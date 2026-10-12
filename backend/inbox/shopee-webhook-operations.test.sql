set local role service_role;
do $$
declare c uuid;u uuid;m uuid;s jsonb;v_primary text;begin
 select md5(setting_value) into v_primary from public.private_runtime_settings where setting_key='shopee_chat_direct_config';
 insert into public.customers(display_name) values('QA Shopee operations') returning id into u;
 insert into public.conversations(customer_id,channel,external_conversation_id,external_customer_id,metadata) values(u,'shopee','qa-ops-conversation','99123456789',jsonb_build_object('shop_id','188218638','username','qa_ops_customer')) returning id into c;
 insert into public.external_order_summaries(source_project,source_channel,external_order_id,order_no,customer_name,shopee_username,shopee_buyer_id,shop_id,payment_status,order_status,active_order,placed_at) values('icetak-order-system','shopee','QAOPSINBOX001','QAOPSINBOX001','QA','qa_ops_customer','99123456789','188218638','paid','READY_TO_SHIP',true,now()-interval '2 days');
 update public.conversations set needs_reply=true,unread_count=1,last_inbound_at=now()-interval '1 day',manual_replied_at=null where id=c;
 if not (select needs_reply from public.conversations where id=c) then raise exception 'active_reply_blocked';end if;
 update public.external_order_summaries set order_status='SHIPPED',active_order=false,shipped_at=now()-interval '12 hours',order_updated_at=now() where order_no='QAOPSINBOX001';
 if (select needs_reply or unread_count>0 from public.conversations where id=c) then raise exception 'shipped_reply_not_cleared';end if;
 if not exists(select 1 from public.shopee_order_sessions where order_no='QAOPSINBOX001' and status='closed' and cutoff_at is not null) then raise exception 'shipped_session_open';end if;
 update public.conversations set needs_reply=true,unread_count=1 where id=c;
 if (select needs_reply from public.conversations where id=c) then raise exception 'old_session_reopened';end if;
 insert into public.messages(conversation_id,channel,provider_message_id,direction,sender_type,message_type,provider_message_type,text_content,media_metadata,status) values(c,'shopee','qa-ops-video','inbound','customer','video','video','[Video]',jsonb_build_object('video_url','https://fixture.example/video.mp4'),'received') returning id into m;
 if (select media_url from public.messages where id=m)<>'https://fixture.example/video.mp4' then raise exception 'video_url_missing';end if;
 insert into public.external_order_summaries(source_project,source_channel,external_order_id,order_no,customer_name,shopee_username,shopee_buyer_id,shop_id,payment_status,order_status,active_order,placed_at) values('icetak-order-system','shopee','QAOPSINBOX002','QAOPSINBOX002','QA','qa_ops_customer','99123456789','188218638','paid','READY_TO_SHIP',true,now());
 update public.conversations set needs_reply=true,unread_count=1,last_inbound_at=now() where id=c;
 if not (select needs_reply from public.conversations where id=c) then raise exception 'new_order_reply_blocked';end if;

 insert into public.customer_identities(customer_id,channel,external_id,username,is_verified,match_confidence) values(u,'shopee','99123456789','qa_current_name',true,'exact_provider_id');
 update public.conversations set metadata=metadata||jsonb_build_object('username','qa_current_name'),needs_reply=false,unread_count=0,manual_replied_at=now() where id=c;
 perform * from public.ingest_shopee_chat_event(gen_random_uuid(),now(),jsonb_build_object('code',10,'shop_id',188218638,'data',jsonb_build_object('type','message','region','MY','content',jsonb_build_object('conversation_id','qa-ops-conversation','message_id','qa-history-order','message_type','order','status','user_chat','from_id',99123456789,'to_id',188218638,'from_shop_id',9999,'to_shop_id',188218638,'from_user_name','qa_ops_customer','created_timestamp',extract(epoch from now()-interval '2 days')::bigint,'content',jsonb_build_object('order_sn','QAOPSOLDUNKNOWN')))),true);
 if (select needs_reply or unread_count>0 from public.conversations where id=c) then raise exception 'history_reopened_reply';end if;
 if (select display_name from public.customers where id=u)<>'QA Shopee operations' or (select username from public.customer_identities where customer_id=u)<>'qa_current_name' or (select metadata->>'username' from public.conversations where id=c)<>'qa_current_name' then raise exception 'history_replaced_current_identity';end if;
 if exists(select 1 from public.conversation_order_links where conversation_id=c and order_no='QAOPSOLDUNKNOWN' and is_primary) then raise exception 'history_promoted_primary_order';end if;
 if exists(select 1 from public.external_order_summaries where order_no='QAOPSOLDUNKNOWN') then raise exception 'history_created_active_provisional_order';end if;
 perform public.icetak_shopee_chat_config('save',jsonb_build_object('shop_id','1635364464','partner_id','99999','enabled',false,'partner_key','qa-fixture-key','actor','QA'));
 s:=public.icetak_shopee_chat_config('get',jsonb_build_object('shop_id','1635364464'));
 if s->>'shop_id'<>'1635364464' or s?'access_token' then raise exception 'sg_config_inherited_token';end if;
 if v_primary is distinct from (select md5(setting_value) from public.private_runtime_settings where setting_key='shopee_chat_direct_config') then raise exception 'primary_config_changed';end if;
 if has_function_privilege('anon','public.icetak_shopee_chat_config(text,jsonb)','execute') then raise exception 'config_exposed';end if;
end $$;
reset role;
select 'INBOX_OPS_ROLLBACK_PASS' result;
