-- Owner-only QRPay daily control page and reliable 10AM/10PM MYT summary delivery.

create extension if not exists pgcrypto;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create table if not exists finance.qrpay_daily_summary_runs (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  summary_date date not null,
  slot text not null check (slot in ('10am','10pm')),
  status text not null default 'pending' check (status in ('pending','sending','retry','sent','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  scheduled_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  sent_at timestamptz,
  recipient_phone text,
  provider_message_id text,
  last_error text,
  snapshot jsonb not null default '{}'::jsonb,
  message_preview text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (summary_date,slot)
);

create index if not exists finance_qrpay_summary_due_idx
  on finance.qrpay_daily_summary_runs(next_attempt_at,id)
  where status in ('pending','retry');

create index if not exists payment_transactions_qrpay_daily_idx
  on public.payment_transactions(paid_at desc)
  where provider in ('qrpay','qrpay_ai','duitnow');

create index if not exists unmatched_payment_qrpay_daily_idx
  on public.unmatched_payment_transactions(paid_at desc)
  where provider in ('qrpay','qrpay_ai','duitnow');

create index if not exists qrpay_ai_jobs_unmatched_payment_idx
  on public.qrpay_ai_jobs(unmatched_payment_id)
  where unmatched_payment_id is not null;

create index if not exists admin_order_reviews_qrpay_job_idx
  on public.admin_order_reviews(qrpay_job_id)
  where qrpay_job_id is not null;

alter table finance.qrpay_daily_summary_runs enable row level security;
alter table finance.qrpay_daily_summary_runs force row level security;
revoke all on finance.qrpay_daily_summary_runs from public,anon,authenticated;
grant select,insert,update on finance.qrpay_daily_summary_runs to service_role;
grant usage,select on sequence finance.qrpay_daily_summary_runs_id_seq to service_role;

insert into public.private_runtime_settings(setting_key,setting_value)
values ('qrpay_daily_summary_token',encode(gen_random_bytes(32),'hex'))
on conflict(setting_key) do nothing;

create or replace function public.finance_admin_qrpay_daily(p_date date default null)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
with requested as (
  select coalesce(p_date,(now() at time zone 'Asia/Kuala_Lumpur')::date) summary_date
), bounds as (
  select summary_date,
    summary_date::timestamp at time zone 'Asia/Kuala_Lumpur' from_ts,
    (summary_date::timestamp + interval '1 day') at time zone 'Asia/Kuala_Lumpur' to_ts
  from requested
), matched as (
  select
    1 source_priority,
    'matched'::text source,
    p.transaction_id,
    p.amount,
    coalesce(p.paid_at,p.created_at) paid_at,
    nullif(p.sender_name,'') sender_name,
    p.provider,
    'matched_order'::text workflow_status,
    p.order_id,
    o.order_no,
    o.public_token,
    coalesce(nullif(regexp_replace(o.delivery_phone,'[^0-9]','','g'),''),nullif(regexp_replace(c.phone,'[^0-9]','','g'),''),nullif(p.raw_payload->>'matched_phone','')) phone,
    null::text job_status,
    null::text review_status
  from public.payment_transactions p
  join bounds b on coalesce(p.paid_at,p.created_at)>=b.from_ts and coalesce(p.paid_at,p.created_at)<b.to_ts
  left join public.orders o on o.id=p.order_id
  left join public.customers c on c.id=o.customer_id
  where p.provider in ('qrpay','qrpay_ai','duitnow')
), unmatched as (
  select
    2 source_priority,
    'unmatched'::text source,
    u.transaction_id,
    u.amount,
    coalesce(u.paid_at,u.created_at) paid_at,
    nullif(u.sender_name,'') sender_name,
    u.provider,
    case
      when r.status in ('pending_admin','awaiting_admin_detail') or j.status='needs_review' then 'needs_review'
      when j.status in ('waiting','processing','retry','matched','order_created') then 'processing'
      when j.status in ('failed','unmatched') or j.id is null then 'missed'
      else 'pending'
    end workflow_status,
    j.order_id,
    coalesce(j.order_no,o.order_no),
    o.public_token,
    coalesce(nullif(regexp_replace(o.delivery_phone,'[^0-9]','','g'),''),nullif(regexp_replace(c.phone,'[^0-9]','','g'),''),nullif(regexp_replace(r.candidate_phone,'[^0-9]','','g'),''),nullif(regexp_replace(j.matched_phone,'[^0-9]','','g'),'')) phone,
    j.status job_status,
    r.status review_status
  from public.unmatched_payment_transactions u
  join bounds b on coalesce(u.paid_at,u.created_at)>=b.from_ts and coalesce(u.paid_at,u.created_at)<b.to_ts
  left join public.qrpay_ai_jobs j on j.unmatched_payment_id=u.id or (j.unmatched_payment_id is null and j.transaction_id=u.transaction_id)
  left join lateral (
    select ar.* from public.admin_order_reviews ar
    where ar.qrpay_job_id=j.id
    order by ar.updated_at desc limit 1
  ) r on true
  left join public.orders o on o.id=j.order_id
  left join public.customers c on c.id=o.customer_id
  where u.provider in ('qrpay','qrpay_ai','duitnow')
), combined as (
  select * from matched
  union all
  select * from unmatched
), rows as (
  select distinct on(transaction_id)
    source,transaction_id,amount,paid_at,sender_name,provider,workflow_status,order_id,order_no,public_token,phone,job_status,review_status
  from combined
  order by transaction_id,source_priority
), totals as (
  select
    count(*) total_count,
    coalesce(sum(amount),0) total_amount,
    count(*) filter(where workflow_status='matched_order') matched_count,
    coalesce(sum(amount) filter(where workflow_status='matched_order'),0) matched_amount,
    count(*) filter(where workflow_status='needs_review') review_count,
    coalesce(sum(amount) filter(where workflow_status='needs_review'),0) review_amount,
    count(*) filter(where workflow_status in ('processing','pending')) processing_count,
    coalesce(sum(amount) filter(where workflow_status in ('processing','pending')),0) processing_amount,
    count(*) filter(where workflow_status='missed') missed_count,
    coalesce(sum(amount) filter(where workflow_status='missed'),0) missed_amount,
    count(*) filter(where workflow_status<>'matched_order') unresolved_count,
    coalesce(sum(amount) filter(where workflow_status<>'matched_order'),0) unresolved_amount
  from rows
), delivery as (
  select to_jsonb(x) value from (
    select slot,status,attempts,scheduled_at,sent_at,recipient_phone,last_error
    from finance.qrpay_daily_summary_runs q,requested r
    where q.summary_date=r.summary_date
    order by q.created_at desc limit 1
  ) x
)
select jsonb_build_object(
  'date',(select summary_date from requested),
  'timezone','Asia/Kuala_Lumpur',
  'generated_at',now(),
  'totals',(select to_jsonb(totals) from totals),
  'rows',(select coalesce(jsonb_agg(jsonb_build_object(
    'source',source,
    'transaction_id',transaction_id,
    'amount',amount,
    'paid_at',paid_at,
    'sender_name',sender_name,
    'provider',provider,
    'workflow_status',workflow_status,
    'order_id',order_id,
    'order_no',order_no,
    'phone',phone,
    'whatsapp_link',case when phone is null then null else 'https://wa.me/'||phone end,
    'order_link',case when public_token is null then null else 'https://icetak.bolt.host/?admin=v2&order='||public_token end,
    'job_status',job_status,
    'review_status',review_status
  ) order by paid_at desc),'[]'::jsonb) from rows),
  'delivery',(select value from delivery)
);
$$;

create or replace function public.finance_enqueue_qrpay_daily_summary(p_summary_date date,p_slot text)
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare v_id bigint;
begin
  if p_summary_date is null or p_slot not in ('10am','10pm') then
    raise exception 'Valid summary date and slot are required';
  end if;
  insert into finance.qrpay_daily_summary_runs(summary_date,slot,status,scheduled_at,next_attempt_at)
  values(p_summary_date,p_slot,'pending',now(),now())
  on conflict(summary_date,slot) do update set updated_at=finance.qrpay_daily_summary_runs.updated_at
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.finance_claim_qrpay_daily_summaries(p_limit integer default 2)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_result jsonb;
begin
  update finance.qrpay_daily_summary_runs
  set status='retry',locked_at=null,next_attempt_at=now(),last_error=coalesce(last_error,'stale_dispatch_recovered'),updated_at=now()
  where status='sending' and locked_at<now()-interval '10 minutes';

  with candidates as (
    select id from finance.qrpay_daily_summary_runs
    where status in ('pending','retry') and next_attempt_at<=now()
    order by scheduled_at,id
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,2),5))
  ), claimed as (
    update finance.qrpay_daily_summary_runs q
    set status='sending',attempts=q.attempts+1,locked_at=now(),updated_at=now(),last_error=null
    from candidates c where q.id=c.id
    returning q.id,q.summary_date,q.slot,q.attempts
  )
  select coalesce(jsonb_agg(to_jsonb(claimed) order by id),'[]'::jsonb) into v_result from claimed;
  return v_result;
