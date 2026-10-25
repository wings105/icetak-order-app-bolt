-- Rollback-only fixture test: set icetak.test_order_id before running.
DO $delete_regression$
declare
  oid uuid:=nullif(current_setting('icetak.test_order_id',true),'')::uuid;
  iid uuid; tid text; admin_id uuid; old_total numeric; removed_amount numeric;
  old_count integer; payload jsonb; result_value jsonb; draft_items jsonb;
begin
  select i.id,i.price*i.qty,pc.clickup_task_id into iid,removed_amount,tid
    from public.order_items i join public.production_components pc on pc.order_item_id=i.id
    where i.order_id=oid and i.size='3 inch' and pc.clickup_task_id is not null limit 1;
  if iid is null then raise exception 'Linked 3 inch fixture required'; end if;
  select total into old_total from public.orders where id=oid;
  select count(*) into old_count from public.order_items where order_id=oid;
  select auth_user_id into admin_id from public.admin_users where username='admin1' and is_active limit 1;
  select jsonb_build_object('order_db_id',oid,'delete_ids',jsonb_build_array(iid),'items',coalesce(jsonb_agg(
    jsonb_build_object('id',i.id,'product_id',i.product_id,'k',coalesce(i.k,i.product_type),'title',i.title,
      'qty',i.qty,'price',i.price,'size',i.size,'style',i.style,'review_required',i.review_required,
      'custom_text',coalesce(i.custom_text,i.wording,''),'design_preview_url',coalesce(i.design_preview_url,''))
    order by i.sort_index),'[]'::jsonb),'_actor','admin1','_archived_task_ids',jsonb_build_array(tid))
    into payload from public.order_items i where i.order_id=oid and i.id<>iid;

  -- Forged client archive attestations cannot authorize linked deletion.
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  begin
    perform public.icetak_admin_order_items_reconcile(payload);
    raise exception using errcode='ZD001',message='Client bypassed server archive verification';
  exception when raise_exception then
    if sqlerrm not like 'Linked ClickUp tasks must be archived%' then raise; end if;
  end;

  perform set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
  result_value:=public.icetak_admin_order_items_reconcile(payload);
  if not (result_value->>'ok')::boolean or (result_value->>'deleted')::integer<>1 then
    raise exception 'Verified server deletion failed';
  end if;
  if (select count(*) from public.order_items where order_id=oid)<>old_count-1
    or exists(select 1 from public.production_components where order_item_id=iid)
    or exists(select 1 from public.clickup_tasks where order_id=oid and clickup_task_id=tid) then
    raise exception 'Removed item/component/task mapping is still active';
  end if;
  if (result_value->>'total')::numeric<>old_total-removed_amount
    or (select total from public.orders where id=oid)<>old_total-removed_amount then
    raise exception 'Delete total did not retain the existing discount';
  end if;
  if not exists(select 1 from public.admin_audit a where a.order_db_id=oid::text and a.action='reconcile_order_items'
    and jsonb_array_length(coalesce(a.payload->'removedComponents','[]'::jsonb))>0
    and jsonb_array_length(coalesce(a.payload->'removedClickupTasks','[]'::jsonb))>0) then
    raise exception 'Removed task/component audit missing';
  end if;
  select working_draft->'items' into draft_items from public.qrpay_order_drafts where order_id=oid limit 1;
  perform public.icetak_sync_draft_items_to_order(oid,draft_items);
  perform public.enqueue_clickup_production_order(oid);
  if (select count(*) from public.order_items where order_id=oid)<>old_count-1
    or (select total from public.orders where id=oid)<>old_total-removed_amount then
    raise exception 'Stale draft/ClickUp sync restored a removed item or old total';
  end if;
end;
$delete_regression$;
