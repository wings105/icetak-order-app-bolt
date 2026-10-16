-- Read-only list projection. Preserve all mutation/auth contracts and existing function ACLs.
do $patch$
declare d text:=pg_get_functiondef('public.icetak_product_admin(text,jsonb,text)'::regprocedure);
begin
 if position('   (select count(*) from product_variants pv where pv.product_id=pr.id) model_count' in d)=0 or position('  return r;
 elsif p_action=''detail'' then' in d)=0 then raise exception 'PRODUCT_LIST_PROJECTION_DRIFT'; end if;
 d:=replace(d,'declare r jsonb;','declare v_status_counts jsonb; r jsonb;');
 d:=replace(d,'   (select count(*) from product_variants pv where pv.product_id=pr.id) model_count','   (select count(*) from product_variants pv where pv.product_id=pr.id) model_count,
   (select jsonb_build_object(''price_min'',min(nullif(model->>''price'','''')::numeric),''price_max'',max(nullif(model->>''price'','''')::numeric),''stock'',sum(nullif(model->>''stock'','''')::int),''captured_at'',cl.last_imported_at)
    from jsonb_array_elements(coalesce(cl.snapshot->''models'',''[]''::jsonb)) model) shopee_summary');
 d:=replace(d,'  return r;
 elsif p_action=''detail'' then','  select jsonb_object_agg(status,n)||jsonb_build_object(''ALL'',coalesce(sum(n),0)) into v_status_counts
  from (select coalesce(cl.provider_status,''WEBSITE_ONLY'') status,count(*) n
   from products pr left join product_channel_listings cl on cl.product_id=pr.id
   where (q='''' or concat_ws('' '',pr.display_name,pr.parent_sku,cl.item_id) ilike ''%''||q||''%'')
   group by coalesce(cl.provider_status,''WEBSITE_ONLY'')) counts;
  r:=r||jsonb_build_object(''status_counts'',coalesce(v_status_counts,''{"ALL":0}''::jsonb));
  return r;
 elsif p_action=''detail'' then');
 execute d;
end $patch$;