end;
$$;

create or replace function public.finance_complete_qrpay_daily_summary(
  p_run_id bigint,
  p_success boolean,
  p_recipient_phone text default null,
  p_provider_message_id text default null,
  p_error text default null,
  p_snapshot jsonb default '{}'::jsonb,
  p_message_preview text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_run finance.qrpay_daily_summary_runs%rowtype;
begin
  select * into v_run from finance.qrpay_daily_summary_runs where id=p_run_id for update;
  if not found then raise exception 'QRPay summary run not found'; end if;
  update finance.qrpay_daily_summary_runs set
    status=case when p_success then 'sent' when attempts>=5 then 'failed' else 'retry' end,
    next_attempt_at=case when p_success then next_attempt_at else now()+case least(attempts,5) when 1 then interval '2 minutes' when 2 then interval '5 minutes' when 3 then interval '15 minutes' when 4 then interval '30 minutes' else interval '1 hour' end end,
    locked_at=null,
    sent_at=case when p_success then now() else sent_at end,
    recipient_phone=coalesce(nullif(p_recipient_phone,''),recipient_phone),
    provider_message_id=coalesce(nullif(p_provider_message_id,''),provider_message_id),
    last_error=case when p_success then null else left(coalesce(p_error,'send_failed'),2000) end,
    snapshot=coalesce(p_snapshot,'{}'::jsonb),
    message_preview=left(p_message_preview,4000),
    updated_at=now()
  where id=p_run_id;
  return jsonb_build_object('id',p_run_id,'success',p_success,'status',(select status from finance.qrpay_daily_summary_runs where id=p_run_id));
end;
$$;

create or replace function public.finance_invoke_qrpay_daily_summary_dispatch()
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare v_token text; v_request_id bigint;
begin
  if not exists(
    select 1 from finance.qrpay_daily_summary_runs
    where (status in ('pending','retry') and next_attempt_at<=now())
       or (status='sending' and locked_at<now()-interval '10 minutes')
  ) then return null; end if;
  select setting_value into v_token from public.private_runtime_settings where setting_key='qrpay_daily_summary_token';
  if v_token is null then raise exception 'QRPay daily summary token missing'; end if;
  select net.http_post(
    url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/qrpay-daily-summary',
    headers:=jsonb_build_object('Content-Type','application/json','x-qrpay-summary-token',v_token),
    body:=jsonb_build_object('source','supabase-cron'),
    timeout_milliseconds:=120000
  ) into v_request_id;
  return v_request_id;
end;
$$;

create or replace function public.finance_schedule_qrpay_daily_summary(p_slot text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_date date; v_run bigint; v_request bigint;
begin
  if p_slot not in ('10am','10pm') then raise exception 'Invalid QRPay summary slot'; end if;
  v_date:=(now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_run:=public.finance_enqueue_qrpay_daily_summary(v_date,p_slot);
  v_request:=public.finance_invoke_qrpay_daily_summary_dispatch();
  return jsonb_build_object('run_id',v_run,'request_id',v_request,'date',v_date,'slot',p_slot);
end;
$$;

revoke execute on function public.finance_admin_qrpay_daily(date) from public,anon,authenticated;
revoke execute on function public.finance_enqueue_qrpay_daily_summary(date,text) from public,anon,authenticated;
revoke execute on function public.finance_claim_qrpay_daily_summaries(integer) from public,anon,authenticated;
revoke execute on function public.finance_complete_qrpay_daily_summary(bigint,boolean,text,text,text,jsonb,text) from public,anon,authenticated;
revoke execute on function public.finance_invoke_qrpay_daily_summary_dispatch() from public,anon,authenticated;
revoke execute on function public.finance_schedule_qrpay_daily_summary(text) from public,anon,authenticated;
grant execute on function public.finance_admin_qrpay_daily(date) to service_role;
grant execute on function public.finance_claim_qrpay_daily_summaries(integer) to service_role;
grant execute on function public.finance_complete_qrpay_daily_summary(bigint,boolean,text,text,text,jsonb,text) to service_role;

do $$
declare v_jobid bigint;
begin
  for v_jobid in select jobid from cron.job where jobname in (
    'icetak-qrpay-summary-10am-myt','icetak-qrpay-summary-10pm-myt','icetak-qrpay-summary-retry'
  ) loop perform cron.unschedule(v_jobid); end loop;

  perform cron.schedule(
    'icetak-qrpay-summary-10am-myt','0 2 * * *',
    $job$select public.finance_schedule_qrpay_daily_summary('10am');$job$
  );
  perform cron.schedule(
    'icetak-qrpay-summary-10pm-myt','0 14 * * *',
    $job$select public.finance_schedule_qrpay_daily_summary('10pm');$job$
  );
  perform cron.schedule(
    'icetak-qrpay-summary-retry','*/5 * * * *',
    $job$select public.finance_invoke_qrpay_daily_summary_dispatch();$job$
  );
end $$;

comment on table finance.qrpay_daily_summary_runs is 'Idempotent 10AM/10PM MYT QRPay owner summaries with delivery retry audit.';
comment on function public.finance_admin_qrpay_daily(date) is 'Owner Finance data API for one Malaysia-calendar-day QRPay control summary.';
