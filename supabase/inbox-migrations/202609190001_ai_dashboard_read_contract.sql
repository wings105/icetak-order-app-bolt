-- Apply to Unified Inbox (uujcqcsfghqkukaydruc), NOT Order System.
-- Read-only contract; existing ingestion and needs_reply remain unchanged.
create or replace function public.icetak_ai_inbox_read(
  p_conversation_id uuid default null, p_channel text default null,
  p_search text default '', p_offset integer default 0, p_limit integer default 30
) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
with selected as (
 select c.*, cu.display_name, cu.order_system_master_customer_id
 from conversations c join customers cu on cu.id=c.customer_id
 where c.channel in ('whatsapp','shopee')
 and (p_conversation_id is null or c.id=p_conversation_id)
 and (nullif(p_channel,'') is null or c.channel=p_channel)
 and (nullif(trim(p_search),'') is null
   or strpos(lower(coalesce(cu.display_name,'')),lower(trim(p_search)))>0
   or exists(select 1 from customer_identities i where i.customer_id=c.customer_id
     and (strpos(lower(coalesce(i.username,'')),lower(trim(p_search)))>0
       or strpos(coalesce(i.normalized_phone,''),trim(p_search))>0
       or i.external_id=trim(p_search))))
 order by c.last_inbound_at desc nulls last,c.id
 limit least(greatest(p_limit,1),60) offset greatest(p_offset,0)
), rows as (
 select jsonb_build_object(
 'id',c.id,'channel',c.channel,'customer_id',c.customer_id,'name',c.display_name,
 'master_id',c.order_system_master_customer_id,'external_customer_id',c.external_customer_id,
 'external_conversation_id',c.external_conversation_id,'last_inbound_at',c.last_inbound_at,
 'last_outbound_at',c.last_outbound_at,'last_message_at',c.last_message_at,
 'legacy_needs_reply',c.needs_reply,'archived',c.archived,
 'window_expires_at',c.window_expires_at,
 'identities',coalesce((select jsonb_agg(jsonb_build_object('channel',i.channel,'external_id',i.external_id,
   'username',i.username,'phone',i.normalized_phone)) from customer_identities i where i.customer_id=c.customer_id),'[]'::jsonb),
 'revision',coalesce((select m.id::text||'@'||coalesce(m.updated_at,m.created_at)::text
   from messages m where m.conversation_id=c.id order by m.created_at desc,m.id desc limit 1),'empty'),
 'inbound_revision',coalesce((select m.id::text||'@'||coalesce(m.updated_at,m.created_at)::text
   from messages m where m.conversation_id=c.id and m.direction='inbound'
   order by m.created_at desc,m.id desc limit 1),'empty'),
 'messages',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from (
   select m.id,m.direction,m.sender_type,m.message_type,m.text_content,m.caption,
     case when p_conversation_id is not null then m.media_url else null end media_url,
     m.source,m.created_at,m.sent_at,m.is_history
   from messages m where m.conversation_id=c.id
   order by m.created_at desc,m.id desc limit case when p_conversation_id is null then 12 else 100 end
 )x),'[]'::jsonb)
 ) item,c.last_inbound_at,c.id from selected c
)
select jsonb_build_object('rows',coalesce(jsonb_agg(item order by last_inbound_at desc nulls last,id),'[]'::jsonb),
 'offset',greatest(p_offset,0),'limit',least(greatest(p_limit,1),60),'fetched_at',now()) from rows;
$$;
revoke all on function public.icetak_ai_inbox_read(uuid,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.icetak_ai_inbox_read(uuid,text,text,integer,integer) to service_role;
