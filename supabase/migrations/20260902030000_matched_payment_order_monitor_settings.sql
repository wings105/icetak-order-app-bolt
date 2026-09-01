-- Monitor a payment only when it is a confirmed customer checkout match and
-- still has no real order.  An explicit admin ignore remains the only
-- non-order resolution path.

create table if not exists public.payment_order_attention_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default true,
  delay_minutes integer not null default 15 check (delay_minutes between 1 and 1440),
  enabled_at timestamptz,
  disabled_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.payment_order_attention_settings(singleton,enabled,delay_minutes,enabled_at)
values(true,true,15,now())
on conflict(singleton) do nothing;

alter table public.payment_order_attention_settings enable row level security;
revoke all on public.payment_order_attention_settings from public,anon,authenticated;

alter table public.payment_order_attention_alerts
  drop constraint if exists payment_order_attention_alerts_status_check;
alter table public.payment_order_attention_alerts
  add constraint payment_order_attention_alerts_status_check
  check (status in ('pending','sending','retry','sent','resolved','failed','disabled'));

create or replace function public.icetak_admin_payment_order_attention_settings()
returns jsonb
language plpgsql
security definer
set search_path = 'public','pg_temp'
as $function$
declare cfg public.payment_order_attention_settings%rowtype;
begin
  if not public.icetak_admin_has_permission('manage_admins') then raise exception 'Forbidden'; end if;
  select * into cfg from public.payment_order_attention_settings where singleton=true;
  return jsonb_build_object(
    'enabled',coalesce(cfg.enabled,true),
    'delay_minutes',coalesce(cfg.delay_minutes,15),
    'updated_at',cfg.updated_at,
    'enabled_at',cfg.enabled_at,
    'disabled_at',cfg.disabled_at,
    'open_alerts',(select count(*) from public.payment_order_attention_alerts where status in ('pending','sending','retry','sent','failed'))
  );
end;
$function$;

