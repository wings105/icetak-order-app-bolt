create table shipping_ops.pending_pickup_checks (
 shipment_id uuid primary key references public.shipments(id),
 checked_at timestamptz not null default now(),
 provider_status text, provider_group text, result text not null, last_error text, observation jsonb not null default '{}'::jsonb
);
alter table shipping_ops.pending_pickup_checks enable row level security;
grant all on shipping_ops.pending_pickup_checks to service_role;
create table shipping_ops.pending_pickup_poll_lease (
 singleton boolean primary key default true check(singleton), run_id uuid, locked_until timestamptz
);
insert into shipping_ops.pending_pickup_poll_lease(singleton) values(true);
alter table shipping_ops.pending_pickup_poll_lease enable row level security;
grant all on shipping_ops.pending_pickup_poll_lease to service_role;

create function public.icetak_pending_pickup_poll_claim(p_run uuid) returns boolean
language sql security invoker set search_path='' as $$
 with claimed as (update shipping_ops.pending_pickup_poll_lease set run_id=p_run,locked_until=now()+interval '5 minutes'
 where singleton and (locked_until is null or locked_until<now()) returning 1) select exists(select 1 from claimed);
$$;
create function public.icetak_pending_pickup_poll_release(p_run uuid) returns void
language sql security invoker set search_path='' as $$
 update shipping_ops.pending_pickup_poll_lease set locked_until=null,run_id=null where singleton and run_id=p_run;
$$;
create function public.icetak_pending_pickup_poll_candidates() returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) from (
  select s.id,s.tracking_no from jsonb_array_elements(public.icetak_pending_pickup_snapshot()->'items') x
  join public.shipments s on s.id=(x->>'id')::uuid
  left join shipping_ops.pending_pickup_checks c on c.shipment_id=s.id
  where s.provider='parceldaily'
  order by c.checked_at nulls first,s.created_at,s.id limit 20
 ) q;
$$;

