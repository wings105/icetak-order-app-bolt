-- Read the last WhatsApp evidence from the preceding ready print brief for the
-- same Shopee buyer and shop. There is no shipping-status dependency.
create function public.icetak_print_previous_whatsapp_close(p_order_id uuid)
returns timestamptz language sql stable security invoker set search_path = '' as $fn$
 select max(coalesce(
   nullif(j.brief->>'whatsapp_closed_at','')::timestamptz,
   (select max((e->>'at')::timestamptz) from jsonb_array_elements(j.brief->'evidence') e where e->>'channel'='whatsapp')
 ))
 from public.marketplace_orders current_order
 join public.marketplace_orders earlier on earlier.provider='shopee'
  and earlier.shop_id=current_order.shop_id and earlier.buyer_user_id=current_order.buyer_user_id
  and earlier.placed_at<current_order.placed_at
  and earlier.placed_at>=date_trunc('day',current_order.placed_at at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur'
 join public.ai_clickup_work_snapshots s on s.marketplace_order_id=earlier.id
 join public.clickup_order_brief_jobs j on j.task_id=s.task_id
 where current_order.id=p_order_id and current_order.provider='shopee'
  and nullif(current_order.buyer_user_id,'') is not null
  and j.brief->>'profile'='edible-wafer-v1' and j.brief->>'status'='BRIEF_READY'
  and j.completed_at is not null;
$fn$;
revoke all on function public.icetak_print_previous_whatsapp_close(uuid) from public,anon,authenticated;
grant execute on function public.icetak_print_previous_whatsapp_close(uuid) to service_role;
