-- Preserve explicit admin order pricing through draft/ClickUp sync.
-- Initial draft conversion retains its existing deal/discount behavior.
DO $admin_price_patch$
begin
  if md5(pg_get_functiondef('public.icetak_admin_order_items_reconcile(jsonb)'::regprocedure)) <> 'a32fe03fed35a69c637e324127145d98' then
    raise exception 'Concurrent function change: icetak_admin_order_items_reconcile';
  end if;
  if md5(pg_get_functiondef('public.icetak_admin_order_update(jsonb)'::regprocedure)) <> '64e732c8205f2f4800d90f9d19b86449' then
    raise exception 'Concurrent function change: icetak_admin_order_update';
  end if;
  if md5(pg_get_functiondef('public.icetak_sync_order_pricing_from_payload_v15(uuid,jsonb)'::regprocedure)) <> '3f3b224e97b032cbf0604370e9cab002' then
    raise exception 'Concurrent function change: icetak_sync_order_pricing_from_payload_v15';
  end if;
  if md5(pg_get_functiondef('public.icetak_sync_draft_items_to_order(uuid,jsonb)'::regprocedure)) <> 'eb80809ddb1a544ee6e5d7a4af3b7f00' then
    raise exception 'Concurrent function change: icetak_sync_draft_items_to_order';
  end if;
  execute $definition_0$
