-- Treat a paid multi-order pickup checkout as a resolved QRPay payment.
-- The canonical payment row intentionally has no single order_id; linkage lives
-- in pickup_checkout_orders and finance.payment_allocations.

create or replace function public.finance_admin_qrpay_range_with_progress(
  p_from date default null::date,
  p_to date default null::date
)
returns jsonb
language sql
security definer
set search_path to ''
as $$
with base as (
  select public.finance_admin_qrpay_range(p_from,p_to) value
), enriched as (
  select
    r.ordinality,
    r.value || jsonb_build_object(
      'sender_name',coalesce(
        nullif(qc.identity_name,''),
        nullif(r.value->>'sender_name',''),
        nullif(bundle.customer_name,'')
      ),
      'phone',coalesce(
        nullif(qc.identity_phone,''),
        nullif(r.value->>'phone',''),
        nullif(bundle.customer_phone,'')
      ),
      'whatsapp_link',case
        when nullif(coalesce(qc.identity_phone,r.value->>'phone',bundle.customer_phone),'') is null then null
        else 'tel:'||regexp_replace(
          coalesce(qc.identity_phone,r.value->>'phone',bundle.customer_phone),
          '[^0-9]','','g'
        )
      end,
      'workflow_status',case
        when bundle.checkout_id is not null then 'matched_order'
        else r.value->>'workflow_status'
      end,
      'review_remark',case
        when bundle.checkout_id is not null then qc.remark
        else r.value->>'review_remark'
      end,
      'identity_confirmed',qc.identity_confirmed_at is not null,
      'identity_confirmed_at',qc.identity_confirmed_at,
      'identity_confirmed_by',qc.identity_confirmed_by,
      'identity_original_name',coalesce(
        nullif(r.value->>'sender_name',''),
        nullif(bundle.customer_name,'')
      ),
      'identity_original_phone',coalesce(
        nullif(r.value->>'phone',''),
        nullif(bundle.customer_phone,'')
      ),
      'bundle_checkout_id',bundle.checkout_id,
      'bundle_checkout_no',bundle.checkout_no,
      'bundle_order_count',coalesce(bundle.order_count,0),
      'bundle_ready_count',coalesce(bundle.ready_count,0),
      'bundle_collected_count',coalesce(bundle.collected_count,0),
      'bundle_orders',coalesce(bundle.orders,'[]'::jsonb),
      'order_progress',case
        when bundle.checkout_id is not null then null
        when nullif(r.value->>'order_id','') is not null then
          public.finance_admin_qrpay_order_progress((r.value->>'order_id')::uuid)
        when nullif(r.value->>'draft_id','') is not null then
          jsonb_build_object(
            'order_status','Draft',
            'admin_status',coalesce(nullif(r.value->>'draft_status',''),'pending_admin'),
            'fulfillment_stage','draft',
            'delivery_method',null,
            'production_approved',false,
            'production_completed_at',null,
            'pickup_ready_at',null,
            'pickup_collected_at',null,
            'delivered_at',null,
            'components_total',0,
            'components_complete',0,
            'progress_percent',0,
            'components','[]'::jsonb,
            'shipment_status',null,
            'shipment_status_group',null,
            'tracking_number',null,
            'tracking_link',null,
            'courier',null,
            'approval_blockers',jsonb_build_array('draft_pending_admin'),
            'overall_label','Draft pending admin',
            'overall_tone','warning',
            'available_actions','[]'::jsonb,
            'task_status_source','clickup_webhook',
            'shipment_status_source','parceldaily'
          )
        when coalesce(r.value->>'workflow_status','')='ignored' then
          jsonb_build_object(
            'order_status','Ignored',
            'admin_status','Ignored for order',
            'fulfillment_stage','ignored',
            'delivery_method',null,
            'production_approved',false,
            'production_completed_at',null,
            'pickup_ready_at',null,
            'pickup_collected_at',null,
            'delivered_at',null,
            'components_total',0,
            'components_complete',0,
            'progress_percent',0,
            'components','[]'::jsonb,
            'shipment_status',null,
            'shipment_status_group',null,
            'tracking_number',null,
            'tracking_link',null,
            'courier',null,
            'approval_blockers','[]'::jsonb,
            'overall_label','Ignored for order',
            'overall_tone','neutral',
            'available_actions','[]'::jsonb,
            'task_status_source','clickup_webhook',
            'shipment_status_source','parceldaily'
          )
        else null
      end
    ) value
  from base b
  cross join lateral jsonb_array_elements(coalesce(b.value->'rows','[]'::jsonb))
    with ordinality r(value,ordinality)
  left join finance.qrpay_payment_controls qc
    on qc.transaction_id=r.value->>'transaction_id'
  left join lateral (
    select
      pc.id checkout_id,
      pc.checkout_no,
      nullif(cm.display_name,'') customer_name,
      nullif(cm.primary_phone_normalized,'') customer_phone,
      count(*)::integer order_count,
      count(*) filter (
        where o.pickup_ready_at is not null
          or lower(coalesce(o.fulfillment_stage,''))='ready_for_pickup'
          or lower(coalesce(o.status,'')) like '%ready%pickup%'
      )::integer ready_count,
      count(*) filter (where o.pickup_collected_at is not null)::integer collected_count,
      jsonb_agg(jsonb_build_object(
        'id',o.id,
        'orderNo',coalesce(o.order_no,o.order_id),
        'publicToken',o.public_token,
        'amount',po.amount,
        'status',o.status,
        'ready',o.pickup_ready_at is not null
          or lower(coalesce(o.fulfillment_stage,''))='ready_for_pickup'
          or lower(coalesce(o.status,'')) like '%ready%pickup%',
        'collected',o.pickup_collected_at is not null
      ) order by coalesce(o.order_no,o.order_id)) orders
    from public.payment_transactions pt
    join public.pickup_checkouts pc
      on pc.payment_session_id=pt.payment_session_id
      and pc.transaction_id=pt.transaction_id
      and pc.status='paid'
    join public.pickup_checkout_orders po on po.checkout_id=pc.id
    join public.orders o on o.id=po.order_id
    left join public.customer_master cm on cm.id=pc.customer_master_id
    where pt.transaction_id=r.value->>'transaction_id'
    group by pc.id,pc.checkout_no,cm.display_name,cm.primary_phone_normalized
  ) bundle on true
), enriched_rows as (
  select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) value
  from enriched
), totals as (
  select
    count(*) total_count,
    coalesce(sum((value->>'amount')::numeric),0) total_amount,
    count(*) filter(where value->>'workflow_status'='matched_order') matched_count,
    coalesce(sum((value->>'amount')::numeric)
      filter(where value->>'workflow_status'='matched_order'),0) matched_amount,
    count(*) filter(where value->>'workflow_status'='needs_review') review_count,
    coalesce(sum((value->>'amount')::numeric)
      filter(where value->>'workflow_status'='needs_review'),0) review_amount,
    count(*) filter(where value->>'workflow_status' in ('processing','pending')) processing_count,
    coalesce(sum((value->>'amount')::numeric)
      filter(where value->>'workflow_status' in ('processing','pending')),0) processing_amount,
    count(*) filter(where value->>'workflow_status'='missed') missed_count,
    coalesce(sum((value->>'amount')::numeric)
      filter(where value->>'workflow_status'='missed'),0) missed_amount,
    count(*) filter(where value->>'workflow_status'='ignored') ignored_count,
    coalesce(sum((value->>'amount')::numeric)
      filter(where value->>'workflow_status'='ignored'),0) ignored_amount,
    count(*) filter(where value->>'workflow_status' not in ('matched_order','ignored')) unresolved_count,
    coalesce(sum((value->>'amount')::numeric)
      filter(where value->>'workflow_status' not in ('matched_order','ignored')),0) unresolved_amount
  from enriched
)
select b.value || jsonb_build_object(
  'rows',e.value,
  'totals',(select to_jsonb(totals) from totals)
)
from base b cross join enriched_rows e;
$$;

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
      not exists(
        select 1 from public.payment_transactions p
        where p.transaction_id=a.transaction_id
      )
      or exists(
        select 1 from public.payment_transactions p
        where p.transaction_id=a.transaction_id and p.order_id is not null
      )
      or exists(
        select 1
        from public.payment_transactions p
        join public.pickup_checkouts pc
          on pc.payment_session_id=p.payment_session_id
          and pc.transaction_id=p.transaction_id
          and pc.status='paid'
        join public.pickup_checkout_orders po on po.checkout_id=pc.id
        where p.transaction_id=a.transaction_id
      )
      or exists(
        select 1 from finance.qrpay_payment_controls qc
        where qc.transaction_id=a.transaction_id and qc.workflow_state='ignored'
      )
    );
  get diagnostics v_resolved=row_count;

  insert into public.payment_order_attention_alerts(
    transaction_id,alert_type,status,scheduled_at
  )
  select p.transaction_id,'paid_no_order_15m','pending',now()
  from public.payment_transactions p
  left join finance.qrpay_payment_controls qc on qc.transaction_id=p.transaction_id
  where p.provider in ('qrpay','qrpay_ai','duitnow')
    and p.order_id is null
    and nullif(btrim(coalesce(p.transaction_id,'')),'') is not null
    and coalesce(p.paid_at,p.created_at)<=now()-interval '15 minutes'
    and coalesce(p.paid_at,p.created_at)>=now()-interval '14 days'
    and coalesce(qc.workflow_state,'')<>'ignored'
    and not exists(
      select 1
      from public.pickup_checkouts pc
      join public.pickup_checkout_orders po on po.checkout_id=pc.id
      where pc.payment_session_id=p.payment_session_id
        and pc.transaction_id=p.transaction_id
        and pc.status='paid'
    )
  on conflict(transaction_id,alert_type) do nothing;
  get diagnostics v_inserted=row_count;

  return jsonb_build_object(
    'ok',true,'new_alerts',v_inserted,'resolved',v_resolved,'threshold_minutes',15
  );
end
$$;

revoke all on function public.finance_admin_qrpay_range_with_progress(date,date)
  from public,anon,authenticated;
grant execute on function public.finance_admin_qrpay_range_with_progress(date,date)
  to service_role;
revoke all on function public.icetak_scan_payment_order_attention()
  from public,anon,authenticated;
grant execute on function public.icetak_scan_payment_order_attention()
  to service_role;

comment on function public.finance_admin_qrpay_range_with_progress(date,date)
  is 'QRPay range enriched with single-order progress or linked pickup-bundle allocations.';
comment on function public.icetak_scan_payment_order_attention()
  is 'Alerts only on QRPay payments without a real single-order or pickup-bundle allocation.';
