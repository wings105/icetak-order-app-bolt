-- Apply to Unified Inbox ONLY. Narrow read-only phone/buyer fallback for current task sessions.
create function public.icetak_task_automation_context(p_orders jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$
with requests as materialized (
 select x,x->>'key' key,x->>'reference' reference,nullif(x->>'buyer_user_id','') buyer,
 case when x->>'placed_at' ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T' then (x->>'placed_at')::timestamptz end placed,
 case when regexp_replace(coalesce(x->>'phone',''),'[^0-9]','','g') like '0%'
 then '6'||regexp_replace(x->>'phone','[^0-9]','','g') else regexp_replace(coalesce(x->>'phone',''),'[^0-9]','','g') end phone,
 coalesce((x->>'closed')::boolean,false) closed from jsonb_array_elements(p_orders) x where jsonb_array_length(p_orders) between 1 and 50
),original as materialized (select * from jsonb_each(public.icetak_task_brief_context(p_orders))),
candidates as materialized (
 select distinct r.key,c.id,c.channel,
 case when c.channel='whatsapp' then 'order_phone' else 'buyer_identity' end source
 from requests r join public.conversations c on not c.archived and not r.closed and r.placed is not null
 where (c.channel='whatsapp' and length(r.phone) between 9 and 15 and exists(
  select 1 from public.customer_identities i where i.customer_id=c.customer_id and i.channel='whatsapp' and i.normalized_phone=r.phone))
 or (c.channel='shopee' and r.buyer is not null and c.external_customer_id=r.buyer)
), safe as materialized (
 select r.*,c.id,c.channel,c.source,
 (select count(*) from candidates other where other.key=c.key and other.channel=c.channel)=1 unique_chat,
 exists(select 1 from public.external_order_summaries o where o.active_order and o.order_no<>r.reference
  and ((r.phone<>'' and o.customer_phone_normalized=r.phone) or (r.buyer is not null and o.shopee_buyer_id=r.buyer))) other_active,
 (select max(s.cutoff_at) from public.shopee_order_sessions s where s.order_no<>r.reference and s.cutoff_at<=r.placed and
  (s.conversation_id=c.id or exists(select 1 from public.conversation_order_links l where l.order_no=s.order_no and l.conversation_id=c.id and l.unlinked_at is null))) previous_cutoff,
 exists(select 1 from public.conversation_order_links l where l.conversation_id=c.id and l.order_no<>r.reference and l.unlinked_at is null
  and not exists(select 1 from public.shopee_order_sessions s where s.order_no=l.order_no and s.cutoff_at<=r.placed)) unknown_boundary
 from requests r join candidates c using(key)
 where not exists(select 1 from original o cross join lateral jsonb_array_elements(o.value->'bindings') b where o.key=r.key and b->>'id'=c.id::text)
),scopes as materialized (
 select *,greatest(case when unknown_boundary then placed else placed-interval '7 days' end,coalesce(previous_cutoff,'-infinity'::timestamptz)) start_at,
 unique_chat and not other_active usable from safe
),reads as materialized (
 select s.*,coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at,m.id) from (
  select m.id,m.conversation_id,m.channel,m.direction,m.message_type,left(m.text_content,2000) text_content,left(m.caption,2000) caption,m.media_url,m.created_at,m.is_history
  from public.messages m where m.conversation_id=s.id and m.created_at>=s.start_at and not m.is_history
  order by m.created_at desc,m.id desc limit 120)m),'[]') messages,
 (select count(*)>120 from public.messages m where m.conversation_id=s.id and m.created_at>=s.start_at and not m.is_history) truncated
 from scopes s
)
select coalesce(jsonb_object_agg(r.key,coalesce(o.value,'{}')||jsonb_build_object(
 'bindings',coalesce(o.value->'bindings','[]')||coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'channel',a.channel,'start_at',a.start_at,'end_at',null,'usable',a.usable,'source',a.source)) from reads a where a.key=r.key),'[]'),
 'messages',coalesce(o.value->'messages','[]')||coalesce((select jsonb_agg(v) from reads a cross join lateral jsonb_array_elements(a.messages) v where a.key=r.key and a.usable),'[]'),
 'ambiguous',coalesce((o.value->>'ambiguous')::boolean,false) or exists(select 1 from reads a where a.key=r.key and not a.usable),
 'truncated',coalesce((o.value->>'truncated')::boolean,false) or exists(select 1 from reads a where a.key=r.key and a.usable and a.truncated)
 )),'{}') from requests r left join original o on o.key=r.key;
$$;
revoke all on function public.icetak_task_automation_context(jsonb) from public,anon,authenticated;
grant execute on function public.icetak_task_automation_context(jsonb) to service_role;
notify pgrst,'reload schema';
