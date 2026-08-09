-- Enterprise QRPay review controls.
-- "Ignored" means excluded from the new-order workflow only. The bank/finance
-- transaction remains intact and visible for accounting classification.

create extension if not exists pgcrypto;

create table if not exists finance.qrpay_payment_controls (
  id uuid primary key default gen_random_uuid(),
  transaction_id text not null unique,
  workflow_state text not null default 'active' check (workflow_state in ('active','ignored')),
  category text check (category is null or category in (
    'old_debt','personal_transfer','supplier_refund','internal_transfer','duplicate_or_test','other'
  )),
  remark text,
  resume_job_status text,
  resume_match_reason text,
  resume_review_status text,
  ignored_at timestamptz,
  ignored_by text,
  created_at timestamptz not null default now(),
  created_by text not null,
  updated_at timestamptz not null default now(),
  updated_by text not null,
  version integer not null default 1 check (version > 0),
  check (workflow_state <> 'ignored' or (category is not null and nullif(btrim(remark),'') is not null))
);

create table if not exists finance.qrpay_payment_control_history (
  id bigint generated always as identity primary key,
  control_id uuid not null references finance.qrpay_payment_controls(id) on delete restrict,
  transaction_id text not null,
  action text not null check (action in ('save_remark','ignore','reopen')),
  category text,
  remark text,
  actor text not null,
  before_data jsonb,
  after_data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists qrpay_payment_controls_state_idx
  on finance.qrpay_payment_controls(workflow_state,updated_at desc);
create index if not exists qrpay_payment_control_history_tx_idx
  on finance.qrpay_payment_control_history(transaction_id,created_at desc);

alter table finance.qrpay_payment_controls enable row level security;
alter table finance.qrpay_payment_controls force row level security;
alter table finance.qrpay_payment_control_history enable row level security;
alter table finance.qrpay_payment_control_history force row level security;
revoke all on finance.qrpay_payment_controls from public,anon,authenticated;
revoke all on finance.qrpay_payment_control_history from public,anon,authenticated;
grant select,insert,update on finance.qrpay_payment_controls to service_role;
grant select,insert on finance.qrpay_payment_control_history to service_role;
grant usage,select on sequence finance.qrpay_payment_control_history_id_seq to service_role;

create or replace function public.finance_admin_qrpay_review_action(
  p_transaction_id text,
  p_action text,
  p_remark text default null,
  p_category text default null,
  p_actor text default 'admin1'
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_transaction_id text:=nullif(btrim(coalesce(p_transaction_id,'')),'');
  v_action text:=lower(nullif(btrim(coalesce(p_action,'')),''));
  v_remark text:=nullif(btrim(coalesce(p_remark,'')),'');
  v_category text:=nullif(lower(btrim(coalesce(p_category,''))),'');
  v_actor text:=left(coalesce(nullif(btrim(coalesce(p_actor,'')),''),'admin1'),120);
  v_has_matched boolean:=false;
  v_has_unmatched boolean:=false;
  v_job public.qrpay_ai_jobs%rowtype;
  v_review public.admin_order_reviews%rowtype;
  v_control finance.qrpay_payment_controls%rowtype;
  v_after finance.qrpay_payment_controls%rowtype;
  v_before jsonb;
  v_finance_count integer:=0;
begin
  if v_transaction_id is null then raise exception 'Transaction ID is required'; end if;
  if v_action not in ('save_remark','ignore','reopen') then raise exception 'Invalid QRPay review action'; end if;
  if length(coalesce(v_remark,''))>2000 then raise exception 'Remark cannot exceed 2000 characters'; end if;
  if v_category is not null and v_category not in (
    'old_debt','personal_transfer','supplier_refund','internal_transfer','duplicate_or_test','other'
  ) then raise exception 'Invalid QRPay review category'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('qrpay-review:'||v_transaction_id,0));

  select exists(
    select 1 from public.payment_transactions p
    where p.transaction_id=v_transaction_id and p.order_id is not null
  ) into v_has_matched;
  select exists(
    select 1 from public.unmatched_payment_transactions u where u.transaction_id=v_transaction_id
  ) into v_has_unmatched;
  if not v_has_matched and not v_has_unmatched then
    raise exception 'QRPay transaction % was not found',v_transaction_id;
  end if;

  select * into v_job from public.qrpay_ai_jobs
  where transaction_id=v_transaction_id order by created_at desc limit 1 for update;
  if v_job.id is not null then
    select * into v_review from public.admin_order_reviews
    where qrpay_job_id=v_job.id or transaction_id=v_transaction_id
    order by updated_at desc limit 1 for update;
  end if;
  select * into v_control from finance.qrpay_payment_controls
  where transaction_id=v_transaction_id for update;
  v_before:=case when v_control.id is null then null else to_jsonb(v_control) end;

  if v_action='ignore' then
    if v_has_matched then raise exception 'Unmatch this payment from its order before ignoring it'; end if;
    if not v_has_unmatched then raise exception 'Only an unmatched QRPay payment can be ignored'; end if;
    if v_category is null then raise exception 'Ignore category is required'; end if;
    if v_remark is null then raise exception 'Remark is required before ignoring a payment'; end if;
    if v_control.id is not null and v_control.workflow_state='ignored'
       and v_control.category=v_category and v_control.remark=v_remark then
      return jsonb_build_object('success',true,'idempotent',true,'control',to_jsonb(v_control));
    end if;

    insert into finance.qrpay_payment_controls(
      transaction_id,workflow_state,category,remark,resume_job_status,resume_match_reason,
      resume_review_status,ignored_at,ignored_by,created_by,updated_by
    ) values(
      v_transaction_id,'ignored',v_category,v_remark,v_job.status,v_job.match_reason,
      v_review.status,now(),v_actor,v_actor,v_actor
    ) on conflict(transaction_id) do update set
      workflow_state='ignored',category=excluded.category,remark=excluded.remark,
      resume_job_status=case when finance.qrpay_payment_controls.workflow_state='active' then excluded.resume_job_status else finance.qrpay_payment_controls.resume_job_status end,
      resume_match_reason=case when finance.qrpay_payment_controls.workflow_state='active' then excluded.resume_match_reason else finance.qrpay_payment_controls.resume_match_reason end,
      resume_review_status=case when finance.qrpay_payment_controls.workflow_state='active' then excluded.resume_review_status else finance.qrpay_payment_controls.resume_review_status end,
      ignored_at=now(),ignored_by=v_actor,updated_at=now(),updated_by=v_actor,
      version=finance.qrpay_payment_controls.version+1
    returning * into v_after;

    update public.qrpay_ai_jobs set
      status='completed',match_reason='admin_ignored_for_order:'||v_category,
      completed_at=now(),locked_at=null,last_error=null,updated_at=now()
    where transaction_id=v_transaction_id and order_id is null;
    update public.admin_order_reviews set
      status='rejected',rejected_at=now(),completed_at=now(),last_error=null,
      evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object(
        'ignored_for_order',true,'ignore_category',v_category,'ignore_remark',v_remark,
        'ignored_by',v_actor,'ignored_at',now()
      ),updated_at=now()
    where (transaction_id=v_transaction_id or qrpay_job_id=v_job.id)
      and order_id is null and status in ('pending_admin','awaiting_admin_detail','rejected');
    update finance.transactions set
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'order_workflow_state','ignored','order_review_category',v_category,
        'order_review_remark',v_remark,'order_review_updated_by',v_actor,
        'order_review_updated_at',now()
      ),updated_at=now()
    where status<>'void' and order_id is null
      and (external_reference=v_transaction_id or bank_reference=v_transaction_id or metadata->>'transaction_id'=v_transaction_id);
    get diagnostics v_finance_count=row_count;
  elsif v_action='reopen' then
    if v_control.id is null or v_control.workflow_state='active' then
      return jsonb_build_object('success',true,'idempotent',true,'control',case when v_control.id is null then null else to_jsonb(v_control) end);
    end if;
    update finance.qrpay_payment_controls set
      workflow_state='active',ignored_at=null,ignored_by=null,
      updated_at=now(),updated_by=v_actor,version=version+1
    where id=v_control.id returning * into v_after;
    update public.qrpay_ai_jobs set
      status=case when v_control.resume_job_status in ('waiting','processing','retry','needs_review','unmatched','failed')
        then v_control.resume_job_status else 'needs_review' end,
      match_reason=coalesce(v_control.resume_match_reason,'admin_reopened_for_order'),
      completed_at=null,locked_at=null,last_error=null,next_attempt_at=least(next_attempt_at,now()),updated_at=now()
    where transaction_id=v_transaction_id and order_id is null;
    update public.admin_order_reviews set
      status=case when v_control.resume_review_status in ('pending_admin','awaiting_admin_detail')
        then v_control.resume_review_status else 'pending_admin' end,
      rejected_at=null,completed_at=null,last_error=null,
      evidence=(coalesce(evidence,'{}'::jsonb)-'ignored_for_order')||jsonb_build_object(
        'reopened_for_order',true,'reopened_by',v_actor,'reopened_at',now()
      ),updated_at=now()
    where (transaction_id=v_transaction_id or qrpay_job_id=v_job.id) and order_id is null;
    update finance.transactions set
      metadata=(coalesce(metadata,'{}'::jsonb)-'order_workflow_state'-'order_review_category'
        -'order_review_remark'-'order_review_updated_by'-'order_review_updated_at')
        ||jsonb_build_object('order_workflow_reopened_by',v_actor,'order_workflow_reopened_at',now()),
      updated_at=now()
    where status<>'void' and order_id is null
      and (external_reference=v_transaction_id or bank_reference=v_transaction_id or metadata->>'transaction_id'=v_transaction_id);
    get diagnostics v_finance_count=row_count;
  else
    if v_control.id is not null and v_control.remark is not distinct from v_remark
       and (v_category is null or v_control.category is not distinct from v_category) then
      return jsonb_build_object('success',true,'idempotent',true,'control',to_jsonb(v_control));
    end if;
    insert into finance.qrpay_payment_controls(
      transaction_id,workflow_state,category,remark,created_by,updated_by
    ) values(v_transaction_id,'active',v_category,v_remark,v_actor,v_actor)
    on conflict(transaction_id) do update set
      category=coalesce(excluded.category,finance.qrpay_payment_controls.category),
      remark=excluded.remark,updated_at=now(),updated_by=v_actor,
      version=finance.qrpay_payment_controls.version+1
    returning * into v_after;
    update finance.transactions set
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'order_review_remark',coalesce(v_remark,''),'order_review_updated_by',v_actor,
        'order_review_updated_at',now()
      ),updated_at=now()
    where status<>'void'
      and (external_reference=v_transaction_id or bank_reference=v_transaction_id or metadata->>'transaction_id'=v_transaction_id);
    get diagnostics v_finance_count=row_count;
  end if;

  insert into finance.qrpay_payment_control_history(
    control_id,transaction_id,action,category,remark,actor,before_data,after_data
  ) values(v_after.id,v_transaction_id,v_action,v_after.category,v_after.remark,v_actor,v_before,to_jsonb(v_after));
  insert into finance.audit_log(actor,action,entity_type,entity_id,before_data,after_data)
  values(v_actor,'qrpay_review_'||v_action,'qrpay_payment',v_transaction_id,v_before,
    to_jsonb(v_after)||jsonb_build_object('finance_records_preserved',v_finance_count));

  return jsonb_build_object(
    'success',true,'idempotent',false,'transaction_id',v_transaction_id,'action',v_action,
    'control',to_jsonb(v_after),'finance_records_preserved',v_finance_count
  );
