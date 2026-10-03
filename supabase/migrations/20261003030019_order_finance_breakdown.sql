create function finance.order_finance_catalog() returns jsonb language sql immutable set search_path='' as $$ select '{"buyer_paid_shipping_fee": {"label": "Shipping pembeli", "group": "shipping", "role": "reference"}, "estimated_shipping_fee": {"label": "Shipping anggaran", "group": "shipping", "role": "reference"}, "actual_shipping_fee": {"label": "Shipping sebenar", "group": "shipping", "role": "reference"}, "final_shipping_fee": {"label": "Shipping final (alternatif)", "group": "shipping", "role": "reference"}, "shopee_shipping_rebate": {"label": "Rebat shipping Shopee", "group": "shipping", "role": "reference"}, "shipping_fee_sst": {"label": "SST shipping", "group": "shipping", "role": "reference"}, "seller_shipping_discount": {"label": "Diskaun shipping seller", "group": "shipping", "role": "reference"}, "shipping_fee_discount_from_3pl": {"label": "Diskaun courier", "group": "shipping", "role": "reference"}, "reverse_shipping_fee": {"label": "Reverse shipping", "group": "returns", "role": "deduction"}, "reverse_shipping_fee_sst": {"label": "SST reverse shipping", "group": "returns", "role": "deduction"}, "final_return_to_seller_shipping_fee": {"label": "Return to seller shipping", "group": "returns", "role": "deduction"}, "return_to_seller_shipping_fee_sst": {"label": "SST return to seller", "group": "returns", "role": "deduction"}, "return_handling_fee": {"label": "Return handling", "group": "returns", "role": "deduction"}, "overseas_return_service_fee": {"label": "Overseas return", "group": "returns", "role": "deduction"}, "seller_return_refund": {"label": "Refund / pembatalan barang", "group": "returns", "role": "signed"}, "drc_adjustable_refund": {"label": "Refund pelarasan", "group": "returns", "role": "signed"}, "commission_fee": {"label": "Commission", "group": "fees", "role": "deduction"}, "service_fee": {"label": "Service fee", "group": "fees", "role": "deduction"}, "seller_transaction_fee": {"label": "Transaction fee", "group": "fees", "role": "deduction"}, "ads_escrow_top_up_fee_or_technical_support_fee": {"label": "Ads Escrow Top Up / Technical Support", "group": "fees", "role": "deduction"}, "order_ams_commission_fee": {"label": "Affiliate AMS", "group": "fees", "role": "deduction"}, "campaign_fee": {"label": "Campaign fee", "group": "fees", "role": "deduction"}, "seller_order_processing_fee": {"label": "Order processing", "group": "fees", "role": "deduction"}, "fbs_fee": {"label": "FBS", "group": "fees", "role": "deduction"}, "sspl_fee": {"label": "SSPL", "group": "fees", "role": "deduction"}, "pay_per_sale": {"label": "Pay per sale", "group": "fees", "role": "deduction"}, "shipping_seller_protection_fee_amount": {"label": "Shipping protection", "group": "fees", "role": "deduction"}, "lff_seller_protection_fee_amount": {"label": "Seller protection", "group": "fees", "role": "deduction"}, "delivery_seller_protection_fee_premium_amount": {"label": "Delivery protection", "group": "fees", "role": "deduction"}, "credit_card_transaction_fee": {"label": "Credit card transaction (alternatif)", "group": "fees", "role": "alternative"}, "seller_discount": {"label": "Diskaun seller dalam harga", "group": "discounts", "role": "seller"}, "order_seller_discount": {"label": "Diskaun order seller", "group": "discounts", "role": "seller"}, "voucher_from_seller": {"label": "Voucher seller", "group": "discounts", "role": "seller"}, "seller_coin_cash_back": {"label": "Coin cashback seller", "group": "discounts", "role": "seller"}, "seller_bundle_discount": {"label": "Bundle seller", "group": "discounts", "role": "seller"}, "seller_rebate": {"label": "Rebat seller", "group": "discounts", "role": "seller"}, "shopee_discount": {"label": "Diskaun Shopee", "group": "discounts", "role": "platform"}, "original_shopee_discount": {"label": "Diskaun Shopee asal", "group": "discounts", "role": "platform"}, "voucher_from_shopee": {"label": "Voucher Shopee", "group": "discounts", "role": "platform"}, "coins": {"label": "Shopee coins", "group": "discounts", "role": "platform"}, "shopee_coin_cash_back": {"label": "Coin cashback Shopee", "group": "discounts", "role": "platform"}, "voucher_from_external_party": {"label": "Voucher pihak luar", "group": "discounts", "role": "platform"}, "shopee_bundle_discount": {"label": "Bundle Shopee", "group": "discounts", "role": "platform"}, "payment_promotion": {"label": "Payment promotion", "group": "discounts", "role": "platform"}, "credit_card_promotion": {"label": "Credit card promotion", "group": "discounts", "role": "platform"}, "original_cost_of_goods_sold": {"label": "Nilai barang asal", "group": "goods", "role": "reference"}, "cost_of_goods_sold": {"label": "Nilai barang", "group": "goods", "role": "reference"}, "original_price": {"label": "Harga asal", "group": "goods", "role": "reference"}, "order_original_price": {"label": "Harga asal order", "group": "goods", "role": "reference"}, "order_selling_price": {"label": "Harga jual order", "group": "goods", "role": "reference"}, "order_discounted_price": {"label": "Harga selepas diskaun", "group": "goods", "role": "reference"}, "returned_quantity": {"label": "Kuantiti dipulangkan", "group": "goods", "role": "reference"}, "escrow_amount": {"label": "Escrow nett", "group": "settlement", "role": "reference"}, "escrow_amount_after_adjustment": {"label": "Escrow selepas pelarasan", "group": "settlement", "role": "reference"}, "released_amount": {"label": "Nett dilepaskan", "group": "settlement", "role": "reference"}, "total_adjustment_amount": {"label": "Jumlah pelarasan", "group": "settlement", "role": "reference"}, "seller_lost_compensation": {"label": "Pampasan hilang", "group": "adjustments", "role": "credit"}, "fsf_seller_protection_fee_claim_amount": {"label": "Tuntutan perlindungan shipping", "group": "adjustments", "role": "credit"}, "rsf_seller_protection_fee_claim_amount": {"label": "Tuntutan perlindungan return", "group": "adjustments", "role": "credit"}, "escrow_tax": {"label": "Escrow Tax", "group": "taxes", "role": "reference"}, "escrow_import_tax": {"label": "Escrow Import Tax", "group": "taxes", "role": "reference"}, "withholding_tax": {"label": "Withholding Tax", "group": "taxes", "role": "reference"}, "cross_border_tax": {"label": "Cross Border Tax", "group": "taxes", "role": "reference"}, "sales_tax_on_lvg": {"label": "Sales Tax On Lvg", "group": "taxes", "role": "reference"}, "withholding_cit_tax": {"label": "Withholding Cit Tax", "group": "taxes", "role": "reference"}, "withholding_pit_tax": {"label": "Withholding Pit Tax", "group": "taxes", "role": "reference"}, "withholding_vat_tax": {"label": "Withholding Vat Tax", "group": "taxes", "role": "reference"}, "final_product_vat_tax": {"label": "Final Product Vat Tax", "group": "taxes", "role": "reference"}, "vat_on_imported_goods": {"label": "Vat On Imported Goods", "group": "taxes", "role": "reference"}, "final_shipping_vat_tax": {"label": "Final Shipping Vat Tax", "group": "taxes", "role": "reference"}, "final_escrow_product_gst": {"label": "Final Escrow Product Gst", "group": "taxes", "role": "reference"}, "final_escrow_shipping_gst": {"label": "Final Escrow Shipping Gst", "group": "taxes", "role": "reference"}, "th_import_duty": {"label": "Th Import Duty", "group": "taxes", "role": "reference"}}'::jsonb $$;
create function finance.provider_number(p jsonb) returns numeric language plpgsql immutable set search_path='' as $$
declare s text:=trim(p#>>'{}'); n numeric;
begin
 if p is null or p='null'::jsonb or s='' then return null; end if;
 s:=regexp_replace(s,'^(RM|MYR)\s*','','i');s:=replace(s,',','');
 if s ~ '^\([0-9]+(\.[0-9]+)?\)$' then s:='-'||trim(s,'()');end if;
 if s !~ '^-?[0-9]+(\.[0-9]+)?$' then return null; end if;
 n:=s::numeric; if abs(n)>1000000000 then return null;end if; return n;
end $$;
create function finance.order_finance_fields(p jsonb) returns jsonb language sql immutable set search_path='' as $$
 with recursive scopes(path,v,depth) as (
 select 'payload'::text,p,0 union all
 select path||'.'||e.key,e.value,depth+1 from scopes s cross join lateral jsonb_each(case when jsonb_typeof(s.v)='object' then s.v else '{}'::jsonb end)e
 where e.key in ('data','response','order','order_income','income_details','financials','finance','payment_info','buyer_payment_info','excel_finance') and depth<7
 ), vals as (
 select case when path like '%buyer_payment_info%' then 'buyer.' else '' end||e.key code,path||'.'||e.key source_path,e.value,
 case when path like '%order_income%' then 3 when path like '%excel_finance%' then 4 else depth end priority
 from scopes cross join lateral jsonb_each(case when jsonb_typeof(v)='object' then v else '{}'::jsonb end)e
 where (path like '%order_income%' or path like '%buyer_payment_info%' or path like '%excel_finance%' or finance.order_finance_catalog()?e.key)
 and e.key !~* '(token|secret|password|authorization)' and e.key not in ('order_income','buyer_payment_info')
 ), chosen as (select distinct on(code) * from vals order by code,priority desc,source_path)
 select coalesce(jsonb_object_agg(code,jsonb_build_object('code',code,'label',coalesce(finance.order_finance_catalog()->code->>'label',replace(code,'_',' ')),
 'group',case when code like 'buyer.%' then 'buyer' else coalesce(finance.order_finance_catalog()->code->>'group','additional') end,
 'role',coalesce(finance.order_finance_catalog()->code->>'role','unmapped'),'value',value,'amount',finance.provider_number(value),'source_path',source_path)),'{}'::jsonb) from chosen;
$$;
create function finance.fa(f jsonb,k text) returns numeric language sql immutable set search_path='' as $$select (f->k->>'amount')::numeric$$;
create function finance.order_finance_metrics(f jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare ship numeric;carrier numeric;ret numeric;fees numeric;nett numeric;goods numeric;refund numeric;promo numeric;calc numeric;delta numeric;
 issues jsonb:='[]';reasons jsonb:='[]';v jsonb;fee_known boolean;ship_known boolean;recon text;
begin
 carrier:=coalesce(finance.fa(f,'actual_shipping_fee'),finance.fa(f,'estimated_shipping_fee'));
 ship_known:=carrier is not null and finance.fa(f,'buyer_paid_shipping_fee') is not null and finance.fa(f,'shopee_shipping_rebate') is not null and finance.fa(f,'shipping_fee_sst') is not null;
 if ship_known then ship:=finance.fa(f,'buyer_paid_shipping_fee')+finance.fa(f,'shopee_shipping_rebate')+coalesce(finance.fa(f,'shipping_fee_discount_from_3pl'),0)-carrier-finance.fa(f,'shipping_fee_sst');end if;
 select sum((value->>'amount')::numeric) into ret from jsonb_each(f) where value->>'group'='returns' and value->>'role'='deduction';
 select sum((value->>'amount')::numeric) into fees from jsonb_each(f) where value->>'group'='fees' and value->>'role'='deduction';
 fee_known:=finance.fa(f,'commission_fee') is not null and finance.fa(f,'service_fee') is not null and finance.fa(f,'seller_transaction_fee') is not null;
 goods:=coalesce(finance.fa(f,'original_cost_of_goods_sold'),finance.fa(f,'cost_of_goods_sold'));
 refund:=finance.fa(f,'seller_return_refund');promo:=coalesce(finance.fa(f,'voucher_from_seller'),0)+coalesce(finance.fa(f,'seller_coin_cash_back'),0);
 nett:=finance.fa(f,'escrow_amount');
 if finance.fa(f,'escrow_amount_after_adjustment') is not null then
  if nett is null or abs(finance.fa(f,'escrow_amount_after_adjustment')-nett-coalesce(finance.fa(f,'total_adjustment_amount'),0))<=0.01 then nett:=finance.fa(f,'escrow_amount_after_adjustment');
  else issues:=issues||'"Nett selepas pelarasan tidak sepadan"'::jsonb;end if;
 end if;
 if refund>0 then issues:=issues||'"Refund bertanda positif: semak maksud sumber"'::jsonb;end if;
 for v in select value from jsonb_each(f) loop
  if (v->>'amount')::numeric<>0 and (v->>'group'='taxes' or (v->>'role'='unmapped' and v->>'group'<>'buyer')) then issues:=issues||jsonb_build_array('Semak pemetaan: '||(v->>'code'));end if;
  if v->>'code' in ('seller_discount','order_seller_discount','seller_bundle_discount') and (v->>'amount')::numeric<>0 then issues:=issues||jsonb_build_array('Diskaun mungkin sudah dalam harga: '||(v->>'code'));end if;
 end loop;
 if goods is not null and ship_known and fee_known and refund is not null and refund<=0 and ret is not null then
  calc:=goods+refund-promo+ship-ret-fees+coalesce(finance.fa(f,'seller_lost_compensation'),0)+coalesce(finance.fa(f,'fsf_seller_protection_fee_claim_amount'),0)+coalesce(finance.fa(f,'rsf_seller_protection_fee_claim_amount'),0)+coalesce(finance.fa(f,'total_adjustment_amount'),0);
 end if;
 delta:=nett-calc;recon:=case when jsonb_array_length(issues)>0 then 'needs_mapping' when delta is null then 'incomplete' when abs(delta)<=0.01 then 'matched' else 'difference' end;
 if ship<0 then reasons:=reasons||'"shipping_loss"'::jsonb;end if;
 if ret>0 then reasons:=reasons||'"return_shipping"'::jsonb;end if;
 if refund<>0 then reasons:=reasons||'"refund"'::jsonb;end if;
 if promo>0 then reasons:=reasons||'"seller_promotion"'::jsonb;end if;
 if finance.fa(f,'ads_escrow_top_up_fee_or_technical_support_fee')>0 then reasons:=reasons||'"platform_ads"'::jsonb;end if;
 if finance.fa(f,'order_ams_commission_fee')>0 then reasons:=reasons||'"affiliate"'::jsonb;end if;
 if nett<0 then reasons:=reasons||'"negative_nett"'::jsonb;end if;
 if recon<>'matched' then reasons:=reasons||'"reconciliation"'::jsonb;end if;
 return jsonb_build_object('shipping_net',ship,'shipping_basis',case when finance.fa(f,'actual_shipping_fee') is not null then 'actual' else 'estimated' end,
 'return_shipping',ret,'fee_total',case when fee_known then fees end,'refund_total',case when refund is not null then abs(refund) end,'seller_promotion',promo,
 'platform_ads',finance.fa(f,'ads_escrow_top_up_fee_or_technical_support_fee'),'affiliate',finance.fa(f,'order_ams_commission_fee'),
 'provider_nett',nett,'reconstructed_nett',calc,'reconciliation_delta',delta,'reconciliation',recon,'issues',issues,'reasons',reasons,
 'field_count',(select count(*) from jsonb_object_keys(f)));
end $$;
create table finance.order_finance_snapshots(
 id bigint generated always as identity primary key,order_id uuid not null references public.marketplace_orders(id),source text not null check(source in ('webhook','excel')),
 source_key text not null,captured_at timestamptz not null default clock_timestamp(),fields jsonb not null,metrics jsonb not null,actor text,
 unique(order_id,source,source_key));
create index order_finance_snapshots_order_idx on finance.order_finance_snapshots(order_id,id desc);
alter table finance.order_finance_snapshots enable row level security;
revoke all on finance.order_finance_snapshots from public,anon,authenticated;
grant select,insert on finance.order_finance_snapshots to service_role;
grant usage,select on sequence finance.order_finance_snapshots_id_seq to service_role;
create function finance.capture_order_finance(p_order_id uuid) returns void language plpgsql set search_path='' as $$
declare p jsonb;fs jsonb;k text;
begin
 select coalesce(provider_payload->'shopee_finance',provider_payload),coalesce(provider_payload->>'finance_ingest_event_id',md5(provider_payload::text)) into p,k from public.marketplace_order_financials where order_id=p_order_id and last_enriched_at is not null;
 if p is null then return;end if;fs:=finance.order_finance_fields(p);if fs='{}' then return;end if;
 insert into finance.order_finance_snapshots(order_id,source,source_key,fields,metrics) values(p_order_id,'webhook',k,fs,finance.order_finance_metrics(fs)) on conflict do nothing;
end $$;
create function finance.capture_order_finance_after_update() returns trigger language plpgsql security definer set search_path='' as $$begin perform finance.capture_order_finance(new.order_id);return new;end$$;
create trigger capture_order_finance after insert or update of provider_payload,last_enriched_at on public.marketplace_order_financials for each row execute function finance.capture_order_finance_after_update();
alter function finance.order_profit_row(uuid) rename to order_profit_base;
create function finance.order_profit_row(p_order_id uuid) returns jsonb language plpgsql stable set search_path='' as $$
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
 return r||jsonb_build_object('nett',net,'income_state',inc,'material_total',material,'cost_total',material+extra,'goods_value',goods,'profit',profit,'margin',case when goods>0 then round(profit/goods*100,2) end,
 'profit_per_hour',case when (r->>'work_minutes')::numeric>0 then round(profit/(r->>'work_minutes')::numeric*60,2) end,
 'profit_state',case when profit is null then 'incomplete' when inc='released' and cost_state='actual' then 'actual' else 'estimated' end,
 'cost_state',cost_state,'detail_changed',changed,'lifecycle_review',life,'finance_metrics',metrics,'finance_source',coalesce(s.source,case when fs<>'{}' then 'webhook' else 'missing' end),
 'finance_updated_at',coalesce(s.captured_at,(r->>'enriched_at')::timestamptz),
 'courier',(select courier_name from public.marketplace_orders where id=p_order_id),'shop_id',(select shop_id from public.marketplace_orders where id=p_order_id));
end $$;
create or replace function public.finance_order_profit_detail(p_order_id uuid) returns jsonb language plpgsql set search_path='' as $$
declare r jsonb;fs jsonb;
begin
 perform finance.capture_order_cost_snapshot(p_order_id);perform finance.capture_order_finance(p_order_id);r:=finance.order_profit_row(p_order_id);
 select fields into fs from finance.order_finance_snapshots where order_id=p_order_id order by (source='webhook') desc,id desc limit 1;
 return r||jsonb_build_object('finance_fields',coalesce(fs,'{}'),'finance_history',(select coalesce(jsonb_agg(to_jsonb(h)),'[]') from
 (select id,source,captured_at,metrics from finance.order_finance_snapshots where order_id=p_order_id order by id desc limit 30)h));
end $$;
create function finance.order_report_rows(p_filter jsonb) returns setof jsonb language plpgsql stable set search_path='' as $$
declare d1 date:=coalesce((p_filter->>'from')::date,date_trunc('month',now() at time zone 'Asia/Kuala_Lumpur')::date);d2 date:=coalesce((p_filter->>'to')::date,(now() at time zone 'Asia/Kuala_Lumpur')::date);metric text:=coalesce(p_filter->>'metric','profit');mn numeric;mx numeric;
begin
 if d2<d1 or d2-d1>366 then raise exception 'Julat tarikh maksimum 367 hari';end if;
 if metric not in ('profit','nett','margin','cost_total','shipping_net','return_shipping','refund_total','seller_promotion','fee_total','platform_ads','affiliate') then raise exception 'Metric tidak sah';end if;
 mn:=nullif(p_filter->>'min','')::numeric;mx:=nullif(p_filter->>'max','')::numeric;
 if mn::text in ('NaN','Infinity','-Infinity') or mx::text in ('NaN','Infinity','-Infinity') or mn>mx then raise exception 'Julat angka tidak sah';end if;
 return query with candidates as materialized(
 select o.id from public.marketplace_orders o where o.provider='shopee' and coalesce(o.metadata->>'dashboard_excluded','false')<>'true'
 and coalesce(nullif(o.currency,''),'MYR')=coalesce(nullif(p_filter->>'currency',''),'MYR')
 and (case p_filter->>'date_basis' when 'released' then (select released_at from public.marketplace_order_financials where order_id=o.id) when 'finance' then (select max(captured_at) from finance.order_finance_snapshots where order_id=o.id) else coalesce(o.placed_at,o.created_at) end)>=d1::timestamp at time zone 'Asia/Kuala_Lumpur'
 and (case p_filter->>'date_basis' when 'released' then (select released_at from public.marketplace_order_financials where order_id=o.id) when 'finance' then (select max(captured_at) from finance.order_finance_snapshots where order_id=o.id) else coalesce(o.placed_at,o.created_at) end)<(d2+1)::timestamp at time zone 'Asia/Kuala_Lumpur'
 and (coalesce(p_filter->>'status','all')='all' or p_filter->>'status'='active' and upper(o.current_status)!~'(CANCEL|UNPAID|RETURN|REFUND)' or o.current_status=p_filter->>'status')
 and (coalesce(p_filter->>'courier','')='' or coalesce(o.courier_name,'')=p_filter->>'courier')
 and (coalesce(p_filter->>'shop_id','')='' or o.shop_id::text=p_filter->>'shop_id')
 and (coalesce(p_filter->>'query','')='' or o.order_sn ilike '%'||(p_filter->>'query')||'%' or o.buyer_username ilike '%'||(p_filter->>'query')||'%' or exists(select 1 from public.marketplace_order_items i where i.order_id=o.id and i.is_current and (i.title ilike '%'||(p_filter->>'query')||'%' or i.item_sku ilike '%'||(p_filter->>'query')||'%' or i.variation_sku ilike '%'||(p_filter->>'query')||'%')))
 ),calc as materialized(select finance.order_profit_row(id)r from candidates)
 select r from calc where (coalesce(p_filter->>'category','')='' or r->'categories'?(p_filter->>'category'))
 and (coalesce(p_filter->>'state','')='' or r->>'profit_state'=p_filter->>'state' or p_filter->>'state'='loss' and (r->>'profit')::numeric<0)
 and (coalesce(p_filter->>'income_state','')='' or r->>'income_state'=p_filter->>'income_state')
 and (coalesce(p_filter->>'source','')='' or r->>'finance_source'=p_filter->>'source')
 and (coalesce(p_filter->>'reason','')='' or r->'finance_metrics'->'reasons'?(p_filter->>'reason'))
 and (coalesce(p_filter->>'sku','')='' or r->'skus'?(p_filter->>'sku'))
 and (mn is null or coalesce(r->>metric,r->'finance_metrics'->>metric)::numeric>=mn)
 and (mx is null or coalesce(r->>metric,r->'finance_metrics'->>metric)::numeric<=mx);
end $$;
create function public.finance_order_report(p_filter jsonb default '{}',p_export boolean default false) returns jsonb language plpgsql stable set search_path='' as $$
declare res jsonb;lim integer:=case when p_export then 5000 else 50 end;off integer:=case when p_export then 0 else greatest(0,coalesce((p_filter->>'offset')::integer,0)) end;
begin
 with filtered as materialized(select r from finance.order_report_rows(p_filter)t(r)), page as (
 select r from filtered order by
 case when p_filter->>'sort'='profit_asc' then (r->>'profit')::numeric end asc nulls last,
 case when p_filter->>'sort'='margin_asc' then (r->>'margin')::numeric end asc nulls last,
 case when p_filter->>'sort'='shipping_asc' then (r->'finance_metrics'->>'shipping_net')::numeric end asc nulls last,
 case when p_filter->>'sort'='fees_desc' then (r->'finance_metrics'->>'fee_total')::numeric end desc nulls last,
 case when p_filter->>'sort'='returns_desc' then (r->'finance_metrics'->>'return_shipping')::numeric end desc nulls last,
 (r->>'placed_at')::timestamptz desc,r->>'order_id' limit lim offset off
 ),trend as (
 select ((case p_filter->>'date_basis' when 'finance' then r->>'finance_updated_at' when 'released' then r->>'released_at' else r->>'placed_at' end)::timestamptz at time zone 'Asia/Kuala_Lumpur')::date as day,
 count(*) orders,count((r->>'profit')::numeric) known_orders,sum((r->>'nett')::numeric) nett,sum((r->>'profit')::numeric) profit from filtered group by 1
 ),groups as (select coalesce(nullif(r->>'courier',''),'Tidak diketahui') name,count(*) orders,count((r->>'profit')::numeric)known_orders,sum((r->>'profit')::numeric)profit,sum((r->'finance_metrics'->>'shipping_net')::numeric)shipping_net from filtered group by 1)
 select jsonb_build_object('rows',(select coalesce(jsonb_agg(r),'[]') from page),'total',count(*),'currency',coalesce(nullif(p_filter->>'currency',''),'MYR'),'truncated',p_export and count(*)>5000,
 'trend',(select coalesce(jsonb_agg(to_jsonb(t) order by day),'[]')from trend t),'groups',(select coalesce(jsonb_agg(to_jsonb(g) order by profit asc nulls last),'[]')from groups g),
 'summary',jsonb_build_object('orders',count(*),'released_nett',coalesce(sum((r->>'nett')::numeric)filter(where r->>'income_state'='released'),0),'escrow_nett',coalesce(sum((r->>'nett')::numeric)filter(where r->>'income_state' in ('escrow','report_estimate')),0),
 'actual_profit',coalesce(sum((r->>'profit')::numeric)filter(where r->>'profit_state'='actual'),0),'estimated_profit',coalesce(sum((r->>'profit')::numeric)filter(where r->>'profit_state'='estimated'),0),
 'actual_orders',count(*)filter(where r->>'profit_state'='actual'),'estimated_orders',count(*)filter(where r->>'profit_state'='estimated'),'incomplete_orders',count(*)filter(where r->>'profit_state'='incomplete'),
 'loss_orders',count(*)filter(where (r->>'profit')::numeric<0),'low_margin_orders',count(*)filter(where (r->>'margin')::numeric<20),'finance_orders',count(*)filter(where r->>'finance_source'<>'missing'),
 'shipping_loss',sum(least((r->'finance_metrics'->>'shipping_net')::numeric,0)),'return_shipping',sum((r->'finance_metrics'->>'return_shipping')::numeric),
 'fees',sum((r->'finance_metrics'->>'fee_total')::numeric),'refunds',sum((r->'finance_metrics'->>'refund_total')::numeric),'platform_ads',sum((r->'finance_metrics'->>'platform_ads')::numeric),'affiliate',sum((r->'finance_metrics'->>'affiliate')::numeric),
 'reconciliation_issues',count(*)filter(where r->>'finance_source'<>'missing' and r->'finance_metrics'->>'reconciliation'<>'matched'))) into res from filtered;
 return res;
end $$;
create function public.finance_order_finance_options() returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('catalog',finance.order_finance_catalog(),'shops',(select coalesce(jsonb_agg(to_jsonb(s)),'[]')from(select shop_id,currency,count(*)orders from public.marketplace_orders where provider='shopee' and shop_id is not null group by shop_id,currency order by count(*)desc)s),
 'couriers',(select coalesce(jsonb_agg(c),'[]')from(select distinct courier_name c from public.marketplace_orders where provider='shopee' and courier_name is not null order by 1)t));
$$;

create or replace function public.finance_order_costs_save(p_order_id uuid,p_expected_version integer,p_lines jsonb,p_extras jsonb,p_work_minutes jsonb,p_reviewed boolean,p_note text,p_actor text) returns jsonb
language plpgsql set search_path='' as $$
declare prev finance.marketplace_order_costs%rowtype; current_basis jsonb; source jsonb; item jsonb; v jsonb; k text; line jsonb; amount numeric;
  new_lines jsonb:='[]'; new_extras jsonb:='{}'; all_actual boolean:=true; est jsonb;
begin
  if p_actor is distinct from 'admin1' then raise exception 'Forbidden'; end if;
  -- Serialize with capture and concurrent editors for this one order.
  perform 1 from public.marketplace_orders where id=p_order_id for update;
  if not found then raise exception 'Order tidak dijumpai'; end if;
  select * into prev from finance.marketplace_order_costs where order_id=p_order_id for update;
  if p_expected_version is distinct from coalesce(prev.version,0) then raise exception 'Kos order sudah berubah. Buka semula sebelum simpan.'; end if;
  current_basis:=finance.order_material_basis(p_order_id);
  est:=finance.order_material_estimate(p_order_id,prev.settings_version);
  if prev.order_id is not null and ((finance.order_profit_row(p_order_id)->>'lifecycle_review')::boolean) then
    est:=est||jsonb_build_object('lines',prev.material_lines);
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)<>jsonb_array_length(est->'lines') or jsonb_array_length(p_lines)=0 then raise exception 'Semua item order mesti mempunyai kos'; end if;
  for source in select value from jsonb_array_elements(est->'lines') loop
    select value into item from jsonb_array_elements(p_lines) where value->>'line_no'=source->>'line_no';
    if (select count(*) from jsonb_array_elements(p_lines) where value->>'line_no'=source->>'line_no')<>1 then raise exception 'Item kos tiada atau berulang'; end if;
    if coalesce(item->>'mode','') not in ('actual','estimated') then raise exception 'Status kos bahan tidak sah'; end if;
    amount:=finance.cost_number(item->'amount',true);
    if coalesce(item->>'category','') not in ('','topper','edible','wafer','acrylic') then raise exception 'Kategori kos tidak sah'; end if;
    all_actual:=all_actual and amount is not null and item->>'mode'='actual';
    -- Server-owned quantities and prices; client can only edit cost/category, never order facts.
    line:=source||jsonb_build_object('amount',amount,'mode',item->>'mode','category',nullif(item->>'category',''),'basis','manual');
    new_lines:=new_lines||jsonb_build_array(line);
  end loop;
  if jsonb_typeof(p_extras) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_extras))<>7 then raise exception 'Semua jenis kos tambahan diperlukan'; end if;
  foreach k in array array['packaging','wastage','reprint','labor','shipping','ads','affiliate'] loop
    v:=p_extras->k; amount:=finance.cost_number(v->'amount');
    if coalesce(v->>'mode','') not in ('actual','estimated','allocated') then raise exception 'Status kos tambahan tidak sah'; end if;
    all_actual:=all_actual and v->>'mode'='actual';
    new_extras:=new_extras||jsonb_build_object(k,jsonb_build_object('amount',amount,'mode',v->>'mode'));
  end loop;
  if coalesce(p_reviewed,false) and not all_actual then raise exception 'Kos sebenar diperlukan sebelum sahkan semua kos'; end if;
  if length(coalesce(p_note,''))>2000 then raise exception 'Catatan maksimum 2000 aksara'; end if;
  insert into finance.marketplace_order_costs(order_id,version,settings_version,source_signature,material_lines,extra_costs,work_minutes,reviewed,note,actor)
  values(p_order_id,coalesce(prev.version,0)+1,coalesce(prev.settings_version,(est->>'settings_version')::bigint),current_basis->>'signature',new_lines,new_extras,
    finance.cost_number(p_work_minutes,true),coalesce(p_reviewed,false),coalesce(p_note,''),p_actor)
  on conflict(order_id) do update set version=excluded.version,source_signature=excluded.source_signature,material_lines=excluded.material_lines,
    extra_costs=excluded.extra_costs,work_minutes=excluded.work_minutes,reviewed=excluded.reviewed,note=excluded.note,actor=excluded.actor,updated_at=clock_timestamp();
  insert into finance.audit_log(actor,action,entity_type,entity_id,before_data,after_data) values(p_actor,'save_order_costs','marketplace_order_costs',p_order_id::text,
    case when prev.order_id is not null then to_jsonb(prev) end,(select to_jsonb(c) from finance.marketplace_order_costs c where order_id=p_order_id));
  return finance.order_profit_row(p_order_id);
