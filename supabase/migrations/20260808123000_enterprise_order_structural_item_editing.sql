create or replace function public.enqueue_clickup_production_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare v_id uuid; v_order public.orders;
begin
  select * into v_order from public.orders where id=p_order_id;
  if not found then raise exception 'order_not_found'; end if;
  if not public.icetak_order_is_production_ready(v_order) then return null; end if;
  if not exists(select 1 from public.production_components where order_id=p_order_id and clickup_task_id is null) then return null; end if;
  insert into public.integration_outbox(provider,event_type,order_id,order_token,payload,status,next_attempt_at,source,channel,idempotency_key)
  values('activepieces','clickup.production.create',p_order_id,v_order.public_token,jsonb_build_object('order_id',p_order_id,'event_type','clickup.production.create'),'pending',now(),'supabase','clickup','clickup:production:create:'||p_order_id::text)
  on conflict(idempotency_key) where idempotency_key is not null do update set
    status='pending', next_attempt_at=now(), payload=excluded.payload, last_error=null, error=null,
    locked_at=null, processed_at=null, sent_at=null
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.icetak_admin_order_product_options()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_temp'
as $$
declare result_value jsonb;
begin
  if not exists(select 1 from public.admin_users where auth_user_id=auth.uid() and is_active=true) then raise exception 'Unauthorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',p.id,'slug',p.slug,'label',coalesce(p.display_name,p.name),'basePrice',coalesce(p.base_price,0),
      'kind',case
        when p.slug='edible-image' then 'edible'
        when p.slug='burn-away-combo' then 'burnaway'
        when p.slug='wafer-paper' then 'wafer'
        when p.slug='cake-topper' then 'printed'
        when p.slug='mirror-gold-artpaper' then 'mirror'
        when p.slug='acrylic-cake-topper' then 'acrylic'
        when lower(coalesce(p.display_name,p.name,'')) like '%topper%' then 'printed'
        when lower(coalesce(p.display_name,p.name,'')) like '%wafer%' then 'wafer'
        when lower(coalesce(p.display_name,p.name,'')) like '%acrylic%' then 'acrylic'
        else 'edible' end,
      'productKind',p.product_kind,'catalogClickupTaskId',coalesce(p.clickup_task_id,''),'imageUrl',coalesce(p.main_image_url,''),
      'isCatalogDesign',(p.product_kind='catalog_design')
    ) order by (p.product_kind='catalog_design'),coalesce(p.display_name,p.name)),'[]'::jsonb)
  into result_value from public.products p where coalesce(p.status,'active')='active' or coalesce(p.is_published,false);
  return result_value;
end $$;

create or replace function public.icetak_admin_reconcile_item_components(
  p_order_id uuid,p_item_id uuid,p_kind text,p_title text,p_review_required boolean
) returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare
  desired_count integer:=case when p_kind='burnaway' then 2 else 1 end;
  linked_count integer;
  keep1 uuid; keep2 uuid; inserted_count integer:=0; deleted_count integer:=0; reused_linked integer:=0;
  type1 text; label1 text; type2 text; label2 text; order_token_value text;
begin
  select public_token into order_token_value from public.orders where id=p_order_id;
  select count(*) filter(where clickup_task_id is not null) into linked_count
  from public.production_components where order_id=p_order_id and order_item_id=p_item_id;
  if linked_count>desired_count then
    raise exception 'Cannot reduce this item to % component(s): % ClickUp task(s) are already linked. Close/remove the extra ClickUp task first.',desired_count,linked_count;
  end if;
  if p_kind='burnaway' then type1:='edible'; label1:='Edible Layer'; type2:='wafer'; label2:='Wafer Layer';
  else
    type1:=p_kind;
    label1:=case when p_kind='edible' then 'Edible Image' when p_kind='wafer' then 'Wafer Paper' when p_kind='printed' then 'Cake Topper' when p_kind='mirror' then 'Mirror Gold Topper' when p_kind='acrylic' then 'Acrylic Topper' else coalesce(nullif(p_title,''),'Item') end;
  end if;
  select id into keep1 from public.production_components
  where order_id=p_order_id and order_item_id=p_item_id
  order by (clickup_task_id is not null) desc,set_index nulls last,created_at,id limit 1;
  if keep1 is null then
    insert into public.production_components(order_id,order_item_id,order_token,item_id,component_type,label,workflow,review_required,review_status)
    values(p_order_id,p_item_id,order_token_value,p_item_id::text,type1,label1,'Order Received',p_review_required,case when p_review_required then 'pending' else 'not_required' end)
    returning id into keep1; inserted_count:=inserted_count+1;
  else
    if exists(select 1 from public.production_components where id=keep1 and clickup_task_id is not null) then reused_linked:=reused_linked+1; end if;
    update public.production_components set component_type=type1,label=label1,review_required=p_review_required,
      review_status=case when p_review_required then 'pending' else 'not_required' end,updated_at=now() where id=keep1;
  end if;
  if desired_count=2 then
    select id into keep2 from public.production_components
    where order_id=p_order_id and order_item_id=p_item_id and id<>keep1
    order by (clickup_task_id is not null) desc,set_index nulls last,created_at,id limit 1;
    if keep2 is null then
      insert into public.production_components(order_id,order_item_id,order_token,item_id,component_type,label,workflow,review_required,review_status)
      values(p_order_id,p_item_id,order_token_value,p_item_id::text,type2,label2,'Order Received',p_review_required,case when p_review_required then 'pending' else 'not_required' end)
      returning id into keep2; inserted_count:=inserted_count+1;
    else
      if exists(select 1 from public.production_components where id=keep2 and clickup_task_id is not null) then reused_linked:=reused_linked+1; end if;
      update public.production_components set component_type=type2,label=label2,review_required=p_review_required,
        review_status=case when p_review_required then 'pending' else 'not_required' end,updated_at=now() where id=keep2;
    end if;
  end if;
  with gone as (
    delete from public.production_components
    where order_id=p_order_id and order_item_id=p_item_id and clickup_task_id is null
      and id<>keep1 and (keep2 is null or id<>keep2)
    returning 1
  ) select count(*) into deleted_count from gone;
  return jsonb_build_object('inserted',inserted_count,'deleted',deleted_count,'reusedLinked',reused_linked,'desired',desired_count);
