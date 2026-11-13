-- Delayed read-only Shopee detail enrichment; no payment/lifecycle transitions.
create table marketplace_ops.order_detail_jobs(
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.marketplace_orders(id) on delete cascade unique,
 order_sn text not null,shop_id text not null,
 status text not null default 'pending' check(status in ('pending','processing','completed','failed')),
 attempts integer not null default 0 check(attempts between 0 and 10),
 available_at timestamptz not null,locked_at timestamptz,lease_id uuid,
 last_error text,result_payload jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),completed_at timestamptz
);
create index order_detail_jobs_due_idx on marketplace_ops.order_detail_jobs(available_at) where status='pending';
alter table marketplace_ops.order_detail_jobs enable row level security;
revoke all on marketplace_ops.order_detail_jobs from public,anon,authenticated;
grant all on marketplace_ops.order_detail_jobs to service_role;

create function public.marketplace_order_needs_detail(o public.marketplace_orders)
returns boolean language sql stable set search_path='' as $$
 select o.provider='shopee' and o.current_status in ('UNPAID','READY_TO_SHIP','PROCESSED')
 and o.shop_id in ('188218638','1635364464')
 and o.order_sn ~ '^[0-9]{6}[A-Z0-9]{6,12}$'
 and (coalesce(jsonb_typeof(o.raw_detail->'cod'),'null')<>'boolean'
  or nullif(btrim(o.raw_detail->>'payment_method'),'') is null
  or not exists(select 1 from public.marketplace_order_items i where i.order_id=o.id and i.is_current));
$$;
create function public.enqueue_marketplace_order_detail_job()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.current_status='UNPAID' and public.marketplace_order_needs_detail(new) then
  insert into marketplace_ops.order_detail_jobs(order_id,order_sn,shop_id,available_at)
  values(new.id,new.order_sn,new.shop_id,clock_timestamp()+interval '3 minutes')
  on conflict(order_id) do nothing;
 end if;
 return new;
end $$;
create trigger trg_enqueue_marketplace_order_detail_job
after insert or update of current_status,raw_detail,shop_id on public.marketplace_orders
for each row execute function public.enqueue_marketplace_order_detail_job();

create function public.claim_marketplace_order_detail_jobs(p_limit integer default 10)
returns table(job_id uuid,order_id uuid,order_sn text,shop_id text,lease_id uuid,attempts integer)
language plpgsql security definer set search_path='' as $$
begin
 update marketplace_ops.order_detail_jobs j
 set status=case when j.attempts>=10 then 'failed' else 'pending' end,
 locked_at=null,lease_id=null,available_at=now(),last_error='LEASE_EXPIRED',updated_at=now()
 where j.status='processing' and j.locked_at<now()-interval '5 minutes';
 update marketplace_ops.order_detail_jobs j
 set status='completed',completed_at=now(),updated_at=now(),
 result_payload=jsonb_build_object('skipped','state_changed_or_detail_present')
 from public.marketplace_orders o where o.id=j.order_id and j.status='pending'
 and not public.marketplace_order_needs_detail(o);
 return query with due as (
  select j.id from marketplace_ops.order_detail_jobs j
  join public.marketplace_orders o on o.id=j.order_id
  where j.status='pending' and j.attempts<10 and j.available_at<=now()
  and public.marketplace_order_needs_detail(o)
  order by j.available_at,j.created_at limit greatest(1,least(coalesce(p_limit,10),10))
  for update of j skip locked
 ), claimed as (
  update marketplace_ops.order_detail_jobs j
  set status='processing',attempts=j.attempts+1,locked_at=now(),lease_id=gen_random_uuid(),updated_at=now()
  from due where j.id=due.id returning j.*
 )
 select c.id,c.order_id,c.order_sn,c.shop_id,c.lease_id,c.attempts from claimed c;
end $$;

create function public.finish_marketplace_order_detail_job(p_job_id uuid,p_lease_id uuid,p_ok boolean,p_error text default null,p_retryable boolean default true)
returns void language plpgsql security definer set search_path='' as $$
declare j marketplace_ops.order_detail_jobs%rowtype;
begin
 select * into j from marketplace_ops.order_detail_jobs where id=p_job_id for update;
 if not found or j.status<>'processing' or j.lease_id is distinct from p_lease_id then return;end if;
 update marketplace_ops.order_detail_jobs set
 status=case when p_ok then 'completed' when p_retryable and j.attempts<10 then 'pending' else 'failed' end,
 completed_at=case when p_ok then now() else null end,locked_at=null,lease_id=null,
 available_at=case when not p_ok and p_retryable and j.attempts<10 then now()+make_interval(mins=>least(120,3*(2^(j.attempts-1))::integer)) else available_at end,
 last_error=case when p_ok then null else left(coalesce(p_error,'DETAIL_READ_FAILED'),100) end,updated_at=now()
 where id=j.id;
