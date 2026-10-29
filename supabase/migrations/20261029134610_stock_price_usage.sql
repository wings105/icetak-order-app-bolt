-- Owner-confirmed edible standard merchandise value / RM24; private ledger and fulfillment gates retained.
select pg_advisory_xact_lock(hashtextextended('stock:writer',0));

CREATE OR REPLACE FUNCTION stock.order_input(p_source text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare o public.orders%rowtype; mp public.marketplace_orders%rowtype; stage text; evidence timestamptz; prepared timestamptz;
 lines jsonb:='[]'; i record; cat text; part text; parts text[]; v jsonb; sz text; sty text;
begin
 if p_source='shopee' then
  select * into mp from public.marketplace_orders where id=p_id and provider='shopee';
  if not found then return null; end if;
  stage:=case when mp.current_status in ('READY_TO_SHIP','PROCESSED') then 'to_ship'
   when mp.current_status in ('SHIPPED','TO_CONFIRM_RECEIVE','COMPLETED','TO_RETURN','RETURNED') then 'consume'
   when mp.current_status='CANCELLED' then 'cancelled' else 'waiting' end;
  select min(occurred_at) into evidence from public.marketplace_order_status_history
   where order_id=p_id and status in ('SHIPPED','LOGISTICS_PICKUP_DONE','TO_CONFIRM_RECEIVE','LOGISTICS_DELIVERY_DONE','COMPLETED');
  evidence:=coalesce(evidence,mp.latest_provider_update_at);
  for i in select * from public.marketplace_order_items where order_id=p_id and is_current order by line_no,id loop
   cat:=stock.category(null,i.title,coalesce(nullif(i.variation_sku,'.'),i.item_sku));
   parts:=case when cat='burnaway' then array['edible','wafer'] else array[coalesce(cat,'unknown')] end;
   foreach part in array parts loop
    v:=jsonb_build_object('source','shopee','line_key',i.id::text,'part',part,'category',part,'title',i.title,'sku',coalesce(nullif(i.variation_sku,'.'),i.item_sku),
     'provider_item_id',i.provider_item_id,'provider_variation_id',i.provider_variation_id,'variation',i.variation_name,'size',i.variation_name,'style',i.variation_name,'quantity',i.quantity,'currency',mp.currency,'bundled',cat='burnaway',
     'standard_unit_price',case when cat='edible' and lower(i.title) like '%urgent%' and i.unit_original_price in (7,14,28) then i.unit_original_price*6/7 else i.unit_original_price end,'price_basis','original_merchandise');
    lines:=lines||jsonb_build_array(v);
   end loop;
  end loop;
  return jsonb_build_object('source',p_source,'order_id',p_id,'reference',mp.order_sn,'linked_order_id',mp.internal_order_id,'stage',stage,'evidence_at',evidence,'created_at',mp.placed_at,'lines',lines,'detail_complete',mp.detail_complete or (coalesce(mp.metadata->>'stock_items_complete'='true',false) and jsonb_array_length(lines)>0));
 end if;
 select * into o from public.orders where id=p_id;
 if not found then return null; end if;
 -- Shopee's canonical marketplace record exclusively owns its stock effects.
 select * into mp from public.marketplace_orders where internal_order_id=o.id and provider='shopee' order by id limit 1;
 if found then return jsonb_build_object('redirect',mp.id); end if;
 if lower(coalesce(o.source,'')) like '%shopee%' then return jsonb_build_object('ignored','Shopee stock belongs to marketplace order'); end if;
 if lower(concat_ws(' ',o.status,o.admin_status,o.fulfillment_stage)) like '%cancel%' then stage:='cancelled';
 elsif lower(coalesce(o.delivery_method,o.delivery,'')) like '%pickup%' then
  select min(sent_at) into evidence from public.notification_queue where order_id=o.id and event_type in ('order_ready_pickup','order_ready_pickup_auto') and status='sent' and sent_at>=o.pickup_ready_at;
  if o.pickup_collected_at is not null then stage:='consume';evidence:=coalesce(evidence,o.pickup_collected_at);
  elsif o.pickup_ready_at is not null and evidence is not null then stage:='consume';
  elsif o.customer_confirmed or o.production_approved or lower(coalesce(o.payment_status,'')) in ('paid','cash_counter','matched') then stage:='to_ship'; else stage:='waiting'; end if;
 elsif lower(coalesce(o.shipment_status_group,'')) in ('picked_up','accepted_by_courier','in_transit','shipped','out_for_delivery','delivered') then stage:='consume';evidence:=o.shipment_updated_at;
 elsif lower(replace(coalesce(o.status,''),' ','_'))='shipped' then stage:='consume';evidence:=o.updated_at;
 elsif o.customer_confirmed or o.production_approved or lower(coalesce(o.payment_status,'')) in ('paid','cash_counter','matched') then stage:='to_ship'; else stage:='waiting'; end if;
 for i in select * from public.order_items where order_id=o.id order by sort_index,id loop
  cat:=stock.category(coalesce(nullif(i.k,''),i.product_type),i.title,i.product_snapshot->>'sku');
  parts:=case when cat='burnaway' then array['edible','wafer'] else array[coalesce(cat,'unknown')] end;
  foreach part in array parts loop
   sz:=case when cat='burnaway' then coalesce(i.customization#>>array['layers',part,'size'],i.size) else coalesce(nullif(i.customization->>'size',''),i.size) end;
   sty:=case when cat='burnaway' then coalesce(i.customization#>>array['layers',part,'shape'],i.style) else case when cat='acrylic' then coalesce(nullif(i.customization->>'colour',''),nullif(i.customization->>'color',''),i.style) else coalesce(nullif(i.customization->>'shape',''),i.style) end end;
   v:=jsonb_build_object('source','icetak','line_key',i.id::text,'part',part,'category',part,'title',i.title,'sku',i.product_snapshot->>'sku','product_id',i.product_id,'size',sz,'style',sty,'quantity',i.qty,'currency','MYR','bundled',cat='burnaway',
    'standard_unit_price',case when cat='edible' and i.customization->>'admin_process'='Urgent' and i.review_required and i.price=public.icetak_quick_order_price('edible','Urgent',i.size,i.style,'Need Review') then public.icetak_quick_order_price('edible','Pre-order',i.size,i.style,'No Review') else i.price end,'price_basis','saved_merchandise');
   lines:=lines||jsonb_build_array(v);
  end loop;
 end loop;
 -- Completed canonical production establishes only a later-stocktake cutoff, never a shipping deduction.
 if o.production_completed_at is not null
 and exists(select 1 from public.order_items where order_id=o.id)
 and not exists(select 1 from public.order_items oi where oi.order_id=o.id and not exists(
  select 1 from public.production_components pc where pc.order_id=o.id and pc.order_item_id=oi.id))
 and not exists(select 1 from public.production_components pc join public.order_items oi on oi.id=pc.order_item_id and oi.order_id=o.id
  where pc.order_id=o.id and (coalesce(pc.progress_percent,0)<100 or coalesce(pc.progress_stage,0)<7))
 then
  select greatest(o.production_completed_at,max(coalesce(pc.last_synced_at,pc.updated_at))) into prepared
  from public.production_components pc join public.order_items oi on oi.id=pc.order_item_id and oi.order_id=o.id where pc.order_id=o.id;
 end if;
 return jsonb_build_object('source',p_source,'order_id',p_id,'reference',coalesce(o.order_no,o.order_id,o.id::text),'stage',stage,'evidence_at',evidence,'created_at',o.created_at,'prepared_at',least(prepared,case when lower(coalesce(o.delivery_method,o.delivery,'')) like '%pickup%' and (o.pickup_collected_at is not null or lower(coalesce(o.fulfillment_stage,'')) in ('ready_for_pickup','collected') or lower(coalesce(o.status,'')) in ('ready for pickup','customer collected')) then coalesce(o.pickup_ready_at,o.pickup_collected_at) end),'lines',lines,'detail_complete',true);
end $function$;

CREATE OR REPLACE FUNCTION stock.resolve_line(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare r stock.size_rules%rowtype; m stock.materials%rowtype; ov stock.item_rules%rowtype;
 key text:=stock.match_key(p); cat text:=p->>'category'; sz text:=stock.size_key(p->>'size'); shape text:=stock.shape_key(concat_ws(' ',p->>'style',p->>'size'));
 q numeric; rate numeric; unit_price numeric; basis text:='size_rule'; v_colour text; allocations jsonb:='[]'; tape stock.materials%rowtype;
begin
 if coalesce(p->>'quantity','') !~ '^[0-9]+$' or (p->>'quantity')::numeric<=0 then return jsonb_build_object('error','Kuantiti item belum sah','match_key',key); end if;
 q:=(p->>'quantity')::numeric;
 -- Owner confirmed one standard glossy set uses one A4. Explicit custom sizes still need a rule.
 if cat='glossy' and nullif(trim(p->>'size'),'') is null then sz:='1pc';end if;
 select * into ov from stock.item_rules where match_key=key;
 if found then
  if ov.manual_only then return jsonb_build_object('allocations','[]'::jsonb); end if;
  select * into m from stock.materials where code=ov.material_code;
  rate:=ov.rate;basis:='item_rule';
 else
  if cat='edible' and coalesce((p->>'bundled')::boolean,false)=false and p->>'currency'='MYR'
  and coalesce(p->>'standard_unit_price','')~'^[0-9]+([.][0-9]+)?$'
  and (p->>'standard_unit_price')::numeric>0 and (p->>'standard_unit_price')::numeric<=2400 then
   unit_price:=(p->>'standard_unit_price')::numeric;rate:=unit_price/24;basis:='standard_price_rm24';
  else
   select * into r from stock.size_rules where category=cat and size_key=sz and shape_key in (shape,'*') order by (shape_key=shape) desc limit 1;
   if r.approved is not true or r.rate is null then return jsonb_build_object('error','Kadar saiz atau harga standard belum disahkan','match_key',key,'category',cat,'size_key',sz,'shape_key',shape); end if;
   rate:=r.rate;
  end if;
  if cat='acrylic' then
   v_colour:=coalesce(stock.colour_name(p->>'style'),stock.colour_name(split_part(coalesce(p->>'variation',''),',',1)),finance.acrylic_colour(p->>'variation',p->>'sku',p->>'title'));
   if v_colour is null then return jsonb_build_object('error','Warna acrylic belum jelas','match_key',key); end if;
   select * into m from stock.materials where category=cat and colour=v_colour and auto_eligible;
  else select * into m from stock.materials where category=cat and is_default; end if;
 end if;
 if m.code is null or not m.auto_eligible then return jsonb_build_object('error','Bahan auto belum dipadankan','match_key',key,'category',cat,'size_key',sz,'colour',v_colour); end if;
 allocations:=jsonb_build_array(jsonb_build_object('line_key',p->>'line_key','part',p->>'part','material_code',m.code,'quantity',round(rate*q,6),'rate',rate,'match_key',key,'basis',basis,'standard_unit_price',unit_price));
 if m.category='glossy' then
  select * into tape from stock.materials where category='double_tape' and is_default;
  if tape.code is null then return jsonb_build_object('error','Bahan double tape belum dipadankan','match_key',key); end if;
  allocations:=allocations||jsonb_build_array(jsonb_build_object('line_key',p->>'line_key','part',p->>'part','material_code',tape.code,'quantity',round(rate*q,6),'rate',rate,'match_key',key,'basis',basis,'standard_unit_price',unit_price));
 end if;
 return jsonb_build_object('allocations',allocations);
end $function$;

CREATE OR REPLACE FUNCTION stock.order_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if tg_op='UPDATE' then
  if tg_table_name='marketplace_orders' then if row(new.current_status,new.detail_complete,new.internal_order_id,new.placed_at,new.latest_provider_update_at,new.currency) is not distinct from row(old.current_status,old.detail_complete,old.internal_order_id,old.placed_at,old.latest_provider_update_at,old.currency) then return new;end if;end if;
  if tg_table_name='marketplace_order_items' then if row(new.order_id,new.provider_item_id,new.provider_variation_id,new.is_current,new.quantity,new.title,new.variation_name,new.item_sku,new.variation_sku,new.unit_original_price) is not distinct from row(old.order_id,old.provider_item_id,old.provider_variation_id,old.is_current,old.quantity,old.title,old.variation_name,old.item_sku,old.variation_sku,old.unit_original_price) then return new;end if;end if;
  if tg_table_name='orders' then if row(new.admin_status,new.fulfillment_stage,new.status,new.payment_status,new.customer_confirmed,new.production_approved,new.shipment_status_group,new.shipment_updated_at,new.pickup_ready_at,new.pickup_collected_at,new.production_completed_at,new.delivery_method,new.delivery,new.source) is not distinct from row(old.admin_status,old.fulfillment_stage,old.status,old.payment_status,old.customer_confirmed,old.production_approved,old.shipment_status_group,old.shipment_updated_at,old.pickup_ready_at,old.pickup_collected_at,old.production_completed_at,old.delivery_method,old.delivery,old.source) then return new;end if;end if;
  if tg_table_name='order_items' then if row(new.order_id,new.qty,new.size,new.style,new.customization,new.product_type,new.k,new.title,new.product_id,new.product_snapshot->>'sku',new.price) is not distinct from row(old.order_id,old.qty,old.size,old.style,old.customization,old.product_type,old.k,old.title,old.product_id,old.product_snapshot->>'sku',old.price) then return new;end if;end if;
  if tg_table_name='notification_queue' then if row(new.status,new.sent_at) is not distinct from row(old.status,old.sent_at) then return new;end if;end if;
 end if;
 if tg_table_name='marketplace_orders' then if new.provider='shopee' then perform stock.enqueue('shopee',new.id);end if;
 elsif tg_table_name='marketplace_order_status_history' then
  if new.status in ('SHIPPED','LOGISTICS_PICKUP_DONE','TO_CONFIRM_RECEIVE','LOGISTICS_DELIVERY_DONE','COMPLETED') then perform stock.enqueue('shopee',new.order_id);end if;
 elsif tg_table_name='marketplace_order_items' then
  if tg_op='UPDATE' and old.order_id is distinct from new.order_id then perform stock.enqueue('shopee',old.order_id);end if;
  perform stock.enqueue('shopee',case when tg_op='DELETE' then old.order_id else new.order_id end);
 elsif tg_table_name='order_items' then
  if tg_op='UPDATE' and old.order_id is distinct from new.order_id then perform stock.enqueue('icetak',old.order_id);end if;
  perform stock.enqueue('icetak',case when tg_op='DELETE' then old.order_id else new.order_id end);
 elsif tg_table_name='notification_queue' then
  if new.status='sent' and new.sent_at is not null and new.event_type in ('order_ready_pickup','order_ready_pickup_auto') and new.order_id is not null then perform stock.enqueue('icetak',new.order_id);end if;
 else perform stock.enqueue('icetak',new.id);end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $function$;


create or replace trigger stock_direct_order after insert or update of admin_status,fulfillment_stage,status,payment_status,customer_confirmed,production_approved,shipment_status_group,shipment_updated_at,pickup_ready_at,pickup_collected_at,production_completed_at,delivery_method,delivery,source on public.orders for each row execute function stock.order_trigger();
create or replace trigger stock_direct_items after insert or delete or update of order_id,qty,size,style,customization,product_type,k,title,product_id,product_snapshot,price on public.order_items for each row execute function stock.order_trigger();
create or replace trigger stock_marketplace_items after insert or delete or update of order_id,provider_item_id,provider_variation_id,is_current,quantity,title,variation_name,item_sku,variation_sku,unit_original_price on public.marketplace_order_items for each row execute function stock.order_trigger();
create or replace trigger stock_marketplace_order after insert or update of current_status,detail_complete,internal_order_id,placed_at,latest_provider_update_at,currency on public.marketplace_orders for each row execute function stock.order_trigger();
