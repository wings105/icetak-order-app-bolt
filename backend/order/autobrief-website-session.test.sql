begin;
do $$
declare c uuid:=gen_random_uuid(); o uuid:=gen_random_uuid(); previous_order uuid:=gen_random_uuid(); i uuid:=gen_random_uuid(); previous_session uuid:=gen_random_uuid(); result jsonb; boundary timestamptz:=now()-interval '3 days';
begin
 insert into public.customers(id,name,phone) values(c,'QA Website AutoBrief','601199999991');
 insert into public.orders(id,customer_id,order_no,created_at,source,status,payment_status) values(previous_order,c,'QA-WEBSITE-PREVIOUS',now()-interval '4 days','qa_autobrief','Complete','paid');
 insert into public.order_sessions(id,customer_phone,status,opened_at,closed_at,created_at,order_id,source_type) values(previous_session,'601199999991','converted',now()-interval '6 days',boundary,now()-interval '5 days',previous_order,'chat_trigger');
 insert into public.orders(id,customer_id,delivery_phone,delivery_name,delivery_method,order_no,created_at,source,status,payment_status) values(o,c,'01199999991','QA Website','pickup','QA-WEBSITE-CURRENT',now()-interval '1 day','customer_portal','Ready to Process','paid');
 insert into public.order_items(id,order_id,product_type,title,qty) values(i,o,'printed','Cake Topper',1);
 insert into public.production_components(order_id,order_item_id,component_type,label,clickup_task_id) values(o,i,'printed','QA','qa-website-session');
 insert into public.ai_clickup_work_snapshots(task_id,order_reference,order_id,list_id,clickup_status,mapping_status,source_updated_at,observed_at) values('qa-website-session','QA-WEBSITE-CURRENT',o,'18375902','design editing -topper','exact_reference',now(),now());
 result:=public.icetak_autobrief_direct_scope(o,'qa-website-session');
 if (result->>'eligible')::boolean is not true or (result->>'start_at')::timestamptz<>boundary or result->>'session_source'<>'website_phone_session' or result->>'phone'<>'601199999991' then raise exception 'website phone/session boundary incorrect: %',result;end if;
 if (result->>'start_at')::timestamptz>=(result->>'placed_at')::timestamptz then raise exception 'pre-checkout session excluded';end if;
 insert into public.orders(customer_id,delivery_name,delivery_phone,delivery_method,order_no,created_at,source,status,payment_status) values(c,'QA Website','01199999991','pickup','QA-WEBSITE-NEXT',now()-interval '12 hours','customer_portal','Ready to Process','paid');
 result:=public.icetak_autobrief_direct_scope(o,'qa-website-session');
 if (result->>'end_at')::timestamptz is distinct from (select created_at from public.orders where order_no='QA-WEBSITE-NEXT') then raise exception 'next order leak';end if;
 if (result->>'start_at')::timestamptz<>boundary then raise exception 'future order changed prior session start';end if;
end $$;
rollback;
select 'PASS website checkout phone normalization, previous closed-order boundary, pre-checkout details and next-order cutoff; rollback' result;
