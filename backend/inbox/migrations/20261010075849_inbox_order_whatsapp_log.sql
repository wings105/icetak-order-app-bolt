-- Inbox only: log a successful canonical Order System send; never send to WasapFlow.
create or replace function public.icetak_log_order_whatsapp_outbound(p_body jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_phone text; v_bsuid text; v_pid text; v_type text; v_text text; v_sent timestamptz;
 v_customer uuid; v_count integer; v_conversation uuid; v_message uuid; v_order uuid; existing record;
begin
 if jsonb_typeof(p_body) is distinct from 'object' then raise exception 'INVALID_OUTBOUND'; end if;
 v_pid:=nullif(btrim(p_body->>'provider_message_id'),''); v_text:=nullif(btrim(p_body->>'text'),'');
 v_type:=coalesce(p_body->>'message_type','text');
 if v_pid is null or length(v_pid)>512 or v_text is null or length(v_text)>12000 or v_type not in ('text','template') or coalesce(p_body->>'outbox_id','') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'INVALID_OUTBOUND'; end if;
 v_sent:=(p_body->>'sent_at')::timestamptz;
 if v_sent is null or v_sent>clock_timestamp()+interval '5 minutes' then raise exception 'INVALID_OUTBOUND'; end if;
 v_phone:=nullif(regexp_replace(coalesce(p_body->>'phone',''),'[^0-9]','','g'),'');
 if left(v_phone,1)='0' then v_phone:='6'||v_phone; elsif left(v_phone,1)='1' then v_phone:='60'||v_phone; end if;
 if v_phone is not null and v_phone !~ '^601[0-9]{8,9}$' then raise exception 'INVALID_OUTBOUND'; end if;
 v_bsuid:=nullif(btrim(p_body->>'recipient_bsuid'),'');
 select count(distinct customer_id), (array_agg(distinct customer_id))[1] into v_count,v_customer
 from public.customer_identities where channel='whatsapp' and ((v_phone is not null and normalized_phone=v_phone) or (v_bsuid is not null and external_id=v_bsuid));
 if v_count=0 then raise exception 'IDENTITY_NOT_FOUND'; end if;
 if v_count<>1 then raise exception 'IDENTITY_AMBIGUOUS'; end if;
 perform pg_advisory_xact_lock(hashtextextended('order-wa-outbound:'||v_pid,0));
 select m.id,m.conversation_id,m.direction,c.customer_id into existing from public.messages m join public.conversations c on c.id=m.conversation_id where m.channel='whatsapp' and m.provider_message_id=v_pid limit 1;
 if found then
  if existing.customer_id<>v_customer or existing.direction<>'outbound' then raise exception 'MESSAGE_IDENTITY_CONFLICT'; end if;
  return jsonb_build_object('message_id',existing.id,'conversation_id',existing.conversation_id,'duplicate',true);
 end if;
 select id,order_id into v_conversation,v_order from public.conversations where channel='whatsapp' and customer_id=v_customer
 order by (external_customer_id=v_bsuid) desc nulls last,last_message_at desc nulls last,id limit 1 for update;
 if v_conversation is null then raise exception 'CONVERSATION_NOT_FOUND'; end if;
 insert into public.messages(conversation_id,order_id,channel,provider_message_id,source_event_id,direction,sender_type,source,recipient_phone,recipient_bsuid,message_type,text_content,status,sent_at,created_at,updated_at,raw_payload)
 values(v_conversation,v_order,'whatsapp',v_pid,'order-wa:'||(p_body->>'outbox_id'),'outbound','system','icetak_api',v_phone,v_bsuid,v_type,v_text,'sent',v_sent,v_sent,clock_timestamp(),
 jsonb_build_object('source_project','icetak-order-system','outbox_id',p_body->>'outbox_id','event_type',p_body->>'event_type','order_no',p_body->>'order_no','order_db_id',p_body->>'order_db_id','template_name',p_body->>'template_name','template_components',p_body->'template_components'))
 on conflict(channel,provider_message_id) where provider_message_id is not null do nothing returning id into v_message;
 if v_message is null then
  select id into v_message from public.messages where channel='whatsapp' and provider_message_id=v_pid and conversation_id=v_conversation and direction='outbound';
  if v_message is null then raise exception 'MESSAGE_IDENTITY_CONFLICT'; end if;
  return jsonb_build_object('message_id',v_message,'conversation_id',v_conversation,'duplicate',true);
 end if;
 -- Historical mirror must not move the conversation backwards or clear a later customer's reply.
 update public.conversations set
 last_outbound_at=greatest(last_outbound_at,v_sent),
 last_message_sender=case when last_message_at is null or last_message_at<=v_sent then 'seller' else last_message_sender end,
 last_message_at=greatest(last_message_at,v_sent),updated_at=clock_timestamp() where id=v_conversation;
 return jsonb_build_object('message_id',v_message,'conversation_id',v_conversation,'duplicate',false);
end $$;
revoke all on function public.icetak_log_order_whatsapp_outbound(jsonb) from public,anon,authenticated;
grant execute on function public.icetak_log_order_whatsapp_outbound(jsonb) to service_role;