end $$;

create function public.apply_marketplace_order_detail(p_job_id uuid,p_lease_id uuid,p_order_id uuid,p_order_sn text,p_shop_id text,p_provider_updated_at timestamptz,p_detail jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j marketplace_ops.order_detail_jobs%rowtype;o public.marketplace_orders%rowtype;
 item jsonb;line integer:=0;qty integer;original numeric;discounted numeric;complete_evidence boolean;merged jsonb;
begin
 select * into j from marketplace_ops.order_detail_jobs where id=p_job_id for update;
 if not found or j.status<>'processing' or j.lease_id is distinct from p_lease_id or j.order_id is distinct from p_order_id
 or j.order_sn is distinct from p_order_sn or j.shop_id is distinct from p_shop_id then raise exception 'DETAIL_LEASE_MISMATCH';end if;
 select * into o from public.marketplace_orders where id=p_order_id for update;
 if not found or o.provider<>'shopee' or o.order_sn is distinct from p_order_sn or o.shop_id is distinct from p_shop_id
 or p_detail->>'order_sn' is distinct from p_order_sn or p_detail->>'shop_id' is distinct from p_shop_id then raise exception 'DETAIL_IDENTITY_MISMATCH';end if;
 if o.current_status not in ('UNPAID','READY_TO_SHIP','PROCESSED') then
  perform public.finish_marketplace_order_detail_job(j.id,p_lease_id,true,null,false);
  return jsonb_build_object('applied',false,'skipped','state_changed');
 end if;
 if p_provider_updated_at is null then raise exception 'DETAIL_TIMESTAMP_MISSING';end if;
 if (o.latest_provider_update_at is not null and p_provider_updated_at<o.latest_provider_update_at)
 or (nullif(o.metadata#>>'{order_detail_read,provider_updated_at}','') is not null and p_provider_updated_at<(o.metadata#>>'{order_detail_read,provider_updated_at}')::timestamptz) then
  perform public.finish_marketplace_order_detail_job(j.id,p_lease_id,false,'STALE_PROVIDER_RESPONSE',true);
  return jsonb_build_object('applied',false,'retry','stale');
 end if;
 if upper(coalesce(p_detail->>'order_status','')) ~ '(CANCEL|RETURN|REFUND|COMPLETED)' then
  perform public.finish_marketplace_order_detail_job(j.id,p_lease_id,true,'PROVIDER_TERMINAL',false);
  return jsonb_build_object('applied',false,'skipped','provider_terminal');
 end if;
 if (p_detail->>'currency') is distinct from (case when p_shop_id='188218638' then 'MYR' else 'SGD' end) then raise exception 'DETAIL_CURRENCY_MISMATCH';end if;
 if jsonb_typeof(p_detail->'item_list') is distinct from 'array' then raise exception 'DETAIL_ITEMS_INVALID';end if;
 if jsonb_array_length(p_detail->'item_list') not between 1 and 100 then raise exception 'DETAIL_ITEMS_INVALID';end if;
 if p_detail ? 'cod' and jsonb_typeof(p_detail->'cod') not in ('boolean','null') then raise exception 'DETAIL_COD_INVALID';end if;
 for item in select value from jsonb_array_elements(p_detail->'item_list') loop
  line:=line+1;qty:=(item->>'model_quantity_purchased')::integer;
  if qty is null or qty not between 1 and 100000 or coalesce(item->>'item_id','') !~ '^[0-9]+$'
  or nullif(btrim(item->>'item_name'),'') is null then raise exception 'DETAIL_ITEM_INVALID';end if;
  original:=nullif(item->>'model_original_price','')::numeric;discounted:=nullif(item->>'model_discounted_price','')::numeric;
  if original<0 or discounted<0 or original>1000000 or discounted>1000000 then raise exception 'DETAIL_PRICE_INVALID';end if;
  insert into public.marketplace_order_items(order_id,line_no,provider_item_id,provider_variation_id,item_sku,variation_sku,title,variation_name,quantity,unit_original_price,unit_discounted_price,line_subtotal,image_url,is_current,raw_item)
  values(o.id,line,item->>'item_id',item->>'model_id',item->>'item_sku',item->>'model_sku',item->>'item_name',item->>'model_name',qty,original,discounted,discounted*qty,item->>'image_url',true,item)
  on conflict(order_id,line_no) do update set provider_item_id=excluded.provider_item_id,provider_variation_id=excluded.provider_variation_id,item_sku=excluded.item_sku,variation_sku=excluded.variation_sku,title=excluded.title,variation_name=excluded.variation_name,quantity=excluded.quantity,unit_original_price=excluded.unit_original_price,unit_discounted_price=excluded.unit_discounted_price,line_subtotal=excluded.line_subtotal,image_url=excluded.image_url,is_current=true,raw_item=excluded.raw_item,updated_at=now()
  where (marketplace_order_items.provider_item_id,marketplace_order_items.provider_variation_id,marketplace_order_items.item_sku,marketplace_order_items.variation_sku,marketplace_order_items.title,marketplace_order_items.variation_name,marketplace_order_items.quantity,marketplace_order_items.unit_original_price,marketplace_order_items.unit_discounted_price,marketplace_order_items.image_url,marketplace_order_items.is_current)
  is distinct from (excluded.provider_item_id,excluded.provider_variation_id,excluded.item_sku,excluded.variation_sku,excluded.title,excluded.variation_name,excluded.quantity,excluded.unit_original_price,excluded.unit_discounted_price,excluded.image_url,true);
 end loop;
 update public.marketplace_order_items set is_current=false,updated_at=now() where order_id=o.id and is_current and line_no>line;
 -- Strip nulls so an incomplete response cannot erase existing verified evidence.
 merged:=coalesce(o.raw_detail,'{}'::jsonb)||jsonb_strip_nulls(p_detail);
 complete_evidence:=coalesce(jsonb_typeof(merged->'cod'),'null')='boolean' and nullif(btrim(merged->>'payment_method'),'') is not null;
 update public.marketplace_orders set raw_detail=merged,
 metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('order_detail_read',jsonb_build_object('source','shopee_get_order_detail','checked_at',now(),'provider_updated_at',p_provider_updated_at,'cod',merged->'cod','complete',complete_evidence)),
 updated_at=now() where id=o.id;
 -- Full order completeness, status, payment and finance amounts are intentionally untouched.
 update public.marketplace_order_financials set payment_method=coalesce(nullif(merged->>'payment_method',''),payment_method),updated_at=now() where order_id=o.id;
 update marketplace_ops.order_detail_jobs set result_payload=jsonb_build_object('cod',merged->'cod','payment_method',merged->>'payment_method','items',line),updated_at=now() where id=j.id;
 perform public.finish_marketplace_order_detail_job(j.id,p_lease_id,complete_evidence,case when complete_evidence then null else 'PAYMENT_EVIDENCE_MISSING' end,true);
 return jsonb_build_object('applied',true,'complete',complete_evidence,'cod',merged->'cod','payment_method',merged->>'payment_method','items',line);
end $$;

revoke all on function public.marketplace_order_needs_detail(public.marketplace_orders),public.enqueue_marketplace_order_detail_job(),public.claim_marketplace_order_detail_jobs(integer),public.finish_marketplace_order_detail_job(uuid,uuid,boolean,text,boolean),public.apply_marketplace_order_detail(uuid,uuid,uuid,text,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.marketplace_order_needs_detail(public.marketplace_orders),public.claim_marketplace_order_detail_jobs(integer),public.finish_marketplace_order_detail_job(uuid,uuid,boolean,text,boolean),public.apply_marketplace_order_detail(uuid,uuid,uuid,text,text,timestamptz,jsonb) to service_role;

create function marketplace_ops.kick_order_detail_worker() returns bigint language plpgsql security invoker set search_path='' as $$
declare token text;
begin
 if not pg_try_advisory_xact_lock(hashtext('shopee_order_detail_enrich_dispatch')) then return null;end if;
 if not exists(select 1 from marketplace_ops.order_detail_jobs where (status='pending' and available_at<=now()) or (status='processing' and locked_at<now()-interval '5 minutes')) then return null;end if;
 select setting_value into token from public.private_runtime_settings where setting_key='admin_window_bridge_token';
 if nullif(token,'') is null then return null;end if;
 return net.http_post(url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/shopee-order-detail-enrich',headers:=jsonb_build_object('Content-Type','application/json','x-admin-window-token',token),body:='{}'::jsonb,timeout_milliseconds:=60000);
end $$;
revoke all on function marketplace_ops.kick_order_detail_worker() from public,anon,authenticated;
grant execute on function marketplace_ops.kick_order_detail_worker() to service_role;
select cron.schedule('icetak-shopee-order-detail-enrich','* * * * *','select marketplace_ops.kick_order_detail_worker();');
