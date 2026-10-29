-- Physical counts reconcile past prepared/fulfilled usage; future orders retain reservations.
select pg_advisory_xact_lock(hashtextextended('stock:writer',0));

-- A confirmed raw-material count already includes usage completed before that count.
-- Rates are not inferred: only the material identity and physical cutoff are checked.
create or replace function stock.count_covers_order(p_input jsonb,p_evidence timestamptz)
returns boolean language plpgsql stable security invoker set search_path='' as $covers$
declare line jsonb; ov stock.item_rules%rowtype; m stock.materials%rowtype;
 cat text; v_colour text; tape_count timestamptz;
begin
 if p_evidence is null or p_evidence>now() or not coalesce((p_input->>'detail_complete')::boolean,false)
 or jsonb_array_length(coalesce(p_input->'lines','[]'::jsonb))=0 then return false;end if;
 for line in select value from jsonb_array_elements(p_input->'lines') loop
  if coalesce(line->>'quantity','')!~'^[0-9]+$' or (line->>'quantity')::numeric<=0 then return false;end if;
  select * into ov from stock.item_rules where match_key=stock.match_key(line);
  if found then
   if ov.manual_only then continue;end if;
   select * into m from stock.materials where code=ov.material_code and auto_eligible;
  else
   cat:=line->>'category';
   if cat='acrylic' then
    v_colour:=coalesce(stock.colour_name(line->>'style'),stock.colour_name(split_part(coalesce(line->>'variation',''),',',1)),finance.acrylic_colour(line->>'variation',line->>'sku',line->>'title'));
    if v_colour is null then return false;end if;
    select * into m from stock.materials where category='acrylic' and materials.colour=v_colour and auto_eligible;
   elsif cat in ('edible','wafer','glossy','artpaper_gold') then
    select * into m from stock.materials where category=cat and is_default and auto_eligible;
   else return false;end if;
  end if;
  if m.code is null or m.counted_at is null or m.counted_at<p_evidence then return false;end if;
  if m.category='glossy' then
   select counted_at into tape_count from stock.materials where category='double_tape' and is_default;
   if tape_count is null or tape_count<p_evidence then return false;end if;
  end if;
 end loop;
 return true;
end $covers$;
revoke all on function stock.count_covers_order(jsonb,timestamptz) from public,anon,authenticated;
grant execute on function stock.count_covers_order(jsonb,timestamptz) to service_role;


CREATE OR REPLACE FUNCTION stock.order_input(p_source text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare o public.orders%rowtype; mp public.marketplace_orders%rowtype; stage text; evidence timestamptz;
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
     'provider_item_id',i.provider_item_id,'provider_variation_id',i.provider_variation_id,'variation',i.variation_name,'size',i.variation_name,'style',i.variation_name,'quantity',i.quantity);
    lines:=lines||jsonb_build_array(v);
   end loop;
  end loop;
  return jsonb_build_object('source',p_source,'order_id',p_id,'reference',mp.order_sn,'linked_order_id',mp.internal_order_id,'stage',stage,'evidence_at',evidence,'created_at',mp.placed_at,'lines',lines,'detail_complete',mp.detail_complete);
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
   v:=jsonb_build_object('source','icetak','line_key',i.id::text,'part',part,'category',part,'title',i.title,'sku',i.product_snapshot->>'sku','product_id',i.product_id,'size',sz,'style',sty,'quantity',i.qty);
   lines:=lines||jsonb_build_array(v);
  end loop;
 end loop;
 return jsonb_build_object('source',p_source,'order_id',p_id,'reference',coalesce(o.order_no,o.order_id,o.id::text),'stage',stage,'evidence_at',evidence,'created_at',o.created_at,'prepared_at',case when lower(coalesce(o.delivery_method,o.delivery,'')) like '%pickup%' and (o.pickup_collected_at is not null or lower(coalesce(o.fulfillment_stage,'')) in ('ready_for_pickup','collected') or lower(coalesce(o.status,'')) in ('ready for pickup','customer collected')) then coalesce(o.pickup_ready_at,o.pickup_collected_at) end,'lines',lines,'detail_complete',true);
end $function$;

