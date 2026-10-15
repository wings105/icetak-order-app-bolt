-- Chat reply state is independent of the order extraction session.
create or replace function public.shopee_reply_allowed(p_conversation_id uuid)
returns boolean language sql security invoker set search_path='' as $$
 select true;
$$;
comment on function public.shopee_reply_allowed(uuid) is
 'Compatibility helper: fulfillment never suppresses Shopee chat reply state. Not a send authorization check.';

create or replace function public.guard_shopee_reply_state()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.channel='shopee' and new.needs_reply and
    new.manual_replied_at is not null and
    new.manual_replied_at>=coalesce(new.last_inbound_at,'-infinity'::timestamptz)
 then new.needs_reply:=false;new.unread_count:=0;end if;
 return new;
end $$;

-- Latest matched order wins, scoped by shop/buyer; explicit links support WhatsApp too.
-- Do not let an older shipped order remove urgency from a newer active order.
create or replace function public.conversation_order_fulfilled(p_conversation_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select coalesce((
  select upper(coalesce(s.order_status,'')) in
   ('SHIPPED','TO_CONFIRM_RECEIVE','COMPLETED','CANCELLED','TO_RETURN','RETURNED')
    or s.shipped_at is not null
  from public.conversations c
  join public.external_order_summaries s on
   (c.channel='shopee' and s.source_channel='shopee' and s.shop_id=c.metadata->>'shop_id'
     and (s.shopee_buyer_id=c.external_customer_id or
      (s.shopee_buyer_id is null and lower(s.shopee_username)=lower(c.metadata->>'username'))))
   or exists(select 1 from public.conversation_order_links l
     where l.conversation_id=c.id and l.unlinked_at is null
      and l.source_project=s.source_project and l.order_no=s.order_no)
  where c.id=p_conversation_id
  order by coalesce(s.placed_at,s.created_at) desc,s.created_at desc,s.id desc limit 1
 ),false);
$$;
revoke all on function public.conversation_order_fulfilled(uuid) from public,anon;
grant execute on function public.conversation_order_fulfilled(uuid) to authenticated,service_role;

create or replace function public.guard_fulfilled_conversation_urgency()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if public.conversation_order_fulfilled(new.id) then
  if new.priority='urgent' then new.priority:='normal';end if;
  new.ai_urgency:='normal';
  new.ai_priority_score:=least(new.ai_priority_score,30);
  new.ai_due_date:=null;
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)-'priority_source';
  delete from public.conversation_tags ct using public.tags t
   where ct.conversation_id=new.id and ct.tag_id=t.id and t.slug='urgent';
 end if;
 return new;
end $$;
create trigger zz_guard_fulfilled_conversation_urgency
 before update on public.conversations for each row
 execute function public.guard_fulfilled_conversation_urgency();

create or replace function public.guard_fulfilled_urgent_tag()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from public.tags where id=new.tag_id and slug='urgent')
    and public.conversation_order_fulfilled(new.conversation_id)
 then return null;end if;
 return new;
end $$;
create trigger guard_fulfilled_urgent_tag before insert or update on public.conversation_tags
 for each row execute function public.guard_fulfilled_urgent_tag();

create or replace function public.clear_fulfilled_order_urgency()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 update public.conversations c set priority=case when priority='urgent' then 'normal' else priority end,
  ai_urgency='normal',ai_priority_score=least(ai_priority_score,30),ai_due_date=null,
  metadata=coalesce(c.metadata,'{}'::jsonb)-'priority_source'
 where (
  (c.channel='shopee' and new.source_channel='shopee' and new.shop_id=c.metadata->>'shop_id'
   and (new.shopee_buyer_id=c.external_customer_id or
    (new.shopee_buyer_id is null and lower(new.shopee_username)=lower(c.metadata->>'username'))))
  or exists(select 1 from public.conversation_order_links l where l.conversation_id=c.id
    and l.unlinked_at is null and l.source_project=new.source_project and l.order_no=new.order_no)
 ) and public.conversation_order_fulfilled(c.id);
 return new;
end $$;
create trigger zz_clear_fulfilled_order_urgency after insert or update on public.external_order_summaries
 for each row execute function public.clear_fulfilled_order_urgency();
revoke all on function public.guard_fulfilled_conversation_urgency(),
 public.guard_fulfilled_urgent_tag(),public.clear_fulfilled_order_urgency() from public,anon,authenticated;
grant execute on function public.guard_fulfilled_conversation_urgency(),
 public.guard_fulfilled_urgent_tag(),public.clear_fulfilled_order_urgency() to service_role;

CREATE OR REPLACE FUNCTION public.sync_shopee_order_session_from_summary()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_prev_cutoff timestamptz;
  v_conversation_id uuid;
  v_order_ref_at timestamptz;
  v_distinct_items integer;
  v_session_start timestamptz;
