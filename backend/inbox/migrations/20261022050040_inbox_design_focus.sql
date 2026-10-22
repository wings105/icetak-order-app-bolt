-- Inbox only: task focus is separate from payment/fulfillment eligibility.
create or replace function public.icetak_inbox_order_design_stage(p jsonb)
returns text language sql immutable parallel safe security invoker set search_path='' as $$
 select case when p#>>'{metadata,design_work,version}'='1'
  and p#>>'{metadata,design_work,stage}' in ('needs_design','done','review','unknown')
 then p#>>'{metadata,design_work,stage}' else 'unknown' end
$$;
revoke all on function public.icetak_inbox_order_design_stage(jsonb) from public,anon;
grant execute on function public.icetak_inbox_order_design_stage(jsonb) to authenticated,service_role;

create or replace function public.icetak_inbox_order_page(
 p_design text,p_category text, p_mode text default 'active',p_channel text default 'all',p_bucket text default 'all',
 p_query text default '',p_limit integer default 100,p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb; v_limit int:=greatest(1,least(coalesce(p_limit,100),100)); v_offset int:=greatest(0,coalesce(p_offset,0));
begin
 if p_design is null or p_design not in ('all','needs_design','done','review','unknown') or p_category is null or p_category not in ('all','edible','topper','acrylic','wafer','artpaper_gold') or p_mode not in ('active','urgent','all','no_phone') or p_channel not in ('all','shopee','whatsapp')
   or p_bucket not in ('all','to_ship','unpaid','shipping','completed','cancelled','return','other') then
  raise exception 'Invalid order filter' using errcode='22023';end if;
 with source as materialized (
  select e.id,e.ship_by_at,e.order_no,e.last_synced_at,e.customer_phone_normalized,public.icetak_inbox_order_categories(e.items) as categories,
   jsonb_build_object('source_project',e.source_project,'source_channel',e.source_channel,'order_status',e.order_status,
    'payment_status',e.payment_status,'shipped_at',e.shipped_at,'shipment_status',e.shipment_status,
    'fulfillment_status',e.fulfillment_status,'ship_by_at',e.ship_by_at,'date_need',e.date_need,'metadata',e.metadata) as policy
  from public.external_order_summaries e
  where e.source_project='icetak-order-system' and e.source_channel in ('shopee','whatsapp')
   and lower(coalesce(e.metadata->>'dashboard_excluded','false')) not in ('true','1')
   and (p_channel='all' or e.source_channel=p_channel)
   and (nullif(btrim(p_query),'') is null or position(lower(btrim(p_query)) in lower(concat_ws(' ',e.order_no,e.customer_name,e.customer_phone,e.customer_phone_normalized,e.shopee_username,e.buyer_message,e.items::text)))>0)
 ), work as materialized (
  select s.*,public.icetak_inbox_order_design_stage(policy) as design_stage,public.icetak_inbox_order_active(policy) as active,
   public.icetak_inbox_order_bucket(policy) as bucket,public.icetak_inbox_order_priority(policy) as priority from source s
 ), design_scope as materialized (
  select * from work where (p_mode='all' or active)
   and (p_mode<>'urgent' or priority->>'priority_level' in ('P0','P1','P2'))
   and (p_mode<>'no_phone' or nullif(customer_phone_normalized,'') is null)
   and (p_bucket='all' or bucket=p_bucket)
 ), eligible_unfiltered as materialized (
  select * from design_scope where p_design='all' or design_stage=p_design
 ), category_work as materialized (
  select * from work where (p_category='all' or p_category=any(categories)) and (p_design='all' or design_stage=p_design)
 ), eligible as materialized (
  select * from eligible_unfiltered where p_category='all' or p_category=any(categories)
 ), page as (
  select * from eligible order by priority->>'priority_level',ship_by_at asc nulls last,last_synced_at desc,order_no,id limit v_limit offset v_offset
 )
 select jsonb_build_object(
  'orders',coalesce((select jsonb_agg(to_jsonb(e)||p.priority||jsonb_build_object('active_order',p.active,'work_bucket',p.bucket,'design_stage',p.design_stage,'product_categories',to_jsonb(p.categories))
    order by p.priority->>'priority_level',p.ship_by_at asc nulls last,p.last_synced_at desc,p.order_no,p.id)
    from page p join public.external_order_summaries e on e.id=p.id),'[]'::jsonb),
  'total',(select count(*) from eligible),'offset',v_offset,
  'has_more',(select count(*) from eligible)>v_offset+v_limit,
  'active_count',(select count(*) from category_work where active),
  'urgent_count',(select count(*) from category_work where active and priority->>'priority_level' in ('P0','P1','P2')),
  'counts',(select jsonb_build_object('all',count(*) filter(where active),'to_ship',count(*) filter(where bucket='to_ship'),
    'unpaid',count(*) filter(where bucket='unpaid'),'shipping',count(*) filter(where bucket='shipping'),
    'completed',count(*) filter(where bucket='completed'),'cancelled',count(*) filter(where bucket='cancelled'),'return',count(*) filter(where bucket='return')) from category_work),
  'design_counts',(select jsonb_build_object('all',count(*),'needs_design',count(*) filter(where design_stage='needs_design'),
   'done',count(*) filter(where design_stage='done'),'review',count(*) filter(where design_stage='review'),'unknown',count(*) filter(where design_stage='unknown'))
   from design_scope where p_category='all' or p_category=any(categories)),
  'category_counts',(select jsonb_object_agg(key,n) from (
   select 'all' as key,count(*) as n from eligible_unfiltered
   union all select c,count(w.id) from unnest(array['edible','topper','acrylic','wafer','artpaper_gold']) c
    left join eligible_unfiltered w on c=any(w.categories) group by c
  ) category_counts)
 ) into v_result;
 return v_result;
end $$;
revoke all on function public.icetak_inbox_order_page(text,text,text,text,text,text,integer,integer) from public,anon;
grant execute on function public.icetak_inbox_order_page(text,text,text,text,text,text,integer,integer) to authenticated,service_role;



notify pgrst, 'reload schema';
