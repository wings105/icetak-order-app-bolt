-- Synthetic provider proof and canonical item fixtures; every effect rolls back.
begin;
do $verify$
declare oid uuid:=gen_random_uuid(); sn text:='261001QA'||upper(substr(gen_random_uuid()::text,1,6));
 response_id bigint:=-1-floor(random()*100000000)::bigint; payload jsonb; answer jsonb; before_audits bigint; raw_before jsonb; rejected boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended('stock:writer',0));
 select jsonb_object_agg(code,on_hand) into raw_before from stock.materials;
 insert into public.marketplace_orders(id,provider,order_sn,shop_id,region,currency,current_status,detail_complete,placed_at)
 values(oid,'shopee',sn,'188218638','MY','MYR','READY_TO_SHIP',false,now());
 insert into stock.order_state(source,order_id,reference,stage) values('shopee',oid,sn,'to_ship');
 payload:=jsonb_build_object('ok',true,'complete',true,'checked_at',now(),'orders',jsonb_build_array(jsonb_build_object(
 'order_sn',sn,'shop_id','188218638','currency','MYR','status','READY_TO_SHIP','create_time',extract(epoch from now())::bigint,
 'items',jsonb_build_array(jsonb_build_object('item_id','123','model_id','456','sku','edible','model_sku','edible-A4','model','A4','title','Edible Image','quantity',2,'unit_original_price',24,'unit_discounted_price',0)))));
 insert into net._http_response(id,status_code,content,created,timed_out) values(response_id,200,payload::text,now(),false);
 rejected:=false;
 begin perform stock.recover_items(response_id,null,'verification-rollback');exception when others then if sqlerrm<>'EXACT_ORDERS_REQUIRED' then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'Null expected-order set accepted';end if;
 update net._http_response set content=(payload-'ok')::text where id=response_id;
 rejected:=false;
 begin perform stock.recover_items(response_id,jsonb_build_array(sn),'verification-rollback');exception when others then if sqlerrm<>'PROVIDER_RESPONSE_REQUIRED' then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'Missing explicit success proof accepted';end if;
 update net._http_response set content=payload::text,created=now()-interval '2 hours' where id=response_id;
 rejected:=false;
 begin perform stock.recover_items(response_id,jsonb_build_array(sn),'verification-rollback');exception when others then if sqlerrm<>'PROVIDER_RESPONSE_REQUIRED' then raise;end if;rejected:=true;end;
 if not rejected then raise exception 'Stale provider proof accepted';end if;
 update net._http_response set created=now() where id=response_id;
 insert into stock.item_recovery(order_id,shop_id,reference,status,attempts,response_id,available_at)
 values(oid,'188218638',sn,'reading',1,response_id,now()+interval '2 minutes');
 perform stock.recovery_tick();
 if (select status from stock.item_recovery where order_id=oid) is distinct from 'done' then raise exception 'Worker did not apply source response';end if;
 if (select count(*) from public.marketplace_order_items where order_id=oid and is_current)<>1 then raise exception 'Item recovery incomplete';end if;
 if (select detail_complete from public.marketplace_orders where id=oid) then raise exception 'Item-only recovery forged full detail completeness';end if;
 if (stock.order_input('shopee',oid)->>'detail_complete')::boolean is distinct from true then raise exception 'Stock-specific completeness missing';end if;
 answer:=stock.resolve_line(stock.order_input('shopee',oid)#>'{lines,0}');
 if (answer#>>'{allocations,0,quantity}')::numeric is distinct from 2 then raise exception 'Original-price quantity not calculated';end if;
 select count(*) into before_audits from stock.audit;
 answer:=stock.recover_items(response_id,jsonb_build_array(sn),'verification-rollback');
 if (answer->>'imported')::int<>0 or (select count(*) from stock.audit)<>before_audits then raise exception 'Source replay duplicated item/audit';end if;
 if (select current_status from public.marketplace_orders where id=oid)<>'READY_TO_SHIP' then raise exception 'Recovery changed order status';end if;
 if (select jsonb_object_agg(code,on_hand) from stock.materials)<>raw_before then raise exception 'Item recovery altered physical stock';end if;
 if has_function_privilege('anon','stock.recovery_tick()','execute') or has_function_privilege('authenticated','stock.recover_items(bigint,jsonb,text)','execute') or has_table_privilege('authenticated','stock.item_recovery','select') then raise exception 'Private recovery exposed';end if;
end $verify$;
rollback;
select 'Source recovery worker, exact provider proof, original-price quantity, full-detail separation, privacy and replay checks passed; all effects reverted.' result;
