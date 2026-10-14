select pg_advisory_xact_lock(hashtextextended('stock:writer',0));
create or replace function stock.order_input(p_source text,p_id uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare o public.orders%rowtype; mp public.marketplace_orders%rowtype; stage text; evidence timestamptz;
 lines jsonb:='[]'; i record; cat text; part text; parts text[]; v jsonb; sz text; sty text;
begin
 if p_source='shopee' then
  select * into mp from public.marketplace_orders where id=p_id and provider='shopee';
  if not found then return null; end if;
  stage:=case when mp.current_status in ('READY_TO_SHIP','PROCESSED') then 'to_ship'
   when mp.current_status in ('SHIPPED','TO_CONFIRM_RECEIVE','COMPLETED','TO_RETURN','RETURNED') then 'consume'
   when mp.current_status='CANCELLED' then 'cancelled' else 'waiting' end;
  evidence:=mp.latest_provider_update_at;
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
  select max(sent_at) into evidence from public.notification_queue where order_id=o.id and event_type in ('order_ready_pickup','order_ready_pickup_auto') and status='sent' and sent_at>=o.pickup_ready_at;
  if o.pickup_ready_at is not null and evidence is not null then stage:='consume';
  elsif o.customer_confirmed or o.production_approved or lower(coalesce(o.payment_status,'')) in ('paid','cash_counter','matched') then stage:='to_ship'; else stage:='waiting'; end if;
 elsif lower(coalesce(o.shipment_status_group,'')) in ('picked_up','accepted_by_courier','in_transit','shipped','out_for_delivery','delivered') then stage:='consume';evidence:=o.shipment_updated_at;
 elsif lower(replace(coalesce(o.status,''),' ','_'))='shipped' then stage:='consume';evidence:=o.updated_at;
 elsif o.customer_confirmed or o.production_approved or lower(coalesce(o.payment_status,'')) in ('paid','cash_counter','matched') then stage:='to_ship'; else stage:='waiting'; end if;
 for i in select * from public.order_items where order_id=o.id order by sort_index,id loop
  cat:=stock.category(coalesce(nullif(i.k,''),i.product_type),i.title,i.product_snapshot->>'sku');
  parts:=case when cat='burnaway' then array['edible','wafer'] else array[coalesce(cat,'unknown')] end;
  foreach part in array parts loop
   sz:=case when cat='burnaway' then coalesce(i.customization#>>array['layers',part,'size'],i.size) else coalesce(i.customization->>'size',i.size) end;
   sty:=case when cat='burnaway' then coalesce(i.customization#>>array['layers',part,'shape'],i.style) else coalesce(i.customization->>'colour',i.customization->>'color',i.style) end;
   v:=jsonb_build_object('source','icetak','line_key',i.id::text,'part',part,'category',part,'title',i.title,'sku',i.product_snapshot->>'sku','product_id',i.product_id,'size',sz,'style',sty,'quantity',i.qty);
   lines:=lines||jsonb_build_array(v);
  end loop;
 end loop;
 return jsonb_build_object('source',p_source,'order_id',p_id,'reference',coalesce(o.order_no,o.order_id,o.id::text),'stage',stage,'evidence_at',evidence,'created_at',o.created_at,'lines',lines,'detail_complete',true);
end $$;
create or replace function stock.process_order(p_source text,p_id uuid) returns text language plpgsql set search_path='' as $$
declare input jsonb; st stock.order_state%rowtype; line jsonb; result jsonb; desired jsonb:='[]'; has_error boolean:=false; input_hash text; first_evidence timestamptz; cfg stock.settings%rowtype; stage text;
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
 first_evidence:=coalesce(st.first_consume_evidence,(input->>'evidence_at')::timestamptz); if stage='consume' and st.first_consume_evidence is null then update stock.order_state set first_consume_evidence=first_evidence where source=p_source and order_id=p_id;end if;
 if stage='consume' then update stock.order_state set stage='consume',evidence_at=first_evidence,updated_at=now() where source=p_source and order_id=p_id;end if;
 update stock.issues set resolved_at=now() where source=p_source and order_id=p_id and resolved_at is null and code not in ('shortage','after_dispatch_edit');
 if stage='cancelled' then return stock.apply_order(p_source,p_id,stage,'[]',null);end if;
 if stage='waiting' then return 'done';end if;
 if jsonb_array_length(input->'lines')=0 or not coalesce((input->>'detail_complete')::boolean,false) then
  perform stock.issue(p_source,p_id,'','details_needed','Detail item order belum lengkap. Sistem akan cuba selepas detail masuk.');return 'blocked';
 end if;
 for line in select value from jsonb_array_elements(input->'lines') loop
  result:=stock.resolve_line(line);
  if result ? 'error' then
   has_error:=true;perform stock.issue(p_source,p_id,line->>'line_key','mapping_needed',result->>'error',line||result);
  else desired:=desired||(result->'allocations');end if;
 end loop;
 if has_error then update stock.order_state set review='Mapping belum lengkap',updated_at=now() where source=p_source and order_id=p_id;return 'blocked';end if;
 if exists(select 1 from jsonb_array_elements(desired) d group by d->>'line_key',d->>'part',d->>'material_code' having count(*)>1) then raise exception 'DUPLICATE_ALLOCATION';end if;
 result:=jsonb_build_object('status',stock.apply_order(p_source,p_id,stage,desired,first_evidence));
 if result->>'status'='done' then update stock.order_state set source_hash=input_hash where source=p_source and order_id=p_id;end if;
 return result->>'status';
end $$;
