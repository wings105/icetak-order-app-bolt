-- Production WhatsApp notification queue, event triggers, secure admin RPCs and consent handling.
-- This migration mirrors the live database changes applied on 2026-07-13.

alter table public.orders add column if not exists whatsapp_opt_in boolean not null default false;
alter table public.notification_queue add column if not exists idempotency_key text;
alter table public.notification_queue add column if not exists locked_at timestamptz;
alter table public.notification_queue add column if not exists processed_at timestamptz;
alter table public.notification_queue add column if not exists provider_message_id text;
alter table public.notification_queue add column if not exists decision_mode text;
alter table public.notification_queue add column if not exists decision_reason text;
create unique index if not exists notification_queue_idempotency_key_uq on public.notification_queue(idempotency_key);

alter table public.whatsapp_outbox add column if not exists attempt_count integer not null default 1;
alter table public.whatsapp_outbox add column if not exists last_attempt_at timestamptz;
alter table public.whatsapp_outbox add column if not exists next_retry_at timestamptz;
alter table public.whatsapp_outbox add column if not exists decision_reason text;
alter table public.whatsapp_outbox add column if not exists window_payload jsonb not null default '{}'::jsonb;
create unique index if not exists whatsapp_outbox_idempotency_key_uq on public.whatsapp_outbox(idempotency_key) where idempotency_key is not null;

create or replace function public.icetak_normalize_phone(p_phone text)
returns text language sql immutable as $$
  select case
    when regexp_replace(coalesce(p_phone,''),'[^0-9]','','g') like '60%' then regexp_replace(coalesce(p_phone,''),'[^0-9]','','g')
    when regexp_replace(coalesce(p_phone,''),'[^0-9]','','g') like '0%' then '6'||regexp_replace(coalesce(p_phone,''),'[^0-9]','','g')
    when regexp_replace(coalesce(p_phone,''),'[^0-9]','','g') like '1%' then '60'||regexp_replace(coalesce(p_phone,''),'[^0-9]','','g')
    else regexp_replace(coalesce(p_phone,''),'[^0-9]','','g') end
$$;

create or replace function public.icetak_customers_phone_normalize_trigger()
returns trigger language plpgsql set search_path=public as $$
begin new.phone:=public.icetak_normalize_phone(new.phone); return new; end;
$$;
drop trigger if exists icetak_customers_phone_normalize_trg on public.customers;
create trigger icetak_customers_phone_normalize_trg before insert or update of phone on public.customers for each row execute function public.icetak_customers_phone_normalize_trigger();

