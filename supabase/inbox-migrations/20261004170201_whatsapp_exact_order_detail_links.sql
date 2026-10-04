-- Unified Inbox: exact order references are evidence bindings, not customer identity merges.
set local lock_timeout='5s';
create or replace function public.icetak_link_order_message(p_message_id uuid) returns integer
language plpgsql security invoker set search_path=public,pg_temp as $$
declare m messages; refs text[]; ref text; inserted integer:=0;
begin
 select * into m from messages where id=p_message_id;
 if not found or m.direction<>'inbound' or m.channel not in ('whatsapp','shopee') or coalesce(m.is_history,false) then return 0; end if;
 select array_agg(distinct x[1]) into refs from regexp_matches(upper(coalesce(m.text_content,'')||' '||coalesce(m.caption,'')), '\m([0-9]{6}[A-Z0-9]{8})\M','g') x;
 -- Multiple order references in one message require item/order allocation by admin.
 if coalesce(array_length(refs,1),0)<>1 then return 0; end if;
 ref:=refs[1];
 if not exists(select 1 from external_order_summaries where order_no=ref and source_channel='shopee')
 and not exists(select 1 from shopee_order_sessions where order_no=ref) then return 0; end if;
 insert into conversation_order_links(conversation_id,source_project,external_order_id,order_no,is_primary,match_method,match_confidence,linked_by_label,metadata)
 values(m.conversation_id,'icetak-order-system',ref,ref,false,'exact_order_id',1,'Order reference rule',
 jsonb_build_object('rule','exact_order_message_v1','message_id',m.id,'message_at',m.created_at,'channel',m.channel))
 on conflict(conversation_id,source_project,order_no) where unlinked_at is null do nothing;
 get diagnostics inserted=row_count;return inserted;
end $$;
revoke all on function public.icetak_link_order_message(uuid) from public,anon,authenticated;
grant execute on function public.icetak_link_order_message(uuid) to service_role;

create or replace function private.icetak_order_message_link_trigger() returns trigger
language plpgsql security invoker set search_path=public,private,pg_temp as $$
begin perform public.icetak_link_order_message(new.id);return new;end $$;
revoke all on function private.icetak_order_message_link_trigger() from public,anon,authenticated;
create trigger icetak_order_message_link after insert or update of text_content,caption on public.messages
for each row execute function private.icetak_order_message_link_trigger();

-- Handle a message arriving before the order summary without allocating reference-free chat.
create or replace function private.icetak_order_summary_link_trigger() returns trigger
language plpgsql security invoker set search_path=public,private,pg_temp as $$
declare message_id uuid;
begin
 if new.source_channel='shopee' then
  for message_id in select id from messages where direction='inbound' and channel in ('whatsapp','shopee')
   and not coalesce(is_history,false) and created_at>=greatest(coalesce(new.placed_at,new.created_at)-interval '1 day',now()-interval '30 days')
   and position(upper(new.order_no) in upper(coalesce(text_content,'')||' '||coalesce(caption,'')))>0
  loop perform public.icetak_link_order_message(message_id);end loop;
 end if;return new;
end $$;
revoke all on function private.icetak_order_summary_link_trigger() from public,anon,authenticated;
create trigger icetak_order_summary_link after insert or update of order_no,source_channel on public.external_order_summaries
for each row execute function private.icetak_order_summary_link_trigger();

