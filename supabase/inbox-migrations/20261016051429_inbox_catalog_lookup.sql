-- Apply only to Inbox project. Bounded, shop-scoped catalogue resolution for active workspace members.
create or replace function public.icetak_inbox_catalog_lookup(p_items jsonb)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.workspace_members where auth_user_id=(select auth.uid()) and active) then raise exception 'WORKSPACE_MEMBER_REQUIRED'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>40 then raise exception 'LOOKUP_LIMIT'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('shop_id',c.metadata->>'shop_id','item_id',c.metadata->>'item_id','name',c.name,'image_url',c.image_url,'models',coalesce(c.metadata->'models','[]'::jsonb)))
 from public.product_catalog_cache c where c.source_project='icetak-order-system' and c.source_channel='shopee' and c.active and c.external_product_id in
 (select (x->>'shop_id')||':'||(x->>'item_id') from jsonb_array_elements(p_items) x where x->>'shop_id' ~ '^\d+$' and x->>'item_id' ~ '^\d+$')),'[]'::jsonb);
end $$;
revoke all on function public.icetak_inbox_catalog_lookup(jsonb) from public,anon;
grant execute on function public.icetak_inbox_catalog_lookup(jsonb) to authenticated;
