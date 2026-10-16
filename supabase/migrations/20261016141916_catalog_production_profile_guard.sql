-- Explicit owner profiles and managed import drafts must survive title/category saves.
do $patch$
declare d text:=pg_get_functiondef('public.icetak_assign_product_order_profile()'::regprocedure);
begin
 if position('  select slug into v_category_slug' in d)=0 then raise exception 'PRODUCT_PROFILE_TRIGGER_DRIFT';end if;
 d:=replace(d,'  select slug into v_category_slug','  if new.order_profile_id is not null or coalesce((new.metadata->>''catalog_managed'')::boolean,false) then return new;end if;
  select slug into v_category_slug');execute d;
end $patch$;
