CREATE OR REPLACE FUNCTION public.icetak_reply_product_search(p_terms text[], p_code text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with query as (select array(select distinct left(lower(trim(x)),55) from unnest(p_terms[1:8]) x where length(trim(x))>=2) terms),hits as (
select p.id,p.slug,p.display_name,p.parent_sku,p.base_price,pr.config,
(lower(p.parent_sku)=lower(p_code) or lower(p.slug)=lower(p_code)) exact
from public.products p left join public.product_order_profiles pr on pr.id=p.order_profile_id cross join query q
where p.is_published and p.status='active' and p.product_kind='catalog_design'
and ((p_code<>'' and (lower(p.parent_sku)=lower(p_code) or lower(p.slug)=lower(p_code) or exists(select 1 from public.product_variants v where v.product_id=p.id and v.active and lower(v.sku)=lower(p_code)))) or (p_code='' and cardinality(q.terms)>0 and not exists(select from unnest(q.terms) t where strpos(lower(concat_ws(' ',p.display_name,p.source_title,p.parent_sku,p.slug)),t)=0)))
order by exact desc nulls last,length(p.display_name),p.id limit 4),
items as(select h.*,case when coalesce((h.config->>'catalog_models')::boolean,false) then
(select jsonb_agg(jsonb_build_object('name',v.name,'price',v.price,'stock',v.stock) order by v.price,v.name) from public.product_variants v where v.product_id=h.id and v.active and v.price>0 and v.stock>0 and (p_code='' or not exists(select 1 from public.product_variants s where s.product_id=h.id and lower(s.sku)=lower(p_code)) or lower(v.sku)=lower(p_code)))
else coalesce((select jsonb_agg(jsonb_build_object('name',coalesce(j->>'label',j->>'value'),'price',j->'price')) from jsonb_array_elements(h.config->'size_options') j where (j->>'price')::numeric>0),case when h.base_price>0 then jsonb_build_array(jsonb_build_object('name','1 pc','price',h.base_price)) end) end variants from hits h)
select coalesce(jsonb_agg(jsonb_build_object('name',display_name,'slug',slug,'sku',parent_sku,'variants',coalesce(variants,'[]'::jsonb)) order by exact desc nulls last,length(display_name),id),'[]'::jsonb) from items;
$function$
;
revoke all on function public.icetak_reply_product_search(text[],text) from public,anon,authenticated;
grant execute on function public.icetak_reply_product_search(text[],text) to service_role;