create or replace function public.icetak_admin_set_payment_order_attention_enabled(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = 'public','pg_temp'
as $function$
declare v_enabled boolean:=coalesce(p_enabled,false);
begin
  if not public.icetak_admin_has_permission('manage_admins') then raise exception 'Forbidden'; end if;
  update public.payment_order_attention_settings
  set enabled=v_enabled,
      enabled_at=case when v_enabled and not enabled then now() else enabled_at end,
      disabled_at=case when not v_enabled and enabled then now() else disabled_at end,
      updated_at=now(),updated_by=auth.uid()
  where singleton=true;

  if v_enabled then
    update public.payment_order_attention_alerts a
    set status='pending',scheduled_at=now(),locked_at=null,last_error=null,updated_at=now()
    where a.status='disabled'
      and exists (
        select 1
        from public.payment_transactions p
        join public.payment_sessions ps on ps.id=p.payment_session_id and ps.status='matched'
        where p.transaction_id=a.transaction_id
          and p.order_id is null and ps.order_id is null
      )
      and not exists(select 1 from finance.qrpay_payment_controls qc where qc.transaction_id=a.transaction_id and qc.workflow_state='ignored');
  else
    update public.payment_order_attention_alerts
    set status='disabled',locked_at=null,updated_at=now(),last_error='Matched payment order monitor switched OFF'
    where status in ('pending','sending','retry');
  end if;

  insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
  values(null,null,'payment_order_monitor_'||case when v_enabled then 'enabled' else 'disabled' end,
    coalesce(auth.jwt()->>'email',auth.uid()::text,'admin'),jsonb_build_object('enabled',v_enabled));
  return public.icetak_admin_payment_order_attention_settings();
end;
$function$;

create or replace function public.icetak_scan_payment_order_attention()
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare v_inserted integer:=0; v_resolved integer:=0; cfg public.payment_order_attention_settings%rowtype;
begin
  select * into cfg from public.payment_order_attention_settings where singleton=true;
  if coalesce(cfg.enabled,true) is not true then
    return jsonb_build_object('ok',true,'enabled',false,'new_alerts',0,'resolved',0,'threshold_minutes',coalesce(cfg.delay_minutes,15));
  end if;

  update public.payment_order_attention_alerts a
  set status='resolved',resolved_at=now(),locked_at=null,updated_at=now()
  where a.status in ('pending','sending','retry','sent','failed')
    and (
      not exists(select 1 from public.payment_transactions p where p.transaction_id=a.transaction_id)
      or exists(
        select 1 from public.payment_transactions p
        left join public.payment_sessions ps on ps.id=p.payment_session_id
        where p.transaction_id=a.transaction_id and (p.order_id is not null or ps.order_id is not null)
      )
      or exists(select 1 from finance.qrpay_payment_controls qc where qc.transaction_id=a.transaction_id and qc.workflow_state='ignored')
    );
  get diagnostics v_resolved=row_count;

  insert into public.payment_order_attention_alerts(transaction_id,alert_type,status,scheduled_at)
  select p.transaction_id,'matched_checkout_no_order','pending',now()
  from public.payment_transactions p
  join public.payment_sessions ps on ps.id=p.payment_session_id and ps.status='matched'
  left join finance.qrpay_payment_controls qc on qc.transaction_id=p.transaction_id
  where p.provider in ('qrpay','qrpay_ai','duitnow')
    and p.order_id is null and ps.order_id is null
    and nullif(btrim(coalesce(p.transaction_id,'')),'') is not null
    and coalesce(p.paid_at,p.created_at) <= now()-make_interval(mins=>coalesce(cfg.delay_minutes,15))
    and coalesce(p.paid_at,p.created_at) >= now()-interval '14 days'
    and coalesce(qc.workflow_state,'') <> 'ignored'
  on conflict(transaction_id,alert_type) do update
    set status=case when public.payment_order_attention_alerts.status='disabled' then 'pending' else public.payment_order_attention_alerts.status end,
        scheduled_at=case when public.payment_order_attention_alerts.status='disabled' then now() else public.payment_order_attention_alerts.scheduled_at end,
        updated_at=case when public.payment_order_attention_alerts.status='disabled' then now() else public.payment_order_attention_alerts.updated_at end;
  get diagnostics v_inserted=row_count;

  return jsonb_build_object('ok',true,'enabled',true,'new_alerts',v_inserted,'resolved',v_resolved,'threshold_minutes',coalesce(cfg.delay_minutes,15));
end;
$function$;

create or replace function public.icetak_kick_payment_order_attention()
returns integer
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare v_ids jsonb; v_token text; v_count integer:=0; v_enabled boolean;
begin
  select enabled into v_enabled from public.payment_order_attention_settings where singleton=true;
  if coalesce(v_enabled,true) is not true then return 0; end if;
  update public.payment_order_attention_alerts set status='retry',locked_at=null,scheduled_at=now(),updated_at=now(),last_error=coalesce(last_error,'stale_sender_recovered') where status='sending' and locked_at<now()-interval '10 minutes' and attempts<5;
  update public.payment_order_attention_alerts set status='failed',locked_at=null,updated_at=now(),last_error=coalesce(last_error,'max_attempts_reached') where status in ('sending','retry','pending') and attempts>=5;
  with picked as (select id from public.payment_order_attention_alerts where status in ('pending','retry') and scheduled_at<=now() order by detected_at for update skip locked limit 10), claimed as (update public.payment_order_attention_alerts a set status='sending',locked_at=now(),attempts=attempts+1,updated_at=now() from picked where a.id=picked.id returning a.id) select coalesce(jsonb_agg(id),'[]'::jsonb),count(*)::int into v_ids,v_count from claimed;
  if v_count=0 then return 0; end if;
  select setting_value into v_token from public.private_runtime_settings where setting_key='qrpay_ai_worker_token' limit 1;
  if nullif(v_token,'') is null then update public.payment_order_attention_alerts set status='retry',locked_at=null,scheduled_at=now()+interval '5 minutes',last_error='missing_internal_token',updated_at=now() where id in (select value::text::uuid from jsonb_array_elements_text(v_ids)); return 0; end if;
  perform net.http_post(url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/payment-order-attention-dispatch',headers:=jsonb_build_object('content-type','application/json','x-payment-order-alert-token',v_token),body:=jsonb_build_object('alert_ids',v_ids));
  return v_count;
end;
$function$;

revoke all on function public.icetak_admin_payment_order_attention_settings() from public,anon;
revoke all on function public.icetak_admin_set_payment_order_attention_enabled(boolean) from public,anon;
grant execute on function public.icetak_admin_payment_order_attention_settings() to authenticated,service_role;
grant execute on function public.icetak_admin_set_payment_order_attention_enabled(boolean) to authenticated,service_role;
