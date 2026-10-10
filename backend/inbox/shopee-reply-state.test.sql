-- Execute inside BEGIN / SET LOCAL ROLE service_role / ROLLBACK; no provider calls.
do $$
declare m public.messages%rowtype; c public.conversations%rowtype; i uuid; r jsonb;
begin
 select x.* into m from public.messages x join public.shopee_chat_send_attempts a on a.local_message_id=x.id
 where x.channel='shopee' and x.status='sent' and a.status='sent' and a.provider_message_id=x.provider_message_id
 and exists(select 1 from public.messages y where y.conversation_id=x.conversation_id and y.direction='inbound' and y.created_at<x.created_at)
 order by x.created_at desc limit 1;
 if m.id is null then raise exception 'A proven send with earlier inbound is required'; end if;
 select * into c from public.conversations where id=m.conversation_id for update;
 select id into i from public.messages where conversation_id=c.id and direction='inbound' order by created_at desc limit 1;
 update public.conversations set needs_reply=true,unread_count=2,last_inbound_at=m.created_at-interval '1 second',last_message_at=m.sent_at,last_message_sender='seller' where id=c.id;
 r:=public.complete_shopee_reply(m.id);
 if r->>'replied'<>'true' or not exists(select 1 from public.conversations where id=c.id and needs_reply=false and unread_count=0) then raise exception 'Successful reply not resolved'; end if;
 perform public.complete_shopee_reply(m.id);
 if (select count(*) from public.messages where id=m.id)<>1 then raise exception 'Retry duplicated message'; end if;
 -- Customer arrives during provider wait, before successful completion.
 update public.messages set created_at=m.created_at+interval '1 second' where id=i;
 update public.messages set sent_at=m.created_at+interval '2 seconds' where id=m.id;
 update public.conversations set needs_reply=true,unread_count=2,last_inbound_at=m.created_at+interval '1 second' where id=c.id;
 r:=public.complete_shopee_reply(m.id);
 if r->>'replied'<>'false' or not exists(select 1 from public.conversations where id=c.id and needs_reply and unread_count=2) then raise exception 'Concurrent inbound was cleared'; end if;
 -- Later incoming remains the latest message even on a replay of an old sent request.
 update public.messages set created_at=m.sent_at+interval '1 minute' where id=i;
 update public.conversations set last_inbound_at=m.sent_at+interval '1 minute',last_message_at=m.sent_at+interval '1 minute',last_message_sender='customer' where id=c.id;
 perform public.complete_shopee_reply(m.id);
 if not exists(select 1 from public.conversations where id=c.id and needs_reply and unread_count=2 and last_message_sender='customer' and last_message_at=m.sent_at+interval '1 minute') then raise exception 'Historical replay changed newer state'; end if;
 foreach r in array array['"pending"'::jsonb,'"failed"'::jsonb,'"unknown"'::jsonb] loop
  update public.messages set status=r#>>'{}' where id=m.id;
  begin
   perform public.complete_shopee_reply(m.id);raise exception 'Non-success accepted';
  exception when others then if sqlerrm not like '%SUCCESSFUL_SHOPEE_SEND_REQUIRED%' then raise; end if; end;
 end loop;
 update public.messages set status='sent' where id=m.id;
 update public.shopee_chat_send_attempts set status='unknown' where local_message_id=m.id;
 begin
  perform public.complete_shopee_reply(m.id);raise exception 'Unproven audit accepted';
 exception when others then if sqlerrm not like '%SUCCESSFUL_SHOPEE_SEND_REQUIRED%' then raise; end if; end;
 if has_function_privilege('anon','public.complete_shopee_reply(uuid)','execute') or has_function_privilege('authenticated','public.complete_shopee_reply(uuid)','execute') then raise exception 'Private completion grants failed'; end if;
end $$;
