-- QRPay -> WhatsApp AI extraction -> Bolt order -> ClickUp outbox.
--
-- The worker runs in the Unified Inbox project because the WhatsApp conversation
-- tables live there. The Order System project exposes a token-protected bridge.
-- After applying this migration, copy the generated qrpay_ai_worker_token into
-- the Unified Inbox project's private_runtime_settings table through a secure
-- deployment step. Never commit the live token.

create extension if not exists pgcrypto;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create schema if not exists util;

create table if not exists public.private_runtime_settings (
  setting_key text primary key,
  setting_value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.private_runtime_settings enable row level security;
revoke all on public.private_runtime_settings from anon, authenticated;

insert into public.private_runtime_settings(setting_key, setting_value)
values ('qrpay_ai_worker_token', encode(gen_random_bytes(32), 'hex'))
on conflict (setting_key) do nothing;

create table if not exists public.qrpay_ai_jobs (
  id uuid primary key default gen_random_uuid(),
  unmatched_payment_id uuid null references public.unmatched_payment_transactions(id) on delete set null,
  transaction_id text not null,
  provider text,
  amount numeric(12,2) not null,
  payment_received_at timestamptz not null,
  process_after timestamptz not null,
  mode text not null default 'live' check (mode in ('live','dry_run')),
  status text not null default 'waiting' check (status in (
    'waiting','processing','retry','matched','order_created','completed',
    'needs_review','unmatched','failed','dry_run_complete'
  )),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  matched_conversation_id uuid,
  matched_phone text,
  matched_customer_name text,
  match_score numeric(6,3),
  match_reason text,
  extraction jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  order_id uuid references public.orders(id) on delete set null,
  order_no text,
  outbox_id uuid references public.integration_outbox(id) on delete set null,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (transaction_id)
);

create index if not exists qrpay_ai_jobs_claim_idx
  on public.qrpay_ai_jobs(status, process_after, next_attempt_at);
create index if not exists qrpay_ai_jobs_conversation_idx
  on public.qrpay_ai_jobs(matched_conversation_id, created_at desc);

alter table public.qrpay_ai_jobs enable row level security;
revoke all on public.qrpay_ai_jobs from anon, authenticated;

create or replace function public.queue_qrpay_ai_job()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.transaction_id is null or coalesce(new.amount,0) <= 0 then
    return new;
  end if;

  insert into public.qrpay_ai_jobs(
    unmatched_payment_id,
    transaction_id,
    provider,
    amount,
    payment_received_at,
    process_after,
    mode,
    status,
    next_attempt_at
  ) values (
    new.id,
    new.transaction_id,
    coalesce(new.provider,'duitnow'),
    new.amount,
    coalesce(new.created_at,new.paid_at,now()),
    coalesce(new.created_at,new.paid_at,now()) + interval '15 minutes',
    'live',
    'waiting',
    coalesce(new.created_at,new.paid_at,now()) + interval '15 minutes'
  )
  on conflict (transaction_id) do nothing;

  return new;
end;
$$;

drop trigger if exists unmatched_payment_queue_qrpay_ai
  on public.unmatched_payment_transactions;

create trigger unmatched_payment_queue_qrpay_ai
after insert on public.unmatched_payment_transactions
for each row execute function public.queue_qrpay_ai_job();

create or replace function public.claim_qrpay_ai_jobs(p_limit integer default 3)
returns setof public.qrpay_ai_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with candidates as (
    select id
    from public.qrpay_ai_jobs
    where status in ('waiting','retry')
      and process_after <= now()
      and next_attempt_at <= now()
    order by payment_received_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,3),10))
  )
  update public.qrpay_ai_jobs j
  set status='processing',
      attempts=j.attempts+1,
      locked_at=now(),
      updated_at=now(),
      last_error=null
  from candidates c
  where j.id=c.id
  returning j.*;
end;
$$;

