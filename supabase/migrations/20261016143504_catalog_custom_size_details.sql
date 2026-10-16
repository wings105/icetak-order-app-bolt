-- Custom size ranges require an explicit customer measurement and design review.
create function public.icetak_catalog_item_details(p_catalog jsonb,p_item jsonb)returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare label text:=coalesce(p_catalog#>>'{customization,catalog_model_label}','');note text:=trim(coalesce(p_item->>'catalog_spec_note',''));r jsonb:=p_catalog;
begin
 if label ~* 'custom[[:space:]]+(a[456]|any[[:space:]]+size|size)'then
  if length(note)<2 or length(note)>300 then raise exception 'catalog_custom_size_required';end if;
  r:=jsonb_set(r,'{customization}',coalesce(r->'customization','{}')||jsonb_build_object('requested_size',note,'review_required',true));
  r:=jsonb_set(r,'{review_required}','true');
 end if;return r;
end $$;
revoke all on function public.icetak_catalog_item_details(jsonb,jsonb)from public,anon,authenticated;grant execute on function public.icetak_catalog_item_details(jsonb,jsonb)to service_role;
do $patch$
declare d text:=pg_get_functiondef('public.icetak_create_order(jsonb)'::regprocedure);needle text;
begin
 needle:='v_catalog:=public.icetak_validate_catalog_selection(v_catalog_slug,coalesce(v_item->>''wordingMode'',v_item->>''wording_mode'',''''),coalesce(v_item->>''customText'',v_item->>''custom_text'',v_item->>''wording'',''''),coalesce(v_item->>''sizeCode'',v_item->>''size_code'',v_item->>''size'',''''));';
 if position(needle in d)=0 then raise exception 'CATALOG_DETAILS_CHECKOUT_DRIFT';end if;
 d:=replace(d,needle,needle||' v_catalog:=public.icetak_catalog_item_details(v_catalog,v_item);');execute d;
end $patch$;
