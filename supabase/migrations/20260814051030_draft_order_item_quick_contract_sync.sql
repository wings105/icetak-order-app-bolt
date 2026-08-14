create or replace function public.icetak_assign_order_item_sort_index()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
begin
  if new.sort_index is null then
    select coalesce(max(sort_index),-1)+1 into new.sort_index from public.order_items where order_id=new.order_id;
  end if;
  return new;
end
$function$;

drop trigger if exists trg_icetak_order_item_sort_index on public.order_items;
create trigger trg_icetak_order_item_sort_index before insert on public.order_items for each row execute function public.icetak_assign_order_item_sort_index();

create or replace function public.icetak_sync_draft_items_to_order(p_order_id uuid,p_items jsonb)
returns void
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare s record; ref text; proc text; review_required boolean; cust jsonb; snap jsonb;
begin
  if p_order_id is null or jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' then return; end if;
  for s in select ord::int-1 idx,item from jsonb_array_elements(p_items) with ordinality x(item,ord) loop
    ref:=coalesce(nullif(s.item->>'referenceUrl',''),nullif(s.item->>'reference_url',''),nullif(s.item#>>'{customization,reference_url}',''),nullif(s.item#>>'{product_snapshot,image_url}',''),'');
    proc:=coalesce(nullif(s.item->>'process',''),'Pre-order');
    review_required:=coalesce(s.item->>'review','')='Need Review' or coalesce(nullif(s.item->>'review_required','')::boolean,false);
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
      review_required=review_required,
      customization=coalesce(oi.customization,'{}'::jsonb)||cust,
      product_snapshot=coalesce(oi.product_snapshot,'{}'::jsonb)||snap,
      design_preview_url=case when ref<>'' then ref else oi.design_preview_url end,
      sort_index=s.idx,
      updated_at=now()
    where oi.order_id=p_order_id and coalesce(oi.sort_index,s.idx)=s.idx;
  end loop;
end
$function$;

revoke all on function public.icetak_sync_draft_items_to_order(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icetak_sync_draft_items_to_order(uuid,jsonb) to service_role;

create or replace function public.icetak_sync_confirmed_draft_order_items()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
begin
  if new.order_id is not null and (old.order_id is distinct from new.order_id or old.confirmed_draft is distinct from new.confirmed_draft or old.working_draft is distinct from new.working_draft) then
    perform public.icetak_sync_draft_items_to_order(new.order_id,coalesce(new.confirmed_draft->'items',new.working_draft->'items','[]'::jsonb));
  end if;
  return new;
end
$function$;

drop trigger if exists trg_icetak_sync_confirmed_draft_items on public.qrpay_order_drafts;
create trigger trg_icetak_sync_confirmed_draft_items after update of order_id,confirmed_draft,working_draft on public.qrpay_order_drafts for each row execute function public.icetak_sync_confirmed_draft_order_items();