create table if not exists public.shipment_attention_alerts (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  alert_type text not null default 'stuck_48h',
  last_movement_at timestamptz not null,
  detected_at timestamptz not null default now(),
  status text not null default 'pending',
  attempts integer not null default 0,
  scheduled_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  resolved_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipment_attention_alerts_status_chk check (status in ('pending','sending','retry','sent','failed','resolved','cancelled')),
  constraint shipment_attention_alerts_episode_uniq unique (shipment_id, alert_type, last_movement_at)
);

create index if not exists shipment_attention_alerts_status_idx on public.shipment_attention_alerts(status, scheduled_at, detected_at);
create index if not exists shipment_attention_alerts_shipment_idx on public.shipment_attention_alerts(shipment_id, detected_at desc);
alter table public.shipment_attention_alerts enable row level security;
revoke all on public.shipment_attention_alerts from anon, authenticated;

create or replace function public.icetak_scan_stuck_shipments()
returns jsonb language plpgsql security definer set search_path='public','pg_temp'
as $function$
declare v_inserted integer:=0; v_resolved integer:=0;
begin
  with current_state as (
    select s.id shipment_id,
      coalesce((select max(coalesce(e.event_time,e.created_at)) from public.shipment_events e where e.shipment_id=s.id),st.first_scan_at,s.shipped_at,s.created_at) last_movement_at,
      lower(coalesce(s.normalized_status,s.status,'')) status_key,st.first_scan_at
    from public.shipments s join public.shipment_tracking_state st on st.shipment_id=s.id
    where nullif(btrim(coalesce(s.tracking_no,'')),'') is not null
  )
  update public.shipment_attention_alerts a set status='resolved',resolved_at=now(),locked_at=null,updated_at=now()
  from current_state c where a.shipment_id=c.shipment_id and a.status in ('pending','sending','retry','sent','failed')
    and (c.first_scan_at is null or c.status_key ~ '(delivered|cancelled|canceled|failed|exception|returned_to_sender|return_to_sender)' or c.last_movement_at>a.last_movement_at+interval '1 second');
  get diagnostics v_resolved=row_count;

  with candidates as (
    select s.id shipment_id,
      coalesce((select max(coalesce(e.event_time,e.created_at)) from public.shipment_events e where e.shipment_id=s.id),st.first_scan_at,s.shipped_at,s.created_at) last_movement_at,
      lower(coalesce(s.normalized_status,s.status,'')) status_key
    from public.shipments s join public.shipment_tracking_state st on st.shipment_id=s.id
    where st.first_scan_at is not null and nullif(btrim(coalesce(s.tracking_no,'')),'') is not null and s.cancelled_at is null
  )
  insert into public.shipment_attention_alerts(shipment_id,alert_type,last_movement_at,status,scheduled_at)
  select c.shipment_id,'stuck_48h',c.last_movement_at,'pending',now() from candidates c
  where c.last_movement_at is not null and now()-c.last_movement_at>interval '48 hours'
    and c.status_key !~ '(delivered|cancelled|canceled|failed|exception|returned_to_sender|return_to_sender)'
  on conflict (shipment_id,alert_type,last_movement_at) do nothing;
  get diagnostics v_inserted=row_count;
  return jsonb_build_object('ok',true,'new_alerts',v_inserted,'resolved',v_resolved);
end $function$;

