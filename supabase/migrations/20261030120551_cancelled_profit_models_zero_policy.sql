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
 return finance.cancelled_zero_row(r||jsonb_build_object('nett',net,'income_state',inc,'material_total',material,'cost_total',material+extra,'goods_value',goods,'profit',profit,'margin',case when goods>0 then round(profit/goods*100,2) end,
 'profit_per_hour',case when (r->>'work_minutes')::numeric>0 then round(profit/(r->>'work_minutes')::numeric*60,2) end,
 'profit_state',case when profit is null then 'incomplete' when inc='released' and cost_state='actual' then 'actual' else 'estimated' end,
 'cost_state',cost_state,'detail_changed',changed,'lifecycle_review',life,'finance_metrics',metrics,'finance_source',coalesce(s.source,case when fs<>'{}' then 'webhook' else 'missing' end),
 'finance_updated_at',coalesce(s.captured_at,(r->>'enriched_at')::timestamptz),
 'courier',(select courier_name from public.marketplace_orders where id=p_order_id),'shop_id',(select shop_id from public.marketplace_orders where id=p_order_id)));
end $function$;
CREATE OR REPLACE FUNCTION finance.direct_margin_row(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare o public.orders%rowtype; cfg finance.material_cost_versions%rowtype; c finance.direct_order_costs%rowtype;
 i record; lines jsonb:='[]'; sig text; mat numeric:=0; raw_goods numeric:=0; goods numeric;
 cat text; sku text; sc jsonb; cost numeric; shipping numeric; actual_shipping boolean:=false;
 receipts numeric; txpay numeric; copay numeric; refund numeric; net numeric; contribution numeric; actual boolean:=false;
 mode text; paid boolean;shipment_count integer;currency_bad boolean; changed boolean:=false; reasons jsonb:='[]';
begin
 select * into o from public.orders where id=p_order_id;
 if not found then raise exception 'Order direct tidak dijumpai';end if;
 -- Identity ownership: a marketplace mirror cannot become direct income.
 if exists(select 1 from public.marketplace_orders m where m.internal_order_id=o.id or m.order_sn in(o.external_order_id,o.order_id,o.order_no))
 or coalesce(o.source,'') in ('shopee','marketplace','chatgpt-test') then raise exception 'Order ini bukan jualan direct';end if;
 select * into cfg from finance.material_cost_versions where effective_at<=o.created_at order by effective_at desc limit 1;
 goods:=o.total-coalesce(o.delivery_fee,0);
 select coalesce(sum(price*qty),0),md5(coalesce(jsonb_agg(jsonb_build_array(id,title,qty,price,k,product_type,product_id,product_variant_id,product_snapshot) order by id),'[]')::text||coalesce(o.total::text,'')||coalesce(o.delivery_fee::text,'')||coalesce(o.delivery_method,'')||coalesce(o.delivery,''))
 into raw_goods,sig from public.order_items where order_id=o.id;
 select * into c from finance.direct_order_costs where order_id=o.id;changed:=c.order_id is not null and c.source_signature<>sig;
 for i in select oi.*,p.parent_sku,v.sku variant_sku from public.order_items oi left join public.products p on p.id=oi.product_id left join public.product_variants v on v.id=oi.product_variant_id where oi.order_id=o.id order by oi.id loop
  sku:=lower(coalesce(nullif(i.variant_sku,''),nullif(i.product_snapshot->>'sku',''),i.parent_sku,''));
  sc:=coalesce(cfg.sku_costs->lower(coalesce(i.parent_sku,'')||'::'||sku),cfg.sku_costs->sku,cfg.sku_costs->lower(i.parent_sku));
  cat:=coalesce(sc->>'category',case lower(coalesce(nullif(i.k,''),i.product_type,'')) when 'edible' then 'edible' when 'ei' then 'edible' when 'printed' then 'topper' when 'topper' then 'topper' when 'mirror' then 'topper' when 'wafer' then 'wafer' when 'acrylic' then 'acrylic' end,finance.material_category(sku,i.title));
  cost:=case when sc is not null then round((sc->>'unit_cost')::numeric*i.qty,2)
   when raw_goods>0 and goods>=0 and i.qty>0 and i.price>=0 then round(i.price*i.qty/raw_goods*goods*(cfg.rates->>cat)::numeric/100,2) end;
  mat:=mat+cost;
  lines:=lines||jsonb_build_array(jsonb_build_object('title',i.title,'qty',i.qty,'category',cat,'goods',case when raw_goods>0 then round(i.price*i.qty/raw_goods*goods,2) end,'material',cost,'sku',sku));
 end loop;
 if jsonb_array_length(lines)=0 then mat:=null;end if;
 if c.order_id is not null and not changed and c.material is not null then mat:=c.material;end if;
 select case when count(*) filter(where charged_amount is not null)=count(*) then sum(charged_amount) when count(*) filter(where coalesce(charged_amount,quoted_amount) is not null)=count(*) then sum(coalesce(charged_amount,quoted_amount)) else null end,
 count(*)>0 and count(*) filter(where charged_amount is not null)=count(*),count(*),coalesce(bool_or(coalesce(currency,'MYR')<>'MYR' or coalesce(charged_amount,quoted_amount)<0),false)
 into shipping,actual_shipping,shipment_count,currency_bad from public.shipments where order_id=o.id and cancelled_at is null and archived_at is null;
 if lower(coalesce(nullif(o.delivery_method,''),o.delivery,'')) in ('pickup','walkin','walk-in','counter') then shipping:=0;actual_shipping:=true;
 elsif shipping is null and shipment_count<=1 and o.delivery_fee>0 then shipping:=o.delivery_fee;end if;
 if currency_bad then shipping:=null;actual_shipping:=false;end if;
 -- Manual override applies only to the same item/total revision. AWB charges replace estimates automatically.
 if c.order_id is not null and not changed and c.courier is not null and (c.courier_actual or not actual_shipping) then shipping:=c.courier;actual_shipping:=c.courier_actual;end if;
 select sum(pt.amount) filter(where pt.amount>=0),-coalesce(sum(pt.amount) filter(where pt.amount<0),0) into txpay,refund
 from public.payment_transactions pt where pt.order_id=o.id and pt.provider not in('legacy_test','test_webhook')
 and not exists(select 1 from public.payment_transaction_voids v where v.original_payment_id=pt.id);
 select sum(co.amount) into copay from public.pickup_checkout_orders co join public.pickup_checkouts pc on pc.id=co.checkout_id
 where co.order_id=o.id and co.status='allocated' and pc.status='paid' and not exists(select 1 from public.pickup_checkout_voids v where v.checkout_id=pc.id)
 and not exists(select 1 from public.payment_transactions pt where pt.order_id=o.id and pt.transaction_id=pc.transaction_id);
 receipts:=case when txpay is not null or copay is not null then coalesce(txpay,0)+coalesce(copay,0)-refund end;
 paid:=lower(coalesce(o.payment_status,''))='paid' or lower(coalesce(o.payment,''))='paid' or (receipts is not null and receipts>=o.total-0.01);
 if receipts is not null and receipts<o.total-0.01 then paid:=false;end if;
 if not paid then reasons:=reasons||'"Bayaran belum penuh"'::jsonb;end if;
 if changed then reasons:=reasons||'"Item / jumlah berubah; semak kos"'::jsonb;end if;
 if mat is null then reasons:=reasons||'"Modal belum lengkap"'::jsonb;end if;
 if shipping is null then reasons:=reasons||'"Kos courier belum diketahui"'::jsonb;end if;
 if lower(coalesce(o.status,'')||' '||coalesce(o.admin_status,'')||' '||coalesce(o.fulfillment_stage,'')) ~ '(cancel|refund|void|return)' or refund>0 then paid:=false;reasons:=reasons||'"Batal / refund perlu semakan; tidak masuk target"'::jsonb;end if;
 if paid then
  -- Receipt evidence is capped at order total: unrelated overpayments cannot inflate contribution.
  net:=least(coalesce(receipts,o.total),o.total)-shipping;
  if not changed then contribution:=round(net-mat-coalesce(c.extras,0)-coalesce((case when lower(coalesce(nullif(o.delivery_method,''),o.delivery,'')) in ('pickup','walkin','walk-in','counter') then 0::numeric else finance.packing_estimate(lines) end),0),2);end if;
 end if;
 actual:=lower(coalesce(nullif(o.delivery_method,''),o.delivery,'')) in ('pickup','walkin','walk-in','counter') and receipts is not null and c.material is not null and c.material_actual and actual_shipping and c.extras_actual and not changed;
 mode:=case when not paid then 'excluded' when contribution is null then 'incomplete' when actual then 'actual' else 'estimated' end;
 return finance.cancelled_zero_row(jsonb_build_object('order_id',o.id,'reference',coalesce(nullif(o.order_no,''),o.order_id,o.id::text),'channel','deco','day',(o.created_at at time zone 'Asia/Kuala_Lumpur')::date,
 'status',o.status,'sales',goods,'customer_paid',case when paid then least(coalesce(receipts,o.total),o.total) else receipts end,
 'shipping_charged',o.delivery_fee,'courier',shipping,'courier_state',case when actual_shipping then 'actual' else 'estimated' end,
 'fee',0,'nett',net,'material',mat,'packing',(case when lower(coalesce(nullif(o.delivery_method,''),o.delivery,'')) in ('pickup','walkin','walk-in','counter') then 0::numeric else finance.packing_estimate(lines) end),'extras',coalesce(c.extras,0),'contribution',contribution,'margin',case when goods>0 then round(contribution/goods*100,2) end,
 'state',mode,'income_state',case when receipts is not null then 'transaction' when paid then 'paid_status_only' else 'unpaid' end,
 'included',paid,'lines',lines,'reasons',reasons,'version',coalesce(c.version,0),'signature',sig,'settings_version',cfg.version,
 'material_override',c.material,'courier_override',c.courier,'material_actual',coalesce(c.material_actual,false) and not changed,'courier_actual',coalesce(c.courier_actual,false) and not changed,'extras_actual',coalesce(c.extras_actual,false) and not changed,'note',coalesce(c.note,'')),coalesce('CANCELLED'=any(array[upper(trim(o.status)),upper(trim(o.admin_status)),upper(trim(o.fulfillment_stage))]),false));
end $function$;
CREATE OR REPLACE FUNCTION public.finance_order_profit_detail(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r jsonb;fs jsonb;
begin
 perform finance.capture_order_cost_snapshot(p_order_id);perform finance.capture_order_finance(p_order_id);r:=finance.order_profit_row(p_order_id);
 select fields into fs from finance.order_finance_snapshots where order_id=p_order_id order by (source='webhook') desc,id desc limit 1;
 return finance.cancelled_zero_row(r||jsonb_build_object('finance_fields',coalesce(fs,'{}'),'finance_history',(select coalesce(jsonb_agg(to_jsonb(h)),'[]') from
 (select id,source,captured_at,metrics,fields from finance.order_finance_snapshots where order_id=p_order_id order by id desc limit 30)h)));
end $function$;
CREATE OR REPLACE FUNCTION public.finance_order_profit_list(p_filter jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare d1 date:=coalesce((p_filter->>'from')::date,date_trunc('month',now() at time zone 'Asia/Kuala_Lumpur')::date);
  d2 date:=coalesce((p_filter->>'to')::date,(now() at time zone 'Asia/Kuala_Lumpur')::date); result jsonb;
  lim integer:=greatest(1,least(coalesce((p_filter->>'limit')::integer,50),100)); off integer:=greatest(0,coalesce((p_filter->>'offset')::integer,0));
begin
  if d2<d1 or d2-d1>366 then raise exception 'Julat tarikh maksimum 367 hari'; end if;
  with candidates as materialized (
    select o.id from public.marketplace_orders o where coalesce(o.placed_at,o.created_at)>=d1::timestamp at time zone 'Asia/Kuala_Lumpur'
    and coalesce(o.placed_at,o.created_at)<(d2+1)::timestamp at time zone 'Asia/Kuala_Lumpur'
    and coalesce(o.metadata->>'dashboard_excluded','false')<>'true' and coalesce(nullif(o.currency,''),'MYR')=coalesce(nullif(p_filter->>'currency',''),'MYR')
    and (coalesce(p_filter->>'status','active')='all' or (coalesce(p_filter->>'status','active')='active' and upper(o.current_status) !~ '(CANCEL|UNPAID|RETURN|REFUND)') or o.current_status=p_filter->>'status')
    and (coalesce(p_filter->>'query','')='' or o.order_sn ilike '%'||(p_filter->>'query')||'%' or o.buyer_username ilike '%'||(p_filter->>'query')||'%' or exists(
      select 1 from public.marketplace_order_items i where i.order_id=o.id and i.is_current and (i.title ilike '%'||(p_filter->>'query')||'%' or i.item_sku ilike '%'||(p_filter->>'query')||'%' or i.variation_sku ilike '%'||(p_filter->>'query')||'%')))
  ), calculated as materialized (select finance.order_profit_row(id) r from candidates), filtered as materialized (
    select r from calculated where (coalesce(p_filter->>'category','')='' or r->'categories' ? (p_filter->>'category'))
    and (coalesce(p_filter->>'state','')='' or r->>'profit_state'=p_filter->>'state' or (p_filter->>'state'='loss' and (r->>'profit')::numeric<0))
  ), page as (
    select r from filtered order by
      case when p_filter->>'sort'='profit_asc' then (r->>'profit')::numeric end asc nulls last,
      case when p_filter->>'sort'='margin_asc' then (r->>'margin')::numeric end asc nulls last,
      (r->>'placed_at')::timestamptz desc,r->>'order_id' limit lim offset off
  ) select jsonb_build_object('rows',(select coalesce(jsonb_agg(r),'[]'::jsonb) from page),'total',count(*),'currency',coalesce(nullif(p_filter->>'currency',''),'MYR'),
    'summary',jsonb_build_object('orders',count(*),'released_nett',coalesce(sum((r->>'nett')::numeric) filter(where r->>'income_state'='released'),0),
      'escrow_nett',coalesce(sum((r->>'nett')::numeric) filter(where r->>'income_state'='escrow'),0),
      'actual_profit',coalesce(sum((r->>'profit')::numeric) filter(where r->>'profit_state'='actual'),0),
      'estimated_profit',coalesce(sum((r->>'profit')::numeric) filter(where r->>'profit_state'='estimated'),0),
      'actual_orders',count(*) filter(where r->>'profit_state'='actual'),'estimated_orders',count(*) filter(where r->>'profit_state'='estimated'),
      'incomplete_orders',count(*) filter(where r->>'profit_state' in ('incomplete','lifecycle_review')),
      'loss_orders',count(*) filter(where (r->>'profit')::numeric<0),'low_margin_orders',count(*) filter(where (r->>'margin')::numeric<20 and r->>'profit_state'<>'excluded'))) into result from filtered;
  return result;
end $function$;