create or replace function public.icetak_order_detail_context(p_orders jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
with supplied as (select x from jsonb_array_elements(p_orders) x where jsonb_array_length(p_orders)<=50),
sessions as materialized (
 select x->>'key' key,x->>'reference' reference,coalesce(x->'bindings','[]') manual,coalesce((x->>'closed')::boolean,false) source_closed,s.*,
 (select count(*) from shopee_order_sessions other where other.conversation_id=s.conversation_id and other.status='open' and other.order_no<>s.order_no) other_open,
 (select max(cutoff_at) from shopee_order_sessions old where old.conversation_id=s.conversation_id and old.order_no<>s.order_no and old.cutoff_at<=s.started_at) boundary_at
 from supplied left join shopee_order_sessions s on s.order_no=x->>'reference'
),scopes as materialized (
 select key,conversation_id id,started_at start_at,cutoff_at end_at,
 status='open' and not source_closed and other_open=0 and not review_required usable,'shopee_session' source,boundary_at
 from sessions where conversation_id is not null and jsonb_array_length(manual)=0
 union all
 select s.key,(b->>'conversation_id')::uuid,(b->>'start_at')::timestamptz,least(nullif(b->>'end_at','')::timestamptz,s.cutoff_at),
 not s.source_closed and coalesce(s.status,'open')='open','admin_bound',s.boundary_at from sessions s cross join lateral jsonb_array_elements(s.manual) b
 union all
 select s.key,l.conversation_id,(l.metadata->>'message_at')::timestamptz,
 least(s.cutoff_at,(select min((other.metadata->>'message_at')::timestamptz) from conversation_order_links other
  where other.conversation_id=l.conversation_id and other.source_project=l.source_project and other.order_no<>l.order_no
  and other.unlinked_at is null and other.metadata->>'rule'='exact_order_message_v1'
  and (other.metadata->>'message_at')::timestamptz>(l.metadata->>'message_at')::timestamptz)),
 not s.source_closed and coalesce(s.status,'open')='open','exact_order_id',null::timestamptz
 from sessions s join conversation_order_links l on l.order_no=s.reference and l.source_project='icetak-order-system'
 join conversations c on c.id=l.conversation_id and c.channel='whatsapp'
 where l.unlinked_at is null and l.match_method='exact_order_id' and l.metadata->>'rule'='exact_order_message_v1' and jsonb_array_length(s.manual)=0
), messages_by_scope as materialized (
 select s.*,c.channel,
 coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at,m.id) from (
 select m.id,m.conversation_id,m.channel,m.direction,m.message_type,left(m.text_content,2000) text_content,left(m.caption,2000) caption,m.media_url,m.created_at,m.is_history
 from messages m where m.conversation_id=s.id and m.created_at>=greatest(s.start_at,coalesce(s.boundary_at,s.start_at))
 and (s.end_at is null or m.created_at<s.end_at) order by m.created_at desc,m.id desc limit 120)m),'[]') messages,
 (select count(*)>120 from messages m where m.conversation_id=s.id and m.created_at>=greatest(s.start_at,coalesce(s.boundary_at,s.start_at)) and (s.end_at is null or m.created_at<s.end_at)) truncated,
 coalesce((select m.id::text||'@'||coalesce(m.updated_at,m.created_at)::text from messages m where m.conversation_id=s.id and m.direction='inbound'
 and m.created_at>=greatest(s.start_at,coalesce(s.boundary_at,s.start_at)) and (s.end_at is null or m.created_at<s.end_at) order by m.created_at desc,m.id desc limit 1),'empty') revision
 from scopes s join conversations c on c.id=s.id
)
select coalesce(jsonb_object_agg(s.key,jsonb_build_object(
 'ambiguous',coalesce(s.other_open>0 or s.review_required,false) and jsonb_array_length(s.manual)=0 and not exists(select 1 from messages_by_scope m where m.key=s.key and m.usable and m.source='exact_order_id'),
 'bindings',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'channel',m.channel,'start_at',m.start_at,'end_at',m.end_at,'usable',m.usable,'source',m.source,'revision',m.revision,'boundary_at',m.boundary_at)) from messages_by_scope m where m.key=s.key),'[]'),
 'messages',coalesce((select jsonb_agg(v) from messages_by_scope m cross join lateral jsonb_array_elements(m.messages) v where m.key=s.key),'[]'),
 'truncated',coalesce((select bool_or(m.truncated and m.usable) from messages_by_scope m where m.key=s.key),false))), '{}') from sessions s;
$$;
revoke all on function public.icetak_order_detail_context(jsonb) from public,anon,authenticated;
grant execute on function public.icetak_order_detail_context(jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.icetak_customer_focus_chat_page(p_ids jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
 'order_links',coalesce((select jsonb_agg(jsonb_build_object('reference',l.order_no,'source','exact_order_id','start_at',l.metadata->>'message_at')) from conversation_order_links l where l.conversation_id=c.id and l.source_project='icetak-order-system' and l.unlinked_at is null and l.match_method='exact_order_id' and l.metadata->>'rule'='exact_order_message_v1'),'[]'),
 'inbound_revision',coalesce((select m.id::text||'@'||coalesce(m.updated_at,m.created_at)::text from messages m where m.conversation_id=c.id and m.direction='inbound' order by m.created_at desc,m.id desc limit 1),'empty'),
 'messages',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from (
 select m.id,m.direction,m.sender_type,m.message_type,left(m.text_content,1000) text_content,left(m.caption,1000) caption,m.source,m.created_at,m.is_history
 from messages m where m.conversation_id=c.id order by m.created_at desc,m.id desc limit 6)x),'[]')) item,c.last_inbound_at,c.id
 from selected c left join identities i on i.customer_id=c.customer_id
)
select jsonb_build_object('rows',coalesce((select jsonb_agg(item order by last_inbound_at desc nulls last,id) from rows),'[]'),'total',(select count(*) from eligible),
 'truncated',(select count(*)>6000 from eligible),'fetched_at',now());
$function$;

revoke all on function public.icetak_customer_focus_chat_page(jsonb) from public,anon,authenticated;
grant execute on function public.icetak_customer_focus_chat_page(jsonb) to service_role;
notify pgrst,'reload schema';
