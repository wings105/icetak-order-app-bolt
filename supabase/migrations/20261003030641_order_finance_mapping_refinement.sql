create or replace function finance.order_finance_catalog() returns jsonb language sql immutable set search_path='' as $$select '{"buyer_paid_shipping_fee": {"label": "Shipping pembeli", "group": "shipping", "role": "reference"}, "estimated_shipping_fee": {"label": "Shipping anggaran", "group": "shipping", "role": "reference"}, "actual_shipping_fee": {"label": "Shipping sebenar", "group": "shipping", "role": "reference"}, "final_shipping_fee": {"label": "Shipping final (alternatif)", "group": "shipping", "role": "reference"}, "shopee_shipping_rebate": {"label": "Rebat shipping Shopee", "group": "shipping", "role": "reference"}, "shipping_fee_sst": {"label": "SST shipping", "group": "shipping", "role": "reference"}, "seller_shipping_discount": {"label": "Diskaun shipping seller", "group": "shipping", "role": "reference"}, "shipping_fee_discount_from_3pl": {"label": "Diskaun courier", "group": "shipping", "role": "reference"}, "reverse_shipping_fee": {"label": "Reverse shipping", "group": "returns", "role": "deduction"}, "reverse_shipping_fee_sst": {"label": "SST reverse shipping", "group": "returns", "role": "deduction"}, "final_return_to_seller_shipping_fee": {"label": "Return to seller shipping", "group": "returns", "role": "deduction"}, "return_to_seller_shipping_fee_sst": {"label": "SST return to seller", "group": "returns", "role": "deduction"}, "return_handling_fee": {"label": "Return handling", "group": "returns", "role": "deduction"}, "overseas_return_service_fee": {"label": "Overseas return", "group": "returns", "role": "deduction"}, "seller_return_refund": {"label": "Refund / pembatalan barang", "group": "returns", "role": "signed"}, "drc_adjustable_refund": {"label": "Refund pelarasan", "group": "returns", "role": "signed"}, "commission_fee": {"label": "Commission", "group": "fees", "role": "deduction"}, "service_fee": {"label": "Service fee", "group": "fees", "role": "deduction"}, "seller_transaction_fee": {"label": "Transaction fee", "group": "fees", "role": "deduction"}, "ads_escrow_top_up_fee_or_technical_support_fee": {"label": "Ads Escrow Top Up / Technical Support", "group": "fees", "role": "deduction"}, "order_ams_commission_fee": {"label": "Affiliate AMS", "group": "fees", "role": "deduction"}, "campaign_fee": {"label": "Campaign fee", "group": "fees", "role": "deduction"}, "seller_order_processing_fee": {"label": "Order processing", "group": "fees", "role": "deduction"}, "fbs_fee": {"label": "FBS", "group": "fees", "role": "deduction"}, "sspl_fee": {"label": "SSPL", "group": "fees", "role": "deduction"}, "pay_per_sale": {"label": "Pay per sale", "group": "fees", "role": "deduction"}, "shipping_seller_protection_fee_amount": {"label": "Shipping protection", "group": "fees", "role": "deduction"}, "lff_seller_protection_fee_amount": {"label": "Seller protection", "group": "fees", "role": "deduction"}, "delivery_seller_protection_fee_premium_amount": {"label": "Delivery protection", "group": "fees", "role": "deduction"}, "credit_card_transaction_fee": {"label": "Credit card transaction (alternatif)", "group": "fees", "role": "alternative"}, "seller_discount": {"label": "Diskaun seller dalam harga", "group": "discounts", "role": "seller"}, "order_seller_discount": {"label": "Diskaun order seller", "group": "discounts", "role": "seller"}, "voucher_from_seller": {"label": "Voucher seller", "group": "discounts", "role": "seller"}, "seller_coin_cash_back": {"label": "Coin cashback seller", "group": "discounts", "role": "seller"}, "seller_bundle_discount": {"label": "Bundle seller", "group": "discounts", "role": "seller"}, "seller_rebate": {"label": "Rebat seller", "group": "discounts", "role": "seller"}, "shopee_discount": {"label": "Diskaun Shopee", "group": "discounts", "role": "platform"}, "original_shopee_discount": {"label": "Diskaun Shopee asal", "group": "discounts", "role": "platform"}, "voucher_from_shopee": {"label": "Voucher Shopee", "group": "discounts", "role": "platform"}, "coins": {"label": "Shopee coins", "group": "discounts", "role": "platform"}, "shopee_coin_cash_back": {"label": "Coin cashback Shopee", "group": "discounts", "role": "platform"}, "voucher_from_external_party": {"label": "Voucher pihak luar", "group": "discounts", "role": "platform"}, "shopee_bundle_discount": {"label": "Bundle Shopee", "group": "discounts", "role": "platform"}, "payment_promotion": {"label": "Payment promotion", "group": "discounts", "role": "platform"}, "credit_card_promotion": {"label": "Credit card promotion", "group": "discounts", "role": "platform"}, "original_cost_of_goods_sold": {"label": "Nilai barang asal", "group": "goods", "role": "reference"}, "cost_of_goods_sold": {"label": "Nilai barang", "group": "goods", "role": "reference"}, "original_price": {"label": "Harga asal", "group": "goods", "role": "reference"}, "order_original_price": {"label": "Harga asal order", "group": "goods", "role": "reference"}, "order_selling_price": {"label": "Harga jual order", "group": "goods", "role": "reference"}, "order_discounted_price": {"label": "Harga selepas diskaun", "group": "goods", "role": "reference"}, "returned_quantity": {"label": "Kuantiti dipulangkan", "group": "goods", "role": "reference"}, "escrow_amount": {"label": "Escrow nett", "group": "settlement", "role": "reference"}, "escrow_amount_after_adjustment": {"label": "Escrow selepas pelarasan", "group": "settlement", "role": "reference"}, "released_amount": {"label": "Nett dilepaskan", "group": "settlement", "role": "reference"}, "total_adjustment_amount": {"label": "Jumlah pelarasan", "group": "settlement", "role": "reference"}, "seller_lost_compensation": {"label": "Pampasan hilang", "group": "adjustments", "role": "credit"}, "fsf_seller_protection_fee_claim_amount": {"label": "Tuntutan perlindungan shipping", "group": "adjustments", "role": "credit"}, "rsf_seller_protection_fee_claim_amount": {"label": "Tuntutan perlindungan return", "group": "adjustments", "role": "credit"}, "escrow_tax": {"label": "Escrow Tax", "group": "taxes", "role": "reference"}, "escrow_import_tax": {"label": "Escrow Import Tax", "group": "taxes", "role": "reference"}, "withholding_tax": {"label": "Withholding Tax", "group": "taxes", "role": "reference"}, "cross_border_tax": {"label": "Cross Border Tax", "group": "taxes", "role": "reference"}, "sales_tax_on_lvg": {"label": "Sales Tax On Lvg", "group": "taxes", "role": "reference"}, "withholding_cit_tax": {"label": "Withholding Cit Tax", "group": "taxes", "role": "reference"}, "withholding_pit_tax": {"label": "Withholding Pit Tax", "group": "taxes", "role": "reference"}, "withholding_vat_tax": {"label": "Withholding Vat Tax", "group": "taxes", "role": "reference"}, "final_product_vat_tax": {"label": "Final Product Vat Tax", "group": "taxes", "role": "reference"}, "vat_on_imported_goods": {"label": "Vat On Imported Goods", "group": "taxes", "role": "reference"}, "final_shipping_vat_tax": {"label": "Final Shipping Vat Tax", "group": "taxes", "role": "reference"}, "final_escrow_product_gst": {"label": "Final Escrow Product Gst", "group": "taxes", "role": "reference"}, "final_escrow_shipping_gst": {"label": "Final Escrow Shipping Gst", "group": "taxes", "role": "reference"}, "th_import_duty": {"label": "Th Import Duty", "group": "taxes", "role": "reference"}, "buyer_total_amount": {"label": "Jumlah pembeli bayar", "group": "buyer", "role": "reference"}, "total_amount": {"label": "Jumlah order laporan", "group": "buyer", "role": "reference"}}'::jsonb$$;
create or replace function public.finance_import_order_finance(p_orders jsonb,p_shop_id bigint,p_currency text,p_actor text,p_commit boolean default false,p_expected_hash text default null) returns jsonb language plpgsql set search_path='' as $$
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
   if m->>'reconstructed_nett' is null or jsonb_array_length(m->'issues')>0 then state:='incomplete_finance';
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
create or replace function finance.order_material_basis(p_order_id uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('signature',md5(coalesce(jsonb_agg(jsonb_build_array(i.line_no,i.item_sku,i.variation_sku,i.title,i.quantity,i.line_subtotal,i.unit_discounted_price,i.unit_original_price) order by i.line_no,i.id),'[]'::jsonb)::text),
    'items',coalesce(jsonb_agg(jsonb_build_object('line_no',i.line_no,'sku',coalesce(nullif(i.variation_sku,''),i.item_sku,''),'parent_sku',i.item_sku,
      'title',i.title,'variation',i.variation_name,'quantity',i.quantity,
      'goods_value',case when exists(select 1 from public.marketplace_orders o where o.id=p_order_id and (upper(o.current_status)~'(CANCEL|RETURN|REFUND)' or upper(o.payment_status)~'(REFUND|VOID)')) then coalesce(i.quantity*coalesce(i.unit_discounted_price,i.unit_original_price),i.line_subtotal) else coalesce(i.line_subtotal,i.quantity*coalesce(i.unit_discounted_price,i.unit_original_price)) end) order by i.line_no,i.id),'[]'::jsonb))
  from public.marketplace_order_items i where i.order_id=p_order_id and i.is_current;
$$;

create or replace function finance.order_finance_metrics(f jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
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
 'return_shipping',ret,'fee_total',case when fee_known then fees end,'refund_total',case when refund is not null then abs(refund) end,'seller_promotion',case when finance.fa(f,'voucher_from_seller') is not null and finance.fa(f,'seller_coin_cash_back') is not null then promo end,
 'platform_ads',finance.fa(f,'ads_escrow_top_up_fee_or_technical_support_fee'),'affiliate',finance.fa(f,'order_ams_commission_fee'),
 'provider_nett',nett,'reconstructed_nett',calc,'reconciliation_delta',delta,'reconciliation',recon,'issues',issues,'reasons',reasons,
 'field_count',(select count(*) from jsonb_object_keys(f)));
end $$;
create or replace function public.finance_order_report(p_filter jsonb default '{}',p_export boolean default false) returns jsonb language plpgsql stable set search_path='' as $$
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
 'shipping_loss',sum(least((r->'finance_metrics'->>'shipping_net')::numeric,0))filter(where r->'finance_metrics'->>'shipping_net' is not null),'return_shipping',sum((r->'finance_metrics'->>'return_shipping')::numeric),
 'fees',sum((r->'finance_metrics'->>'fee_total')::numeric),'refunds',sum((r->'finance_metrics'->>'refund_total')::numeric),'platform_ads',sum((r->'finance_metrics'->>'platform_ads')::numeric),'affiliate',sum((r->'finance_metrics'->>'affiliate')::numeric),
 'reconciliation_issues',count(*)filter(where r->>'finance_source'<>'missing' and r->'finance_metrics'->>'reconciliation'<>'matched'))) into res from filtered;
 return res;
end $$;
notify pgrst,'reload schema';