begin
  if lower(coalesce(new.source_channel,'')) <> 'shopee'
     or coalesce(new.shopee_username,'') = ''
     or coalesce(new.order_no,'') = '' then
    return new;
  end if;

  select max(coalesce(s.cutoff_at, eos.shipped_at))
  into v_prev_cutoff
  from public.shopee_order_sessions s
  left join public.external_order_summaries eos on eos.order_no = s.order_no
  where lower(s.shopee_username) = lower(new.shopee_username)
    and s.order_no <> new.order_no
    and eos.shop_id is not distinct from new.shop_id
    and coalesce(s.cutoff_at, eos.shipped_at) is not null
    and coalesce(s.cutoff_at, eos.shipped_at) <= coalesce(new.placed_at, new.created_at, now());

  select m.conversation_id, min(m.created_at)
  into v_conversation_id, v_order_ref_at
  from public.message_references mr
  join public.messages m on m.id = mr.message_id
  where mr.provider = 'shopee'
    and mr.reference_type = 'order'
    and mr.external_id = new.order_no
    and exists(select 1 from public.conversations c where c.id=m.conversation_id and c.metadata->>'shop_id'=new.shop_id)
  group by m.conversation_id
  order by min(m.created_at) asc
  limit 1;

  if v_conversation_id is null then
    select c.id
    into v_conversation_id
    from public.conversations c
    where c.channel = 'shopee'
      and c.metadata->>'shop_id'=new.shop_id
      and (c.external_customer_id=new.shopee_buyer_id or (new.shopee_buyer_id is null and lower(coalesce(c.metadata->>'username',''))=lower(new.shopee_username)))
    order by c.last_message_at desc nulls last, c.updated_at desc
    limit 1;
  end if;

  v_session_start := coalesce(
    greatest(v_order_ref_at, v_prev_cutoff),
    v_order_ref_at,
    v_prev_cutoff,
    new.placed_at - interval '48 hours',
    new.created_at,
    now()
  );

  select count(distinct coalesce(x->>'provider_item_id', x->>'item_sku', x->>'title', x::text))
  into v_distinct_items
  from jsonb_array_elements(coalesce(new.items,'[]'::jsonb)) x;

  insert into public.shopee_order_sessions (
    order_no, shopee_username, conversation_id, started_at, cutoff_at, cutoff_reason,
    status, payment_status, order_status, item_count, distinct_item_count,
    review_required, ambiguity_reason, confidence_cap, metadata, updated_at
  )
  values (
    new.order_no, new.shopee_username, v_conversation_id, v_session_start,
    case when upper(coalesce(new.order_status,'')) in ('SHIPPED','TO_CONFIRM_RECEIVE','COMPLETED','CANCELLED','TO_RETURN','RETURNED') then coalesce(new.shipped_at,nullif(new.metadata->>'latest_provider_update_at','')::timestamptz,new.order_updated_at,new.created_at,now()) else null end,
    case when upper(coalesce(new.order_status,'')) in ('SHIPPED','TO_CONFIRM_RECEIVE','COMPLETED','CANCELLED','TO_RETURN','RETURNED') then case when new.shipped_at is not null then 'shopee_raw_status_shipped' else 'shopee_terminal_status' end else null end,
    case when upper(coalesce(new.order_status,'')) in ('SHIPPED','TO_CONFIRM_RECEIVE','COMPLETED','CANCELLED','TO_RETURN','RETURNED') then 'closed' else 'open' end,
    new.payment_status, new.order_status, coalesce(new.item_count,0), coalesce(v_distinct_items,0),
    false, null, 1,
    jsonb_build_object(
      'source','external_order_summaries',
      'source_payload_version',new.source_payload_version,
      'session_start_source',case when v_order_ref_at is not null then 'shopee_order_reference_message' else 'fallback' end
    ),
    now()
  )
  on conflict (order_no) do update set
    shopee_username = excluded.shopee_username,
    conversation_id = coalesce(excluded.conversation_id, public.shopee_order_sessions.conversation_id),
    started_at = case
      when excluded.metadata->>'session_start_source' = 'shopee_order_reference_message' then excluded.started_at
      else least(public.shopee_order_sessions.started_at, excluded.started_at)
    end,
    cutoff_at = coalesce(excluded.cutoff_at, public.shopee_order_sessions.cutoff_at),
    cutoff_reason = coalesce(excluded.cutoff_reason, public.shopee_order_sessions.cutoff_reason),
    status = case when excluded.cutoff_at is not null then 'closed' else public.shopee_order_sessions.status end,
    payment_status = excluded.payment_status,
    order_status = excluded.order_status,
    item_count = excluded.item_count,
    distinct_item_count = excluded.distinct_item_count,
    metadata = public.shopee_order_sessions.metadata || excluded.metadata,
    updated_at = now();

  -- Closing an order session must preserve chat needs_reply and unread_count.
  return new;
end;
$function$
;

-- Repair existing fulfillment urgency only. Reply flags are recovered separately from provider evidence.
update public.conversations c
 set priority=case when priority='urgent' then 'normal' else priority end,
 ai_urgency='normal',ai_priority_score=least(ai_priority_score,30),ai_due_date=null,
 metadata=coalesce(c.metadata,'{}'::jsonb)-'priority_source'
 where public.conversation_order_fulfilled(c.id)
 and (priority='urgent' or ai_urgency in ('high','critical','urgent')
  or exists(select 1 from public.conversation_tags ct join public.tags t on t.id=ct.tag_id
    where ct.conversation_id=c.id and t.slug='urgent'));
