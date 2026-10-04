-- Unified Inbox only. Preserve complete chat coverage and exact message ordering.
set local lock_timeout='5s';
create index if not exists messages_focus_latest on public.messages(conversation_id,created_at desc,id desc);
create index if not exists messages_focus_inbound_latest on public.messages(conversation_id,created_at desc,id desc) include(updated_at) where direction='inbound';
create index if not exists shopee_sessions_conversation_boundary on public.shopee_order_sessions(conversation_id,cutoff_at desc);
create or replace function public.icetak_customer_focus_chats() returns jsonb language sql stable security invoker set search_path=public,pg_temp as $function$
with eligible as materialized (
 select c.id,c.channel,c.customer_id,c.external_customer_id,c.last_inbound_at,c.last_outbound_at,c.last_message_at,c.needs_reply,c.archived,cu.display_name,cu.order_system_master_customer_id
 from conversations c join customers cu on cu.id=c.customer_id where c.channel in ('whatsapp','shopee')
), selected as materialized(select * from eligible order by last_inbound_at desc nulls last,id limit 6000),
 identities as materialized(
 select i.customer_id,jsonb_agg(jsonb_build_object('channel',i.channel,'external_id',i.external_id,'phone',i.normalized_phone,'username',i.username)) items
 from customer_identities i group by i.customer_id
), rows as (
 select jsonb_build_object('id',c.id,'channel',c.channel,'name',c.display_name,'customer_id',c.customer_id,
 'master_id',c.order_system_master_customer_id,'external_customer_id',c.external_customer_id,
 'last_inbound_at',c.last_inbound_at,'last_outbound_at',c.last_outbound_at,'last_message_at',c.last_message_at,
 'legacy_needs_reply',c.needs_reply,'archived',c.archived,'identities',coalesce(i.items,'[]'),
 'inbound_revision',coalesce((select m.id::text||'@'||coalesce(m.updated_at,m.created_at)::text from messages m where m.conversation_id=c.id and m.direction='inbound' order by m.created_at desc,m.id desc limit 1),'empty'),
 'messages',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from (
 select m.id,m.direction,m.sender_type,m.message_type,left(m.text_content,1000) text_content,left(m.caption,1000) caption,m.source,m.created_at,m.is_history
 from messages m where m.conversation_id=c.id order by m.created_at desc,m.id desc limit 6)x),'[]')) item,c.last_inbound_at,c.id
 from selected c left join identities i on i.customer_id=c.customer_id
)
select jsonb_build_object('rows',coalesce((select jsonb_agg(item order by last_inbound_at desc nulls last,id) from rows),'[]'),'total',(select count(*) from eligible),
 'truncated',(select count(*)>6000 from eligible),'fetched_at',now());
$function$;
revoke all on function public.icetak_customer_focus_chats() from public,anon,authenticated;
grant execute on function public.icetak_customer_focus_chats() to service_role;
notify pgrst,'reload schema';

create or replace function public.icetak_customer_focus_chat_ids() returns jsonb language sql stable security invoker set search_path=public,pg_temp as $function$
with eligible as materialized(select c.id,c.last_inbound_at from conversations c join customers cu on cu.id=c.customer_id where c.channel in ('whatsapp','shopee')),
selected as(select * from eligible order by last_inbound_at desc nulls last,id limit 6000)
select jsonb_build_object('ids',coalesce((select jsonb_agg(id order by last_inbound_at desc nulls last,id) from selected),'[]'),'total',(select count(*) from eligible),'truncated',(select count(*)>6000 from eligible),'fetched_at',now());
$function$;
create or replace function public.icetak_customer_focus_chat_page(p_ids jsonb) returns jsonb language sql stable security invoker set search_path=public,pg_temp as $function$
with eligible as materialized (
 select c.id,c.channel,c.customer_id,c.external_customer_id,c.last_inbound_at,c.last_outbound_at,c.last_message_at,c.needs_reply,c.archived,cu.display_name,cu.order_system_master_customer_id
 from conversations c join customers cu on cu.id=c.customer_id where c.channel in ('whatsapp','shopee') and jsonb_array_length(p_ids)<=500 and c.id::text in (select jsonb_array_elements_text(p_ids))
), selected as materialized(select * from eligible order by last_inbound_at desc nulls last,id limit 500),
 identities as materialized(
 select i.customer_id,jsonb_agg(jsonb_build_object('channel',i.channel,'external_id',i.external_id,'phone',i.normalized_phone,'username',i.username)) items
 from customer_identities i group by i.customer_id
), rows as (
 select jsonb_build_object('id',c.id,'channel',c.channel,'name',c.display_name,'customer_id',c.customer_id,
 'master_id',c.order_system_master_customer_id,'external_customer_id',c.external_customer_id,
 'last_inbound_at',c.last_inbound_at,'last_outbound_at',c.last_outbound_at,'last_message_at',c.last_message_at,
 'legacy_needs_reply',c.needs_reply,'archived',c.archived,'identities',coalesce(i.items,'[]'),
 'inbound_revision',coalesce((select m.id::text||'@'||coalesce(m.updated_at,m.created_at)::text from messages m where m.conversation_id=c.id and m.direction='inbound' order by m.created_at desc,m.id desc limit 1),'empty'),
 'messages',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from (
 select m.id,m.direction,m.sender_type,m.message_type,left(m.text_content,1000) text_content,left(m.caption,1000) caption,m.source,m.created_at,m.is_history
 from messages m where m.conversation_id=c.id order by m.created_at desc,m.id desc limit 6)x),'[]')) item,c.last_inbound_at,c.id
 from selected c left join identities i on i.customer_id=c.customer_id
)
select jsonb_build_object('rows',coalesce((select jsonb_agg(item order by last_inbound_at desc nulls last,id) from rows),'[]'),'total',(select count(*) from eligible),
 'truncated',(select count(*)>6000 from eligible),'fetched_at',now());
$function$;

revoke all on function public.icetak_customer_focus_chat_ids(),public.icetak_customer_focus_chat_page(jsonb) from public,anon,authenticated;
grant execute on function public.icetak_customer_focus_chat_ids(),public.icetak_customer_focus_chat_page(jsonb) to service_role;
notify pgrst,'reload schema';
