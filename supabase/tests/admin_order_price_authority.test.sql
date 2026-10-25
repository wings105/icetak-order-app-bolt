-- Run against a designated existing edible A4 fixture inside a rollback-only
-- transaction. Set icetak.test_order_id locally before executing this block.
-- The deployment runner rolls back all item/order/outbox/audit changes.
DO $price_regression$
declare
  order_uuid uuid:=nullif(current_setting('icetak.test_order_id',true),'')::uuid;
  admin_uuid uuid;
  target_item uuid;
  original_price numeric;
  target_qty integer;
  standard_price numeric;
  original_subtotal numeric;
  expected_subtotal numeric;
  expected_total numeric;
  result_value jsonb;
  payload jsonb;
  old_draft jsonb;
  protected_state jsonb;
  current_state jsonb;
  saved_items jsonb;
  saved_total numeric;
  iteration integer;
begin
  if order_uuid is null then raise exception 'icetak.test_order_id required'; end if;
  select auth_user_id into admin_uuid from public.admin_users
    where username='admin1' and is_active and auth_user_id is not null limit 1;
  if admin_uuid is null then raise exception 'Designated admin fixture missing'; end if;
  select i.id,i.price,i.qty,
    public.icetak_quick_order_price('edible','Pre-order',i.size,i.style,'No Review')
    into target_item,original_price,target_qty,standard_price
    from public.order_items i where i.order_id=order_uuid and i.size='A4'
      and coalesce(i.k,i.product_type)='edible' order by i.sort_index limit 1;
  if target_item is null then raise exception 'Edible A4 fixture required'; end if;
  select working_draft into old_draft from public.qrpay_order_drafts
    where order_id=order_uuid order by created_at desc limit 1;
  if old_draft is null then raise exception 'Converted draft fixture required'; end if;

  select jsonb_build_object(
    'payment',o.payment,'payment_status',o.payment_status,
    'payment_method',o.payment_method,'payment_transaction_id',o.payment_transaction_id,
    'pickup_ready_at',o.pickup_ready_at,'pickup_collected_at',o.pickup_collected_at,
    'date_need',o.date_need,
    'tasks',(select jsonb_agg(jsonb_build_object('id',p.id,'task',p.clickup_task_id) order by p.id)
             from public.production_components p where p.order_id=o.id),
    'payments',(select jsonb_agg(to_jsonb(p) order by p.id)
                from public.payment_transactions p where p.order_id=o.id)
  ) into protected_state from public.orders o where o.id=order_uuid;

  -- Before admin ownership, initial draft pricing/deals still apply.
  perform public.icetak_sync_order_pricing_from_payload_v15(order_uuid,old_draft);
  if (select total from public.orders where id=order_uuid)
      is distinct from (public.icetak_qrpay_draft_totals(old_draft)->>'draft_total')::numeric then
    raise exception 'Initial draft pricing regression';
  end if;

  -- Existing permission gate must still reject a request without an admin.
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  begin
    perform public.icetak_admin_order_items_reconcile(jsonb_build_object('order_db_id',order_uuid,'items','[]'::jsonb));
    raise exception using errcode='ZT001',message='Unauthenticated edit was accepted';
  exception when raise_exception then
    if sqlerrm<>'Forbidden' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub',admin_uuid::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_uuid,'role','authenticated')::text,true);

  select sum(qty*price) into original_subtotal from public.order_items where order_id=order_uuid;
  select jsonb_build_object('order_db_id',order_uuid,'items',jsonb_agg(jsonb_build_object(
    'id',i.id,'product_id',i.product_id,'k',coalesce(i.k,i.product_type),
    'title',i.title,'qty',i.qty,'price',case when i.id=target_item then standard_price else i.price end,
    'size',i.size,'style',i.style,'process',coalesce(i.customization->>'admin_process','Pre-order'),
    'review_required',i.review_required,'custom_text',coalesce(i.custom_text,i.wording,''),
    'design_preview_url',coalesce(i.design_preview_url,'')
  ) order by i.sort_index nulls last,i.id)) into payload
    from public.order_items i where i.order_id=order_uuid;
  expected_subtotal:=original_subtotal+(standard_price-original_price)*target_qty;
  -- This fixture has a RM2 amount discount and no delivery fee/add-on.
  expected_total:=expected_subtotal-2;
  result_value:=public.icetak_admin_order_items_reconcile(payload);
  if (result_value->>'total')::numeric<>expected_total
      or (select total from public.orders where id=order_uuid)<>expected_total
      or (select price from public.order_items where id=target_item)<>standard_price then
    raise exception 'Apply standard price / persisted total mismatch: %',result_value->>'total';
  end if;
  if (select pricing_adjustments->>'pricing_authority' from public.orders where id=order_uuid)<>'admin' then
    raise exception 'Admin ownership missing';
  end if;

  select jsonb_agg(to_jsonb(i) order by i.id) into saved_items
    from public.order_items i where i.order_id=order_uuid;
  select total into saved_total from public.orders where id=order_uuid;
  for iteration in 1..3 loop
    perform public.enqueue_clickup_production_order(order_uuid);
    perform public.icetak_sync_order_pricing_from_payload_v15(order_uuid,old_draft);
    perform public.icetak_sync_draft_items_to_order(order_uuid,old_draft->'items');
  end loop;
  if saved_total is distinct from (select total from public.orders where id=order_uuid)
      or saved_items is distinct from (select jsonb_agg(to_jsonb(i) order by i.id)
         from public.order_items i where i.order_id=order_uuid) then
    raise exception 'Stale ClickUp/draft sync overwrote admin save';
  end if;

  -- Overview save uses a second RPC; custom and zero prices must also persist.
  result_value:=public.icetak_admin_order_update(jsonb_build_object('order_db_id',order_uuid,
    'items',jsonb_build_array(jsonb_build_object('id',target_item,'price',19.75))));
  expected_total:=original_subtotal+(19.75-original_price)*target_qty-2;
  perform public.enqueue_clickup_production_order(order_uuid);
  if (select price from public.order_items where id=target_item)<>19.75
      or (select total from public.orders where id=order_uuid)<>expected_total
      or (result_value->>'total')::numeric<>expected_total then
    raise exception 'Custom admin price / overview save regression';
  end if;
  result_value:=public.icetak_admin_order_update(jsonb_build_object('order_db_id',order_uuid,
    'items',jsonb_build_array(jsonb_build_object('id',target_item,'price',0))));
  perform public.enqueue_clickup_production_order(order_uuid);
  if (select price from public.order_items where id=target_item)<>0 then
    raise exception 'Zero price was replaced by draft/catalog price';
  end if;

  -- Percent discount, add-on, shipping and rounding are retained by recalculation.
  update public.orders set pricing_adjustments=pricing_adjustments||jsonb_build_object(
    'discount_type','percent','discount_value',10,'custom_addon',3,'rounding',-0.05
  ) where id=order_uuid;
  result_value:=public.icetak_admin_order_update(jsonb_build_object('order_db_id',order_uuid,
    'delivery_fee',4.50,
    'items',jsonb_build_array(jsonb_build_object('id',target_item,'price',standard_price,'qty',2))));
  expected_subtotal:=original_subtotal-original_price*target_qty+standard_price*2;
  expected_total:=round(expected_subtotal+3-round((expected_subtotal+3)*0.10,2)+4.50-0.05,2);
  perform public.enqueue_clickup_production_order(order_uuid);
  if (select total from public.orders where id=order_uuid)<>expected_total
      or (result_value->>'total')::numeric<>expected_total then
    raise exception 'Adjusted total / quantity / delivery fee regression';
  end if;

  -- Fulfillment lock remains in force.
  update public.orders set pickup_ready_at=now() where id=order_uuid;
  begin
    perform public.icetak_admin_order_items_reconcile(payload);
    raise exception using errcode='ZT002',message='Ready Pickup structural lock was bypassed';
  exception when raise_exception then
    if sqlerrm not like 'Structural item editing is locked%' then raise; end if;
  end;
  update public.orders set pickup_ready_at=null where id=order_uuid;

  select jsonb_build_object(
    'payment',o.payment,'payment_status',o.payment_status,
    'payment_method',o.payment_method,'payment_transaction_id',o.payment_transaction_id,
    'pickup_ready_at',o.pickup_ready_at,'pickup_collected_at',o.pickup_collected_at,
    'date_need',o.date_need,
    'tasks',(select jsonb_agg(jsonb_build_object('id',p.id,'task',p.clickup_task_id) order by p.id)
             from public.production_components p where p.order_id=o.id),
    'payments',(select jsonb_agg(to_jsonb(p) order by p.id)
                from public.payment_transactions p where p.order_id=o.id)
  ) into current_state from public.orders o where o.id=order_uuid;
  if protected_state is distinct from current_state then
    raise exception 'Payment records, date or ClickUp task identity changed';
  end if;
end;
$price_regression$;
