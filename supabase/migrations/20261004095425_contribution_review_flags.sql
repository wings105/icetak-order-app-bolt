-- Changed item/total/delivery facts require an explicit fresh actual-cost confirmation.
create or replace function finance.direct_margin_row(p_order_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $f$
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
  if not changed then contribution:=round(net-mat-coalesce(c.extras,0),2);end if;
 end if;
 actual:=receipts is not null and c.material is not null and c.material_actual and actual_shipping and c.extras_actual and not changed;
 mode:=case when not paid then 'excluded' when contribution is null then 'incomplete' when actual then 'actual' else 'estimated' end;
 return jsonb_build_object('order_id',o.id,'reference',coalesce(nullif(o.order_no,''),o.order_id,o.id::text),'channel','deco','day',(o.created_at at time zone 'Asia/Kuala_Lumpur')::date,
 'status',o.status,'sales',goods,'customer_paid',case when paid then least(coalesce(receipts,o.total),o.total) else receipts end,
 'shipping_charged',o.delivery_fee,'courier',shipping,'courier_state',case when actual_shipping then 'actual' else 'estimated' end,
 'fee',0,'nett',net,'material',mat,'extras',coalesce(c.extras,0),'contribution',contribution,'margin',case when goods>0 then round(contribution/goods*100,2) end,
 'state',mode,'income_state',case when receipts is not null then 'transaction' when paid then 'paid_status_only' else 'unpaid' end,
 'included',paid,'lines',lines,'reasons',reasons,'version',coalesce(c.version,0),'signature',sig,'settings_version',cfg.version,
 'material_override',c.material,'courier_override',c.courier,'material_actual',coalesce(c.material_actual,false) and not changed,'courier_actual',coalesce(c.courier_actual,false) and not changed,'extras_actual',coalesce(c.extras_actual,false) and not changed,'note',coalesce(c.note,''));
end $f$;
