-- Consume only a recent successful private, read-only provider response for exact existing orders.
create or replace function stock.recover_items(p_response_id bigint,p_expected jsonb,p_actor text)
returns jsonb language plpgsql security invoker set search_path='' as $recover$
declare response jsonb; item_order jsonb; item jsonb; mp public.marketplace_orders%rowtype; seq integer; received timestamptz;
 imported integer:=0; skipped integer:=0; n integer; source_hash text;
begin
 if nullif(trim(p_actor),'') is null then raise exception 'ACTOR_REQUIRED';end if;
 if jsonb_typeof(p_expected)<>'array' or jsonb_array_length(p_expected) not between 1 and 50 then raise exception 'EXACT_ORDERS_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('stock:writer',0));
 select content::jsonb,created into response,received from net._http_response where id=p_response_id and status_code=200 and not timed_out;
 if response is null or received<now()-interval '1 hour' or response->>'ok'<>'true' or response->>'complete'<>'true'
 or jsonb_typeof(response->'orders')<>'array' or jsonb_array_length(response->'orders')<>jsonb_array_length(p_expected) then raise exception 'PROVIDER_RESPONSE_REQUIRED';end if;
 select count(distinct x->>'order_sn') into n from jsonb_array_elements(response->'orders') x where p_expected ? (x->>'order_sn');
 if n<>jsonb_array_length(p_expected) then raise exception 'EXACT_ORDER_SET_MISMATCH';end if;
 for item_order in select value from jsonb_array_elements(response->'orders') loop
  select * into mp from public.marketplace_orders where provider='shopee' and order_sn=item_order->>'order_sn' and shop_id=item_order->>'shop_id' for update;
  if mp.id is null or mp.currency is distinct from item_order->>'currency' then raise exception 'CANONICAL_ORDER_CURRENCY_MISMATCH';end if;
  if mp.current_status in ('READY_TO_SHIP','PROCESSED') and item_order->>'status' not in ('READY_TO_SHIP','PROCESSED')
  or mp.current_status not in ('READY_TO_SHIP','PROCESSED') and item_order->>'status' in ('READY_TO_SHIP','PROCESSED') then raise exception 'CANONICAL_STATUS_RECONCILIATION_REQUIRED';end if;
  source_hash:=md5((item_order->'items')::text);
  if mp.metadata#>>'{stock_item_recovery,items_hash}'=source_hash or mp.detail_complete then skipped:=skipped+1;continue;end if;
  if exists(select 1 from public.marketplace_order_items where order_id=mp.id) then raise exception 'EXISTING_ITEM_DETAIL_PRESERVED';end if;
  if jsonb_typeof(item_order->'items')<>'array' or jsonb_array_length(item_order->'items') not between 1 and 100 then raise exception 'ITEM_DETAIL_REQUIRED';end if;
  seq:=0;
  for item in select value from jsonb_array_elements(item_order->'items') loop
   seq:=seq+1;
   if coalesce(item->>'quantity','')!~'^[1-9][0-9]*$' or (item->>'quantity')::numeric>100000
   or coalesce(item->>'item_id','')!~'^[0-9]+$' or nullif(trim(item->>'title'),'') is null then raise exception 'INVALID_PROVIDER_ITEM';end if;
   insert into public.marketplace_order_items(order_id,line_no,provider_item_id,provider_variation_id,item_sku,variation_sku,title,variation_name,quantity,unit_original_price,unit_discounted_price,line_subtotal,is_current,raw_item)
   values(mp.id,seq,item->>'item_id',nullif(item->>'model_id','0'),nullif(item->>'sku',''),nullif(item->>'model_sku',''),item->>'title',nullif(item->>'model',''),(item->>'quantity')::integer,(item->>'unit_original_price')::numeric,(item->>'unit_discounted_price')::numeric,
   (item->>'unit_discounted_price')::numeric*(item->>'quantity')::integer,true,item||jsonb_build_object('source','shopee_api_stock_recovery','response_id',p_response_id,'checked_at',response->>'checked_at'));
  end loop;
  update public.marketplace_orders set
   placed_at=coalesce(placed_at,case when (item_order->>'create_time')::numeric>0 then to_timestamp((item_order->>'create_time')::double precision) end),
   metadata=metadata||jsonb_build_object('stock_items_complete',true,'stock_item_recovery',jsonb_build_object('response_id',p_response_id,'items_hash',source_hash,'checked_at',response->>'checked_at')),
   raw_detail=raw_detail||jsonb_build_object('stock_item_recovery',item_order),
   updated_at=now() where id=mp.id;
  insert into stock.audit(action,actor,target,details) values('marketplace_items_recovered',p_actor,'shopee:'||mp.id::text,jsonb_build_object('reference',mp.order_sn,'response_id',p_response_id,'items_hash',source_hash,'items',seq,'source','signed_shopee_get_order_detail','checked_at',response->>'checked_at'));
  perform stock.enqueue('shopee',mp.id);
  imported:=imported+1;
 end loop;
 return jsonb_build_object('imported',imported,'skipped',skipped,'response_id',p_response_id);
end $recover$;
revoke all on function stock.recover_items(bigint,jsonb,text) from public,anon,authenticated;
grant execute on function stock.recover_items(bigint,jsonb,text) to service_role;
