create function public.icetak_catalog_layer_size(p_label text)returns text language sql immutable security invoker set search_path=public,pg_temp as $$
 select case when p_label ~* '\mA4\M'then 'A4'when p_label ~* '\mA5\M'then 'A5'when p_label ~* '\mA6\M'then 'A6'
 when p_label ~* '^[[:space:]]*[0-9]+(\.[0-9]+)?[[:space:]]+inch' then split_part(trim(p_label),' ',1)||' inch'else null end;
$$;
revoke all on function public.icetak_catalog_layer_size(text)from public,anon,authenticated;grant execute on function public.icetak_catalog_layer_size(text)to service_role;
do $patch$
declare d text:=pg_get_functiondef('public.icetak_normalize_burnaway_single_shape_v1()'::regprocedure);
begin
 d:=replace(d,E'  v_shape text;',E'  v_model_label text;\n  v_shape text;');
 d:=replace(d,'  v_shape:=coalesce(',$body$
  if new.catalog_slug is not null and new.product_variant_id is not null then
    select name into v_model_label from public.product_variants where id=new.product_variant_id and product_id=new.product_id;
    if v_model_label is null then raise exception 'catalog_model_unavailable';end if;
    v_edible_size:=public.icetak_catalog_layer_size(split_part(v_model_label,',',1));
    v_wafer_size:=public.icetak_catalog_layer_size(split_part(v_model_label,',',2));
    if v_edible_size is null or v_wafer_size is null then raise exception 'catalog_burnaway_size_unknown';end if;
    v_shape:=case when v_model_label ~* 'custom' then 'Custom'else 'Round / Bulat'end;
    new.style:=v_shape;new.size:=format('Edible %s • Wafer %s',v_edible_size,v_wafer_size);
    new.customization:=coalesce(new.customization,'{}')||jsonb_build_object('shape',v_shape,'layers',jsonb_build_object(
      'edible',coalesce(new.customization#>'{layers,edible}','{}')||jsonb_build_object('size',v_edible_size,'shape',v_shape),
      'wafer',coalesce(new.customization#>'{layers,wafer}','{}')||jsonb_build_object('size',v_wafer_size,'shape',v_shape)));
    return new;
  end if;
  v_shape:=coalesce(
 $body$);execute d;
end $patch$;
