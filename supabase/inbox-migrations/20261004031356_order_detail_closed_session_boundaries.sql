create or replace function public.icetak_order_detail_context(p_orders jsonb) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
with supplied as (select x from jsonb_array_elements(p_orders) x where jsonb_array_length(p_orders)<=50),
 sessions as materialized (
 select x->>'key' key,x->>'reference' reference,coalesce(x->'bindings','[]') manual,coalesce((x->>'closed')::boolean,false) source_closed,s.*,
 (select count(*) from shopee_order_sessions other where other.conversation_id=s.conversation_id and other.status='open' and other.order_no<>s.order_no) other_open,
 (select max(cutoff_at) from shopee_order_sessions old where old.conversation_id=s.conversation_id and old.order_no<>s.order_no and old.cutoff_at<=s.started_at) boundary_at
 from supplied left join shopee_order_sessions s on s.order_no=x->>'reference'
), scopes as materialized (
 select key,conversation_id id,started_at start_at,cutoff_at end_at,
 status='open' and not source_closed and other_open=0 and not review_required usable,'shopee_session' source,boundary_at
 from sessions where conversation_id is not null and jsonb_array_length(manual)=0
 union all
 select s.key,(b->>'conversation_id')::uuid,(b->>'start_at')::timestamptz,least(nullif(b->>'end_at','')::timestamptz,s.cutoff_at),
 not s.source_closed and coalesce(s.status,'open')='open','admin_bound',s.boundary_at from sessions s cross join lateral jsonb_array_elements(s.manual) b
), messages_by_scope as materialized (
 select s.key,s.id,s.start_at,s.end_at,s.usable,s.source,s.boundary_at,
 coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at,m.id) from (
 select m.id,m.conversation_id,m.channel,m.direction,m.message_type,left(m.text_content,2000) text_content,left(m.caption,2000) caption,m.media_url,m.created_at,m.is_history
 from messages m where m.conversation_id=s.id and m.created_at>=greatest(s.start_at,coalesce(s.boundary_at,s.start_at))
 and (s.end_at is null or m.created_at<=s.end_at) order by m.created_at desc,m.id desc limit 120)m),'[]') messages,
 (select count(*)>120 from messages m where m.conversation_id=s.id and m.created_at>=greatest(s.start_at,coalesce(s.boundary_at,s.start_at)) and (s.end_at is null or m.created_at<=s.end_at)) truncated,
 coalesce((select m.id::text||'@'||coalesce(m.updated_at,m.created_at)::text from messages m where m.conversation_id=s.id and m.direction='inbound' order by m.created_at desc,m.id desc limit 1),'empty') revision
 from scopes s
)
select coalesce(jsonb_object_agg(s.key,jsonb_build_object(
 'ambiguous',coalesce(s.other_open>0 or s.review_required,false) and jsonb_array_length(s.manual)=0,
 'bindings',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'start_at',m.start_at,'end_at',m.end_at,'usable',m.usable,'source',m.source,'revision',m.revision,'boundary_at',m.boundary_at)) from messages_by_scope m where m.key=s.key),'[]'),
 'messages',coalesce((select jsonb_agg(v) from messages_by_scope m cross join lateral jsonb_array_elements(m.messages) v where m.key=s.key),'[]'),
 'truncated',coalesce((select bool_or(m.truncated) from messages_by_scope m where m.key=s.key),false))), '{}') from sessions s;
$$;
revoke all on function public.icetak_order_detail_context(jsonb) from public,anon,authenticated;
grant execute on function public.icetak_order_detail_context(jsonb) to service_role;
