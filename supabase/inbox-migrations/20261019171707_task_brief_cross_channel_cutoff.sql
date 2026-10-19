-- Opt-in Task Workspace context. CRM/draft extraction keeps its original session contract.
create or replace function public.icetak_task_brief_context(p_orders jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$
with requests as materialized (
 select x->>'key' key,x->>'reference' reference,coalesce((x->>'closed')::boolean,false) closed,
 coalesce((x->>'single_item_scope')::boolean,false) single_item_scope,
 case when x->>'placed_at' ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T' then (x->>'placed_at')::timestamptz end placed_at
 from jsonb_array_elements(p_orders) x where jsonb_array_length(p_orders) between 1 and 50
), original as materialized (
 select * from jsonb_each(public.icetak_order_detail_context(p_orders))
), bindings as (
 select r.*,o.value ctx,b,
 (b->>'id')::uuid conversation_id,(b->>'start_at')::timestamptz original_start,
 nullif(b->>'end_at','')::timestamptz end_at,
 exists(select 1 from public.shopee_order_sessions s where s.conversation_id=(b->>'id')::uuid and s.order_no<>r.reference and s.status='open') other_open,
 (select max(s.cutoff_at) from public.shopee_order_sessions s where (s.conversation_id=(b->>'id')::uuid or exists(select 1 from public.conversation_order_links old_link where old_link.conversation_id=(b->>'id')::uuid and old_link.source_project='icetak-order-system' and old_link.order_no=s.order_no and old_link.unlinked_at is null)) and s.order_no<>r.reference and s.cutoff_at<=coalesce(r.placed_at,(b->>'start_at')::timestamptz)) previous_cutoff,
 exists(select 1 from public.conversation_order_links l where l.conversation_id=(b->>'id')::uuid and l.source_project='icetak-order-system'
   and l.order_no<>r.reference and l.unlinked_at is null and l.metadata->>'rule'='exact_order_message_v1'
   and (l.metadata->>'message_at')::timestamptz<coalesce(r.placed_at,(b->>'start_at')::timestamptz)
   and not exists(select 1 from public.shopee_order_sessions s where s.order_no=l.order_no and s.cutoff_at<=coalesce(r.placed_at,(b->>'start_at')::timestamptz))) unknown_previous
 from requests r join original o on o.key=r.key cross join lateral jsonb_array_elements(o.value->'bindings') b
), scopes as materialized (
 select *,
 case when b->>'source' in ('shopee_session','exact_order_id') and not closed and not other_open and not unknown_previous
  then greatest(coalesce(placed_at,original_start)-interval '7 days',coalesce(previous_cutoff,'-infinity'::timestamptz),coalesce(nullif(b->>'boundary_at','')::timestamptz,'-infinity'::timestamptz))
  else original_start end start_at,
 not closed and (coalesce((b->>'usable')::boolean,false) or (b->>'source'='shopee_session' and single_item_scope and not other_open
  and exists(select 1 from public.shopee_order_sessions s where s.order_no=reference and s.conversation_id=bindings.conversation_id and s.status='open'))) usable
 from bindings
), reads as materialized (
 select s.*,
 coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at,m.id) from (
  select m.id,m.conversation_id,m.channel,m.direction,m.message_type,left(m.text_content,2000) text_content,left(m.caption,2000) caption,m.media_url,m.created_at,m.is_history
  from public.messages m where m.conversation_id=s.conversation_id and m.created_at>=s.start_at and (s.end_at is null or m.created_at<s.end_at)
  order by m.created_at desc,m.id desc limit 120)m),'[]') messages,
 (select count(*)>120 from public.messages m where m.conversation_id=s.conversation_id and m.created_at>=s.start_at and (s.end_at is null or m.created_at<s.end_at)) truncated,
 coalesce((select m.id::text||'@'||coalesce(m.updated_at,m.created_at)::text from public.messages m where m.conversation_id=s.conversation_id and m.direction='inbound'
  and m.created_at>=s.start_at and (s.end_at is null or m.created_at<s.end_at) order by m.created_at desc,m.id desc limit 1),'empty') revision
 from scopes s
)
select coalesce(jsonb_object_agg(r.key,jsonb_build_object(
 'ambiguous',coalesce((o.value->>'ambiguous')::boolean,false) and not exists(select 1 from reads m where m.key=r.key and m.usable),
 'bindings',coalesce((select jsonb_agg(m.b||jsonb_build_object('start_at',m.start_at,'usable',m.usable,'revision',m.revision,'preorder',m.start_at<m.original_start)) from reads m where m.key=r.key),'[]'),
 'messages',coalesce((select jsonb_agg(v) from reads m cross join lateral jsonb_array_elements(m.messages) v where m.key=r.key and m.usable),'[]'),
 'truncated',coalesce((select bool_or(m.truncated and m.usable) from reads m where m.key=r.key),false))), '{}')
from requests r join original o on o.key=r.key;
$$;
revoke all on function public.icetak_task_brief_context(jsonb) from public,anon,authenticated;
grant execute on function public.icetak_task_brief_context(jsonb) to service_role;
notify pgrst,'reload schema';
