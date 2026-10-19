CREATE OR REPLACE FUNCTION public.search_unified_inbox(p_query text, p_limit integer DEFAULT 50)
 RETURNS TABLE(result_type text, result_id uuid, conversation_id uuid, order_summary_id uuid, title text, subtitle text, matched_field text, message_id uuid, snippet text, channel text, last_activity_at timestamp with time zone, rank numeric)
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $function$
with input as (
 select replace(replace(replace(trim(coalesce(p_query,'')),E'\\',E'\\\\'),'%','\%'),'_','\_') q,
 case when trim(coalesce(p_query,'')) ~ '^[+0-9() .-]+$' and length(regexp_replace(p_query,'[^0-9]','','g'))>=7
 then regexp_replace(p_query,'[^0-9]','','g') else '' end digits,
 case when trim(coalesce(p_query,'')) ~ '^[+0-9() .-]+$' and length(regexp_replace(p_query,'[^0-9]','','g'))>=7
 then case when regexp_replace(p_query,'[^0-9]','','g') like '60%' then '0'||substr(regexp_replace(p_query,'[^0-9]','','g'),3)
 when regexp_replace(p_query,'[^0-9]','','g') like '0%' then '60'||substr(regexp_replace(p_query,'[^0-9]','','g'),2)
 else regexp_replace(p_query,'[^0-9]','','g') end else '' end phone_alt
),
exact_orders as materialized (
 select o.* from public.external_order_summaries o
 where length(trim(coalesce(p_query,'')))>=2 and
 (lower(o.order_no)=lower(trim(p_query)) or lower(o.external_order_id)=lower(trim(p_query)))
),
order_candidates as (
 select * from exact_orders
 union all select o.* from public.external_order_summaries o where not exists(select 1 from exact_orders)
),
order_hits(result_type,result_id,conversation_id,order_summary_id,title,subtitle,matched_field,message_id,snippet,channel,last_activity_at,rank) as (
 select 'order'::text,o.id,l.conversation_id,o.id,
  coalesce(nullif(o.shopee_username,''),nullif(o.customer_name,''),o.order_no),
  concat_ws(' · ',o.order_no,o.order_status,o.payment_status),
  case when o.order_no ilike '%'||i.q||'%' or coalesce(o.external_order_id,'') ilike '%'||i.q||'%' then 'Order ID'
       when coalesce(o.shopee_username,'') ilike '%'||i.q||'%' then 'Username'
       when coalesce(o.shopee_buyer_id,'') ilike '%'||i.q||'%' then 'Buyer ID'
       when i.digits<>'' and (o.customer_phone_normalized like '%'||i.digits||'%' or o.customer_phone_normalized like '%'||i.phone_alt||'%') then 'Telefon'
       when coalesce(o.buyer_message,'') ilike '%'||i.q||'%' then 'Nota checkout'
       when o.items::text ilike '%'||i.q||'%' then 'Item'
       when coalesce(o.delivery_address,'') ilike '%'||i.q||'%' then 'Alamat' else 'Order' end,
  null::uuid,coalesce(nullif(o.buyer_message,''),nullif(o.delivery_address,''),o.order_no),
  o.source_channel,coalesce(o.order_updated_at,o.last_synced_at),
  greatest(similarity(coalesce(o.order_no,''),i.q),similarity(coalesce(o.shopee_username,''),i.q),similarity(coalesce(o.shopee_buyer_id,''),i.q))::numeric
   + case when lower(o.order_no)=lower(i.q) then 10 else 0 end
 from order_candidates o cross join input i
 left join lateral (
  select col.conversation_id from public.conversation_order_links col
  where col.source_project=o.source_project and col.order_no=o.order_no and col.unlinked_at is null
  order by col.is_primary desc,col.linked_at desc limit 1
 ) l on true
 where length(i.q)>=2 and (
  o.order_no ilike '%'||i.q||'%' or coalesce(o.external_order_id,'') ilike '%'||i.q||'%'
  or coalesce(o.shopee_username,'') ilike '%'||i.q||'%' or coalesce(o.shopee_buyer_id,'') ilike '%'||i.q||'%'
  or (i.digits<>'' and (o.customer_phone_normalized like '%'||i.digits||'%' or o.customer_phone_normalized like '%'||i.phone_alt||'%'))
  or coalesce(o.customer_name,'') ilike '%'||i.q||'%' or coalesce(o.buyer_message,'') ilike '%'||i.q||'%'
  or coalesce(o.delivery_address,'') ilike '%'||i.q||'%' or o.items::text ilike '%'||i.q||'%'
 )
),

