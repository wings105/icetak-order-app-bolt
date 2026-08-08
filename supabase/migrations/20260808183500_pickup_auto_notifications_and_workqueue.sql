create table if not exists public.pickup_notification_settings (
  singleton boolean primary key default true check (singleton),
  auto_send_enabled boolean not null default false,
  delay_minutes integer not null default 10 check (delay_minutes between 1 and 1440),
  provider_name text not null default 'wasapflow',
  provider_ready boolean not null default false,
  provider_error text,
  template_name text not null default 'order_ready_pickup_notice',
  auto_send_activated_at timestamptz,
  auto_send_disabled_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.pickup_notification_settings(singleton,auto_send_enabled,delay_minutes,provider_name,provider_ready,template_name)
values(true,false,10,'wasapflow',false,'order_ready_pickup_notice') on conflict(singleton) do nothing;
alter table public.pickup_notification_settings enable row level security;
revoke all on public.pickup_notification_settings from anon,authenticated;

insert into public.whatsapp_notification_rules(event_type,label,enabled,prefer_template_when_closed,freeform_text,template_name,template_language,template_params,sort_order,trigger_status,notes,freeform_enabled,template_enabled)
values('order_ready_pickup_auto','Auto Ready For Pickup',true,true,
 'Hi {customer_name}, order {order_id} sudah siap untuk pickup.\n\nLokasi pickup:\n{pickup_location}\n\nSila maklumkan sebelum datang.',
 'order_ready_pickup_notice','ms','["customer_name","order_id","pickup_location"]'::jsonb,95,null,
 'Operational pickup automation. Controlled only by pickup_notification_settings.auto_send_enabled. Queued 10 minutes after pickup_ready_at. No historical backfill.',true,true)
on conflict(event_type) do update set label=excluded.label,freeform_text=excluded.freeform_text,template_name=excluded.template_name,
 template_language=excluded.template_language,template_params=excluded.template_params,notes=excluded.notes,freeform_enabled=true,template_enabled=true;

create or replace function public.icetak_pickup_auto_provider_status()
returns jsonb language plpgsql stable security definer set search_path='public' as $$
declare v_partner boolean; v_waba boolean; v_dispatch_url boolean; v_dispatch_key boolean; v_template boolean; v_rule boolean; v_ready boolean;
begin
 select exists(select 1 from public.whatsapp_settings where key='partner_key' and nullif(secret_value,'') is not null) into v_partner;
 select exists(select 1 from public.whatsapp_settings where key='waba_id' and nullif(text_value,'') is not null) into v_waba;
 select exists(select 1 from public.whatsapp_settings where key='dispatch_url' and nullif(text_value,'') is not null) into v_dispatch_url;
 select exists(select 1 from public.whatsapp_settings where key='dispatch_internal_key' and nullif(secret_value,'') is not null) into v_dispatch_key;
 select exists(select 1 from public.whatsapp_templates where name='order_ready_pickup_notice' and language='ms' and upper(status)='APPROVED') into v_template;
 select exists(select 1 from public.whatsapp_notification_rules where event_type='order_ready_pickup_auto' and enabled) into v_rule;
 v_ready:=v_partner and v_waba and v_dispatch_url and v_dispatch_key and v_template and v_rule;
 return jsonb_build_object('ready',v_ready,'provider','wasapflow','template_name','order_ready_pickup_notice',
  'checks',jsonb_build_object('partner_key',v_partner,'waba_id',v_waba,'dispatcher',v_dispatch_url and v_dispatch_key,'approved_template',v_template,'rule_enabled',v_rule));
end $$;

create or replace function public.icetak_admin_pickup_auto_settings()
returns jsonb language plpgsql stable security definer set search_path='public' as $$
declare cfg public.pickup_notification_settings%rowtype; v_status jsonb;
begin
 if not public.icetak_admin_can_manage_whatsapp() then raise exception 'forbidden'; end if;
 select * into cfg from public.pickup_notification_settings where singleton=true;
 v_status:=public.icetak_pickup_auto_provider_status();
 return jsonb_build_object('auto_send_enabled',coalesce(cfg.auto_send_enabled,false),'delay_minutes',coalesce(cfg.delay_minutes,10),
  'provider_name',cfg.provider_name,'provider_ready',coalesce((v_status->>'ready')::boolean,false),'provider_error',cfg.provider_error,
  'template_name',cfg.template_name,'auto_send_activated_at',cfg.auto_send_activated_at,'updated_at',cfg.updated_at,'provider_status',v_status,
  'pending',(select count(*) from public.notification_queue where event_type='order_ready_pickup_auto' and status='pending'),
  'sent',(select count(*) from public.notification_queue where event_type='order_ready_pickup_auto' and status='sent'),
  'failed',(select count(*) from public.notification_queue where event_type='order_ready_pickup_auto' and status='failed'));
end $$;

create or replace function public.icetak_admin_set_pickup_auto_send(p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='public' as $$
declare cfg public.pickup_notification_settings%rowtype; v_status jsonb; v_enable boolean:=coalesce(p_enabled,false);
begin
 if not public.icetak_admin_can_manage_whatsapp() then raise exception 'forbidden'; end if;
 v_status:=public.icetak_pickup_auto_provider_status();
 if v_enable and not coalesce((v_status->>'ready')::boolean,false) then raise exception 'PICKUP_PROVIDER_NOT_READY'; end if;
 update public.pickup_notification_settings set auto_send_enabled=v_enable,provider_ready=coalesce((v_status->>'ready')::boolean,false),
  provider_error=case when coalesce((v_status->>'ready')::boolean,false) then null else 'Wasapflow dispatcher or approved pickup template incomplete' end,
  auto_send_activated_at=case when v_enable and not auto_send_enabled then now() else auto_send_activated_at end,
  auto_send_disabled_at=case when not v_enable then now() else auto_send_disabled_at end,updated_at=now(),updated_by=auth.uid()
 where singleton=true returning * into cfg;
 if not v_enable then
  update public.notification_queue set status='cancelled',processed_at=now(),locked_at=null,last_error='Pickup Auto Send switched OFF'
  where event_type='order_ready_pickup_auto' and status in ('pending','processing');
 end if;
 return public.icetak_admin_pickup_auto_settings();
end $$;

create or replace function public.icetak_enqueue_auto_pickup_ready(p_order_id uuid,p_ready_at timestamptz default null)
returns uuid language plpgsql security definer set search_path='public','pg_temp' as $$
declare o public.orders%rowtype; c public.customers%rowtype; cfg public.pickup_notification_settings%rowtype; r public.whatsapp_notification_rules%rowtype;
 v_status jsonb; v_ready timestamptz; v_phone text; v_vars jsonb; v_idem text; v_qid uuid;
begin
 select * into cfg from public.pickup_notification_settings where singleton=true;
 if cfg.auto_send_enabled is not true or cfg.auto_send_activated_at is null then return null; end if;
 v_status:=public.icetak_pickup_auto_provider_status(); if not coalesce((v_status->>'ready')::boolean,false) then return null; end if;
 select * into o from public.orders where id=p_order_id; if o.id is null then return null; end if;
 v_ready:=coalesce(p_ready_at,o.pickup_ready_at); if v_ready is null or v_ready < cfg.auto_send_activated_at then return null; end if;
 if lower(coalesce(o.delivery_method,o.delivery,'')) not like '%pickup%' then return null; end if;
 if o.pickup_ready_at is null or o.pickup_collected_at is not null or lower(coalesce(o.status,'')) like '%cancel%' or lower(coalesce(o.fulfillment_stage,''))='cancelled' then return null; end if;
 select * into r from public.whatsapp_notification_rules where event_type='order_ready_pickup_auto' limit 1; if r.id is null or not coalesce(r.enabled,false) then return null; end if;
 select * into c from public.customers where id=o.customer_id; v_phone:=public.icetak_normalize_phone(coalesce(c.phone,o.delivery_phone));
 if v_phone !~ '^601[0-9]{8,9}$' then return null; end if;
 v_vars:=public.icetak_whatsapp_vars(o.id,'{}'::jsonb)||jsonb_build_object('order_db_id',o.id::text,'pickup_ready_at',v_ready);
 v_idem:='order_ready_pickup_auto:'||o.id::text;
 insert into public.notification_queue(event_type,channel,order_id,customer_id,phone,payload,status,attempts,scheduled_at,created_at,idempotency_key)
 values('order_ready_pickup_auto','whatsapp',o.id,o.customer_id,v_phone,
  jsonb_build_object('event_type','order_ready_pickup_auto','phone',v_phone,'mode','auto','vars',v_vars,'source','pickup_auto','order_db_id',o.id,'pickup_ready_at',v_ready,
   'template_name','order_ready_pickup_notice','template_language','ms','template_params',jsonb_build_array('customer_name','order_id','pickup_location'),'idempotency_key',v_idem),
  'pending',0,greatest(now(),v_ready+make_interval(mins=>coalesce(cfg.delay_minutes,10))),now(),v_idem)
 on conflict(idempotency_key) do nothing returning id into v_qid; return v_qid;
end $$;

create or replace function public.icetak_orders_whatsapp_trigger()
returns trigger language plpgsql security definer set search_path='public' as $$
declare old_paid boolean; new_paid boolean; old_cancel boolean; new_cancel boolean; old_ready_pickup boolean; new_ready_pickup boolean; old_status_text text; new_status_text text;
begin
 if tg_op='INSERT' then return new; end if;
 old_paid:=lower(coalesce(old.payment_status,old.payment,'')) similar to '%(paid|matched|payment_received)%'; new_paid:=lower(coalesce(new.payment_status,new.payment,'')) similar to '%(paid|matched|payment_received)%';
 if not old_paid and new_paid then perform public.icetak_enqueue_whatsapp_event('payment_received',new.id,'{}'::jsonb,null,now()); end if;
 if coalesce(old.production_approved,false)=false and coalesce(new.production_approved,false)=true then perform public.icetak_enqueue_whatsapp_event('production_started',new.id,'{}'::jsonb,null,now()); end if;
 old_cancel:=lower(coalesce(old.status,'')||' '||coalesce(old.admin_status,'')) like '%cancel%'; new_cancel:=lower(coalesce(new.status,'')||' '||coalesce(new.admin_status,'')) like '%cancel%';
 if not old_cancel and new_cancel then perform public.icetak_enqueue_whatsapp_event('order_cancelled',new.id,'{}'::jsonb,null,now()); end if;
 old_status_text:=lower(trim(coalesce(old.status,''))); new_status_text:=lower(trim(coalesce(new.status,'')));
 old_ready_pickup:=old_status_text in ('ready for pickup','ready_for_pickup','ready pickup','ready_pickup') or lower(trim(coalesce(old.admin_status,''))) in ('ready for pickup','ready_for_pickup','ready pickup','ready_pickup');
 new_ready_pickup:=new_status_text in ('ready for pickup','ready_for_pickup','ready pickup','ready_pickup') or lower(trim(coalesce(new.admin_status,''))) in ('ready for pickup','ready_for_pickup','ready pickup','ready_pickup');
 if not old_ready_pickup and new_ready_pickup and lower(coalesce(new.delivery_method,new.delivery,'')) like '%pickup%' then perform public.icetak_enqueue_auto_pickup_ready(new.id,new.pickup_ready_at); end if;
 return new;
end $$;

update public.orders set production_approved=true,updated_at=updated_at
where coalesce(production_approved,false)=false and (production_completed_at is not null
 or lower(coalesce(fulfillment_stage,'')) in ('ready_to_ship','awb_created','in_transit','delivery_issue','ready_for_pickup','collected','delivered','completed')
 or lower(coalesce(shipment_status_group,'')) in ('picked_up','shipped','in_transit','out_for_delivery','delivered'));

do $do$
declare src text;
begin
 select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='icetak_admin_orders_enterprise' limit 1;
 src:=replace(src,$old$count(*) filter(where coalesce(pc.review_required,false) and lower(coalesce(pc.review_status,'')) not in ('approved','ok','accepted','not_required'))::int review_pending$old$,$new$count(*) filter(where coalesce(pc.review_required,false) and (lower(coalesce(pc.review_status,'')) in ('waiting_customer_review','waiting_review','pending_review','review') or lower(coalesce(pc.workflow,'')) in ('waiting_review','review_pending','customer_review')))::int review_pending$new$);
 src:=replace(src,$old$(b.pickup_collected_at is not null or b.delivered_at is not null or lower(b.fulfillment_stage) in ('collected','delivered','completed') or lower(b.status) in ('completed','delivered')) is_completed,lower(b.payment)<>'paid' is_unpaid$old$,$new$(b.pickup_collected_at is not null or b.delivered_at is not null or lower(b.fulfillment_stage) in ('collected','delivered','completed') or lower(b.status) in ('completed','delivered')) is_completed,(lower(b.shipment_status_group) in ('picked_up','shipped','in_transit','out_for_delivery') or lower(b.fulfillment_stage)='in_transit' or lower(b.status) in ('shipped','in transit')) is_post_production_shipping,lower(b.payment)<>'paid' is_unpaid$new$);
 src:=replace(src,$old$when 'active' then not f.is_completed and not f.is_cancelled$old$,$new$when 'active' then not f.is_completed and not f.is_cancelled and not f.is_post_production_shipping$new$);
 src:=replace(src,$old$when 'today' then f.date_need=current_date and not f.is_completed and not f.is_cancelled$old$,$new$when 'today' then f.date_need=current_date and not f.is_completed and not f.is_cancelled and not f.is_post_production_shipping$new$);
 src:=replace(src,$old$when 'overdue' then f.date_need<current_date and not f.is_completed and not f.is_cancelled$old$,$new$when 'overdue' then f.date_need<current_date and not f.is_completed and not f.is_cancelled and not f.is_post_production_shipping$new$);
 src:=replace(src,$old$when 'tomorrow' then f.date_need=current_date+1 and not f.is_completed and not f.is_cancelled$old$,$new$when 'tomorrow' then f.date_need=current_date+1 and not f.is_completed and not f.is_cancelled and not f.is_post_production_shipping$new$);
 src:=replace(src,$old$when 'design' then f.review_pending>0 and not f.is_cancelled and not f.is_completed$old$,$new$when 'design' then f.review_pending>0 and not f.is_cancelled and not f.is_completed and not f.is_post_production_shipping$new$);
 src:=replace(src,$old$'active',count(*) filter(where not is_completed and not is_cancelled)$old$,$new$'active',count(*) filter(where not is_completed and not is_cancelled and not is_post_production_shipping)$new$);
 src:=replace(src,$old$'today',count(*) filter(where date_need=current_date and not is_completed and not is_cancelled)$old$,$new$'today',count(*) filter(where date_need=current_date and not is_completed and not is_cancelled and not is_post_production_shipping)$new$);
 src:=replace(src,$old$'overdue',count(*) filter(where date_need<current_date and not is_completed and not is_cancelled)$old$,$new$'overdue',count(*) filter(where date_need<current_date and not is_completed and not is_cancelled and not is_post_production_shipping)$new$);
 src:=replace(src,$old$'tomorrow',count(*) filter(where date_need=current_date+1 and not is_completed and not is_cancelled)$old$,$new$'tomorrow',count(*) filter(where date_need=current_date+1 and not is_completed and not is_cancelled and not is_post_production_shipping)$new$);
 src:=replace(src,$old$'design',count(*) filter(where review_pending>0 and not is_completed and not is_cancelled)$old$,$new$'design',count(*) filter(where review_pending>0 and not is_completed and not is_cancelled and not is_post_production_shipping)$new$);
 execute src;
end $do$;

grant execute on function public.icetak_admin_pickup_auto_settings() to authenticated;
grant execute on function public.icetak_admin_set_pickup_auto_send(boolean) to authenticated;
revoke execute on function public.icetak_admin_pickup_auto_settings() from anon;
revoke execute on function public.icetak_admin_set_pickup_auto_send(boolean) from anon;