CREATE OR REPLACE FUNCTION public.icetak_admin_order_items_reconcile(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  order_uuid uuid:=nullif(p_payload->>'order_db_id','')::uuid;
  o public.orders%rowtype;
  actor_value text;
  item jsonb; delete_value jsonb;
  item_uuid uuid; product_uuid uuid; p public.products%rowtype; old_item public.order_items%rowtype;
  kind_value text; title_value text; process_value text; size_value text; style_value text; custom_value text; preview_value text;
  qty_value integer; price_value numeric; review_value boolean; is_new boolean; structural_changed boolean;
  pricing_payload jsonb; pricing_totals jsonb;
  total_value numeric; before_items jsonb; after_items jsonb; component_result jsonb;
  added_count integer:=0; changed_count integer:=0; deleted_count integer:=0; linked_reused integer:=0; outbox_value uuid;
  linked_delete_count integer;
begin
  if not public.icetak_admin_has_permission('edit_order') then raise exception 'Forbidden'; end if;
  if order_uuid is null then raise exception 'order_db_id required'; end if;
  select * into o from public.orders where id=order_uuid for update;
  if o.id is null then raise exception 'Order not found'; end if;
  if lower(coalesce(o.status,'')) in ('cancelled','completed','delivered','customer collected')
     or lower(coalesce(o.fulfillment_stage,'')) in ('cancelled','ready_for_pickup','collected','delivered','completed')
     or o.pickup_ready_at is not null or o.pickup_collected_at is not null or o.delivered_at is not null
     or lower(coalesce(o.shipment_status_group,'')) in ('picked_up','shipped','in_transit','out_for_delivery','delivered') then
    raise exception 'Structural item editing is locked after courier scan / Ready Pickup / completion.';
  end if;
  select username into actor_value from public.admin_users where auth_user_id=auth.uid() and is_active=true limit 1;
  select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) into before_items from public.order_items i where i.order_id=order_uuid;

  if jsonb_typeof(coalesce(p_payload->'delete_ids','[]'::jsonb))='array' then
    for delete_value in select value from jsonb_array_elements(coalesce(p_payload->'delete_ids','[]'::jsonb)) loop
      begin item_uuid:=trim(both '"' from delete_value::text)::uuid; exception when invalid_text_representation then item_uuid:=null; end;
      if item_uuid is null then continue; end if;
      if not exists(select 1 from public.order_items where id=item_uuid and order_id=order_uuid) then continue; end if;
      select count(*) into linked_delete_count from public.production_components where order_id=order_uuid and order_item_id=item_uuid and clickup_task_id is not null;
      if linked_delete_count>0 then raise exception 'Cannot delete item: % ClickUp task(s) already linked. Change product instead so the existing task can be reused.',linked_delete_count; end if;
      delete from public.order_items where id=item_uuid and order_id=order_uuid;
      deleted_count:=deleted_count+1;
    end loop;
  end if;

  if jsonb_typeof(coalesce(p_payload->'items','[]'::jsonb))<>'array' then raise exception 'items must be an array'; end if;
  for item in select value from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
    begin item_uuid:=nullif(item->>'id','')::uuid; exception when invalid_text_representation then item_uuid:=null; end;
    begin product_uuid:=nullif(item->>'product_id','')::uuid; exception when invalid_text_representation then product_uuid:=null; end;
    is_new:=item_uuid is null;
    if not is_new then select * into old_item from public.order_items where id=item_uuid and order_id=order_uuid for update; if old_item.id is null then raise exception 'Order item not found: %',item_uuid; end if; end if;
    p:=null;
    if product_uuid is not null then
      select * into p from public.products where id=product_uuid and (coalesce(status,'active')='active' or coalesce(is_published,false));
      if p.id is null then raise exception 'Product not found or inactive'; end if;
    end if;
    kind_value:=lower(coalesce(nullif(item->>'k',''),case when p.slug='edible-image' then 'edible' when p.slug='burn-away-combo' then 'burnaway' when p.slug='wafer-paper' then 'wafer' when p.slug='cake-topper' then 'printed' when p.slug='mirror-gold-artpaper' then 'mirror' when p.slug='acrylic-cake-topper' then 'acrylic' when lower(coalesce(p.display_name,p.name,'')) like '%topper%' then 'printed' when lower(coalesce(p.display_name,p.name,'')) like '%wafer%' then 'wafer' else 'edible' end,case when is_new then 'edible' else coalesce(old_item.k,old_item.product_type,'edible') end));
    if kind_value not in ('edible','burnaway','wafer','printed','mirror','acrylic') then raise exception 'Unsupported product kind: %',kind_value; end if;
    title_value:=coalesce(nullif(coalesce(p.display_name,p.name,''),''),nullif(item->>'title',''),case when is_new then 'Item' else old_item.title end);
    process_value:=coalesce(nullif(item->>'process',''),'Pre-order'); size_value:=coalesce(item->>'size',case when is_new then '' else old_item.size end,''); style_value:=coalesce(item->>'style',case when is_new then '' else old_item.style end,'');
    custom_value:=coalesce(item->>'custom_text',case when is_new then '' else coalesce(old_item.custom_text,old_item.wording,'') end,''); preview_value:=coalesce(item->>'design_preview_url',case when is_new then '' else old_item.design_preview_url end,'');
    qty_value:=greatest(1,coalesce(nullif(item->>'qty','')::integer,case when is_new then 1 else old_item.qty end,1)); price_value:=greatest(0,coalesce(nullif(item->>'price','')::numeric,p.base_price,case when is_new then 0 else old_item.price end,0));
    review_value:=coalesce(nullif(item->>'review_required','')::boolean,case when is_new then false else old_item.review_required end,false);
    structural_changed:=is_new or old_item.k is distinct from kind_value or old_item.product_type is distinct from kind_value or old_item.product_id is distinct from product_uuid or old_item.title is distinct from title_value or old_item.review_required is distinct from review_value;

    if is_new then
      insert into public.order_items(order_id,order_token,product_type,k,title,qty,price,size,style,wording,custom_text,review_required,workflow,design_preview_url,product_id,catalog_slug,catalog_clickup_task_id,customization,product_snapshot)
      values(order_uuid,o.public_token,kind_value,kind_value,title_value,qty_value,price_value,size_value,style_value,custom_value,custom_value,review_value,'Order Received',nullif(preview_value,''),product_uuid,p.slug,p.clickup_task_id,jsonb_build_object('admin_process',process_value,'admin_structural_edit',true),jsonb_strip_nulls(jsonb_build_object('product_id',product_uuid,'slug',p.slug,'image_url',p.main_image_url,'parent_sku',p.parent_sku,'admin_process',process_value,'source','admin_order_edit')))
      returning id into item_uuid; added_count:=added_count+1;
    else
      update public.order_items set product_type=kind_value,k=kind_value,title=title_value,qty=qty_value,price=price_value,size=size_value,style=style_value,wording=custom_value,custom_text=custom_value,review_required=review_value,design_preview_url=nullif(preview_value,''),product_id=product_uuid,product_variant_id=null,catalog_slug=p.slug,catalog_clickup_task_id=p.clickup_task_id,
        customization=coalesce(customization,'{}'::jsonb)||jsonb_build_object('admin_process',process_value,'admin_structural_edit',structural_changed,'admin_structural_edit_at',now()),
        product_snapshot=coalesce(product_snapshot,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object('product_id',product_uuid,'slug',p.slug,'image_url',p.main_image_url,'parent_sku',p.parent_sku,'admin_process',process_value,'source','admin_order_edit')),updated_at=now()
      where id=item_uuid;
      changed_count:=changed_count+1;
    end if;
    if structural_changed then
      component_result:=public.icetak_admin_reconcile_item_components(order_uuid,item_uuid,kind_value,title_value,review_value);
      linked_reused:=linked_reused+coalesce((component_result->>'reusedLinked')::integer,0);
    else
      update public.production_components set review_required=review_value,review_status=case when review_value then case when review_status='not_required' then 'pending' else review_status end else 'not_required' end,preview_url=nullif(preview_value,''),updated_at=now() where order_id=order_uuid and order_item_id=item_uuid;
    end if;
  end loop;

  if not exists(select 1 from public.order_items where order_id=order_uuid) then raise exception 'An order must contain at least one item'; end if;
  select jsonb_build_object(
    'items',coalesce(jsonb_agg(jsonb_build_object(
      'qty',coalesce(i.qty,1),
      'catalog_price',coalesce(nullif(i.customization#>>'{pricing,catalog_price}','')::numeric,i.price,0),
      'seller_deal_price',coalesce(i.price,0)
    ) order by i.sort_index nulls last,i.id),'[]'::jsonb),
    'delivery_fee',coalesce(o.delivery_fee,0),
    'price_adjustments',coalesce(o.pricing_adjustments,'{}'::jsonb)
  ) into pricing_payload
  from public.order_items i where i.order_id=order_uuid;
  pricing_totals:=public.icetak_qrpay_draft_totals(pricing_payload);
  total_value:=(pricing_totals->>'draft_total')::numeric;
  update public.orders set total=total_value,
    pricing_adjustments=coalesce(o.pricing_adjustments,'{}'::jsonb)||pricing_totals||jsonb_build_object(
      'final_total',total_value,'source','admin_order_edit',
      'pricing_authority','admin','admin_saved_at',now()
    ),updated_at=now()
  where id=order_uuid;
  outbox_value:=public.enqueue_clickup_production_order(order_uuid);
  select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) into after_items from public.order_items i where i.order_id=order_uuid;
  insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
  values(order_uuid::text,coalesce(o.order_no,o.order_id),'reconcile_order_items',coalesce(actor_value,'admin'),jsonb_build_object('before',before_items,'after',after_items,'added',added_count,'changed',changed_count,'deleted',deleted_count,'linkedComponentsReused',linked_reused,'newTotal',total_value,'clickupOutboxId',outbox_value));
  return jsonb_build_object('ok',true,'added',added_count,'changed',changed_count,'deleted',deleted_count,'linkedComponentsReused',linked_reused,'total',total_value,'clickupOutboxId',outbox_value);
end $function$

$definition_0$;
  execute $definition_1$
CREATE OR REPLACE FUNCTION public.icetak_admin_order_update(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  order_uuid uuid := nullif(p_payload->>'order_db_id','')::uuid;
  order_value public.orders%rowtype;
  item jsonb;
  username_value text;
  total_value numeric;
  pricing_payload jsonb; pricing_totals jsonb;
  current_delivery_fee numeric;
  delivery_key text;
  before_items jsonb;
  after_items jsonb;
  before_order jsonb;
  after_order jsonb;
  shipment_locked boolean := false;
begin
  if not public.icetak_admin_has_permission('edit_order') then raise exception 'Forbidden'; end if;
  if order_uuid is null then raise exception 'order_db_id required'; end if;

  select * into order_value from public.orders where id=order_uuid for update;
  if order_value.id is null then raise exception 'Order not found'; end if;

  if p_payload ? 'delivery_method' then
    delivery_key := lower(btrim(coalesce(p_payload->>'delivery_method','')));
    if delivery_key in ('j&t','jt','j&t express','jnt express') then delivery_key := 'jnt'; end if;
    if delivery_key in ('ninjavan','ninja van','ninja van malaysia','ninja') then delivery_key := 'ninja'; end if;
    if delivery_key not in ('pickup','spx','jnt','ninja') then
      raise exception 'Unsupported delivery method. Use pickup, spx, jnt or ninja';
    end if;

    shipment_locked := nullif(btrim(coalesce(order_value.tracking,'')),'') is not null
      or exists (
        select 1 from public.shipments s
        where s.order_id=order_uuid
          and nullif(btrim(coalesce(s.tracking_no,'')),'') is not null
      );
    if shipment_locked then
      raise exception 'Courier/delivery cannot be changed after tracking has been created';
    end if;
  end if;

  before_order:=jsonb_build_object(
    'dateNeed',order_value.date_need,
    'adminRemark',order_value.admin_remark,
    'total',order_value.total,
    'deliveryFee',coalesce(order_value.delivery_fee,0),
    'delivery',coalesce(order_value.delivery,''),
    'deliveryMethod',coalesce(order_value.delivery_method,''),
    'courier',coalesce(order_value.courier,'')
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'qty',i.qty,'price',i.price,
    'customText',coalesce(i.custom_text,i.wording,''),
    'previewUrl',coalesce(i.design_preview_url,'')
  ) order by i.id),'[]'::jsonb)
  into before_items
  from public.order_items i where i.order_id=order_uuid;

  update public.orders set
    date_need=coalesce(nullif(p_payload->>'date_need','')::date,date_need),
    admin_remark=coalesce(p_payload->>'admin_remark',admin_remark),
    delivery_fee=case
      when delivery_key='pickup' then 0
      when p_payload ? 'delivery_fee' then greatest(0,coalesce(nullif(p_payload->>'delivery_fee','')::numeric,0))
      else delivery_fee
    end,
    delivery=case delivery_key
      when 'pickup' then 'Pickup'
      when 'spx' then 'SPX'
      when 'jnt' then 'JNT'
      when 'ninja' then 'NINJA'
      else delivery
    end,
    delivery_method=coalesce(delivery_key,delivery_method),
    courier=case
      when delivery_key='pickup' then null
      when delivery_key in ('spx','jnt','ninja') then delivery_key
      else courier
    end,
    updated_at=now()
  where id=order_uuid;

  if jsonb_typeof(p_payload->'items')='array' then
    for item in select value from jsonb_array_elements(p_payload->'items') loop
      update public.order_items set
        qty=greatest(1,coalesce(nullif(item->>'qty','')::integer,qty)),
        price=greatest(0,coalesce(nullif(item->>'price','')::numeric,price)),
        custom_text=coalesce(item->>'custom_text',custom_text),
        wording=coalesce(item->>'custom_text',wording),
        design_preview_url=coalesce(item->>'design_preview_url',design_preview_url),
        updated_at=now()
      where id=nullif(item->>'id','')::uuid and order_id=order_uuid;
    end loop;
  end if;

  select * into order_value from public.orders where id=order_uuid;
  select jsonb_build_object(
    'items',coalesce(jsonb_agg(jsonb_build_object(
      'qty',coalesce(i.qty,1),
      'catalog_price',coalesce(nullif(i.customization#>>'{pricing,catalog_price}','')::numeric,i.price,0),
      'seller_deal_price',coalesce(i.price,0)
    ) order by i.sort_index nulls last,i.id),'[]'::jsonb),
    'delivery_fee',coalesce(order_value.delivery_fee,0),
    'price_adjustments',coalesce(order_value.pricing_adjustments,'{}'::jsonb)
  ) into pricing_payload
  from public.order_items i where i.order_id=order_uuid;
  pricing_totals:=public.icetak_qrpay_draft_totals(pricing_payload);
  total_value:=(pricing_totals->>'draft_total')::numeric;
  update public.orders set total=total_value,
    pricing_adjustments=coalesce(order_value.pricing_adjustments,'{}'::jsonb)||pricing_totals||jsonb_build_object(
      'final_total',total_value,'source','admin_order_edit',
      'pricing_authority','admin','admin_saved_at',now()
    ),updated_at=now()
  where id=order_uuid;
  perform public.enqueue_clickup_production_order(order_uuid);
  select * into order_value from public.orders where id=order_uuid;

  after_order:=jsonb_build_object(
    'dateNeed',order_value.date_need,
    'adminRemark',order_value.admin_remark,
    'total',order_value.total,
    'deliveryFee',coalesce(order_value.delivery_fee,0),
    'delivery',coalesce(order_value.delivery,''),
    'deliveryMethod',coalesce(order_value.delivery_method,''),
    'courier',coalesce(order_value.courier,'')
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'qty',i.qty,'price',i.price,
    'customText',coalesce(i.custom_text,i.wording,''),
    'previewUrl',coalesce(i.design_preview_url,'')
  ) order by i.id),'[]'::jsonb)
  into after_items
  from public.order_items i where i.order_id=order_uuid;

  select username into username_value
  from public.admin_users
  where auth_user_id=auth.uid() and is_active=true limit 1;

  insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
  values(
    order_uuid::text,
    coalesce(order_value.order_id,order_value.order_no),
    'update_order',username_value,
    jsonb_build_object(
      'before',jsonb_build_object('order',before_order,'items',before_items),
      'after',jsonb_build_object('order',after_order,'items',after_items)
    )
  );

  return jsonb_build_object(
    'ok',true,
    'total',total_value,
    'deliveryFee',coalesce(order_value.delivery_fee,0),
    'delivery',coalesce(order_value.delivery,''),
    'deliveryMethod',coalesce(order_value.delivery_method,''),
    'courier',coalesce(order_value.courier,'')
  );