end $$;

create function public.finance_import_order_finance(p_orders jsonb,p_shop_id bigint,p_currency text,p_actor text,p_commit boolean default false,p_expected_hash text default null) returns jsonb language plpgsql set search_path='' as $$
declare item jsonb;o public.marketplace_orders%rowtype;fs jsonb;m jsonb;result jsonb:='[]';batchkey text;current_ids jsonb;valid boolean:=true;state text;cnt integer:=0;refs integer:=0;dups integer:=0;
begin
 if p_actor is distinct from 'admin1' then raise exception 'Forbidden';end if;
 if jsonb_typeof(p_orders) is distinct from 'array' or jsonb_array_length(p_orders) not between 1 and 500 or octet_length(p_orders::text)>2000000 then raise exception 'Maksimum 500 order / 2MB satu import';end if;
 if p_shop_id is null or p_currency!~'^[A-Z]{3}$' then raise exception 'Pilih shop dan currency';end if;
 if exists(select 1 from jsonb_array_elements(p_orders)i group by i->>'order_sn' having count(*)>1) then raise exception 'Order ID berulang selepas grouping';end if;
 perform 1 from public.marketplace_orders where provider='shopee' and shop_id=p_shop_id and order_sn in(select i->>'order_sn'from jsonb_array_elements(p_orders)i) order by id for update;
 select coalesce(jsonb_agg(jsonb_build_array(o.id,(select max(id)from finance.order_finance_snapshots where order_id=o.id)) order by o.id),'[]') into current_ids from public.marketplace_orders o where provider='shopee' and shop_id=p_shop_id and order_sn in(select i->>'order_sn'from jsonb_array_elements(p_orders)i);
 batchkey:=md5(p_orders::text||p_shop_id::text||p_currency||current_ids::text);
 if p_commit and batchkey is distinct from p_expected_hash then raise exception 'Data berubah. Preview semula sebelum import';end if;
 for item in select value from jsonb_array_elements(p_orders) loop
  select * into o from public.marketplace_orders where provider='shopee' and shop_id=p_shop_id and order_sn=item->>'order_sn' and coalesce(metadata->>'dashboard_excluded','false')<>'true';
  fs:=finance.order_finance_fields(jsonb_build_object('excel_finance',item->'financials'));m:=finance.order_finance_metrics(fs);
  state:='import';
  if o.id is null then state:='unmatched';valid:=false;
  elsif o.currency is distinct from p_currency then state:='currency_mismatch';valid:=false;
  elsif jsonb_typeof(item->'financials') is distinct from 'object' or fs='{}' or exists(select 1 from jsonb_each(fs)e where e.value->>'role'<>'unmapped' and e.value->'value'<>'null'::jsonb and e.value->>'amount' is null) then state:='invalid';valid:=false;
  elsif exists(select 1 from finance.order_finance_snapshots where order_id=o.id and source='excel' and source_key=md5(item::text||p_currency)) then state:='duplicate';dups:=dups+1;
  elsif exists(select 1 from public.marketplace_order_financials where order_id=o.id and last_enriched_at is not null) then state:='reference_only';refs:=refs+1;
  elsif m->>'provider_nett' is null then
   if m->>'reconstructed_nett' is null or jsonb_array_length(m->'issues')>0 then state:='needs_mapping';valid:=false;
   else m:=m||jsonb_build_object('provider_nett',m->'reconstructed_nett','reconciliation','report_estimate');end if;
  end if;
  result:=result||jsonb_build_array(jsonb_build_object('order_sn',item->>'order_sn','order_id',o.id,'state',state,'nett',m->'provider_nett','metrics',m));
 end loop;
 if p_commit then
  if not valid then raise exception 'Selesaikan semua baris tidak sah / tidak sepadan';end if;
  for item in select value from jsonb_array_elements(p_orders)loop
   select * into o from public.marketplace_orders where provider='shopee' and shop_id=p_shop_id and order_sn=item->>'order_sn';
   fs:=finance.order_finance_fields(jsonb_build_object('excel_finance',item->'financials'));m:=finance.order_finance_metrics(fs);
   if m->>'provider_nett' is null and m->>'reconstructed_nett' is not null and jsonb_array_length(m->'issues')=0 then m:=m||jsonb_build_object('provider_nett',m->'reconstructed_nett','reconciliation','report_estimate');end if;
   insert into finance.order_finance_snapshots(order_id,source,source_key,fields,metrics,actor)values(o.id,'excel',md5(item::text||p_currency),fs,m,p_actor)on conflict do nothing;
   if found then cnt:=cnt+1;end if;
  end loop;
  insert into finance.audit_log(actor,action,entity_type,entity_id,after_data)values(p_actor,'import_order_finance','finance_import',batchkey,jsonb_build_object('rows',jsonb_array_length(p_orders),'inserted',cnt,'reference_only',refs));
 end if;
 return jsonb_build_object('hash',batchkey,'valid',valid,'rows',result,'inserted',cnt,'reference_only',refs,'duplicates',dups,'committed',p_commit);
end $$;
-- Private helpers and RPCs are service-only; finance-admin performs owner/permission validation.
revoke all on function finance.order_finance_catalog(),finance.provider_number(jsonb),finance.order_finance_fields(jsonb),finance.fa(jsonb,text),finance.order_finance_metrics(jsonb),finance.capture_order_finance(uuid),finance.capture_order_finance_after_update(),finance.order_profit_base(uuid),finance.order_profit_row(uuid),finance.order_report_rows(jsonb) from public,anon,authenticated;
grant execute on function finance.order_finance_catalog(),finance.provider_number(jsonb),finance.order_finance_fields(jsonb),finance.fa(jsonb,text),finance.order_finance_metrics(jsonb),finance.capture_order_finance(uuid),finance.order_profit_base(uuid),finance.order_profit_row(uuid),finance.order_report_rows(jsonb) to service_role;
revoke all on function public.finance_order_report(jsonb,boolean),public.finance_order_finance_options(),public.finance_import_order_finance(jsonb,bigint,text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.finance_order_report(jsonb,boolean),public.finance_order_finance_options(),public.finance_import_order_finance(jsonb,bigint,text,text,boolean,text) to service_role;
notify pgrst,'reload schema';
