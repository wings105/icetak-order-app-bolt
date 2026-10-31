-- A shipped return consumes materials and packing even when revenue is refunded.
-- Provider nett already includes seller shipping/fees: never deduct them twice.
create or replace function finance.return_loss_row(r jsonb, d jsonb, shipped boolean)
returns jsonb language plpgsql immutable set search_path='' as $$
declare status text:=upper(coalesce(r->>'status',''));rs text:=upper(coalesce(d->>'status',''));
 active boolean;settled boolean;net numeric;mat numeric;extra numeric;ship numeric;loss numeric;profit numeric;
begin
 if r->>'income_state'='currency_mismatch' then return r;end if;
 if status in ('CANCELLED','IN_CANCEL') or r->>'zero_policy'='cancelled_zero_v1' then return r;end if;
 active:=coalesce((r#>>'{finance_metrics,refund_total}')::numeric,0)>0
   or rs not in ('','CANCELLED','REJECTED') or status='TO_RETURN';
 if rs in ('CANCELLED','REJECTED') and coalesce((r#>>'{finance_metrics,refund_total}')::numeric,0)=0 then return r||jsonb_build_object('lifecycle_review',false);end if;
 if not active then return r;end if;
 -- Do not infer a physical dispatch from payment or wallet release alone.
 if shipped is distinct from true then return r;end if;
 mat:=(r->>'material_total')::numeric;extra:=(r->>'extra_total')::numeric;
 ship:=greatest(-coalesce((r#>>'{finance_metrics,shipping_net}')::numeric,0),0)
       +greatest(coalesce((r#>>'{finance_metrics,return_shipping}')::numeric,0),0);
 settled:=coalesce((r#>>'{finance_metrics,refund_total}')::numeric,0)>0
       or coalesce((r->>'nett')::numeric,0)<0;
 -- Pending claims reserve consumed costs; pre-refund escrow is not retained income.
 net:=case when settled then coalesce((r#>>'{finance_metrics,provider_nett}')::numeric,(r->>'nett')::numeric) else -ship end;
 if mat is not null and extra is not null and coalesce(r->>'detail_changed','false')<>'true' and net is not null then
  profit:=round(net-mat-extra,2);loss:=round(mat+extra+greatest(-net,0),2);
 end if;
 return r||jsonb_build_object('return_loss_applied',true,'return_phase',case when settled then 'settled' else 'pending' end,
  'return_status',nullif(rs,''),'return_shipping_charged',ship,'return_loss_total',loss,
  'return_provider_nett',r#>'{finance_metrics,provider_nett}','return_charges_pending',not settled,
  'nett',net,'profit',profit,'cost_total',mat+extra,'lifecycle_review',false,
  'income_state',case when not settled then 'escrow' else r->>'income_state' end,
  'profit_state',case when profit is null then 'incomplete' when settled and r->>'income_state'='released' and r->>'cost_state'='actual' then 'actual' else 'estimated' end,
  'margin',case when (r->>'goods_value')::numeric>0 then round(profit/(r->>'goods_value')::numeric*100,2) end,
  'profit_per_hour',case when (r->>'work_minutes')::numeric>0 then round(profit/(r->>'work_minutes')::numeric*60,2) end,
  'return_reasons',case when settled then '["Refund: bahan dan packing kekal; caj seller sudah dalam nett Shopee"]'::jsonb
   else '["Return sedang diproses: kos sudah keluar; caj akhir Shopee akan disemak automatik"]'::jsonb end);
end $$;

create or replace function finance.apply_order_return_loss(p_order_id uuid,r jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare d jsonb;shipped boolean;st text:=upper(coalesce(r->>'status',''));
begin
 if st in ('CANCELLED','IN_CANCEL') then return r;end if;
 select raw_snapshot->'detail' into d from public.marketplace_returns where order_id=p_order_id
 and provider='shopee' order by coalesce((raw_snapshot->>'detail_checked_at')::timestamptz,updated_at) desc,id desc limit 1;
 -- Signed order state / actual return pickup evidence establish incurred packing.
 shipped:=st in ('SHIPPED','TO_CONFIRM_RECEIVE','COMPLETED','TO_RETURN')
 or d->>'logistics_status' in ('LOGISTICS_PICKUP_DONE','LOGISTICS_DELIVERY_DONE')
 or d->>'reverse_logistics_status' in ('LOGISTICS_PICKUP_DONE','LOGISTICS_DELIVERY_DONE');
 return finance.return_loss_row(r,coalesce(d,'{}'),shipped);
end $$;
revoke all on function finance.return_loss_row(jsonb,jsonb,boolean),finance.apply_order_return_loss(uuid,jsonb) from public,anon,authenticated;
grant execute on function finance.return_loss_row(jsonb,jsonb,boolean),finance.apply_order_return_loss(uuid,jsonb) to service_role;

CREATE OR REPLACE FUNCTION finance.order_profit_row(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare r jsonb:=finance.order_profit_base(p_order_id);s finance.order_finance_snapshots%rowtype;c finance.marketplace_order_costs%rowtype;
 fs jsonb;metrics jsonb;net numeric;material numeric;extra numeric;goods numeric;profit numeric;cost_state text;inc text;changed boolean;life boolean;
begin
 select * into s from finance.order_finance_snapshots where order_id=p_order_id order by (source='webhook') desc,id desc limit 1;
 if s.id is null then
  select finance.order_finance_fields(coalesce(provider_payload->'shopee_finance',provider_payload)) into fs from public.marketplace_order_financials where order_id=p_order_id and last_enriched_at is not null;
  metrics:=finance.order_finance_metrics(coalesce(fs,'{}'));else fs:=s.fields;metrics:=s.metrics;end if;
 net:=(r->>'nett')::numeric;inc:=r->>'income_state';cost_state:=r->>'cost_state';changed:=(r->>'detail_changed')::boolean;
 life:=r->>'profit_state'='lifecycle_review' or coalesce((metrics->>'refund_total')::numeric,0)>0;
 if inc<>'currency_mismatch' and metrics->>'provider_nett' is not null then
  if inc<>'released' or (life or coalesce(finance.fa(fs,'total_adjustment_amount'),0)<>0) and abs((r->>'released_amount')::numeric-(metrics->>'provider_nett')::numeric)>0.01 then
   net:=(metrics->>'provider_nett')::numeric;inc:=case when s.source='excel' then 'report_estimate' else 'escrow' end;
  end if;
 end if;
 select * into c from finance.marketplace_order_costs where order_id=p_order_id;
 if life and c.order_id is not null then
  r:=r||jsonb_build_object('material_lines',c.material_lines,'reviewed',c.reviewed);changed:=false;
  cost_state:=case when exists(select 1 from jsonb_array_elements(c.material_lines)l where l->>'amount' is null) or jsonb_array_length(c.material_lines)=0 then 'missing'
  when c.reviewed and not exists(select 1 from jsonb_array_elements(c.material_lines)l where l->>'mode'<>'actual') and not exists(select 1 from jsonb_each(c.extra_costs)e where e.value->>'mode'<>'actual') then 'actual' else 'estimated' end;
 end if;
 select sum((l->>'amount')::numeric),sum((l->>'goods_value')::numeric) into material,goods from jsonb_array_elements(r->'material_lines')l;
 extra:=(r->>'extra_total')::numeric;
 if cost_state='missing' then material:=null;end if;
 if net is not null and material is not null and not changed then profit:=round(net-material-extra,2);end if;
 return finance.apply_order_return_loss(p_order_id,finance.cancelled_zero_row(r||jsonb_build_object('nett',net,'income_state',inc,'material_total',material,'cost_total',material+extra,'goods_value',goods,'profit',profit,'margin',case when goods>0 then round(profit/goods*100,2) end,
 'profit_per_hour',case when (r->>'work_minutes')::numeric>0 then round(profit/(r->>'work_minutes')::numeric*60,2) end,
 'profit_state',case when profit is null then 'incomplete' when inc='released' and cost_state='actual' then 'actual' else 'estimated' end,
 'cost_state',cost_state,'detail_changed',changed,'lifecycle_review',life,'finance_metrics',metrics,'finance_source',coalesce(s.source,case when fs<>'{}' then 'webhook' else 'missing' end),
 'finance_updated_at',coalesce(s.captured_at,(r->>'enriched_at')::timestamptz),
 'courier',(select courier_name from public.marketplace_orders where id=p_order_id),'shop_id',(select shop_id from public.marketplace_orders where id=p_order_id))));
end $function$;

CREATE OR REPLACE FUNCTION finance.contribution_rows(p_from date, p_to date)
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
select finance.cancelled_zero_row(q.r) from (with scoped as materialized(select * from finance.sales_channel_orders(p_from,p_to)),
 model as materialized(select s.*,case when s.channel='deco' then finance.direct_margin_row(s.order_id) else finance.order_profit_row(s.order_id) end r from scoped s),
 mp as(select *,case when r->>'return_loss_applied'='true' then (r->>'profit')::numeric when r->>'lifecycle_review'='true' and (coalesce(r->>'reviewed','false')<>'true' or not included and coalesce(r->>'income_state','')<>'released' and (r->>'nett')::numeric>0) then null else (r->>'profit')::numeric end safe_profit from model where channel='shopee')
 select jsonb_build_object('order_id',order_id,'reference',reference,'channel',channel,'day',day,'status',status,'sales',sales,'customer_paid',(r->>'buyer_paid')::numeric,
 'shipping_charged',shipping,'fee',fees,'courier',null,'courier_state','in_nett','nett',(r->>'nett')::numeric,'material',(r->>'material_total')::numeric,'extras',(r->>'extra_total')::numeric,'packing',(r#>>'{extra_costs,packaging,amount}')::numeric,
 'contribution',case when included or r->>'return_loss_applied'='true' or r->>'lifecycle_review'='true' and r->>'reviewed'='true' then safe_profit end,
 'margin',case when sales>0 and (included or r->>'return_loss_applied'='true' or r->>'lifecycle_review'='true' and r->>'reviewed'='true') then round(safe_profit/sales*100,2) end,
 'state',case when not included and coalesce(r->>'lifecycle_review','false')<>'true' then 'excluded' when safe_profit is null then 'incomplete' else r->>'profit_state' end,
 'income_state',r->>'income_state','included',included or r->>'return_loss_applied'='true' or (r->>'lifecycle_review'='true'),
 'return_phase',r->>'return_phase','return_loss_total',r->'return_loss_total','return_charges_pending',r->'return_charges_pending',
 'reasons',case when r->>'return_loss_applied'='true' and safe_profit is not null then r->'return_reasons' when r->>'lifecycle_review'='true' and (coalesce(r->>'reviewed','false')<>'true' or not included and coalesce(r->>'income_state','')<>'released' and (r->>'nett')::numeric>0) then '["Batal / refund perlu semak kos dahulu"]'::jsonb when safe_profit is null then '["Nett / modal belum lengkap atau item berubah"]'::jsonb else '[]'::jsonb end)
 from mp union all select r||jsonb_build_object('day',day) from model where channel='deco') q(r);
$function$;

CREATE OR REPLACE FUNCTION public.marketplace_finance_runtime(p_action text, p_body jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare s text:=p_body->>'shop_id';c marketplace_ops.release_cursor%rowtype;v_from timestamptz;begin
 if p_action='cursor' then
  select greatest(now()-interval '90 days',coalesce(min(coalesce(placed_at,created_at)),now()-interval '7 days')) into v_from from public.marketplace_orders where shop_id=s;
  insert into marketplace_ops.release_cursor(shop_id,from_at,to_at) values(s,v_from,least(v_from+interval '7 days',now())) on conflict(shop_id) do nothing;
  select * into c from marketplace_ops.release_cursor where shop_id=s;
  return to_jsonb(c);
 elsif p_action='cursor_save' then
  update marketplace_ops.release_cursor set from_at=(p_body->>'from_at')::timestamptz,to_at=(p_body->>'to_at')::timestamptz,page=(p_body->>'page')::integer,last_error=p_body->>'error',next_at=coalesce((p_body->>'next_at')::timestamptz,now()),updated_at=now() where shop_id=s;
  return jsonb_build_object('saved',true);
 elsif p_action='state' then
  update marketplace_ops.worker_state set last_finished_at=clock_timestamp(),last_error=left(p_body->>'error',300) where key='finance';return jsonb_build_object('saved',true);
 elsif p_action='complete_job' then
  update public.marketplace_enrichment_jobs set status='completed',completed_at=now(),locked_at=null,last_error=null,updated_at=now() where id=(p_body->>'job_id')::uuid and exists(select 1 from public.marketplace_order_financials f where f.order_id=marketplace_enrichment_jobs.order_id and f.settlement_status='released' and f.released_amount is not null);
  return jsonb_build_object('saved',true);
 elsif p_action='complete_detail' then
  update public.marketplace_enrichment_jobs set status='completed',completed_at=now(),locked_at=null,last_error=null,updated_at=now() where id=(p_body->>'job_id')::uuid and job_type='financial_detail' and exists(select 1 from public.marketplace_order_financials f where f.order_id=marketplace_enrichment_jobs.order_id and f.escrow_amount is not null);
  return jsonb_build_object('saved',true);
 elsif p_action='defer_job' then
  update public.marketplace_enrichment_jobs set status=case when p_body->>'blocked'='true' then 'failed' else 'pending' end,locked_at=null,last_error=left(p_body->>'error',300),available_at=now()+make_interval(hours=>case when p_body->>'blocked'='true' then 24 else 12 end),response_payload=coalesce(response_payload,'{}'::jsonb)||jsonb_build_object('source','direct_shopee','escrow_checked',p_body->>'escrow_checked'='true'),updated_at=now() where id=(p_body->>'job_id')::uuid and status<>'completed';
  return jsonb_build_object('saved',true);
 elsif p_action='return_detail' then
  -- Bind both signed reads to this exact shop/order/return before any mutation.
  if jsonb_typeof(p_body->'detail') is distinct from 'object' or not exists(
   select 1 from public.marketplace_returns r join public.marketplace_orders o on o.id=r.order_id
   where r.provider='shopee' and r.return_sn=p_body->>'return_sn' and o.shop_id=s
   and p_body#>>'{detail,return_sn}'=r.return_sn and p_body#>>'{detail,order_sn}'=o.order_sn
   and p_body#>>'{detail,currency}'=o.currency) then raise exception 'RETURN_IDENTITY_MISMATCH';end if;
  if exists(select 1 from public.marketplace_returns r where r.return_sn=p_body->>'return_sn' and r.provider='shopee'
   and coalesce((p_body#>>'{detail,update_time}')::bigint,0)<coalesce((r.raw_snapshot#>>'{detail,update_time}')::bigint,0)) then raise exception 'STALE_RETURN_DETAIL';end if;
  perform finance.capture_order_cost_snapshot((select r.order_id from public.marketplace_returns r where r.provider='shopee' and r.return_sn=p_body->>'return_sn'));
  if p_body ? 'finance_events' then
   if jsonb_typeof(p_body->'finance_events') is distinct from 'array' or jsonb_array_length(p_body->'finance_events')<>1
   or not exists(select 1 from public.marketplace_returns r join public.marketplace_orders o on o.id=r.order_id
    where r.return_sn=p_body->>'return_sn' and o.shop_id=s and p_body#>>'{finance_events,0,order_sn}'=o.order_sn
    and p_body#>>'{finance_events,0,shop_id}'=o.shop_id and p_body#>>'{finance_events,0,normalized_data,currency}'=o.currency)
   then raise exception 'RETURN_FINANCE_IDENTITY_MISMATCH';end if;
   if exists(select 1 from jsonb_array_elements((public.ingest_shopee_finance(p_body->'finance_events',false))->'results') x
    where x->>'status' is distinct from 'applied') then raise exception 'RETURN_FINANCE_NOT_APPLIED';end if;
  end if;
  update public.marketplace_returns set
   return_status=coalesce(p_body#>>'{detail,status}',return_status),
   logistics_status=coalesce(p_body#>>'{detail,logistics_status}',logistics_status),
   reverse_logistics_status=coalesce(p_body#>>'{detail,reverse_logistics_status}',reverse_logistics_status),
   return_solution=coalesce(p_body->>'return_solution',return_solution),return_reason=coalesce(p_body->>'reason',return_reason),
   refund_amount=coalesce((p_body->>'refund_amount')::numeric,refund_amount),updated_at=now(),
   raw_snapshot=raw_snapshot||jsonb_build_object('detail',p_body->'detail','detail_checked_at',now(),
    'detail_attempts',0,'detail_error',null,'finance_checked_at',case when p_body ? 'finance_events' then to_jsonb(now()) else raw_snapshot->'finance_checked_at' end,
    'detail_next_at',now()+case when not p_body ? 'finance_events' then interval '1 minute'
     when upper(p_body#>>'{detail,status}') in ('ACCEPTED','CANCELLED','REJECTED') then interval '24 hours' else interval '1 hour' end)
  where return_sn=p_body->>'return_sn' and provider='shopee' and order_id in(select id from public.marketplace_orders where shop_id=s);
  return jsonb_build_object('saved',true,'finance_refreshed',p_body ? 'finance_events');
 end if;raise exception 'invalid_action';
end $function$;

create or replace function public.marketplace_returns_pending(p_limit integer default 3)
returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(x),'[]') from (
 select r.return_sn,o.shop_id,o.order_sn,o.currency from public.marketplace_returns r join public.marketplace_orders o on o.id=r.order_id
 where r.provider='shopee' and upper(o.current_status) not in ('CANCELLED','IN_CANCEL')
 and coalesce(r.last_event_at,r.created_at)>now()-interval '90 days'
 and (coalesce((r.raw_snapshot->>'detail_next_at')::timestamptz,'-infinity')<=now()
  or r.last_event_at>greatest(coalesce((r.raw_snapshot->>'detail_checked_at')::timestamptz,'-infinity'),coalesce((r.raw_snapshot->>'detail_attempted_event_at')::timestamptz,'-infinity')))
 order by case when coalesce(r.return_status,'') not in ('ACCEPTED','CANCELLED','REJECTED') then 0 else 1 end,
 coalesce((r.raw_snapshot->>'detail_next_at')::timestamptz,'-infinity'),r.id
 limit greatest(1,least(p_limit,10))) x;
$$;
create or replace function public.marketplace_return_read_failed(p_return_sn text,p_error text)
returns void language sql set search_path='' as $$
 update public.marketplace_returns set raw_snapshot=raw_snapshot||jsonb_build_object('detail_error',left(p_error,200),
 'detail_next_at',now()+make_interval(hours=>least(24,power(2,least(coalesce((raw_snapshot->>'detail_attempts')::int,0),4))::int)),
 'detail_attempts',coalesce((raw_snapshot->>'detail_attempts')::int,0)+1,'detail_attempted_event_at',last_event_at)
 where provider='shopee' and return_sn=p_return_sn;
$$;

-- Native calculator regression. Synthetic facts only; no order/payment mutations.
do $$
declare r jsonb:='{"status":"TO_RETURN","nett":30.02,"material_total":15.30,"extra_total":0.34,"goods_value":36,"cost_state":"estimated","income_state":"escrow","reviewed":false,"detail_changed":false,"finance_metrics":{"provider_nett":30.02,"refund_total":0,"shipping_net":0,"return_shipping":0}}';
 x jsonb;normal jsonb;
begin
 x:=finance.return_loss_row(r,'{"status":"PROCESSING"}',true);
 assert (x->>'profit')::numeric=-15.64 and (x->>'nett')::numeric=0,'Pending escrow inflated retained income';
 assert x->>'return_phase'='pending' and x->>'profit_state'='estimated' and x->>'reviewed'='false','Pending estimate labelled actual';
 r:=r||'{"nett":-5.19,"income_state":"released","material_total":1.27,"extra_total":0.21,"finance_metrics":{"provider_nett":-5.19,"refund_total":10,"shipping_net":0,"return_shipping":5.19}}';
 x:=finance.return_loss_row(r,'{"status":"ACCEPTED"}',true);
 assert (x->>'profit')::numeric=-6.67 and (x->>'return_loss_total')::numeric=6.67,'Refund consumed costs missing';
 r:=jsonb_set(jsonb_set(jsonb_set(r,'{nett}','-10.38'),'{finance_metrics,provider_nett}','-10.38'),'{finance_metrics,shipping_net}','-5.19');
 x:=finance.return_loss_row(r,'{"status":"ACCEPTED"}',true);
 assert (x->>'profit')::numeric=-11.86,'Shipping deducted twice';
 r:=r||'{"nett":8.25,"material_total":15.30,"extra_total":0.34,"finance_metrics":{"provider_nett":8.25,"refund_total":24,"shipping_net":0,"return_shipping":0}}';
 x:=finance.return_loss_row(r,'{"status":"ACCEPTED"}',true);
 assert (x->>'profit')::numeric=-7.39,'Retained partial-refund revenue lost';
 assert finance.return_loss_row(r,'{"status":"ACCEPTED"}',false)=r,'Unshipped material consumed';
 assert finance.return_loss_row(r,'{"status":"ACCEPTED"}',null)=r,'Unknown shipping assumed';
 x:=finance.return_loss_row(r||'{"material_total":null}','{"status":"ACCEPTED"}',true);
 assert x->>'profit' is null and x->>'profit_state'='incomplete','Unknown material became zero';
 x:=finance.return_loss_row(r||'{"detail_changed":true}','{"status":"ACCEPTED"}',true);
 assert x->>'profit' is null,'Stale material snapshot accepted';
 foreach normal in array array['{"status":"CANCELLED","profit":0}'::jsonb,'{"status":"IN_CANCEL","profit":0}'::jsonb,'{"status":"COMPLETED","profit":20}'::jsonb] loop
  assert finance.return_loss_row(normal,'{}',true)=normal,'Unrelated status changed';
 end loop;
 normal:='{"status":"TO_RETURN","profit":12,"lifecycle_review":true,"finance_metrics":{"refund_total":0}}';
 x:=finance.return_loss_row(normal,'{"status":"CANCELLED"}',true);
 assert x->>'profit'='12' and x->>'lifecycle_review'='false','Cancelled claim consumed revenue';
end $$;