CREATE OR REPLACE FUNCTION stock.process_order(p_source text, p_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare input jsonb; st stock.order_state%rowtype; line jsonb; result jsonb; desired jsonb:='[]'; has_error boolean:=false; input_hash text; first_evidence timestamptz; cfg stock.settings%rowtype; stage text; physical_evidence timestamptz; pending_codes jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('stock:'||p_source||':'||p_id::text,0));
 select * into cfg from stock.settings where singleton;
 if not cfg.enabled then return 'blocked'; end if;
 input:=stock.order_input(p_source,p_id);
 if input is null or input ? 'ignored' then return 'done'; end if;
 if input ? 'redirect' then
  if stock.reconcile_link((input->>'redirect')::uuid,p_id)='blocked' then return 'blocked';end if;
  perform stock.enqueue('shopee',(input->>'redirect')::uuid);return 'done';
 end if;
 if nullif(input->>'linked_order_id','') is not null then
  if stock.reconcile_link(p_id,(input->>'linked_order_id')::uuid)='blocked' then return 'blocked';end if;
 end if;
 stage:=input->>'stage';
 select * into st from stock.order_state where source=p_source and order_id=p_id;
 if st.excluded_at is not null then return 'done';end if;
 if not found then
  if stage not in ('to_ship','consume') then return 'done';end if;
  if stage='consume' and ((input->>'created_at') is null or (input->>'created_at')::timestamptz<cfg.started_at) then return 'done';end if;
  insert into stock.order_state(source,order_id,reference,stage,evidence_at) values(p_source,p_id,input->>'reference',stage,(input->>'evidence_at')::timestamptz);
 end if;
 input_hash:=stock.input_hash(input);
 if st.consumed_at is not null and st.source_hash=input_hash then return 'done';end if;
 first_evidence:=least(st.first_consume_evidence,(input->>'evidence_at')::timestamptz); if stage='consume' and st.first_consume_evidence is distinct from first_evidence then update stock.order_state set first_consume_evidence=first_evidence where source=p_source and order_id=p_id;end if;
 -- Reconcile only enrolled, unconsumed work against confirmed physical counts.
 physical_evidence:=least(first_evidence,nullif(input->>'prepared_at','')::timestamptz);
 if st.consumed_at is null and stage in ('to_ship','consume')
 and (stage='consume' or nullif(input->>'prepared_at','') is not null)
 and stock.count_covers_order(input,physical_evidence) then
  perform stock.apply_order(p_source,p_id,'excluded','[]',null);
  update stock.order_state set excluded_at=now(),source_hash=input_hash,review='Penggunaan telah termasuk dalam kiraan fizikal bahan',updated_at=now() where source=p_source and order_id=p_id;
  update stock.issues set resolved_at=now() where source=p_source and order_id=p_id and resolved_at is null;
  insert into stock.audit(action,actor,target,details) values('counted_order_reconciled','system',p_source||':'||p_id::text,jsonb_build_object('reference',input->>'reference','physical_evidence_at',physical_evidence,'reason','All identified materials were physically counted after preparation/fulfillment. No second deduction.'));
  return 'done';
 end if;
 if stage='consume' then
  -- Fulfilled usage awaiting mapping is not a future reservation.
  if st.consumed_at is null and exists(select 1 from stock.allocations where source=p_source and order_id=p_id and state='reserved') then
   perform stock.apply_order(p_source,p_id,'waiting','[]',null);
  end if;
  update stock.order_state set stage='consume',evidence_at=first_evidence,updated_at=now() where source=p_source and order_id=p_id;
 end if;
 update stock.issues set resolved_at=now() where source=p_source and order_id=p_id and resolved_at is null and code not in ('shortage','after_dispatch_edit');
 if stage='cancelled' then return stock.apply_order(p_source,p_id,stage,'[]',null);end if;
 if stage='waiting' then return stock.apply_order(p_source,p_id,stage,'[]',null);end if;
 if jsonb_array_length(input->'lines')=0 or not coalesce((input->>'detail_complete')::boolean,false) then
  if jsonb_array_length(input->'lines')=0 and coalesce((input->>'detail_complete')::boolean,false) then perform stock.apply_order(p_source,p_id,'to_ship','[]',null);end if;
  perform stock.issue(p_source,p_id,'','details_needed','Detail item order belum lengkap. Sistem akan cuba selepas detail masuk.');return 'blocked';
 end if;
 for line in select value from jsonb_array_elements(input->'lines') loop
  result:=stock.resolve_line(line);
  if result ? 'error' then
   has_error:=true;perform stock.issue(p_source,p_id,line->>'line_key','mapping_needed',result->>'error',line||result);
  else desired:=desired||(result->'allocations');end if;
 end loop;
 if has_error and st.consumed_at is null and stage='to_ship' then
  -- Reserve the known lines; never retain a removed or now-unmapped colour as if still selected.
  perform stock.apply_order(p_source,p_id,'to_ship',desired,null);
 end if;
 if stage='consume' and has_error and jsonb_array_length(desired)>0 then
  select jsonb_agg(distinct d->>'material_code') into pending_codes from jsonb_array_elements(desired) d;
  perform stock.issue(p_source,p_id,'','consumption_pending','Order sudah siap/dihantar. Penggunaan bahan menunggu padanan item lain; bukan reserve baru.',jsonb_build_object('material_codes',pending_codes,'allocations',desired));
 end if;
 if has_error then update stock.order_state set stage=input->>'stage',review='Mapping belum lengkap',updated_at=now() where source=p_source and order_id=p_id;return 'blocked';end if;
 if exists(select 1 from jsonb_array_elements(desired) d group by d->>'line_key',d->>'part',d->>'material_code' having count(*)>1) then raise exception 'DUPLICATE_ALLOCATION';end if;
 result:=jsonb_build_object('status',stock.apply_order(p_source,p_id,stage,desired,first_evidence));
 if result->>'status'='blocked' and stage='consume' and st.consumed_at is null then
  select jsonb_agg(distinct d->>'material_code') into pending_codes from jsonb_array_elements(desired) d;
  perform stock.issue(p_source,p_id,'','consumption_pending','Order sudah siap/dihantar. Semak penggunaan bahan terhadap kiraan fizikal.',jsonb_build_object('material_codes',pending_codes,'allocations',desired));
 end if;
 if result->>'status'='done' then update stock.order_state set source_hash=input_hash where source=p_source and order_id=p_id;end if;
 return result->>'status';
