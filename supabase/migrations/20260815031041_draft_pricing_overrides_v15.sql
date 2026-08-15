create or replace function public.icetak_apply_draft_price_overrides_v15(p_payload jsonb)
returns jsonb
language plpgsql
stable
set search_path to 'public','pg_temp'
as $function$
declare
  v jsonb:=coalesce(p_payload,'{}'::jsonb);
  out_items jsonb:='[]'::jsonb;
  item jsonb;
  catalog_price numeric;
  deal_price numeric;
  final_price numeric;
  reason text;
  adj jsonb:=coalesce(v->'price_adjustments','{}'::jsonb);
  addon numeric:=0;
  discount_value numeric:=0;
  rounding numeric:=0;
  discount_type text:=lower(coalesce(adj->>'discount_type','amount'));
begin
  for item in select value from jsonb_array_elements(case when jsonb_typeof(coalesce(v->'items','[]'::jsonb))='array' then coalesce(v->'items','[]'::jsonb) else '[]'::jsonb end)
  loop
    begin catalog_price:=greatest(0,coalesce(nullif(item->>'price','')::numeric,0)); exception when others then catalog_price:=0; end;
    deal_price:=null;
    if item ? 'seller_deal_price' and nullif(btrim(coalesce(item->>'seller_deal_price','')),'') is not null then
      begin deal_price:=(item->>'seller_deal_price')::numeric; exception when others then deal_price:=null; end;
      if deal_price is not null and deal_price<0 then deal_price:=null; end if;
    end if;
    final_price:=coalesce(deal_price,catalog_price);
    reason:=left(btrim(coalesce(item->>'price_reason','')),240);
    item:=item||jsonb_build_object(
      'catalog_price',round(catalog_price,2),
      'seller_deal_price',case when deal_price is null then null else round(deal_price,2) end,
      'price_reason',reason,
      'price',round(final_price,2),
      'customization',coalesce(item->'customization','{}'::jsonb)||jsonb_build_object('pricing',jsonb_build_object(
        'catalog_price',round(catalog_price,2),
        'seller_deal_price',case when deal_price is null then null else round(deal_price,2) end,
        'price_reason',reason,
        'price_source',case when deal_price is null then 'catalog' else 'seller_deal' end
      ))
    );
    out_items:=out_items||jsonb_build_array(item);
  end loop;
  begin addon:=greatest(0,coalesce(nullif(adj->>'custom_addon','')::numeric,0)); exception when others then addon:=0; end;
  begin discount_value:=greatest(0,coalesce(nullif(adj->>'discount_value','')::numeric,0)); exception when others then discount_value:=0; end;
  begin rounding:=coalesce(nullif(adj->>'rounding','')::numeric,0); exception when others then rounding:=0; end;
  if discount_type not in ('amount','percent') then discount_type:='amount'; end if;
  if discount_type='percent' then discount_value:=least(discount_value,100); end if;
  v:=jsonb_set(v,'{items}',out_items,true);
  v:=jsonb_set(v,'{price_adjustments}',jsonb_build_object(
    'custom_addon',round(addon,2),'custom_addon_reason',left(btrim(coalesce(adj->>'custom_addon_reason','')),240),
    'discount_type',discount_type,'discount_value',round(discount_value,2),'discount_reason',left(btrim(coalesce(adj->>'discount_reason','')),240),
    'rounding',round(rounding,2),'rounding_reason',left(btrim(coalesce(adj->>'rounding_reason','')),240)
  ),true);
  return v;
end
$function$;

create or replace function public.icetak_enrich_draft_quick_order_v13(p_payload jsonb)
returns jsonb language sql stable set search_path to 'public','pg_temp'
as $function$
  select public.icetak_apply_draft_price_overrides_v15(public.icetak_clean_draft_address_v14(public.icetak_enrich_draft_quick_order_v14_core(p_payload)));
$function$;

create or replace function public.icetak_qrpay_draft_totals(p_payload jsonb)
returns jsonb
language plpgsql
immutable
set search_path to 'public','pg_temp'
as $function$
declare
  item jsonb; qty int; catalog_price numeric; final_price numeric; deal_price numeric;
  catalog_subtotal numeric:=0; item_subtotal numeric:=0; shipping_fee numeric:=0; addon numeric:=0;
  discount_value numeric:=0; discount_amount numeric:=0; discount_type text:='amount'; rounding numeric:=0;
  subtotal_after_adjustments numeric:=0; draft_total numeric:=0;
  adj jsonb:=coalesce(p_payload->'price_adjustments','{}'::jsonb);
