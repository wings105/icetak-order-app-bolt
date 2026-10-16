do $$
declare d text:=pg_get_functiondef('public.icetak_product_admin(text,jsonb,text)'::regprocedure);
begin
 -- The literal replacement below is separate to keep the rest of the audited function unchanged.
 d:=replace(d,'''importing''','''processing''');
 execute d;
end $$;
do $$
declare d text:=pg_get_functiondef('public.icetak_create_order(jsonb)'::regprocedure); old text:='v_product_variant_id:=nullif(v_catalog->>''product_variant_id'','''')::uuid;';
begin
 if position(old in d)=0 then raise exception 'CHECKOUT_PATCH_DRIFT'; end if;
 d:=replace(d,old,old||' if v_product_variant_id is not null and coalesce(nullif(v_item->>''qty'','''')::int,1)>(select stock from product_variants where id=v_product_variant_id) then raise exception ''catalog_insufficient_stock''; end if;');
 execute d;
end $$;
