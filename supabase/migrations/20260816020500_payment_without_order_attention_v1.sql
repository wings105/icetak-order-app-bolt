create table if not exists public.payment_order_attention_alerts (
  id uuid primary key default gen_random_uuid(),
  transaction_id text not null,
  alert_type text not null default 'paid_no_order_15m',
  detected_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','sending','retry','sent','resolved','failed')),
  attempts integer not null default 0,
  scheduled_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  resolved_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_order_attention_transaction_unique unique(transaction_id,alert_type)
);

create index if not exists payment_order_attention_status_idx
  on public.payment_order_attention_alerts(status,scheduled_at,detected_at);

alter table public.payment_order_attention_alerts enable row level security;

create or replace function public.icetak_scan_payment_order_attention()
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_inserted integer:=0;
  v_resolved integer:=0;
begin
  update public.payment_order_attention_alerts a
  set status='resolved',resolved_at=now(),locked_at=null,updated_at=now()
  where a.status in ('pending','sending','retry','sent','failed')
    and (
      not exists(select 1 from public.payment_transactions p where p.transaction_id=a.transaction_id)
      or exists(select 1 from public.payment_transactions p where p.transaction_id=a.transaction_id and p.order_id is not null)
      or exists(select 1 from finance.qrpay_payment_controls qc where qc.transaction_id=a.transaction_id and qc.workflow_state='ignored')
    );
  get diagnostics v_resolved=row_count;

  insert into public.payment_order_attention_alerts(transaction_id,alert_type,status,scheduled_at)
  select p.transaction_id,'paid_no_order_15m','pending',now()
  from public.payment_transactions p
  left join finance.qrpay_payment_controls qc on qc.transaction_id=p.transaction_id
  where p.provider in ('qrpay','qrpay_ai','duitnow')
    and p.order_id is null
    and nullif(btrim(coalesce(p.transaction_id,'')),'') is not null
    and coalesce(p.paid_at,p.created_at) <= now()-interval '15 minutes'
    and coalesce(p.paid_at,p.created_at) >= now()-interval '14 days'
    and coalesce(qc.workflow_state,'') <> 'ignored'
  on conflict(transaction_id,alert_type) do nothing;
  get diagnostics v_inserted=row_count;

  return jsonb_build_object('ok',true,'new_alerts',v_inserted,'resolved',v_resolved,'threshold_minutes',15);
end
$$;

create or replace function public.icetak_kick_payment_order_attention()
returns integer
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_ids jsonb;
  v_token text;
  v_count integer:=0;
begin
  update public.payment_order_attention_alerts
  set status='retry',locked_at=null,scheduled_at=now(),updated_at=now(),
      last_error=coalesce(last_error,'stale_sender_recovered')
  where status='sending' and locked_at<now()-interval '10 minutes' and attempts<5;

  update public.payment_order_attention_alerts
  set status='failed',locked_at=null,updated_at=now(),
      last_error=coalesce(last_error,'max_attempts_reached')
  where status in ('sending','retry','pending') and attempts>=5;

  with picked as (
    select id
    from public.payment_order_attention_alerts
    where status in ('pending','retry') and scheduled_at<=now()
    order by detected_at
    for update skip locked
    limit 10
  ), claimed as (
    update public.payment_order_attention_alerts a
    set status='sending',locked_at=now(),attempts=attempts+1,updated_at=now()
    from picked
    where a.id=picked.id
    returning a.id
  )
  select coalesce(jsonb_agg(id),'[]'::jsonb),count(*)::int into v_ids,v_count from claimed;

  if v_count=0 then return 0; end if;

  select setting_value into v_token
  from public.private_runtime_settings
  where setting_key='qrpay_ai_worker_token'
  limit 1;

  if nullif(v_token,'') is null then
    update public.payment_order_attention_alerts
    set status='retry',locked_at=null,scheduled_at=now()+interval '5 minutes',last_error='missing_internal_token',updated_at=now()
    where id in (select value::text::uuid from jsonb_array_elements_text(v_ids));
    return 0;
  end if;

  perform net.http_post(
    url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/payment-order-attention-dispatch',
    headers:=jsonb_build_object('content-type','application/json','x-payment-order-alert-token',v_token),
    body:=jsonb_build_object('alert_ids',v_ids)
  );
  return v_count;
end
$$;

create or replace function public.icetak_retry_payment_order_attention_alerts()
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare v_scan jsonb; v_kicked integer;
begin
  v_scan:=public.icetak_scan_payment_order_attention();
  v_kicked:=public.icetak_kick_payment_order_attention();
  return coalesce(v_scan,'{}'::jsonb)||jsonb_build_object('kicked',v_kicked);
end
$$;

revoke all on table public.payment_order_attention_alerts from public,anon,authenticated;
grant all on table public.payment_order_attention_alerts to service_role;
revoke all on function public.icetak_scan_payment_order_attention() from public,anon,authenticated;
revoke all on function public.icetak_kick_payment_order_attention() from public,anon,authenticated;
revoke all on function public.icetak_retry_payment_order_attention_alerts() from public,anon,authenticated;
grant execute on function public.icetak_scan_payment_order_attention() to service_role;
grant execute on function public.icetak_kick_payment_order_attention() to service_role;
grant execute on function public.icetak_retry_payment_order_attention_alerts() to service_role;

do $$
declare v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname='icetak-payment-order-attention' limit 1;
  if v_jobid is not null then perform cron.unschedule(v_jobid); end if;
  perform cron.schedule('icetak-payment-order-attention','*/5 * * * *','select public.icetak_retry_payment_order_attention_alerts();');
end
$$;
