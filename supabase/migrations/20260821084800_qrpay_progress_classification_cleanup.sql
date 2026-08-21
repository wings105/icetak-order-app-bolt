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
), enriched_rows as (
  select coalesce(jsonb_agg(
    r.value || jsonb_build_object(
      'sender_name',coalesce(nullif(qc.identity_name,''),r.value->>'sender_name'),
      'phone',coalesce(nullif(qc.identity_phone,''),r.value->>'phone'),
      'whatsapp_link',case
        when nullif(coalesce(qc.identity_phone,r.value->>'phone'),'') is null then null
        else 'tel:'||regexp_replace(coalesce(qc.identity_phone,r.value->>'phone'),'[^0-9]','','g')
      end,
      'identity_confirmed',qc.identity_confirmed_at is not null,
      'identity_confirmed_at',qc.identity_confirmed_at,
      'identity_confirmed_by',qc.identity_confirmed_by,
      'identity_original_name',r.value->>'sender_name',
      'identity_original_phone',r.value->>'phone',
      'order_progress',case
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
    ) order by r.ordinality
  ),'[]'::jsonb) value
  from base b
  cross join lateral jsonb_array_elements(coalesce(b.value->'rows','[]'::jsonb)) with ordinality r(value,ordinality)
  left join finance.qrpay_payment_controls qc on qc.transaction_id=r.value->>'transaction_id'
)
select b.value || jsonb_build_object('rows',e.value)
from base b cross join enriched_rows e;
$$;