create or replace function public.icetak_admin_shipping_attention_summary()
returns jsonb language plpgsql stable security definer set search_path='public','pg_temp'
as $function$
declare v_attention integer; v_critical integer; v_oldest numeric;
begin
  if not public.icetak_admin_can_manage_shipping_messages() then raise exception 'ADMIN_REQUIRED'; end if;
  with x as (
    select s.id,
      coalesce((select max(coalesce(e.event_time,e.created_at)) from public.shipment_events e where e.shipment_id=s.id),st.first_scan_at,s.shipped_at,s.created_at) last_movement_at,
      lower(coalesce(s.normalized_status,s.status,'')) status_key
    from public.shipments s join public.shipment_tracking_state st on st.shipment_id=s.id
    where st.first_scan_at is not null and nullif(btrim(coalesce(s.tracking_no,'')),'') is not null and s.cancelled_at is null
  ), stuck as (
    select *,extract(epoch from (now()-last_movement_at))/3600.0 hours from x
    where last_movement_at is not null and now()-last_movement_at>interval '48 hours'
      and status_key !~ '(delivered|cancelled|canceled|failed|exception|returned_to_sender|return_to_sender)'
  )
  select count(*)::int,count(*) filter(where hours>=72)::int,coalesce(max(hours),0) into v_attention,v_critical,v_oldest from stuck;
  return jsonb_build_object('attention',coalesce(v_attention,0),'critical',coalesce(v_critical,0),'threshold_hours',48,'oldest_hours',round(coalesce(v_oldest,0)::numeric,1));
end $function$;

grant execute on function public.icetak_admin_shipping_attention_summary() to authenticated;
revoke execute on function public.icetak_scan_stuck_shipments() from public,anon,authenticated;
grant execute on function public.icetak_scan_stuck_shipments() to service_role;

create or replace function public.icetak_kick_shipping_attention_digest()
returns integer language plpgsql security definer set search_path='public','pg_temp'
as $function$
declare v_ids jsonb; v_token text; v_count integer:=0;
begin
  update public.shipment_attention_alerts set status='retry',locked_at=null,scheduled_at=now(),updated_at=now(),last_error=coalesce(last_error,'stale_sender_recovered')
  where status='sending' and locked_at<now()-interval '10 minutes' and attempts<5;
  update public.shipment_attention_alerts set status='failed',locked_at=null,updated_at=now(),last_error=coalesce(last_error,'max_attempts_reached')
  where status in ('sending','retry','pending') and attempts>=5;

  with picked as (
    select id from public.shipment_attention_alerts where status in ('pending','retry') and scheduled_at<=now()
    order by detected_at for update skip locked limit 15
  ), claimed as (
    update public.shipment_attention_alerts a set status='sending',locked_at=now(),attempts=attempts+1,updated_at=now()
    from picked where a.id=picked.id returning a.id
  ) select coalesce(jsonb_agg(id),'[]'::jsonb),count(*)::int into v_ids,v_count from claimed;

  if v_count=0 then return 0; end if;
  select setting_value into v_token from public.private_runtime_settings where setting_key='qrpay_ai_worker_token' limit 1;
  if nullif(v_token,'') is null then
    update public.shipment_attention_alerts set status='retry',locked_at=null,scheduled_at=now()+interval '5 minutes',last_error='missing_internal_token',updated_at=now()
    where id in (select value::text::uuid from jsonb_array_elements_text(v_ids));
    return 0;
  end if;
  perform net.http_post(url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/shipping-attention-dispatch',headers:=jsonb_build_object('content-type','application/json','x-shipping-alert-token',v_token),body:=jsonb_build_object('alert_ids',v_ids));
  return v_count;
end $function$;

create or replace function public.icetak_retry_shipping_attention_alerts()
returns jsonb language plpgsql security definer set search_path='public','pg_temp'
as $function$
declare v_scan jsonb; v_kicked integer;
begin
  v_scan:=public.icetak_scan_stuck_shipments();
  v_kicked:=public.icetak_kick_shipping_attention_digest();
  return coalesce(v_scan,'{}'::jsonb)||jsonb_build_object('kicked',v_kicked);
end $function$;

revoke execute on function public.icetak_kick_shipping_attention_digest() from public,anon,authenticated;
revoke execute on function public.icetak_retry_shipping_attention_alerts() from public,anon,authenticated;
grant execute on function public.icetak_kick_shipping_attention_digest() to service_role;
grant execute on function public.icetak_retry_shipping_attention_alerts() to service_role;

select cron.unschedule(jobid) from cron.job where jobname='icetak-shipping-stuck-attention';
select cron.schedule('icetak-shipping-stuck-attention','*/15 * * * *','select public.icetak_retry_shipping_attention_alerts();');
