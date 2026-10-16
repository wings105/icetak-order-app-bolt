create policy product_channel_service on public.product_channel_listings for all to service_role using(true) with check(true);
create policy product_jobs_service on public.product_sync_jobs for all to service_role using(true) with check(true);
create policy product_requests_service on public.product_catalog_requests for all to service_role using(true) with check(true);
do $patch$
declare d text:=pg_get_functiondef('public.icetak_product_admin(text,jsonb,text)'::regprocedure);
begin
 d:=replace(d,'  r:=jsonb_build_object(''saved'',p.id);',
 $body$
  if (p_body->>'is_published')::boolean and not exists(select 1 from product_variants where product_id=p.id and active and price>0) then raise exception 'ACTIVE_WEBSITE_MODEL_REQUIRED'; end if;
  if coalesce(p_body#>>'{website_order,process}','Pre-order') not in ('Pre-order','Urgent') then raise exception 'INVALID_ORDER_PROCESS'; end if;
  update products set base_price=coalesce((select min(price) from product_variants where product_id=p.id and active),base_price),
    metadata=metadata||jsonb_build_object('website_order',jsonb_build_object('process',coalesce(p_body#>>'{website_order,process}','Pre-order'),'review_required',coalesce((p_body#>>'{website_order,review_required}')::boolean,false),'allow_custom',coalesce((p_body#>>'{website_order,allow_custom}')::boolean,true))) where id=p.id;
  r:=jsonb_build_object('saved',p.id);
 $body$);
 execute d;
 d:=pg_get_functiondef('public.icetak_validate_catalog_selection(text,text,text,text)'::regprocedure);
 d:=replace(d,'    if v_wording is null then raise exception ''catalog_invalid_wording''; end if;',
 '    if v_wording is null or (p_wording_mode=''model_custom'' and not coalesce((v_product.metadata#>>''{website_order,allow_custom}'')::boolean,true)) then raise exception ''catalog_invalid_wording''; end if;');
 d:=replace(d,'v_review:=coalesce((v_wording->>''review_required'')::boolean,false);','v_review:=coalesce((v_wording->>''review_required'')::boolean,false) or coalesce((v_product.metadata#>>''{website_order,review_required}'')::boolean,false);');
 d:=replace(d,'''variant_sku'',v_variant.sku,''wording_mode''','''variant_sku'',v_variant.sku,''admin_process'',coalesce(v_product.metadata#>>''{website_order,process}'',''Pre-order''),''wording_mode''');
 execute d;
end $patch$;
