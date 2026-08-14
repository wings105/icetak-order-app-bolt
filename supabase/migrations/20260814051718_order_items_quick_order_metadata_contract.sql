do $do$
declare fn oid; def text; old text; new text;
begin
  select p.oid into fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='icetak_create_order' limit 1;
  if fn is null then raise exception 'icetak_create_order not found'; end if;
  def:=pg_get_functiondef(fn);
  old:=$x$v_customization:=coalesce(v_item->'customization','{}'::jsonb); v_product_snapshot:=coalesce(v_item->'product_snapshot','{}'::jsonb); v_wording_mode:=nullif(v_item->>'wording_mode','');$x$;
  new:=$x$v_customization:=coalesce(v_item->'customization','{}'::jsonb)||jsonb_build_object('admin_process',coalesce(nullif(v_item->>'process',''),'Pre-order')); v_product_snapshot:=coalesce(v_item->'product_snapshot','{}'::jsonb); v_wording_mode:=nullif(v_item->>'wording_mode','');$x$;
  if position(old in def)>0 then def:=replace(def,old,new); end if;
  old:=$x$values(v_order_db_id,v_public_token,v_k,v_k,v_title,coalesce(nullif(v_item->>'qty','')::int,1),v_item_price,v_item_size,v_item_style,v_custom_text,v_custom_text,v_review_required,'Order Received',v_product_id,v_product_variant_id,v_catalog_slug,v_catalog_clickup_task_id,v_wording_mode,v_customization,v_product_snapshot) returning id into v_item_id;$x$;
  new:=$x$values(v_order_db_id,v_public_token,v_k,v_k,v_title,coalesce(nullif(v_item->>'qty','')::int,1),v_item_price,v_item_size,v_item_style,v_custom_text,v_custom_text,v_review_required,'Order Received',v_product_id,v_product_variant_id,v_catalog_slug,v_catalog_clickup_task_id,v_wording_mode,v_customization,v_product_snapshot) returning id into v_item_id;
    update public.order_items set design_preview_url=coalesce(nullif(v_customization->>'reference_url',''),nullif(v_product_snapshot->>'image_url',''),design_preview_url) where id=v_item_id;$x$;
  if position(old in def)>0 then def:=replace(def,old,new); end if;
  execute def;
end $do$;