create or replace function public.finance_admin_qrpay_linked_drafts(
  p_transaction_ids text[]
)
returns jsonb
language sql
stable
security definer
set search_path to 'public','pg_temp'
as $function$
  with ranked as (
    select
      d.transaction_id,
      d.id as draft_id,
      d.status as draft_status,
      d.payment_status,
      d.customer_name,
      d.customer_phone,
      d.draft_total,
      d.updated_at,
      row_number() over (
        partition by d.transaction_id
        order by d.updated_at desc, d.created_at desc, d.id
      ) as position
    from public.qrpay_order_drafts d
    where d.transaction_id = any(coalesce(p_transaction_ids, array[]::text[]))
      and d.order_id is null
      and d.status <> 'rejected'
  )
  select coalesce(
    jsonb_object_agg(
      transaction_id,
      jsonb_build_object(
        'draft_id', draft_id,
        'draft_status', draft_status,
        'payment_status', payment_status,
        'customer_name', customer_name,
        'customer_phone', customer_phone,
        'draft_total', draft_total,
        'updated_at', updated_at
      )
    ),
    '{}'::jsonb
  )
  from ranked
  where position = 1;
$function$;

revoke all on function public.finance_admin_qrpay_linked_drafts(text[]) from public, anon, authenticated;
grant execute on function public.finance_admin_qrpay_linked_drafts(text[]) to service_role;
