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
 'material_override',c.material,'courier_override',c.courier,'material_actual',coalesce(c.material_actual,false) and not changed,'courier_actual',coalesce(c.courier_actual,false) and not changed,'extras_actual',coalesce(c.extras_actual,false) and not changed,'note',coalesce(c.note,'')),coalesce(('CANCELLED'=any(array[upper(trim(o.status)),upper(trim(o.admin_status)),upper(trim(o.fulfillment_stage))]) or 'IN_CANCEL'=any(array[upper(trim(o.status)),upper(trim(o.admin_status)),upper(trim(o.fulfillment_stage))])),false));
end $function$;

CREATE OR REPLACE FUNCTION finance.sales_channel_orders(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(order_id uuid, channel text, day date, reference text, status text, included boolean, sales numeric, shipping numeric, discount numeric, refund numeric, received numeric, pending numeric, nett numeric, profit numeric, profit_state text, fees numeric, return_shipping numeric, shipping_loss numeric, customer_key text, repeat_customer boolean, fulfillment_days numeric, payment_evidence text, basis_review boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with cancelled_policy_raw(order_id,channel,day,reference,status,included,sales,shipping,discount,refund,received,pending,nett,profit,profit_state,fees,return_shipping,shipping_loss,customer_key,repeat_customer,fulfillment_days,payment_evidence,basis_review) as materialized (with mp as materialized (
 select m.*, coalesce(case when (ex.fields->'report_items'->'value'->0->>'Order Creation Date') ~ '^\d{4}-\d{2}-\d{2}' then left(ex.fields->'report_items'->'value'->0->>'Order Creation Date',10)::date end,(coalesce(m.placed_at,m.created_at) at time zone 'Asia/Kuala_Lumpur')::date) local_day,
 coalesce(m.placed_at,m.created_at) occurred_at,
 m.current_status not in ('CANCELLED','IN_CANCEL','UNPAID','UNKNOWN') and lower(coalesce(ex.fields->'report_items'->'value'->0->>'Order Status','')) not in ('cancelled','unpaid') eligible,
 case when m.buyer_customer_id is not null then 'crm:'||m.buyer_customer_id else 'shopee:'||m.shop_id||':'||nullif(lower(m.buyer_username),'') end ck
 from public.marketplace_orders m
 left join lateral(select fields from finance.order_finance_snapshots where order_id=m.id and source='excel' order by id desc limit 1)ex on true
 where m.provider='shopee' and m.currency='MYR' and coalesce(m.metadata->>'dashboard_excluded','false')<>'true'
), own as materialized (
 select o.*,(o.created_at at time zone 'Asia/Kuala_Lumpur')::date local_day,
 finance.order_is_paid(o.id) eligible,
 coalesce('crm:'||o.customer_id,'phone:'||nullif(regexp_replace(o.delivery_phone,'\D','','g'),'')) ck
 from public.orders o
 where coalesce(o.source,'') not in ('shopee','marketplace','chatgpt-test')
 and not exists(select 1 from public.marketplace_orders m where m.internal_order_id=o.id or m.order_sn in (o.external_order_id,o.order_id,o.order_no))
), identities as (
 select id, 'shopee'::text ch,local_day,occurred_at,ck from mp where eligible
 union all select id,'deco',local_day,created_at,ck from own where eligible
), history as (
 select id,ch,ck is not null and row_number() over(partition by ch,ck order by local_day,occurred_at,id)>1 rep from identities
), goods as materialized (
 select order_id,case when count(*) filter(where sales is null)=0 then sum(sales) end amount from finance.sales_sku_lines('MYR',null) group by order_id
), m_selected as materialized (
 select m.*,finance.order_profit_row(m.id) p,s.fields,coalesce(s.metrics,finance.order_finance_metrics(coalesce(s.fields,'{}'))) metrics,
 g.amount goods, h.rep
 from mp m left join goods g on g.order_id=m.id left join history h on h.id=m.id and h.ch='shopee'
 left join lateral(select fields,metrics from finance.order_finance_snapshots where order_id=m.id order by (source='webhook') desc,id desc limit 1)s on true
 where (p_from is null or m.local_day>=p_from) and (p_to is null or m.local_day<=p_to)
), own_selected as materialized (
 select o.*,h.rep,
 (select sum(pt.amount) from public.payment_transactions pt where pt.order_id=o.id and pt.provider not in ('legacy_test','test_webhook') and not exists(select 1 from public.payment_transaction_voids v where v.original_payment_id=pt.id)) pay,
 (select sum(co.amount) from public.pickup_checkout_orders co join public.pickup_checkouts c on c.id=co.checkout_id
 where co.order_id=o.id and co.status='allocated' and c.status='paid' and not exists(select 1 from public.pickup_checkout_voids v where v.checkout_id=c.id)
 and not exists(select 1 from public.payment_transactions pt where pt.order_id=o.id and pt.transaction_id=c.transaction_id)) checkout_pay,
 (select min(s.shipped_at) from public.shipments s where s.order_id=o.id and s.cancelled_at is null and s.archived_at is null) shipped
 from own o left join history h on h.id=o.id and h.ch='deco'
 where (p_from is null or o.local_day>=p_from) and (p_to is null or o.local_day<=p_to)
)
select id,'shopee',local_day,order_sn,current_status,eligible,
 -- Item selling price already contains item discounts. Only separate seller vouchers/coins are deducted.
 case when eligible then goods-coalesce(finance.fa(fields,'voucher_from_seller'),0)-coalesce(finance.fa(fields,'seller_coin_cash_back'),0) end,
 finance.fa(fields,'buyer_paid_shipping_fee'),
 finance.fa(fields,'voucher_from_seller')+finance.fa(fields,'seller_coin_cash_back'),
 (metrics->>'refund_total')::numeric,
 case when p->>'income_state'='released' then (p->>'nett')::numeric end,
 case when eligible and p->>'income_state' in ('escrow','report_estimate') then (p->>'nett')::numeric when eligible and p->>'income_state'='released' then 0 end,
 (p->>'nett')::numeric,(p->>'profit')::numeric,p->>'profit_state',
 (metrics->>'fee_total')::numeric,(metrics->>'return_shipping')::numeric,case when metrics->>'shipping_net' is not null then greatest(-(metrics->>'shipping_net')::numeric,0) end,
 ck,coalesce(rep,false),
 case when raw_detail->>'ship_time' ~ '^\d{9,10}$' and (raw_detail->>'ship_time')::bigint>0 then greatest(extract(epoch from (to_timestamp((raw_detail->>'ship_time')::bigint)-occurred_at))/86400,0) end,
 coalesce(p->>'income_state','missing'),
 fields is null or finance.fa(fields,'voucher_from_seller') is null or finance.fa(fields,'seller_coin_cash_back') is null or exists(select 1 from jsonb_array_elements(coalesce(metrics->'issues','[]'))j where j#>>'{}' like 'Diskaun%')
from m_selected
union all
select id,'deco',local_day,coalesce(nullif(order_no,''),order_id,id::text),status,eligible,
 case when eligible then total-delivery_fee end,delivery_fee,
 finance.provider_number(pricing_adjustments->'discount_amount'),null::numeric,
 case when pay is not null or checkout_pay is not null then coalesce(pay,0)+coalesce(checkout_pay,0) end,
 case when lower(coalesce(status,'')||' '||coalesce(admin_status,'')||' '||coalesce(fulfillment_stage,'')) !~ '(cancel|refund|void|return)' then case when finance.order_is_paid(id) then 0 else greatest(total-coalesce(pay,0)-coalesce(checkout_pay,0),0) end end,
 null::numeric,null::numeric,'incomplete',null::numeric,null::numeric,null::numeric,ck,coalesce(rep,false),
 case when coalesce(shipped,pickup_collected_at) is not null then greatest(extract(epoch from (coalesce(shipped,pickup_collected_at)-created_at))/86400,0) end,
 case when pay is not null or checkout_pay is not null then 'transaction' when lower(coalesce(payment_status,''))='paid' or lower(coalesce(payment,''))='paid' then 'paid_status_only' else 'unpaid' end,
 delivery_fee is null
from own_selected) select order_id,
channel,
day,
reference,
status,
case when upper(trim(status)) in ('CANCELLED','IN_CANCEL') then false else included end as included,
case when upper(trim(status)) in ('CANCELLED','IN_CANCEL') then 0::numeric else sales end as sales,
case when upper(trim(status)) in ('CANCELLED','IN_CANCEL') then 0::numeric else shipping end as shipping,
case when upper(trim(status)) in ('CANCELLED','IN_CANCEL') then 0::numeric else discount end as discount,
case when upper(trim(status)) in ('CANCELLED','IN_CANCEL') then 0::numeric else refund end as refund,
case when upper(trim(status)) in ('CANCELLED','IN_CANCEL') then 0::numeric else received end as received,
case when upper(trim(status)) in ('CANCELLED','IN_CANCEL') then 0::numeric else pending end as pending,
case when upper(trim(status)) in ('CANCELLED','IN_CANCEL') then 0::numeric else nett end as nett,
case when upper(trim(status)) in ('CANCELLED','IN_CANCEL') then 0::numeric else profit end as profit,
case when upper(trim(status)) in ('CANCELLED','IN_CANCEL') then 'excluded' else profit_state end as profit_state,
case when upper(trim(status)) in ('CANCELLED','IN_CANCEL') then 0::numeric else fees end as fees,
case when upper(trim(status)) in ('CANCELLED','IN_CANCEL') then 0::numeric else return_shipping end as return_shipping,
case when upper(trim(status)) in ('CANCELLED','IN_CANCEL') then 0::numeric else shipping_loss end as shipping_loss,
customer_key,
repeat_customer,
fulfillment_days,
case when upper(trim(status)) in ('CANCELLED','IN_CANCEL') then 'cancelled' else payment_evidence end as payment_evidence,
case when upper(trim(status)) in ('CANCELLED','IN_CANCEL') then false else basis_review end as basis_review from cancelled_policy_raw;
$function$;
