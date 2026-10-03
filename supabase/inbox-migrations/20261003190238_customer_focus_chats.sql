-- Unified Inbox only. All conversations, globally bounded; no provider state writes.
create function public.icetak_customer_focus_chats() returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
with eligible as (select c.*,cu.display_name,cu.order_system_master_customer_id from conversations c join customers cu on cu.id=c.customer_id where c.channel in ('whatsapp','shopee')),
 selected as (select * from eligible order by last_inbound_at desc nulls last,id limit 6000), rows as (
 select jsonb_build_object('id',c.id,'channel',c.channel,'name',c.display_name,'customer_id',c.customer_id,
 'master_id',c.order_system_master_customer_id,'external_customer_id',c.external_customer_id,
 'last_inbound_at',c.last_inbound_at,'last_outbound_at',c.last_outbound_at,'last_message_at',c.last_message_at,
 'legacy_needs_reply',c.needs_reply,'archived',c.archived,
 'identities',coalesce((select jsonb_agg(jsonb_build_object('channel',i.channel,'external_id',i.external_id,'phone',i.normalized_phone,'username',i.username)) from customer_identities i where i.customer_id=c.customer_id),'[]'),
 'inbound_revision',coalesce((select m.id::text||'@'||coalesce(m.updated_at,m.created_at)::text from messages m where m.conversation_id=c.id and m.direction='inbound' order by m.created_at desc,m.id desc limit 1),'empty'),
 'messages',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from (
 select m.id,m.direction,m.sender_type,m.message_type,left(m.text_content,1000) text_content,left(m.caption,1000) caption,m.source,m.created_at,m.is_history
 from messages m where m.conversation_id=c.id order by m.created_at desc,m.id desc limit 6)x),'[]')) item
 from selected c)
select jsonb_build_object('rows',coalesce((select jsonb_agg(item) from rows),'[]'),'total',(select count(*) from eligible),
 'truncated',(select count(*)>6000 from eligible),'fetched_at',now());
$$;
revoke all on function public.icetak_customer_focus_chats() from public,anon,authenticated;
grant execute on function public.icetak_customer_focus_chats() to service_role;
