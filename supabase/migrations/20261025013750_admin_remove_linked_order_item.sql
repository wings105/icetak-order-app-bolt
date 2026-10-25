-- Allow admin removal after the server verifies reversible ClickUp archiving.
-- Keep fulfillment locks, existing pricing authority and permission checks.
DO $linked_item_patch$
begin
  if md5(pg_get_functiondef('public.icetak_admin_order_items_reconcile(jsonb)'::regprocedure))<>'82e8bda34fcb0cb44ea486869f0baff7' then
    raise exception 'Concurrent reconcile function change';
  end if;
  execute $definition$
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
  linked_delete_ids text[];
  removed_components jsonb:='[]'::jsonb;
  removed_tasks jsonb:='[]'::jsonb;
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
  if auth.jwt()->>'role'='service_role' and nullif(p_payload->>'_actor','') is not null then
    select u.username into actor_value from public.admin_users u
      join public.admin_permissions ap on ap.username=u.username
      where u.username=p_payload->>'_actor' and u.is_active
        and 'edit_order'=any(coalesce(ap.permissions,'{}'::text[])) limit 1;
    if actor_value is null then raise exception 'Verified admin actor required'; end if;
  end if;
  select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) into before_items from public.order_items i where i.order_id=order_uuid;

  if jsonb_typeof(coalesce(p_payload->'delete_ids','[]'::jsonb))='array' then
    for delete_value in select value from jsonb_array_elements(coalesce(p_payload->'delete_ids','[]'::jsonb)) loop
      begin item_uuid:=trim(both '"' from delete_value::text)::uuid; exception when invalid_text_representation then item_uuid:=null; end;
      if item_uuid is null then continue; end if;
      if not exists(select 1 from public.order_items where id=item_uuid and order_id=order_uuid) then continue; end if;
      select coalesce(array_agg(distinct task_id),'{}'::text[]) into linked_delete_ids
      from (
        select clickup_task_id as task_id from public.production_components
          where order_id=order_uuid and order_item_id=item_uuid and clickup_task_id is not null
        union
        select clickup_task_id from public.clickup_tasks
          where order_id=order_uuid and order_item_id=item_uuid and clickup_task_id is not null
      ) linked;
      linked_delete_count:=cardinality(linked_delete_ids);
      if linked_delete_count>0 then
        -- Only the authenticated server handler may attest that ClickUp has
        -- archived every linked task. Client-supplied flags cannot bypass this.
        if coalesce(auth.jwt()->>'role','')<>'service_role' or actor_value is null
          or not (to_jsonb(linked_delete_ids)<@coalesce(p_payload->'_archived_task_ids','[]'::jsonb)) then
          raise exception 'Linked ClickUp tasks must be archived and verified before deleting this item.';
        end if;
        if exists(select 1 from public.production_components pc
          where pc.clickup_task_id=any(linked_delete_ids)
            and (pc.order_id is distinct from order_uuid or pc.order_item_id is distinct from item_uuid))
          or exists(select 1 from public.clickup_tasks ct
          where ct.clickup_task_id=any(linked_delete_ids)
            and (ct.order_id is distinct from order_uuid or ct.order_item_id is distinct from item_uuid)) then
          raise exception 'A linked ClickUp task is shared with another item; resolve that link first.';
        end if;
      end if;
      removed_components:=removed_components||coalesce((select jsonb_agg(to_jsonb(pc))
        from public.production_components pc where pc.order_id=order_uuid and pc.order_item_id=item_uuid),'[]'::jsonb);
      removed_tasks:=removed_tasks||coalesce((select jsonb_agg(to_jsonb(ct))
        from public.clickup_tasks ct where ct.order_id=order_uuid and
          (ct.order_item_id=item_uuid or ct.component_id in
            (select id from public.production_components where order_id=order_uuid and order_item_id=item_uuid))),'[]'::jsonb);
      delete from public.clickup_tasks where order_id=order_uuid and
        (order_item_id=item_uuid or component_id in
          (select id from public.production_components where order_id=order_uuid and order_item_id=item_uuid));
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
  values(order_uuid::text,coalesce(o.order_no,o.order_id),'reconcile_order_items',coalesce(actor_value,'admin'),jsonb_build_object('before',before_items,'after',after_items,'added',added_count,'changed',changed_count,'deleted',deleted_count,'linkedComponentsReused',linked_reused,'newTotal',total_value,'removedComponents',removed_components,'removedClickupTasks',removed_tasks,'clickupOutboxId',outbox_value));
  return jsonb_build_object('ok',true,'added',added_count,'changed',changed_count,'deleted',deleted_count,'linkedComponentsReused',linked_reused,'total',total_value,'clickupOutboxId',outbox_value);
end $function$

$definition$;
end;
$linked_item_patch$;
