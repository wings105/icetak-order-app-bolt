create or replace function public.finance_admin_qrpay_range(p_from date default null,p_to date default null)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
with source_dates as (
  select (coalesce(p.paid_at,p.created_at) at time zone 'Asia/Kuala_Lumpur')::date payment_date
  from public.payment_transactions p where p.provider in ('qrpay','qrpay_ai','duitnow')
  union all
  select (coalesce(u.paid_at,u.created_at) at time zone 'Asia/Kuala_Lumpur')::date payment_date
  from public.unmatched_payment_transactions u where u.provider in ('qrpay','qrpay_ai','duitnow')
), requested as (
  select
    coalesce(p_from,(select min(payment_date) from source_dates),coalesce(p_to,(now() at time zone 'Asia/Kuala_Lumpur')::date)) from_date,
    coalesce(p_to,(now() at time zone 'Asia/Kuala_Lumpur')::date) to_date
), bounds as (
  select from_date,to_date,
    from_date::timestamp at time zone 'Asia/Kuala_Lumpur' from_ts,
    (to_date::timestamp + interval '1 day') at time zone 'Asia/Kuala_Lumpur' to_ts
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
    from finance.qrpay_daily_summary_runs q,requested r
    where r.from_date=r.to_date and q.summary_date=r.from_date
    order by q.created_at desc limit 1
  ) x
)
select jsonb_build_object(
  'date',(select from_date from requested),
  'from_date',(select from_date from requested),'to_date',(select to_date from requested),
  'is_single_day',(select from_date=to_date from requested),
  'day_count',(select (to_date-from_date)+1 from requested),
  'timezone','Asia/Kuala_Lumpur','generated_at',now(),
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

create or replace function public.finance_admin_qrpay_daily(p_date date default null)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select public.finance_admin_qrpay_range(
    coalesce(p_date,(now() at time zone 'Asia/Kuala_Lumpur')::date),
    coalesce(p_date,(now() at time zone 'Asia/Kuala_Lumpur')::date)
  );
$$;

revoke execute on function public.finance_admin_qrpay_range(date,date) from public,anon,authenticated;
revoke execute on function public.finance_admin_qrpay_daily(date) from public,anon,authenticated;
grant execute on function public.finance_admin_qrpay_range(date,date) to service_role;
grant execute on function public.finance_admin_qrpay_daily(date) to service_role;

comment on function public.finance_admin_qrpay_range(date,date) is 'Owner Finance QRPay summary for an inclusive Malaysia-calendar date range; null from means all history.';
comment on function public.finance_admin_qrpay_daily(date) is 'Backward-compatible one-day wrapper used by QRPay 10AM and 10PM automation.';