create or replace function public.recover_stale_qrpay_ai_jobs(
  p_stale_minutes integer default 10
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.qrpay_ai_jobs
  set status='retry',
      locked_at=null,
      next_attempt_at=now()+interval '1 minute',
      last_error=coalesce(last_error,'stale_worker_lock_recovered'),
      updated_at=now()
  where status='processing'
    and locked_at < now() - make_interval(
      mins => greatest(2,coalesce(p_stale_minutes,10))
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.icetak_auto_create_qrpay_order(
  p_job_id uuid,
  p_payload jsonb,
  p_internal_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.qrpay_ai_jobs;
  v_expected_token text;
  v_existing_payment_order uuid;
  v_create_payload jsonb;
  v_result jsonb;
  v_order_id uuid;
  v_outbox_id uuid;
  v_payment_id uuid;
  v_date_need date;
begin
  select setting_value into v_expected_token
  from public.private_runtime_settings
  where setting_key='qrpay_ai_worker_token';

  if v_expected_token is null
     or p_internal_token is distinct from v_expected_token then
    raise exception 'Unauthorized qrpay AI worker';
  end if;

  select * into v_job
  from public.qrpay_ai_jobs
  where id=p_job_id
  for update;

  if v_job.id is null then
    raise exception 'qrpay_ai_job_not_found';
  end if;

  if v_job.order_id is not null then
    return jsonb_build_object(
      'success',true,
      'duplicate',true,
      'reason','job_already_created',
      'order_db_id',v_job.order_id,
      'order_id',v_job.order_no,
      'outbox_id',v_job.outbox_id
    );
  end if;

  select order_id into v_existing_payment_order
  from public.payment_transactions
  where transaction_id=v_job.transaction_id
  limit 1;

  if v_existing_payment_order is not null then
    update public.qrpay_ai_jobs
    set order_id=v_existing_payment_order,
        order_no=(select coalesce(order_no,order_id)
                  from public.orders
                  where id=v_existing_payment_order),
        status='completed',
        completed_at=now(),
        locked_at=null,
        updated_at=now(),
        match_reason=coalesce(match_reason,'transaction_already_linked')
    where id=v_job.id;

    return jsonb_build_object(
      'success',true,
      'duplicate',true,
      'reason','transaction_already_linked',
      'order_db_id',v_existing_payment_order
    );
  end if;

  if jsonb_typeof(coalesce(p_payload->'items','[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb))=0 then
    raise exception 'AI extracted no order items';
  end if;

  begin
    v_date_need:=nullif(p_payload->>'date_need','')::date;
  exception when others then
    v_date_need:=null;
  end;

  v_create_payload := (
    coalesce(p_payload,'{}'::jsonb)
      - 'payment'
      - 'payment_received_at'
      - 'transaction_id'
      - 'match_score'
      - 'match_reason'
      - 'conversation_id'
      - 'evidence'
  ) || jsonb_build_object(
    'payment','Paid',
    'total',v_job.amount,
    'source','qrpay_ai',
    'created_by','qrpay-ai-worker',
    'notify_whatsapp',false,
    'external_order_id','qrpay-ai:'||v_job.transaction_id
  );

  v_result:=public.icetak_create_order(v_create_payload);
  v_order_id:=nullif(v_result->>'order_db_id','')::uuid;

  if v_order_id is null
     and coalesce((v_result->>'duplicate')::boolean,false) then
    select id into v_order_id
    from public.orders
    where external_order_id='qrpay-ai:'||v_job.transaction_id
    limit 1;
  end if;

  if v_order_id is null then
    raise exception 'order_creation_returned_no_uuid';
  end if;

  update public.orders
  set payment_method='QRPay AI Match',
      payment_transaction_id=v_job.transaction_id,
      payment_verified_at=now(),
      payment_verified_by='qrpay-ai-worker',
      customer_confirmed=true,
      customer_confirmed_at=coalesce(customer_confirmed_at,now()),
      payment='Paid',
      payment_status='paid',
      status='Ready to Process',
      admin_status='AI Pending Confirmation',
      tab='progress',
      date_need=v_date_need,
      admin_remark=left(concat_ws(E'\n',
        nullif(p_payload->>'admin_remark',''),
        'AUTO QRPay: '||v_job.transaction_id||' | RM'||
          to_char(v_job.amount,'FM999999990.00'),
        'Admin: semak ClickUp, Confirm jika betul atau delete task jika salah.'
      ),2000),
      updated_at=now()
  where id=v_order_id;

  update public.order_items
  set review_required=true,
      workflow='Order Received',
      updated_at=now()
  where order_id=v_order_id;

  update public.production_components
  set review_required=true,
      review_status='pending',
      workflow='Order Received',
      updated_at=now()
  where order_id=v_order_id;

  insert into public.payment_transactions(
    order_id,
    payment_session_id,
    provider,
    transaction_id,
    amount,
    paid_at,
    sender_name,
    raw_payload
  ) values (
    v_order_id,
    null,
    'qrpay_ai',
    v_job.transaction_id,
    v_job.amount,
    v_job.payment_received_at,
    nullif(p_payload#>>'{customer,name}',''),
    jsonb_build_object(
      'qrpay_ai_job_id',v_job.id,
      'matched_conversation_id',p_payload->>'conversation_id',
      'matched_phone',p_payload#>>'{customer,phone}',
      'match_score',p_payload->'match_score',
      'match_reason',p_payload->>'match_reason',
      'evidence',coalesce(p_payload->'evidence','{}'::jsonb),
      'extraction',coalesce(p_payload->'items','[]'::jsonb)
    )
  ) returning id into v_payment_id;

  v_outbox_id:=public.enqueue_clickup_production_order(v_order_id);

  update public.qrpay_ai_jobs
  set order_id=v_order_id,
      order_no=(select coalesce(order_no,order_id)
                from public.orders
                where id=v_order_id),
      outbox_id=v_outbox_id,
      status='order_created',
      extraction=coalesce(p_payload,'{}'::jsonb),
      locked_at=null,
      updated_at=now()
  where id=v_job.id;

  if v_job.unmatched_payment_id is not null then
    delete from public.unmatched_payment_transactions
    where id=v_job.unmatched_payment_id;
  end if;

  return v_result || jsonb_build_object(
    'success',true,
    'payment_id',v_payment_id,
    'outbox_id',v_outbox_id,
    'order_db_id',v_order_id,
    'total',v_job.amount
  );
end;
$$;

revoke all on function public.claim_qrpay_ai_jobs(integer)
  from public, anon, authenticated;
revoke all on function public.recover_stale_qrpay_ai_jobs(integer)
  from public, anon, authenticated;
revoke all on function public.icetak_auto_create_qrpay_order(uuid,jsonb,text)
  from public, anon, authenticated;

grant execute on function public.claim_qrpay_ai_jobs(integer)
  to service_role;
grant execute on function public.recover_stale_qrpay_ai_jobs(integer)
  to service_role;
grant execute on function public.icetak_auto_create_qrpay_order(uuid,jsonb,text)
  to service_role;

create or replace function util.invoke_qrpay_ai_worker(
  p_limit integer default 3
)
returns bigint
language plpgsql
security definer
set search_path = public, net, pg_temp
as $$
declare
  v_token text;
begin
  select setting_value into v_token
  from public.private_runtime_settings
  where setting_key='qrpay_ai_worker_token';

  if v_token is null then
    raise exception 'QRPay AI worker token missing';
  end if;

  perform public.recover_stale_qrpay_ai_jobs(10);

  return net.http_post(
    url := 'https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/qrpay-ai-order-worker',
    headers := jsonb_build_object(
      'x-qrpay-ai-token',v_token,
      'Content-Type','application/json'
    ),
    body := jsonb_build_object(
      'batch_size',greatest(1,least(coalesce(p_limit,3),10))
    ),
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function util.invoke_qrpay_ai_worker(integer)
  from public, anon, authenticated;

do $$
declare
  v_jobid bigint;
begin
  for v_jobid in
    select jobid
    from cron.job
    where jobname='qrpay-ai-order-worker-every-minute'
  loop
    perform cron.unschedule(v_jobid);
  end loop;

  perform cron.schedule(
    'qrpay-ai-order-worker-every-minute',
    '* * * * *',
    'select util.invoke_qrpay_ai_worker(3);'
  );
end $$;
