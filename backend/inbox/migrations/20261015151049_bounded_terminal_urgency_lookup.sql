-- Bound lookups before testing fulfillment; avoid evaluating the helper for every inbox row.
create or replace function public.conversation_order_fulfilled(p_conversation_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 with c as materialized(select * from public.conversations where id=p_conversation_id),
 matched as materialized(
  select s.id,s.order_status,s.shipped_at,s.placed_at,s.created_at
  from c join public.external_order_summaries s on s.source_channel='shopee'
    and s.shop_id=c.metadata->>'shop_id'
    and (s.shopee_buyer_id=c.external_customer_id or
      (s.shopee_buyer_id is null and lower(s.shopee_username)=lower(c.metadata->>'username')))
  where c.channel='shopee'
  union
  select s.id,s.order_status,s.shipped_at,s.placed_at,s.created_at
  from public.conversation_order_links l join public.external_order_summaries s
   on s.source_project=l.source_project and s.order_no=l.order_no
  where l.conversation_id=p_conversation_id and l.unlinked_at is null
 )
 select coalesce((select upper(coalesce(order_status,'')) in
  ('SHIPPED','TO_CONFIRM_RECEIVE','COMPLETED','CANCELLED','TO_RETURN','RETURNED')
  or shipped_at is not null from matched
  order by coalesce(placed_at,created_at) desc,created_at desc,id desc limit 1),false);
$$;
create or replace function public.clear_fulfilled_order_urgency()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_id uuid;
begin
 for v_id in
  select c.id from public.conversations c
   where c.channel='shopee' and new.source_channel='shopee'
    and new.shop_id=c.metadata->>'shop_id'
    and (new.shopee_buyer_id=c.external_customer_id or
      (new.shopee_buyer_id is null and lower(new.shopee_username)=lower(c.metadata->>'username')))
  union
  select l.conversation_id from public.conversation_order_links l
   where l.unlinked_at is null and l.source_project=new.source_project and l.order_no=new.order_no
  order by 1
 loop
  if public.conversation_order_fulfilled(v_id) then
   update public.conversations set
    priority=case when priority='urgent' then 'normal' else priority end,
    ai_urgency='normal',ai_priority_score=least(ai_priority_score,30),ai_due_date=null,
    metadata=coalesce(metadata,'{}'::jsonb)-'priority_source'
   where id=v_id;
  end if;
 end loop;
 return new;
end $$;