message_matches as materialized (
 select distinct on (m.conversation_id) m.conversation_id,m.id,m.text_content,m.created_at
 from public.messages m cross join input i
 where length(i.q)>=2 and m.text_content ilike '%'||i.q||'%'
 order by m.conversation_id,m.created_at desc,m.id desc
),
customer_matches as materialized (
 select cu.id from public.customers cu cross join input i
 where length(i.q)>=2 and (cu.display_name ilike '%'||i.q||'%' or cu.email ilike '%'||i.q||'%')
 union
 select ci.customer_id from public.customer_identities ci cross join input i
 where length(i.q)>=2 and (ci.username ilike '%'||i.q||'%' or ci.external_id ilike '%'||i.q||'%'
 or (i.digits<>'' and (ci.normalized_phone like '%'||i.digits||'%' or ci.normalized_phone like '%'||i.phone_alt||'%')))
),
conversation_candidates as (
 select c.id from public.conversations c join customer_matches cm on cm.id=c.customer_id
 union select m.conversation_id from message_matches m
 union select h.conversation_id from order_hits h where h.conversation_id is not null
),
conversation_hits(result_type,result_id,conversation_id,order_summary_id,title,subtitle,matched_field,message_id,snippet,channel,last_activity_at,rank) as (
 select 'conversation'::text,c.id,c.id,null::uuid,
 coalesce(nullif(cu.display_name,''),ci.username,c.external_customer_id,'Customer'),
 concat_ws(' · ',c.channel,ci.phone),
 case when cu.display_name ilike '%'||i.q||'%' then 'Nama'
 when ci.username_match then 'Username' when ci.external_match then 'User ID'
 when ci.phone_match then 'Telefon' when m.id is not null then 'Mesej' else 'Conversation' end,
 m.id,coalesce(m.text_content,ci.username,cu.display_name),c.channel,
 greatest(coalesce(c.last_message_at,'epoch'::timestamptz),coalesce(m.created_at,'epoch'::timestamptz)),
 (case when lower(cu.display_name)=lower(i.q) then 5 else 0 end
 + coalesce(similarity(cu.display_name,i.q),0)+coalesce(ci.username_similarity,0))::numeric
 from conversation_candidates hit
 join public.conversations c on c.id=hit.id
 join public.customers cu on cu.id=c.customer_id cross join input i
 left join message_matches m on m.conversation_id=c.id
 left join lateral (
 select max(nullif(ci.username,'')) username,max(nullif(ci.normalized_phone,'')) phone,
 bool_or(ci.username ilike '%'||i.q||'%') username_match,
 bool_or(ci.external_id ilike '%'||i.q||'%') external_match,
 bool_or(i.digits<>'' and (ci.normalized_phone like '%'||i.digits||'%' or ci.normalized_phone like '%'||i.phone_alt||'%')) phone_match,
 max(similarity(ci.username,i.q)) username_similarity
 from public.customer_identities ci where ci.customer_id=c.customer_id
 ) ci on true
)
select * from (select * from order_hits union all select * from conversation_hits) hits
order by hits.rank desc,hits.last_activity_at desc nulls last,hits.result_id
limit greatest(1,least(coalesce(p_limit,50),100))
$function$;
revoke execute on function public.search_unified_inbox(text,integer) from public,anon;
grant execute on function public.search_unified_inbox(text,integer) to authenticated,service_role;
notify pgrst,'reload schema';
