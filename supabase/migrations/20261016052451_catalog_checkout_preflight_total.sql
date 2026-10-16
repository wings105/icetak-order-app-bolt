-- Resolve catalogue prices before the order INSERT creates a payment reservation.
do $patch$
declare d text:=pg_get_functiondef('public.icetak_create_order(jsonb)'::regprocedure);
needle text:='  v_order_no:=';
preflight text:=$body$
  if exists(select 1 from jsonb_array_elements(v_items) x where nullif(trim(coalesce(x->>'catalogSlug',x->>'catalog_slug','')),'') is not null) then
    v_total:=v_delivery_fee;
    for v_item in select * from jsonb_array_elements(v_items) loop
      if coalesce(nullif(v_item->>'qty','')::int,1) not between 1 and 999 then raise exception 'catalog_invalid_quantity'; end if;
      v_catalog_slug:=nullif(trim(coalesce(v_item->>'catalogSlug',v_item->>'catalog_slug','')),'');
      if v_catalog_slug is not null then
        v_catalog:=public.icetak_validate_catalog_selection(v_catalog_slug,coalesce(v_item->>'wordingMode',v_item->>'wording_mode',''),coalesce(v_item->>'customText',v_item->>'custom_text',v_item->>'wording',''),coalesce(v_item->>'sizeCode',v_item->>'size_code',v_item->>'size',''));
        v_total:=v_total+(v_catalog->>'price')::numeric*coalesce(nullif(v_item->>'qty','')::int,1);
        v_product_variant_id:=nullif(v_catalog->>'product_variant_id','')::uuid;
        if v_product_variant_id is not null then
          v_model_quantities:=jsonb_set(v_model_quantities,array[v_product_variant_id::text],to_jsonb(coalesce((v_model_quantities->>v_product_variant_id::text)::int,0)+coalesce(nullif(v_item->>'qty','')::int,1)));
          if (v_model_quantities->>v_product_variant_id::text)::int>(select stock from public.product_variants where id=v_product_variant_id) then raise exception 'catalog_insufficient_stock'; end if;
        end if;
      else
        v_total:=v_total+coalesce(nullif(v_item->>'price','')::numeric,0)*coalesce(nullif(v_item->>'qty','')::int,1);
      end if;
    end loop;
    v_total:=round(v_total,2);
  end if;
$body$;
begin
 if position(needle in d)=0 or position('v_customer jsonb:=' in d)=0 then raise exception 'CATALOG_TOTAL_PATCH_DRIFT'; end if;
 d:=replace(d,'v_customer jsonb:=','v_model_quantities jsonb:=''{}''::jsonb; v_customer jsonb:=');
 d:=replace(d,needle,preflight||needle);
 execute d;
end $patch$;
