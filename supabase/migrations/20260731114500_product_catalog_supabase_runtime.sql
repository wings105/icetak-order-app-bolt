create or replace function public.search_product_catalog(
  p_query text default '',
  p_limit integer default 36,
  p_offset integer default 0
)
returns table (
  slug text,
  display_title text,
  title text,
  description text,
  category text,
  parent_sku text,
  shopee_product_id text,
  image_url text,
  shopee_url text,
  clickup_task_id text,
  source text,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with params as (
    select
      lower(trim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g'))) as q,
      least(greatest(coalesce(p_limit, 36), 1), 60) as take,
      greatest(coalesce(p_offset, 0), 0) as skip
  ),
  matches as (
    select
      p.slug,
      p.display_name as display_title,
      coalesce(nullif(p.source_title, ''), p.name) as title,
      coalesce(p.description, '') as description,
      coalesce(c.name, 'Produk') as category,
      coalesce(p.parent_sku, '') as parent_sku,
      coalesce(p.shopee_product_id, '') as shopee_product_id,
      coalesce(p.main_image_url, '') as image_url,
      coalesce(p.shopee_url, '') as shopee_url,
      coalesce(p.clickup_task_id, '') as clickup_task_id,
      p.source,
      case
        when lower(p.display_name) = params.q then 500
        when lower(p.display_name) like params.q || '%' then 350
        when lower(p.display_name) like '%' || params.q || '%' then 250
        when lower(p.search_text) like '%' || params.q || '%' then 200
        when lower(coalesce(p.parent_sku, '')) = params.q then 450
        when lower(coalesce(p.shopee_product_id, '')) = params.q then 450
        else (similarity(lower(p.search_text), params.q) * 100)::integer
      end as search_rank,
      p.source_updated_at
    from public.products p
    left join public.product_categories c on c.id = p.category_id
    cross join params
    where p.is_published = true
      and p.is_indexable = true
      and p.status = 'active'
      and (
        params.q = ''
        or lower(p.display_name) like '%' || params.q || '%'
        or lower(p.search_text) like '%' || params.q || '%'
        or lower(coalesce(p.parent_sku, '')) = params.q
        or lower(coalesce(p.shopee_product_id, '')) = params.q
        or similarity(lower(p.search_text), params.q) >= 0.18
      )
  ),
  counted as (
    select matches.*, count(*) over () as total_count
    from matches
  )
  select
    counted.slug,
    counted.display_title,
    counted.title,
    counted.description,
    counted.category,
    counted.parent_sku,
    counted.shopee_product_id,
    counted.image_url,
    counted.shopee_url,
    counted.clickup_task_id,
    counted.source,
    counted.total_count
  from counted
  cross join params
  order by counted.search_rank desc, counted.source_updated_at desc nulls last, counted.display_title
  limit params.take
  offset params.skip;
$$;

revoke all on function public.search_product_catalog(text, integer, integer) from public;
grant execute on function public.search_product_catalog(text, integer, integer) to anon, authenticated, service_role;

comment on function public.search_product_catalog(text, integer, integer) is
  'Public RLS-safe product catalogue search for the iCetak customer frontend.';
