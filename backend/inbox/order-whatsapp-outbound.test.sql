-- Use BEGIN; SET LOCAL ROLE service_role; ... ROLLBACK. Existing customer's state is preserved.
do $$
declare c record; m jsonb; again jsonb; before_state jsonb; after_state jsonb; b jsonb; other_id text; inbound_pid text;
begin
 select x.*,i.normalized_phone into c from public.conversations x join public.customer_identities i on i.customer_id=x.customer_id and i.channel='whatsapp' where x.id='b24ad63f-2897-42e4-bcfd-68a6fdbb8c55' limit 1;
 if c.id is null then raise exception 'Fixture conversation missing'; end if;
 select to_jsonb(x) into before_state from public.conversations x where id=c.id;
 b:=jsonb_build_object('outbox_id','e0363780-8d6c-4ec9-ab51-b31962718284','phone',c.normalized_phone,'recipient_bsuid',c.external_customer_id,'provider_message_id','fixture-wa-no-provider-send','sent_at','2026-10-10T07:02:00Z','text','Fixture log only','message_type','text','event_type','fixture','secret','must-not-be-stored');
 m:=public.icetak_log_order_whatsapp_outbound(b);
 again:=public.icetak_log_order_whatsapp_outbound(b);
 if m->>'message_id' is distinct from again->>'message_id' or not (again->>'duplicate')::boolean then raise exception 'Retry duplicated message'; end if;
 if not exists(select 1 from public.messages where id=(m->>'message_id')::uuid and direction='outbound' and sender_type='system' and source='icetak_api' and created_at='2026-10-10T07:02:00Z' and raw_payload::text not like '%must-not-be-stored%') then raise exception 'Message provenance/time/redaction failed'; end if;
 select to_jsonb(x) into after_state from public.conversations x where id=c.id;
 if before_state->'last_message_at' is distinct from after_state->'last_message_at' or before_state->'last_message_sender' is distinct from after_state->'last_message_sender' or before_state->'unread_count' is distinct from after_state->'unread_count' or before_state->'needs_reply' is distinct from after_state->'needs_reply' then raise exception 'Historical log changed newer customer context'; end if;
 select provider_message_id into inbound_pid from public.messages where conversation_id=c.id and direction='inbound' and provider_message_id is not null limit 1;
 begin
  perform public.icetak_log_order_whatsapp_outbound(b||jsonb_build_object('provider_message_id',inbound_pid));
  raise exception 'Inbound overwritten as outbound';
 exception when others then if sqlerrm not like '%MESSAGE_IDENTITY_CONFLICT%' then raise; end if; end;
 select external_id into other_id from public.customer_identities where channel='whatsapp' and customer_id<>c.customer_id and external_id is not null limit 1;
 if other_id is not null then
  begin
   perform public.icetak_log_order_whatsapp_outbound(b||jsonb_build_object('recipient_bsuid',other_id));
   raise exception 'Cross-customer identity accepted';
  exception when others then if sqlerrm not like '%IDENTITY_AMBIGUOUS%' then raise; end if; end;
 end if;
 if has_function_privilege('anon','public.icetak_log_order_whatsapp_outbound(jsonb)','execute') or has_function_privilege('authenticated','public.icetak_log_order_whatsapp_outbound(jsonb)','execute') then raise exception 'Logging is not private'; end if;
end $$;