end $function$;

do $patch$
declare d text:=btrim(pg_get_functiondef('stock.order_trigger()'::regprocedure), E' \n\r\t');
begin
 if md5(d)<>'6eae5589a8bfe28215f8e5a89e92610c' then raise exception 'Stock function changed since review: stock.order_trigger';end if;
 d:=replace(d,$old$new.pickup_ready_at,new.delivery_method,new.delivery,new.source) is not distinct from row(old.admin_status,old.fulfillment_stage,old.status,old.payment_status,old.customer_confirmed,old.production_approved,old.shipment_status_group,old.shipment_updated_at,old.pickup_ready_at,old.delivery_method$old$,$new$new.pickup_ready_at,new.pickup_collected_at,new.delivery_method,new.delivery,new.source) is not distinct from row(old.admin_status,old.fulfillment_stage,old.status,old.payment_status,old.customer_confirmed,old.production_approved,old.shipment_status_group,old.shipment_updated_at,old.pickup_ready_at,old.pickup_collected_at,old.delivery_method$new$);
 if md5(d)<>'bad1111f3f02c6abbe5f5f842498b7a0' then raise exception 'Stock patch mismatch: stock.order_trigger';end if;
 execute d;
end $patch$;

do $patch$
declare d text:=btrim(pg_get_functiondef('public.icetak_stock_admin(text,jsonb,text)'::regprocedure), E' \n\r\t');
begin
 if md5(d)<>'6cac2e143c86552f344013ba4fabb717' then raise exception 'Stock function changed since review: public.icetak_stock_admin';end if;
 d:=replace(d,$old$if p_action='opening' or auto is distinct from m.auto_enabled then perform stock.wake();end if;$old$,$new$if p_action in ('opening','adjustment') or auto is distinct from m.auto_enabled then perform stock.wake();end if;$new$);
 if md5(d)<>'d5259267f4cb16a402d64b664aa722be' then raise exception 'Stock patch mismatch: public.icetak_stock_admin';end if;
 execute d;
end $patch$;

create or replace view stock.material_health with (security_invoker=true) as
with ledger as (
 select material_code,sum(delta) balance,sum(reserved_delta) reserve from stock.movements group by material_code
), allocations as (
 select material_code,sum(quantity) reserve from stock.allocations where state='reserved' group by material_code
), usage as (
 select m.code,count(distinct(i.source,i.order_id,i.line_key)) pending
 from stock.materials m join stock.issues i on i.resolved_at is null
 and i.code in ('mapping_needed','opening_needed','before_activation','before_count','consumption_pending')
 and (i.details->>'material_code'=m.code or (i.details->'material_codes') ? m.code or i.details->>'category'=m.category
      or (m.category='double_tape' and i.details->>'category'='glossy'))
 group by m.code
), facts as (
 select m.*,m.on_hand-m.reserved available,coalesce(u.pending,0) unresolved_usage,
  (m.reserved<>coalesce(a.reserve,0) or m.reserved<>coalesce(l.reserve,0)
   or (m.on_hand is not null and m.on_hand<>coalesce(l.balance,0))) ledger_mismatch
 from stock.materials m left join ledger l on l.material_code=m.code
 left join allocations a on a.material_code=m.code left join usage u on u.code=m.code
), ranked as (
 select f.*,case when ledger_mismatch then 0 when available<0 then 1 when available=0 then 2
  when available<=minimum then 3 when unresolved_usage>0 then 4
  when on_hand is null and auto_eligible then 5 when auto_eligible and not auto_enabled then 6
  when on_hand is null then 8 else 7 end priority
 from facts f
)
select r.*,case priority when 0 then 'ledger_mismatch' when 1 then 'shortage' when 2 then 'empty'
 when 3 then 'low' when 4 then 'incomplete' when 5 then 'opening_needed'
 when 6 then 'paused' when 8 then 'manual_uncounted' else 'healthy' end health
from ranked r;
revoke all on stock.material_health from public,anon,authenticated;
grant select on stock.material_health to service_role;


create or replace trigger stock_direct_order after insert or update of admin_status,fulfillment_stage,status,payment_status,customer_confirmed,production_approved,shipment_status_group,shipment_updated_at,pickup_ready_at,pickup_collected_at,delivery_method,delivery,source on public.orders for each row execute function stock.order_trigger();