end;
$$;

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
    1 source_priority,'matched'::text source,p.transaction_id,p.amount,
    coalesce(p.paid_at,p.created_at) paid_at,nullif(p.sender_name,'') sender_name,p.provider,
    'matched_order'::text workflow_status,p.order_id,o.order_no,o.public_token,
    coalesce(nullif(regexp_replace(o.delivery_phone,'[^0-9]','','g'),''),
      nullif(regexp_replace(c.phone,'[^0-9]','','g'),''),nullif(p.raw_payload->>'matched_phone','')) phone,
    null::text job_status,null::text review_status,qc.workflow_state,qc.category review_category,
    qc.remark review_remark,qc.updated_at review_updated_at,qc.updated_by review_updated_by,
    qc.ignored_at,qc.ignored_by
  from public.payment_transactions p
  join bounds b on coalesce(p.paid_at,p.created_at)>=b.from_ts and coalesce(p.paid_at,p.created_at)<b.to_ts
  left join public.orders o on o.id=p.order_id
  left join public.customers c on c.id=o.customer_id
  left join finance.qrpay_payment_controls qc on qc.transaction_id=p.transaction_id
  where p.provider in ('qrpay','qrpay_ai','duitnow')
), unmatched as (
  select
    2 source_priority,'unmatched'::text source,u.transaction_id,u.amount,
    coalesce(u.paid_at,u.created_at) paid_at,nullif(u.sender_name,'') sender_name,u.provider,
    case
      when qc.workflow_state='ignored' then 'ignored'
      when r.status in ('pending_admin','awaiting_admin_detail') or j.status='needs_review' then 'needs_review'
      when j.status in ('waiting','processing','retry','matched','order_created') then 'processing'
      when j.status in ('failed','unmatched') or j.id is null then 'missed'
      else 'pending'
    end workflow_status,
    j.order_id,coalesce(j.order_no,o.order_no),o.public_token,
    coalesce(nullif(regexp_replace(o.delivery_phone,'[^0-9]','','g'),''),
      nullif(regexp_replace(c.phone,'[^0-9]','','g'),''),
      nullif(regexp_replace(r.candidate_phone,'[^0-9]','','g'),''),
      nullif(regexp_replace(j.matched_phone,'[^0-9]','','g'),'')) phone,
    j.status job_status,r.status review_status,qc.workflow_state,qc.category review_category,
    qc.remark review_remark,qc.updated_at review_updated_at,qc.updated_by review_updated_by,
    qc.ignored_at,qc.ignored_by
  from public.unmatched_payment_transactions u
  join bounds b on coalesce(u.paid_at,u.created_at)>=b.from_ts and coalesce(u.paid_at,u.created_at)<b.to_ts
  left join public.qrpay_ai_jobs j on j.unmatched_payment_id=u.id or (j.unmatched_payment_id is null and j.transaction_id=u.transaction_id)
  left join lateral (
    select ar.* from public.admin_order_reviews ar where ar.qrpay_job_id=j.id
    order by ar.updated_at desc limit 1
  ) r on true
  left join public.orders o on o.id=j.order_id
  left join public.customers c on c.id=o.customer_id
  left join finance.qrpay_payment_controls qc on qc.transaction_id=u.transaction_id
  where u.provider in ('qrpay','qrpay_ai','duitnow')
), combined as (
  select * from matched union all select * from unmatched
), rows as (
  select distinct on(transaction_id)
    source,transaction_id,amount,paid_at,sender_name,provider,workflow_status,order_id,order_no,
    public_token,phone,job_status,review_status,workflow_state,review_category,review_remark,
    review_updated_at,review_updated_by,ignored_at,ignored_by
  from combined order by transaction_id,source_priority
), totals as (
  select
    count(*) total_count,coalesce(sum(amount),0) total_amount,
    count(*) filter(where workflow_status='matched_order') matched_count,
    coalesce(sum(amount) filter(where workflow_status='matched_order'),0) matched_amount,
    count(*) filter(where workflow_status='needs_review') review_count,
    coalesce(sum(amount) filter(where workflow_status='needs_review'),0) review_amount,
    count(*) filter(where workflow_status in ('processing','pending')) processing_count,
    coalesce(sum(amount) filter(where workflow_status in ('processing','pending')),0) processing_amount,
    count(*) filter(where workflow_status='missed') missed_count,
    coalesce(sum(amount) filter(where workflow_status='missed'),0) missed_amount,
    count(*) filter(where workflow_status='ignored') ignored_count,
    coalesce(sum(amount) filter(where workflow_status='ignored'),0) ignored_amount,
    count(*) filter(where workflow_status not in ('matched_order','ignored')) unresolved_count,
    coalesce(sum(amount) filter(where workflow_status not in ('matched_order','ignored')),0) unresolved_amount
  from rows
), delivery as (
  select to_jsonb(x) value from (
    select slot,status,attempts,scheduled_at,sent_at,recipient_phone,last_error
    from finance.qrpay_daily_summary_runs q,requested r where q.summary_date=r.summary_date
    order by q.created_at desc limit 1
  ) x
)
select jsonb_build_object(
  'date',(select summary_date from requested),'timezone','Asia/Kuala_Lumpur','generated_at',now(),
  'totals',(select to_jsonb(totals) from totals),
  'rows',(select coalesce(jsonb_agg(jsonb_build_object(
    'source',source,'transaction_id',transaction_id,'amount',amount,'paid_at',paid_at,
    'sender_name',sender_name,'provider',provider,'workflow_status',workflow_status,
    'order_id',order_id,'order_no',order_no,'phone',phone,
    'whatsapp_link',case when phone is null then null else 'https://wa.me/'||phone end,
    'order_link',case when public_token is null then null else 'https://icetak.bolt.host/?admin=v2&order='||public_token end,
    'job_status',job_status,'review_status',review_status,'workflow_state',workflow_state,
    'review_category',review_category,'review_remark',review_remark,
    'review_updated_at',review_updated_at,'review_updated_by',review_updated_by,
    'ignored_at',ignored_at,'ignored_by',ignored_by
  ) order by paid_at desc),'[]'::jsonb) from rows),
  'delivery',(select value from delivery)
);
$$;

revoke execute on function public.finance_admin_qrpay_review_action(text,text,text,text,text) from public,anon,authenticated;
revoke execute on function public.finance_admin_qrpay_daily(date) from public,anon,authenticated;
grant execute on function public.finance_admin_qrpay_review_action(text,text,text,text,text) to service_role;
grant execute on function public.finance_admin_qrpay_daily(date) to service_role;

comment on table finance.qrpay_payment_controls is 'Persistent owner disposition and remarks for QRPay order-workflow review.';
comment on table finance.qrpay_payment_control_history is 'Append-only audit history for QRPay review, ignore and reopen actions.';
comment on function public.finance_admin_qrpay_review_action(text,text,text,text,text) is 'Owner-only idempotent QRPay remark, ignore-for-order and reopen control.';
