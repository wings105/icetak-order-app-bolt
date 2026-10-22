-- Canonical deadlines are read at current MYT time; no customer/order/task writes.
create or replace function public.icetak_inbox_order_deadline(p jsonb,p_now timestamptz default now())
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
 v_shopee boolean:=coalesce(p->>'source_channel'='shopee',false); v_raw text; v_date date; v_at timestamptz;
 v_today date:=(p_now at time zone 'Asia/Kuala_Lumpur')::date; v_bucket text;
 v_empty jsonb:='{"bucket":"undated","date":null,"source":null,"sort_at":null}'::jsonb;
begin
 v_raw:=case when v_shopee then p->>'ship_by_at' else p->>'date_need' end;
 if v_raw is null then return v_empty; end if;
 begin
  if v_shopee then
   if v_raw !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T.*(Z|[+-][0-9]{2}:[0-9]{2})$' then return v_empty;end if;
   v_at:=v_raw::timestamptz; v_date:=(v_at at time zone 'Asia/Kuala_Lumpur')::date;
  else
   if v_raw !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then return v_empty;end if;
   v_date:=v_raw::date; v_at:=v_date::timestamp at time zone 'Asia/Kuala_Lumpur';
  end if;
 exception when invalid_datetime_format or datetime_field_overflow then return v_empty;end;
 if substring(v_raw,1,4)::int < 2020 then return v_empty;end if;
 v_bucket:=case when (v_shopee and v_at<p_now) or (not v_shopee and v_date<v_today) then 'overdue'
  when v_date=v_today then 'today' when v_date=v_today+1 then 'tomorrow' else 'upcoming' end;
 return jsonb_build_object('bucket',v_bucket,'date',v_date,'source',case when v_shopee then 'ship_by' else 'date_need' end,'sort_at',v_at);
end $$;
revoke all on function public.icetak_inbox_order_deadline(jsonb,timestamptz) from public,anon;
grant execute on function public.icetak_inbox_order_deadline(jsonb,timestamptz) to authenticated,service_role;

create or replace function public.icetak_inbox_order_page(
 p_due text,p_design text,p_category text, p_mode text default 'active',p_channel text default 'all',p_bucket text default 'all',
 p_query text default '',p_limit integer default 100,p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb; v_limit int:=greatest(1,least(coalesce(p_limit,100),100)); v_offset int:=greatest(0,coalesce(p_offset,0));
begin
 if p_due is null or p_due not in ('all','urgent','overdue','today','tomorrow','upcoming','undated') or p_design is null or p_design not in ('all','needs_design','done','review','unknown') or p_category is null or p_category not in ('all','edible','topper','acrylic','wafer','artpaper_gold') or p_mode not in ('active','urgent','all','no_phone') or p_channel not in ('all','shopee','whatsapp')
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
   public.icetak_inbox_order_bucket(policy) as bucket,public.icetak_inbox_order_priority(policy) as priority,public.icetak_inbox_order_deadline(policy) as deadline from source s
 ), design_scope as materialized (
  select * from work where (p_mode='all' or active)
   and (p_mode<>'urgent' or deadline->>'bucket' in ('overdue','today','tomorrow'))
   and (p_mode<>'no_phone' or nullif(customer_phone_normalized,'') is null)
   and (p_bucket='all' or bucket=p_bucket)
 ), due_scope as materialized (
  select * from design_scope where p_due='all' or deadline->>'bucket'=p_due
   or (p_due='urgent' and deadline->>'bucket' in ('overdue','today','tomorrow'))
 ), eligible_unfiltered as materialized (
  select * from due_scope where p_design='all' or design_stage=p_design
 ), category_work as materialized (
  select * from work where (p_category='all' or p_category=any(categories)) and (p_design='all' or design_stage=p_design)
   and (p_due='all' or deadline->>'bucket'=p_due or (p_due='urgent' and deadline->>'bucket' in ('overdue','today','tomorrow')))
 ), eligible as materialized (
  select * from eligible_unfiltered where p_category='all' or p_category=any(categories)
 ), page as (
  select * from eligible order by case deadline->>'bucket' when 'overdue' then 0 when 'today' then 1 when 'tomorrow' then 2 when 'upcoming' then 3 else 4 end,(deadline->>'sort_at')::timestamptz asc nulls last,order_no,id limit v_limit offset v_offset
 )
 select jsonb_build_object(
  'orders',coalesce((select jsonb_agg(to_jsonb(e)||p.priority||jsonb_build_object('active_order',p.active,'work_bucket',p.bucket,'design_stage',p.design_stage,'work_deadline',p.deadline,'product_categories',to_jsonb(p.categories))
    order by case p.deadline->>'bucket' when 'overdue' then 0 when 'today' then 1 when 'tomorrow' then 2 when 'upcoming' then 3 else 4 end,(p.deadline->>'sort_at')::timestamptz asc nulls last,p.order_no,p.id)
    from page p join public.external_order_summaries e on e.id=p.id),'[]'::jsonb),
  'total',(select count(*) from eligible),'offset',v_offset,
  'has_more',(select count(*) from eligible)>v_offset+v_limit,
  'active_count',(select count(*) from category_work where active),
  'urgent_count',(select count(*) from category_work where active and deadline->>'bucket' in ('overdue','today','tomorrow')),
  'counts',(select jsonb_build_object('all',count(*) filter(where active),'to_ship',count(*) filter(where bucket='to_ship'),
    'unpaid',count(*) filter(where bucket='unpaid'),'shipping',count(*) filter(where bucket='shipping'),
    'completed',count(*) filter(where bucket='completed'),'cancelled',count(*) filter(where bucket='cancelled'),'return',count(*) filter(where bucket='return')) from category_work),
  'design_counts',(select jsonb_build_object('all',count(*),'needs_design',count(*) filter(where design_stage='needs_design'),
   'done',count(*) filter(where design_stage='done'),'review',count(*) filter(where design_stage='review'),'unknown',count(*) filter(where design_stage='unknown'))
   from due_scope where p_category='all' or p_category=any(categories)),
  'due_counts',(select jsonb_build_object('all',count(*),'urgent',count(*) filter(where deadline->>'bucket' in ('overdue','today','tomorrow')),
   'overdue',count(*) filter(where deadline->>'bucket'='overdue'),'today',count(*) filter(where deadline->>'bucket'='today'),
   'tomorrow',count(*) filter(where deadline->>'bucket'='tomorrow'),'upcoming',count(*) filter(where deadline->>'bucket'='upcoming'),
   'undated',count(*) filter(where deadline->>'bucket'='undated')) from design_scope
   where (p_category='all' or p_category=any(categories)) and (p_design='all' or design_stage=p_design)),
  'category_counts',(select jsonb_object_agg(key,n) from (
   select 'all' as key,count(*) as n from eligible_unfiltered
   union all select c,count(w.id) from unnest(array['edible','topper','acrylic','wafer','artpaper_gold']) c
    left join eligible_unfiltered w on c=any(w.categories) group by c
  ) category_counts)
 ) into v_result;
 return v_result;
end $$;
revoke all on function public.icetak_inbox_order_page(text,text,text,text,text,text,text,integer,integer) from public,anon;
grant execute on function public.icetak_inbox_order_page(text,text,text,text,text,text,text,integer,integer) to authenticated,service_role;



notify pgrst, 'reload schema';