begin
  for item in select value from jsonb_array_elements(case when jsonb_typeof(coalesce(p_payload->'items','[]'::jsonb))='array' then coalesce(p_payload->'items','[]'::jsonb) else '[]'::jsonb end)
  loop
    begin qty:=greatest(coalesce(nullif(item->>'qty','')::int,1),1); exception when others then qty:=1; end;
    begin catalog_price:=greatest(0,coalesce(nullif(item->>'catalog_price','')::numeric,nullif(item->>'price','')::numeric,0)); exception when others then catalog_price:=0; end;
    deal_price:=null;
    if item ? 'seller_deal_price' and nullif(btrim(coalesce(item->>'seller_deal_price','')),'') is not null then
      begin deal_price:=(item->>'seller_deal_price')::numeric; exception when others then deal_price:=null; end;
      if deal_price is not null and deal_price<0 then deal_price:=null; end if;
    end if;
    final_price:=coalesce(deal_price,catalog_price);
    catalog_subtotal:=catalog_subtotal+(catalog_price*qty);
    item_subtotal:=item_subtotal+(final_price*qty);
  end loop;
  begin shipping_fee:=greatest(0,coalesce(nullif(p_payload->>'delivery_fee','')::numeric,0)); exception when others then shipping_fee:=0; end;
  begin addon:=greatest(0,coalesce(nullif(adj->>'custom_addon','')::numeric,0)); exception when others then addon:=0; end;
  discount_type:=lower(coalesce(adj->>'discount_type','amount')); if discount_type not in ('amount','percent') then discount_type:='amount'; end if;
  begin discount_value:=greatest(0,coalesce(nullif(adj->>'discount_value','')::numeric,0)); exception when others then discount_value:=0; end;
  if discount_type='percent' then discount_value:=least(discount_value,100); discount_amount:=round((item_subtotal+addon)*discount_value/100,2); else discount_amount:=least(discount_value,item_subtotal+addon); end if;
  begin rounding:=coalesce(nullif(adj->>'rounding','')::numeric,0); exception when others then rounding:=0; end;
  catalog_subtotal:=round(catalog_subtotal,2); item_subtotal:=round(item_subtotal,2); addon:=round(addon,2); discount_amount:=round(discount_amount,2); shipping_fee:=round(shipping_fee,2); rounding:=round(rounding,2);
  subtotal_after_adjustments:=round(greatest(0,item_subtotal+addon-discount_amount),2);
  draft_total:=round(greatest(0,subtotal_after_adjustments+shipping_fee+rounding),2);
  return jsonb_build_object('catalog_subtotal',catalog_subtotal,'item_subtotal',item_subtotal,'custom_addon',addon,'discount_type',discount_type,'discount_value',round(discount_value,2),'discount_amount',discount_amount,'subtotal_after_adjustments',subtotal_after_adjustments,'shipping_fee',shipping_fee,'rounding',rounding,'draft_total',draft_total);
end
$function$;

alter table public.orders add column if not exists pricing_adjustments jsonb not null default '{}'::jsonb;

create or replace function public.icetak_sync_confirmed_draft_pricing_v15()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
declare totals jsonb;
begin
  if new.status='confirmed' and new.order_id is not null then
    totals:=public.icetak_qrpay_draft_totals(coalesce(new.working_draft,'{}'::jsonb));
    update public.orders set total=(totals->>'draft_total')::numeric,delivery_fee=(totals->>'shipping_fee')::numeric,
      pricing_adjustments=coalesce(new.working_draft->'price_adjustments','{}'::jsonb)||jsonb_build_object('catalog_subtotal',(totals->>'catalog_subtotal')::numeric,'item_subtotal',(totals->>'item_subtotal')::numeric,'custom_addon',(totals->>'custom_addon')::numeric,'discount_type',totals->>'discount_type','discount_value',(totals->>'discount_value')::numeric,'discount_amount',(totals->>'discount_amount')::numeric,'shipping_fee',(totals->>'shipping_fee')::numeric,'rounding',(totals->>'rounding')::numeric,'final_total',(totals->>'draft_total')::numeric,'source','draft_pricing_v15'),updated_at=now() where id=new.order_id;
    with src as (select ord::int rn,item from jsonb_array_elements(coalesce(new.working_draft->'items','[]'::jsonb)) with ordinality x(item,ord)), dst as (select id,row_number() over(order by sort_index nulls last,updated_at,id)::int rn from public.order_items where order_id=new.order_id)
    update public.order_items oi set price=coalesce(nullif(src.item->>'seller_deal_price','')::numeric,nullif(src.item->>'price','')::numeric,oi.price),customization=coalesce(oi.customization,'{}'::jsonb)||jsonb_build_object('pricing',jsonb_build_object('catalog_price',coalesce(nullif(src.item->>'catalog_price','')::numeric,nullif(src.item->>'price','')::numeric,oi.price),'seller_deal_price',case when nullif(src.item->>'seller_deal_price','') is null then null else (src.item->>'seller_deal_price')::numeric end,'price_reason',coalesce(src.item->>'price_reason',''),'price_source',case when nullif(src.item->>'seller_deal_price','') is null then 'catalog' else 'seller_deal' end)),updated_at=now() from src join dst on dst.rn=src.rn where oi.id=dst.id;
  end if;
  return new;
end
$function$;

drop trigger if exists trg_sync_confirmed_draft_pricing_v15 on public.qrpay_order_drafts;
create trigger trg_sync_confirmed_draft_pricing_v15 after insert or update of status,order_id,working_draft on public.qrpay_order_drafts for each row execute function public.icetak_sync_confirmed_draft_pricing_v15();