create or replace function public.icetak_whatsapp_vars(p_order_id uuid,p_extra jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare o public.orders%rowtype; c public.customers%rowtype; base_url text; review_url text; result jsonb;
begin
  select * into o from public.orders where id=p_order_id;
  if o.id is null then return coalesce(p_extra,'{}'::jsonb); end if;
  select * into c from public.customers where id=o.customer_id;
  select coalesce(text_value,value->>'url') into base_url from public.whatsapp_settings where key='customer_app_base_url' limit 1;
  base_url:=coalesce(nullif(base_url,''),'https://icetak.bolt.host');
  select coalesce(pc.preview_url,oi.design_preview_url) into review_url from public.order_items oi left join public.production_components pc on pc.order_item_id=oi.id and nullif(pc.preview_url,'') is not null where oi.order_id=o.id and (nullif(oi.design_preview_url,'') is not null or nullif(pc.preview_url,'') is not null) order by coalesce(pc.updated_at,oi.updated_at) desc nulls last limit 1;
  result:=jsonb_strip_nulls(jsonb_build_object(
    'customer_name',coalesce(c.name,o.delivery_name,'Customer'),'phone',public.icetak_normalize_phone(coalesce(c.phone,o.delivery_phone)),
    'order_id',coalesce(o.order_id,o.order_no),'order_token',o.public_token,'order_total','RM'||trim(to_char(coalesce(o.total,0),'FM999999990.00')),
    'date_need',case when o.date_need is null then null else to_char(o.date_need,'DD/MM/YYYY') end,
    'order_link',rtrim(base_url,'/')||'/?order='||coalesce(o.public_token,o.id::text),
    'payment_link',rtrim(base_url,'/')||'/?order='||coalesce(o.public_token,o.id::text)||'&page=payment',
    'review_link',coalesce(nullif(review_url,''),rtrim(base_url,'/')||'/?order='||coalesce(o.public_token,o.id::text)),
    'tracking_number',coalesce(o.tracking,''),'courier',coalesce(o.courier,''),'tracking_link',coalesce(o.tracking_link,''),
    'pickup_location','Bandar Baru Pasir Puteh','support_phone','60179860656','expiry_minutes','10'));
  return result||coalesce(p_extra,'{}'::jsonb);
end;
$$;

create or replace function public.icetak_enqueue_whatsapp_event(p_event_type text,p_order_id uuid,p_extra jsonb default '{}'::jsonb,p_suffix text default null,p_scheduled_at timestamptz default now())
returns uuid language plpgsql security definer set search_path=public as $$
declare o public.orders%rowtype; c public.customers%rowtype; r public.whatsapp_notification_rules%rowtype; qid uuid; idem text; vars jsonb; enabled_global text;
begin
  select * into o from public.orders where id=p_order_id;
  if o.id is null or coalesce(o.whatsapp_opt_in,false)=false then return null; end if;
  select * into r from public.whatsapp_notification_rules where event_type=p_event_type limit 1;
  if r.id is null or not coalesce(r.enabled,false) then return null; end if;
  select coalesce(text_value,'true') into enabled_global from public.whatsapp_settings where key='enabled' limit 1;
  if lower(coalesce(enabled_global,'true')) not in ('true','1','yes','enabled') then return null; end if;
  select * into c from public.customers where id=o.customer_id;
  vars:=public.icetak_whatsapp_vars(p_order_id,p_extra);
  idem:=p_event_type||':'||p_order_id::text||':'||coalesce(nullif(p_suffix,''),'default');
  insert into public.notification_queue(event_type,channel,order_id,customer_id,phone,payload,status,attempts,scheduled_at,created_at,idempotency_key)
  values(p_event_type,'whatsapp',o.id,o.customer_id,public.icetak_normalize_phone(coalesce(c.phone,o.delivery_phone)),jsonb_build_object('event_type',p_event_type,'phone',public.icetak_normalize_phone(coalesce(c.phone,o.delivery_phone)),'vars',vars,'source','database_trigger','idempotency_key',idem),'pending',0,coalesce(p_scheduled_at,now()),now(),idem)
  on conflict(idempotency_key) do nothing returning id into qid;
  return qid;
end;
$$;

create or replace function public.icetak_admin_can_manage_whatsapp()
returns boolean language sql security definer set search_path=public as $$
  select exists(select 1 from public.admin_users au left join public.admin_permissions ap on ap.auth_user_id=au.auth_user_id or ap.admin_user_id=au.id or ap.username=au.username where au.auth_user_id=auth.uid() and coalesce(au.is_active,true) and (lower(coalesce(au.role,'')) in ('owner','admin','super_admin') or 'manage_whatsapp'=any(coalesce(ap.permissions,'{}'::text[]))))
$$;

create or replace function public.icetak_admin_claim_notification_jobs(p_limit integer default 5)
returns setof public.notification_queue language plpgsql security definer set search_path=public as $$
begin
  if not public.icetak_admin_can_manage_whatsapp() then raise exception 'forbidden'; end if;
  update public.notification_queue q set status='skipped',processed_at=now(),decision_reason='order_already_paid' from public.orders o where q.order_id=o.id and q.status='pending' and q.event_type='payment_pending' and lower(coalesce(o.payment_status,o.payment,o.status,'')) similar to '%(paid|matched|payment_received)%';
  return query with picked as (select q.id from public.notification_queue q where q.status='pending' and coalesce(q.scheduled_at,now())<=now() order by q.created_at for update skip locked limit greatest(1,least(coalesce(p_limit,5),20))) update public.notification_queue q set status='processing',locked_at=now(),attempts=coalesce(q.attempts,0)+1 from picked where q.id=picked.id returning q.*;
end;
$$;

create or replace function public.icetak_admin_finish_notification_job(p_id uuid,p_success boolean,p_result jsonb default '{}'::jsonb,p_error text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a integer; next_time timestamptz; final_status text;
begin
  if not public.icetak_admin_can_manage_whatsapp() then raise exception 'forbidden'; end if;
  select coalesce(attempts,1) into a from public.notification_queue where id=p_id;
  if p_success then update public.notification_queue set status='sent',sent_at=now(),processed_at=now(),locked_at=null,last_error=null,provider_message_id=coalesce(p_result->>'message_id',provider_message_id),decision_mode=coalesce(p_result->>'mode',decision_mode),decision_reason=coalesce(p_result->>'decision_reason',decision_reason) where id=p_id; final_status:='sent';
  else final_status:=case when a>=5 then 'failed' else 'pending' end; next_time:=now()+case a when 1 then interval '1 minute' when 2 then interval '5 minutes' when 3 then interval '15 minutes' when 4 then interval '1 hour' else interval '4 hours' end; update public.notification_queue set status=final_status,scheduled_at=next_time,locked_at=null,last_error=coalesce(p_error,'send_failed') where id=p_id; end if;
  return jsonb_build_object('ok',true,'status',final_status,'next_retry_at',case when p_success then null else next_time end);
end;
$$;

create or replace function public.icetak_admin_retry_notification_job(p_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
begin if not public.icetak_admin_can_manage_whatsapp() then raise exception 'forbidden'; end if; update public.notification_queue set status='pending',scheduled_at=now(),locked_at=null,last_error=null where id=p_id; return jsonb_build_object('ok',found); end;
$$;

create or replace function public.icetak_admin_notification_summary()
returns jsonb language plpgsql security definer set search_path=public as $$
begin if not public.icetak_admin_can_manage_whatsapp() then raise exception 'forbidden'; end if; return jsonb_build_object('pending',(select count(*) from public.notification_queue where status='pending'),'processing',(select count(*) from public.notification_queue where status='processing'),'sent',(select count(*) from public.notification_queue where status='sent'),'failed',(select count(*) from public.notification_queue where status='failed'),'recent_queue',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (select id,event_type,phone,status,attempts,last_error,scheduled_at,sent_at,created_at,payload from public.notification_queue order by created_at desc limit 50)x)); end;
$$;

grant execute on function public.icetak_admin_can_manage_whatsapp() to authenticated;
grant execute on function public.icetak_admin_claim_notification_jobs(integer) to authenticated;
grant execute on function public.icetak_admin_finish_notification_job(uuid,boolean,jsonb,text) to authenticated;
grant execute on function public.icetak_admin_retry_notification_job(uuid) to authenticated;
grant execute on function public.icetak_admin_notification_summary() to authenticated;

-- Event triggers and secure WhatsApp admin RPCs are defined in the live migrations of the same release.