create function public.icetak_apply_pending_pickup_check(p_shipment_id uuid,p_observation jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 v_shipment public.shipments; v_status text:=nullif(btrim(p_observation->>'status'),'');
 v_group text:=nullif(btrim(p_observation->>'statusGroup'),''); v_result text; v_error text;
 v_cancelled boolean; v_event_id text;
begin
 select * into v_shipment from public.shipments where id=p_shipment_id for update;
 if not found or v_shipment.provider is distinct from 'parceldaily' then raise exception 'SHIPMENT_NOT_FOUND';end if;
 if nullif(p_observation->>'error','') is not null then
  v_result:='error';v_error:=left(p_observation->>'error',200);
 elsif upper(btrim(coalesce(p_observation->>'consign_no','')))<>upper(btrim(v_shipment.tracking_no)) then
  v_result:='identity_mismatch';v_error:='PROVIDER_IDENTITY_MISMATCH';
 elsif v_status is null then
  v_result:='error';v_error:='PROVIDER_STATUS_MISSING';
 else
  -- Group is authoritative when present. A request/pending cancellation is not final cancellation.
  v_cancelled:=lower(coalesce(v_group,v_status)) in ('cancelled','canceled','cancelled by user','canceled by user');
  if not v_cancelled then v_result:='unchanged';
  elsif v_shipment.cancelled_at is not null or v_shipment.normalized_status='cancelled' then v_result:='already_cancelled';
  elsif not exists(select 1 from jsonb_array_elements(public.icetak_pending_pickup_snapshot()->'items') x where (x->>'id')::uuid=p_shipment_id) then
   v_result:='no_longer_pending';
  else
   update public.shipments set status=coalesce(v_group,v_status),status_group='cancelled',normalized_status='cancelled',cancelled_at=now(),updated_at=now()
   where id=p_shipment_id;
   v_event_id:='pending-pickup-provider-cancel:'||p_shipment_id::text;
   insert into public.shipment_events(shipment_id,order_id,provider,provider_event_id,event_key,tracking_no,courier,status,status_group,normalized_status,previous_status,event_name,event_time,raw_payload,source)
   values(p_shipment_id,v_shipment.order_id,'parceldaily',v_event_id,v_event_id,v_shipment.tracking_no,v_shipment.courier,coalesce(v_group,v_status),'cancelled','cancelled',v_shipment.status,'PROVIDER_STATUS_RECONCILIATION',now(),p_observation,'provider_poll')
   on conflict do nothing;
   update public.shipment_tracking_state set send_status='cancelled',blocked_reason='PROVIDER_CANCELLED',updated_at=now()
   where shipment_id=p_shipment_id and send_status<>'sent';
   v_result:='cancelled';
  end if;
 end if;
 insert into shipping_ops.pending_pickup_checks(shipment_id,checked_at,provider_status,provider_group,result,last_error,observation)
 values(p_shipment_id,now(),v_status,v_group,v_result,v_error,p_observation)
 on conflict(shipment_id) do update set checked_at=now(),provider_status=excluded.provider_status,provider_group=excluded.provider_group,result=excluded.result,last_error=excluded.last_error,observation=excluded.observation;
 return jsonb_build_object('status',v_result,'shipment_id',p_shipment_id);
end $$;

create function public.icetak_pending_pickup_poll_kick() returns bigint
language plpgsql security invoker set search_path='' as $$
declare v_token text; v_id bigint;
begin
 select setting_value into v_token from public.private_runtime_settings where setting_key='qrpay_ai_worker_token';
 if coalesce(v_token,'')='' then raise exception 'MISSING_INTERNAL_TOKEN';end if;
 select net.http_post(url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/shipping-pickup-reconcile',headers:=jsonb_build_object('content-type','application/json','x-pickup-reconcile-token',v_token),body:='{}'::jsonb,timeout_milliseconds:=60000) into v_id;
 return v_id;
end $$;
revoke all on function public.icetak_pending_pickup_poll_claim(uuid),public.icetak_pending_pickup_poll_release(uuid),public.icetak_pending_pickup_poll_candidates(),public.icetak_apply_pending_pickup_check(uuid,jsonb),public.icetak_pending_pickup_poll_kick() from public,anon,authenticated;
grant execute on function public.icetak_pending_pickup_poll_claim(uuid),public.icetak_pending_pickup_poll_release(uuid),public.icetak_pending_pickup_poll_candidates(),public.icetak_apply_pending_pickup_check(uuid,jsonb),public.icetak_pending_pickup_poll_kick() to service_role;

CREATE OR REPLACE FUNCTION public.shipment_sync_order_after_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  ns text := coalesce(nullif(new.normalized_status,''), public.normalize_shipping_status(new.status,new.status_group));
  next_status text;
  next_admin text;
  next_tab text;
  next_stage text;
  next_delivered_at timestamptz;
  courier_key text := public.icetak_shipping_courier_key(coalesce(nullif(new.courier,''),new.service_provider),new.tracking_no);
  delivery_label text;
  has_active_courier boolean;
begin
  if new.order_id is null then return new; end if;

  update public.shipment_events
  set order_id=new.order_id
  where shipment_id=new.id and order_id is distinct from new.order_id;

  -- A cancelled superseded AWB must not overwrite the current shipment on its order.
  if ns='cancelled' and exists (
    select 1 from public.shipments s
    where s.order_id=new.order_id and s.id<>new.id
      and s.cancelled_at is null and s.archived_at is null
      and coalesce(s.normalized_status,'') not in ('cancelled','archived')
      and (s.created_at>new.created_at or s.tracking_no=(select o.tracking from public.orders o where o.id=new.order_id))
  ) then return new; end if;

  has_active_courier := new.cancelled_at is null
    and nullif(btrim(coalesce(new.tracking_no,'')),'') is not null
    and courier_key in ('spx','jnt','ninja');

  delivery_label := case courier_key
    when 'spx' then 'SPX'
    when 'jnt' then 'JNT'
    when 'ninja' then 'NINJA'
    else null end;

  next_status:=case
    when ns='delivered' then 'Completed'
    when ns='out_for_delivery' then 'Out for Delivery'
    when ns in ('picked_up','in_transit','shipped') then 'Shipped'
    when ns in ('awb_created','shipment_created') then 'AWB Created'
    when ns in ('delivery_failed','failed','exception') then 'Delivery Issue'
    when ns in ('returned','return_to_sender') then 'Returned'
    when has_active_courier then 'AWB Created'
    else null end;
  next_admin:=case
    when ns='delivered' then 'Delivered'
    when ns='out_for_delivery' then 'Out for Delivery'
    when ns='in_transit' then 'In Transit'
    when ns in ('picked_up','shipped') then 'Picked Up by Courier'
    when ns in ('awb_created','shipment_created') then 'AWB Created — Waiting Courier'
    when ns in ('delivery_failed','failed','exception') then 'Delivery Issue'
    when ns in ('returned','return_to_sender') then 'Returned / Return to Sender'
    when has_active_courier then 'AWB Created — Waiting Courier'
    else null end;
  next_tab:=case
    when ns='delivered' then 'completed'
    when ns in ('picked_up','shipped','in_transit','out_for_delivery','delivery_failed','failed','exception','returned','return_to_sender') then 'receive'
    when ns in ('awb_created','shipment_created') or has_active_courier then 'progress'
    else null end;
  next_stage:=case
    when ns='delivered' then 'delivered'
    when ns in ('picked_up','shipped','in_transit','out_for_delivery') then 'in_transit'
    when ns in ('awb_created','shipment_created') or has_active_courier then 'awb_created'
    when ns in ('delivery_failed','failed','exception','returned','return_to_sender') then 'delivery_issue'
    else null end;
  next_delivered_at:=case when ns='delivered' then coalesce(new.updated_at,now()) else null end;

  update public.orders o
  set tracking=coalesce(new.tracking_no,o.tracking),
      courier=case when has_active_courier then courier_key else coalesce(new.courier,new.service_provider,o.courier) end,
      delivery=case when has_active_courier then delivery_label else o.delivery end,
      delivery_method=case when has_active_courier then courier_key else o.delivery_method end,
      tracking_link=coalesce(new.tracking_link,o.tracking_link),
      connote_url=coalesce(new.awb_pdf_url,new.connote_url,new.thermal_connote_url,o.connote_url),
      shipment_status=coalesce(new.status,o.shipment_status),
      shipment_status_group=coalesce(ns,new.status_group,o.shipment_status_group),
      shipment_updated_at=coalesce(new.updated_at,now()),
      status=coalesce(next_status,o.status),
      admin_status=coalesce(next_admin,o.admin_status),
      tab=coalesce(next_tab,o.tab),
      fulfillment_stage=coalesce(next_stage,o.fulfillment_stage),
      pickup_ready_at=case when has_active_courier then null else o.pickup_ready_at end,
      pickup_collected_at=case when has_active_courier then null else o.pickup_collected_at end,
      delivered_at=case when has_active_courier then next_delivered_at else coalesce(next_delivered_at,o.delivered_at) end,
      updated_at=greatest(coalesce(o.updated_at,'epoch'::timestamptz),coalesce(new.updated_at,now()))
  where o.id=new.order_id
    and (
      o.shipment_updated_at is null
      or coalesce(new.updated_at,now()) >= o.shipment_updated_at
      or lower(coalesce(ns,''))='delivered'
      or has_active_courier and lower(coalesce(o.delivery_method,o.delivery,'')) like '%pickup%'
    );

  return new;
end;
$function$