end;
$function$

$definition_1$;
  execute $definition_2$
CREATE OR REPLACE FUNCTION public.icetak_sync_order_pricing_from_payload_v15(p_order_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  totals jsonb;
  current_adjustments jsonb; current_total numeric;
begin
  if p_order_id is null or p_payload is null then return '{}'::jsonb; end if;
  -- Serialize with the existing admin save RPCs before checking authority.
  select pricing_adjustments,total into current_adjustments,current_total
  from public.orders where id=p_order_id for update;
  if not found then return '{}'::jsonb; end if;
  if current_adjustments->>'pricing_authority'='admin' then
    return coalesce(current_adjustments,'{}'::jsonb)||jsonb_build_object(
      'draft_total',current_total,'final_total',current_total,'pricing_preserved',true
    );
  end if;
  totals:=public.icetak_qrpay_draft_totals(coalesce(p_payload,'{}'::jsonb));
  update public.orders
  set total=(totals->>'draft_total')::numeric,
      delivery_fee=(totals->>'shipping_fee')::numeric,
      pricing_adjustments=coalesce(p_payload->'price_adjustments','{}'::jsonb)||jsonb_build_object(
        'catalog_subtotal',(totals->>'catalog_subtotal')::numeric,
        'item_subtotal',(totals->>'item_subtotal')::numeric,
        'custom_addon',(totals->>'custom_addon')::numeric,
        'discount_type',totals->>'discount_type',
        'discount_value',(totals->>'discount_value')::numeric,
        'discount_amount',(totals->>'discount_amount')::numeric,
        'shipping_fee',(totals->>'shipping_fee')::numeric,
        'rounding',(totals->>'rounding')::numeric,
        'final_total',(totals->>'draft_total')::numeric,
        'source','draft_pricing_v15'
      ),updated_at=now()
  where id=p_order_id;

  with src as (
    select ord::int rn,item from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) with ordinality x(item,ord)
  ), dst as (
    select id,row_number() over(order by sort_index nulls last,updated_at,id)::int rn from public.order_items where order_id=p_order_id
  )
  update public.order_items oi
  set price=coalesce(nullif(src.item->>'seller_deal_price','')::numeric,nullif(src.item->>'price','')::numeric,oi.price),
      customization=coalesce(oi.customization,'{}'::jsonb)||jsonb_build_object('pricing',jsonb_build_object(
        'catalog_price',coalesce(nullif(src.item->>'catalog_price','')::numeric,nullif(src.item->>'price','')::numeric,oi.price),
        'seller_deal_price',case when nullif(src.item->>'seller_deal_price','') is null then null else (src.item->>'seller_deal_price')::numeric end,
        'price_reason',coalesce(src.item->>'price_reason',''),
        'price_source',case when nullif(src.item->>'seller_deal_price','') is null then 'catalog' else 'seller_deal' end
      )),updated_at=now()
  from src join dst on dst.rn=src.rn where oi.id=dst.id;
  return totals;