end $$;

create or replace function public.icetak_admin_order_items_reconcile(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp'
as $$
declare
  order_uuid uuid:=nullif(p_payload->>'order_db_id','')::uuid; o public.orders%rowtype; actor_value text;
  item jsonb; delete_value jsonb; item_uuid uuid; product_uuid uuid; p public.products%rowtype; old_item public.order_items%rowtype;
  kind_value text; title_value text; process_value text; size_value text; style_value text; custom_value text; preview_value text;
  qty_value integer; price_value numeric; review_value boolean; is_new boolean; structural_changed boolean;
  total_value numeric; before_items jsonb; after_items jsonb; component_result jsonb;
  added_count integer:=0; changed_count integer:=0; deleted_count integer:=0; linked_reused integer:=0; outbox_value uuid; linked_delete_count integer;
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
      delete from public.order_items where id=item_uuid and order_id=order_uuid; deleted_count:=deleted_count+1;
    end loop;
  end if;
  if jsonb_typeof(coalesce(p_payload->'items','[]'::jsonb))<>'array' then raise exception 'items must be an array'; end if;
  for item in select value from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
    begin item_uuid:=nullif(item->>'id','')::uuid; exception when invalid_text_representation then item_uuid:=null; end;
    begin product_uuid:=nullif(item->>'product_id','')::uuid; exception when invalid_text_representation then product_uuid:=null; end;
    is_new:=item_uuid is null;
    if not is_new then select * into old_item from public.order_items where id=item_uuid and order_id=order_uuid for update; if old_item.id is null then raise exception 'Order item not found: %',item_uuid; end if; end if;
    p:=null;
    if product_uuid is not null then select * into p from public.products where id=product_uuid and (coalesce(status,'active')='active' or coalesce(is_published,false)); if p.id is null then raise exception 'Product not found or inactive'; end if; end if;
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
        product_snapshot=coalesce(product_snapshot,'{}'::jsonb)||jsonb_strip_nulls(jsonb_build_object('product_id',product_uuid,'slug',p.slug,'image_url',p.main_image_url,'parent_sku',p.parent_sku,'admin_process',process_value,'source','admin_order_edit')),updated_at=now() where id=item_uuid;
      changed_count:=changed_count+1;
    end if;
    if structural_changed then component_result:=public.icetak_admin_reconcile_item_components(order_uuid,item_uuid,kind_value,title_value,review_value); linked_reused:=linked_reused+coalesce((component_result->>'reusedLinked')::integer,0);
    else update public.production_components set review_required=review_value,review_status=case when review_value then case when review_status='not_required' then 'pending' else review_status end else 'not_required' end,preview_url=nullif(preview_value,''),updated_at=now() where order_id=order_uuid and order_item_id=item_uuid; end if;
  end loop;
  if not exists(select 1 from public.order_items where order_id=order_uuid) then raise exception 'An order must contain at least one item'; end if;
  select coalesce(sum(coalesce(qty,1)*coalesce(price,0)),0)+coalesce(o.delivery_fee,0) into total_value from public.order_items where order_id=order_uuid;
  update public.orders set total=total_value,updated_at=now() where id=order_uuid;
  outbox_value:=public.enqueue_clickup_production_order(order_uuid);
  select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb) into after_items from public.order_items i where i.order_id=order_uuid;
  insert into public.admin_audit(order_db_id,order_id,action,actor,payload) values(order_uuid::text,coalesce(o.order_no,o.order_id),'reconcile_order_items',coalesce(actor_value,'admin'),jsonb_build_object('before',before_items,'after',after_items,'added',added_count,'changed',changed_count,'deleted',deleted_count,'linkedComponentsReused',linked_reused,'newTotal',total_value,'clickupOutboxId',outbox_value));
  return jsonb_build_object('ok',true,'added',added_count,'changed',changed_count,'deleted',deleted_count,'linkedComponentsReused',linked_reused,'total',total_value,'clickupOutboxId',outbox_value);
end $$;

revoke all on function public.icetak_admin_order_product_options() from public,anon;
grant execute on function public.icetak_admin_order_product_options() to authenticated,service_role,postgres;
revoke all on function public.icetak_admin_order_items_reconcile(jsonb) from public,anon;
grant execute on function public.icetak_admin_order_items_reconcile(jsonb) to authenticated,service_role,postgres;
revoke all on function public.icetak_admin_reconcile_item_components(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.icetak_admin_reconcile_item_components(uuid,uuid,text,text,boolean) to service_role,postgres;
