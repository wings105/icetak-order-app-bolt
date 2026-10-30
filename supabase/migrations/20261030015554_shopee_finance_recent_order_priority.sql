-- New order detail always precedes historical completion confirmation.
create or replace function public.claim_marketplace_finance_jobs(p_limit integer default 3)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;begin
 with due as (
  select j.id from public.marketplace_enrichment_jobs j join public.marketplace_orders m on m.id=j.order_id
  where j.job_type in ('financial_detail','financial_release') and j.status in ('pending','failed')
  and j.available_at<=now() and m.provider='shopee' and m.shop_id is not null
  and not exists(select 1 from public.marketplace_enrichment_jobs p where p.order_id=j.order_id and p.status='processing')
  -- Prefer detail before release for the same order, and recent orders before history.
  and (j.job_type='financial_detail' or not exists(select 1 from public.marketplace_enrichment_jobs d
   where d.order_id=j.order_id and d.job_type='financial_detail' and d.status in ('pending','failed') and d.available_at<=now()))
  order by case
   when j.job_type='financial_detail' and coalesce(m.placed_at,m.created_at)>now()-interval '7 days' then 0
   when j.job_type='financial_release' and coalesce(m.placed_at,m.created_at)>now()-interval '7 days' then 1
   when j.job_type='financial_detail' then 2 else 3 end,
   coalesce(m.placed_at,m.created_at) desc,j.available_at,j.id
  for update of j skip locked limit greatest(1,least(p_limit,3))
 ), claimed as (
  update public.marketplace_enrichment_jobs j set status='processing',attempts=attempts+1,
   locked_at=now(),lease_id=gen_random_uuid(),updated_at=now() from due where j.id=due.id returning j.*
 )
 select coalesce(jsonb_agg(jsonb_build_object('job_id',j.id,'lease_id',j.lease_id,'order_id',m.id,'order_sn',m.order_sn,
  'shop_id',m.shop_id,'currency',m.currency,'job_type',j.job_type)),'[]'::jsonb) into result
 from claimed j join public.marketplace_orders m on m.id=j.order_id;
 return result;
end $$;