end
$function$

$definition_2$;
  execute $definition_3$
CREATE OR REPLACE FUNCTION public.icetak_sync_draft_items_to_order(p_order_id uuid, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  s record;
  ref text;
  proc text;
  v_review_required boolean;
  cust jsonb;
  snap jsonb;
begin
  if p_order_id is null or jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' then return; end if;
  perform 1 from public.orders where id=p_order_id for update;
  if exists(select 1 from public.orders where id=p_order_id
      and pricing_adjustments->>'pricing_authority'='admin') then return; end if;
  for s in
    select ord::int-1 as idx,item
    from jsonb_array_elements(p_items) with ordinality x(item,ord)
  loop
    ref:=coalesce(nullif(s.item->>'referenceUrl',''),nullif(s.item->>'reference_url',''),nullif(s.item#>>'{customization,reference_url}',''),nullif(s.item#>>'{product_snapshot,image_url}',''),'');
    proc:=coalesce(nullif(s.item->>'process',''),'Pre-order');
    v_review_required:=coalesce(s.item->>'review','')='Need Review' or coalesce(nullif(s.item->>'review_required','')::boolean,false);
    cust:=coalesce(s.item->'customization','{}'::jsonb)||jsonb_build_object('admin_process',proc);
    if ref<>'' then cust:=cust||jsonb_build_object('reference_url',ref); end if;
    snap:=coalesce(s.item->'product_snapshot','{}'::jsonb)||jsonb_build_object('quick_arrange_kind',coalesce(s.item->>'k',s.item->>'product_type','edible'));
    if ref<>'' then snap:=snap||jsonb_build_object('image_url',ref); end if;
    update public.order_items oi set
      k=coalesce(nullif(s.item->>'k',''),nullif(s.item->>'product_type',''),oi.k),
      product_type=coalesce(nullif(s.item->>'product_type',''),nullif(s.item->>'k',''),oi.product_type),
      title=coalesce(nullif(s.item->>'title',''),oi.title),
      qty=greatest(1,coalesce(nullif(s.item->>'qty','')::int,oi.qty,1)),
      price=greatest(0,coalesce(nullif(s.item->>'price','')::numeric,oi.price,0)),
      size=coalesce(s.item->>'size',oi.size,''),
      style=coalesce(s.item->>'style',oi.style,''),
      wording=coalesce(nullif(s.item->>'customText',''),nullif(s.item->>'custom_text',''),nullif(s.item->>'wording',''),oi.wording,''),
      custom_text=coalesce(nullif(s.item->>'customText',''),nullif(s.item->>'custom_text',''),nullif(s.item->>'wording',''),oi.custom_text,''),
      review_required=v_review_required,
      customization=coalesce(oi.customization,'{}'::jsonb)||cust,
      product_snapshot=coalesce(oi.product_snapshot,'{}'::jsonb)||snap,
      design_preview_url=case when ref<>'' then ref else oi.design_preview_url end,
      sort_index=s.idx,
      updated_at=now()
    where oi.order_id=p_order_id and coalesce(oi.sort_index,s.idx)=s.idx;
  end loop;
end
$function$

$definition_3$;
end;
$admin_price_patch$;
