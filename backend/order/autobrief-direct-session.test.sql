begin;
do $$
declare c uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); i uuid:=gen_random_uuid(); se uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); result jsonb;
begin
 insert into public.customers(id,name,phone) values(c,'QA AutoBrief','601199999990');
 insert into public.orders(id,customer_id,order_no,created_at,source,status,payment_status) values(o,c,'QA-AUTOBRIEF-DIRECT',now()-interval '1 day','qa_autobrief','Ready to Process','cash_counter');
 insert into public.order_items(id,order_id,product_type,title,qty,wording) values(i,o,'printed','Cake Topper',1,'CN0081');
 insert into public.production_components(order_id,order_item_id,component_type,label,clickup_task_id) values(o,i,'printed','QA','qa-direct-session');
 insert into public.ai_clickup_work_snapshots(task_id,order_reference,order_id,list_id,clickup_status,mapping_status,source_updated_at,observed_at) values('qa-direct-session','QA-AUTOBRIEF-DIRECT',o,'18375902','design editing -topper','exact_reference',now(),now());
 insert into public.order_sessions(id,conversation_id,customer_phone,status,opened_at,closed_at,created_at,order_id,source_type) values(se,gen_random_uuid(),'601199999990','converted',now()-interval '3 days',now()-interval '1 day',now()-interval '2 days',o,'pickup_trigger');
 result:=public.icetak_autobrief_direct_scope(o,'qa-direct-session');
 if (result->>'eligible')::boolean is not true or result->>'session_id'<>se::text or result->>'target_item_id'<>i::text or result->>'note'<>'' then raise exception 'canonical session/item/sku note guard failed: %',result;end if;
 insert into public.order_sessions(id,customer_phone,status,opened_at,created_at,source_type) values(other,'601199999990','open',now()-interval '1 day',now()-interval '12 hours','chat_trigger');
 result:=public.icetak_autobrief_direct_scope(o,'qa-direct-session');
 if (result->>'end_at')::timestamptz<> (select opened_at from public.order_sessions where id=other) then raise exception 'next-session cutoff missing';end if;
 update public.order_items set product_type='acrylic' where id=i;
 result:=public.icetak_autobrief_direct_scope(o,'qa-direct-session');
 if result->>'reason'<>'PRINTED_TOPPER_ONLY' then raise exception 'wrong product accepted';end if;
 if has_function_privilege('anon','public.icetak_autobrief_direct_scope(uuid,text)','execute') or has_function_privilege('authenticated','public.icetak_autobrief_direct_scope(uuid,text)','execute') then raise exception 'browser permission leak';end if;
end $$;
rollback;
select 'PASS canonical direct order/component/item, converted-session proof, next-session cutoff, SKU exclusion, product and private ACL; rollback' result;
