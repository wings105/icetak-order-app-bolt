-- Inbox only. A proven seller send resolves the messages present when it was claimed.
create or replace function public.complete_shopee_reply(p_message_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.messages%rowtype; c public.conversations%rowtype; v_latest_inbound timestamptz; v_replied boolean;
begin
 select * into m from public.messages where id=p_message_id;
 if m.id is null or m.channel<>'shopee' or m.direction<>'outbound' or m.sender_type<>'seller'
    or m.status<>'sent' or m.sent_at is null or nullif(m.provider_message_id,'') is null
    or not exists(select 1 from public.shopee_chat_send_attempts a where a.local_message_id=m.id and a.conversation_id=m.conversation_id and a.status='sent' and a.provider_message_id=m.provider_message_id)
 then raise exception 'SUCCESSFUL_SHOPEE_SEND_REQUIRED'; end if;
 select * into c from public.conversations where id=m.conversation_id and channel='shopee' for update;
 if c.id is null then raise exception 'SHOPEE_CONVERSATION_REQUIRED'; end if;
 select greatest(c.last_inbound_at,max(created_at)) into v_latest_inbound from public.messages where conversation_id=c.id and direction='inbound';
 -- created_at is the durable claim time, before waiting for the upstream API.
 v_replied:=v_latest_inbound is null or v_latest_inbound<=m.created_at;
 update public.conversations set
  needs_reply=case when v_replied then false else needs_reply end,
  unread_count=case when v_replied then 0 else unread_count end,
  last_outbound_at=greatest(last_outbound_at,m.sent_at),
  last_message_sender=case when last_message_at is null or last_message_at<=m.sent_at then 'seller' else last_message_sender end,
  last_message_at=greatest(last_message_at,m.sent_at)
 where id=c.id;
 return jsonb_build_object('conversation_id',c.id,'replied',v_replied);
end $$;
revoke all on function public.complete_shopee_reply(uuid) from public,anon,authenticated;
grant execute on function public.complete_shopee_reply(uuid) to service_role;
