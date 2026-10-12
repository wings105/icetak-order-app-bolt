-- History recovery cannot promote an old order into the active workspace.
CREATE OR REPLACE FUNCTION public.ingest_shopee_chat_event(p_source_event_id uuid, p_source_received_at timestamp with time zone, p_payload jsonb, p_is_history boolean DEFAULT false)
 RETURNS TABLE(customer_id uuid, conversation_id uuid, message_id uuid, inserted boolean)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_envelope_shop_id text;
  v_region text;
  v_provider_event_id text;
  v_message jsonb;
  v_content jsonb;
  v_source_content jsonb;
  v_provider_message_id text;
  v_external_conversation_id text;
  v_provider_message_type text;
  v_chat_status text;
  v_from_id text;
  v_to_id text;
  v_from_shop_id text;
  v_to_shop_id text;
  v_from_username text;
  v_to_username text;
  v_external_customer_id text;
  v_customer_username text;
  v_buyer_shop_id text;
  v_direction text;
  v_sender_type text;
  v_message_type text;
  v_text_content text;
  v_media_url text;
  v_reply_to_message_id text;
  v_order_sn text;
  v_item_id text;
  v_provider_created_at timestamptz;
  v_customer_id uuid;
  v_conversation_id uuid;
  v_message_id uuid;
  v_inserted boolean := false;
  v_existing record;
begin
  if p_source_event_id is null then
    raise exception 'source_event_id is required';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload must be a JSON object';
  end if;
  if coalesce(p_payload->>'code', '') <> '10' then
    raise exception 'payload is not a Shopee chat event (code 10)';
  end if;

  select r.conversation_id, r.message_id
    into v_existing
  from public.shopee_chat_ingest_receipts r
  where r.source_event_id = p_source_event_id;

  if found then
    select c.customer_id into v_customer_id
    from public.conversations c
    where c.id = v_existing.conversation_id;

    return query
    select v_customer_id, v_existing.conversation_id, v_existing.message_id, false;
    return;
  end if;

  v_envelope_shop_id := nullif(p_payload->>'shop_id', '');
  v_region := upper(coalesce(nullif(p_payload #>> '{data,region}', ''), 'MY'));
  v_provider_event_id := coalesce(nullif(p_payload->>'msg_id', ''), p_source_event_id::text);
  v_message := p_payload #> '{data,content}';

  if v_message is null or jsonb_typeof(v_message) <> 'object' then
    raise exception 'Shopee chat message body is missing';
  end if;

  v_content := coalesce(v_message->'content', '{}'::jsonb);
  v_source_content := coalesce(v_message->'source_content', '{}'::jsonb);
  v_provider_message_id := coalesce(
    nullif(v_message->>'message_id', ''),
    v_provider_event_id
  );
  v_external_conversation_id := nullif(v_message->>'conversation_id', '');
  v_provider_message_type := lower(coalesce(nullif(v_message->>'message_type', ''), 'unknown'));
  v_chat_status := lower(coalesce(nullif(v_message->>'status', ''), 'unknown'));
  v_from_id := nullif(v_message->>'from_id', '');
  v_to_id := nullif(v_message->>'to_id', '');
  v_from_shop_id := nullif(v_message->>'from_shop_id', '');
  v_to_shop_id := nullif(v_message->>'to_shop_id', '');
  v_from_username := nullif(v_message->>'from_user_name', '');
  v_to_username := nullif(v_message->>'to_user_name', '');

  if v_external_conversation_id is null or v_provider_message_id is null then
    raise exception 'Shopee conversation_id and message_id are required';
  end if;

  if v_to_shop_id = v_envelope_shop_id then
    v_direction := 'inbound';
    v_sender_type := 'customer';
    v_external_customer_id := v_from_id;
    v_customer_username := coalesce(v_from_username, v_from_id, 'Shopee customer');
    v_buyer_shop_id := v_from_shop_id;
  elsif v_from_shop_id = v_envelope_shop_id then
    v_direction := 'outbound';
    v_sender_type := 'seller';
    v_external_customer_id := v_to_id;
    v_customer_username := coalesce(v_to_username, v_to_id, 'Shopee customer');
    v_buyer_shop_id := v_to_shop_id;
  elsif v_chat_status = 'user_chat' then
    v_direction := 'inbound';
    v_sender_type := 'customer';
    v_external_customer_id := v_from_id;
    v_customer_username := coalesce(v_from_username, v_from_id, 'Shopee customer');
    v_buyer_shop_id := v_from_shop_id;
  elsif v_chat_status = 'shop_chat' then
    v_direction := 'outbound';
    v_sender_type := 'seller';
    v_external_customer_id := v_to_id;
    v_customer_username := coalesce(v_to_username, v_to_id, 'Shopee customer');
    v_buyer_shop_id := v_to_shop_id;
  else
    raise exception 'Unable to determine Shopee message direction';
  end if;

  if v_external_customer_id is null then
    raise exception 'Shopee customer ID is missing';
  end if;

  if coalesce(v_message->>'created_timestamp', '') ~ '^\d+(\.\d+)?$' then
    v_provider_created_at := to_timestamp((v_message->>'created_timestamp')::double precision);
  elsif coalesce(p_payload->>'timestamp', '') ~ '^\d+(\.\d+)?$' then
    v_provider_created_at := to_timestamp((p_payload->>'timestamp')::double precision);
  else
    v_provider_created_at := coalesce(p_source_received_at, now());
  end if;

  v_message_type := case
    when v_provider_message_type in ('text', 'image', 'document', 'audio', 'video', 'sticker')
      then v_provider_message_type
    else 'system'
  end;

  v_order_sn := coalesce(
    nullif(v_content->>'order_sn', ''),
    nullif(v_source_content->>'order_sn', '')
  );
  v_item_id := coalesce(
    nullif(v_content->>'item_id', ''),
    nullif(v_source_content->>'item_id', '')
  );

  v_text_content := case
    when v_provider_message_type = 'text'
      then nullif(v_content->>'text', '')
    when v_provider_message_type = 'image'
      then '[Image]'
    when v_provider_message_type = 'order'
      then '[Shopee order: ' || coalesce(v_order_sn, 'unknown') || ']'
    when v_provider_message_type = 'item'
      then '[Shopee item: ' || coalesce(v_item_id, 'unknown') || ']'
    else '[' || initcap(v_provider_message_type) || ']'
  end;
  v_media_url := case
    when v_message_type in ('image', 'document', 'audio', 'video', 'sticker')
      then nullif(v_content->>'url', '')
    else null
  end;
  v_reply_to_message_id := nullif(v_message #>> '{quoted_msg,message_id}', '');

  perform pg_advisory_xact_lock(hashtextextended('shopee-customer:' || v_external_customer_id, 0));

  select ci.customer_id
    into v_customer_id
  from public.customer_identities ci
  where ci.channel = 'shopee'
    and ci.external_id = v_external_customer_id;

  if v_customer_id is null then
    insert into public.customers(display_name)
    values (v_customer_username)
    returning id into v_customer_id;

    insert into public.customer_identities(
      customer_id,
      channel,
      external_id,
      username,
      is_verified,
      match_confidence,
      metadata
    ) values (
      v_customer_id,
      'shopee',
      v_external_customer_id,
      v_customer_username,
      true,
      'exact_provider_id',
      jsonb_strip_nulls(jsonb_build_object(
        'region', v_region,
        'buyer_shop_id', v_buyer_shop_id,
        'shop_id', v_envelope_shop_id
      ))
    );
  else
    update public.customer_identities
       set username = coalesce(v_customer_username, username),
           is_verified = true,
           match_confidence = 'exact_provider_id',
           metadata = metadata || jsonb_strip_nulls(jsonb_build_object(
             'region', v_region,
             'buyer_shop_id', v_buyer_shop_id,
             'shop_id', v_envelope_shop_id
           ))
     where channel = 'shopee'
       and external_id = v_external_customer_id;

    update public.customers
       set display_name = coalesce(v_customer_username, display_name)
     where id = v_customer_id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('shopee-conversation:' || v_external_conversation_id, 0));

  insert into public.conversations(
    customer_id,
    channel,
    external_conversation_id,
    external_customer_id,
    status,
    metadata
  ) values (
    v_customer_id,
    'shopee',
    v_external_conversation_id,
    v_external_customer_id,
    'open',
    jsonb_strip_nulls(jsonb_build_object(
      'provider', 'shopee',
      'region', v_region,
      'shop_id', v_envelope_shop_id,
      'buyer_shop_id', v_buyer_shop_id,
      'username', v_customer_username
    ))
  )
  on conflict (channel, external_conversation_id)
  do update set
    customer_id = coalesce(public.conversations.customer_id, excluded.customer_id),
    external_customer_id = coalesce(excluded.external_customer_id, public.conversations.external_customer_id),
    metadata = public.conversations.metadata || excluded.metadata
  returning id into v_conversation_id;

  insert into public.messages(
    conversation_id,
    channel,
    provider_message_id,
    direction,
    sender_type,
    message_type,
    provider_message_type,
    text_content,
    media_url,
    media_metadata,
    reply_to_provider_message_id,
    status,
    sent_at,
    created_at,
    source,
    is_history,
    raw_payload,
    source_event_id,
    source_received_at
  ) values (
    v_conversation_id,
    'shopee',
    v_provider_message_id,
    v_direction,
    v_sender_type,
    v_message_type,
    v_provider_message_type,
    v_text_content,
    v_media_url,
    case when jsonb_typeof(v_content) = 'object' then v_content else '{}'::jsonb end,
    v_reply_to_message_id,
    case when v_direction = 'inbound' then 'received' else 'sent' end,
    case when v_direction = 'outbound' then v_provider_created_at else null end,
    v_provider_created_at,
    'shopee_webhook',
    coalesce(p_is_history, false),
    p_payload,
    p_source_event_id,
    p_source_received_at
  )
  on conflict do nothing
  returning id into v_message_id;

  if v_message_id is null then
    select m.id, m.conversation_id
      into v_message_id, v_conversation_id
    from public.messages m
    where m.channel = 'shopee'
      and m.provider_message_id = v_provider_message_id
    limit 1;

    if v_message_id is null then
      raise exception 'Unable to resolve Shopee message after duplicate check';
    end if;
  else
    v_inserted := true;
  end if;

  if v_inserted then
    if v_direction = 'inbound' and not coalesce(p_is_history, false) then
      update public.conversations
         set last_message_at = greatest(coalesce(last_message_at, v_provider_created_at), v_provider_created_at),
             last_inbound_at = greatest(coalesce(last_inbound_at, v_provider_created_at), v_provider_created_at),
             last_customer_message_at = greatest(coalesce(last_customer_message_at, v_provider_created_at), v_provider_created_at),
             last_message_sender = case
               when last_message_at is null or v_provider_created_at >= last_message_at then 'customer'
               else last_message_sender
             end,
             unread_count = unread_count + 1,
             needs_reply = true,
             archived = false,
             status = 'open'
       where id = v_conversation_id;
    elsif v_direction = 'inbound' then
      update public.conversations
         set last_message_at = greatest(coalesce(last_message_at, v_provider_created_at), v_provider_created_at),
             last_inbound_at = greatest(coalesce(last_inbound_at, v_provider_created_at), v_provider_created_at),
             last_customer_message_at = greatest(coalesce(last_customer_message_at, v_provider_created_at), v_provider_created_at),
             last_message_sender = case
               when last_message_at is null or v_provider_created_at >= last_message_at then 'customer'
               else last_message_sender
             end
       where id = v_conversation_id;
    else
      update public.conversations
         set last_message_at = greatest(coalesce(last_message_at, v_provider_created_at), v_provider_created_at),
             last_outbound_at = greatest(coalesce(last_outbound_at, v_provider_created_at), v_provider_created_at),
             last_message_sender = case
               when last_message_at is null or v_provider_created_at >= last_message_at then 'seller'
               else last_message_sender
             end,
             unread_count = case when coalesce(p_is_history, false) or v_chat_status in ('auto_reply','offwork_autoreply') then unread_count else 0 end,
             needs_reply = case when coalesce(p_is_history, false) or v_chat_status in ('auto_reply','offwork_autoreply') then needs_reply else false end
       where id = v_conversation_id;
    end if;
  end if;

  if v_order_sn is not null then
    insert into public.message_references(
      message_id, provider, reference_type, external_id, metadata
    ) values (
      v_message_id,
      'shopee',
      'order',
      v_order_sn,
      jsonb_build_object('shop_id', v_envelope_shop_id)
    ) on conflict do nothing;

    insert into public.conversation_order_links(
      conversation_id,
      source_project,
      external_order_id,
      order_no,
      is_primary,
      match_method,
      match_confidence,
      linked_by_label,
      metadata
    ) values (
      v_conversation_id,
      'icetak-order-system',
      v_order_sn,
      v_order_sn,
      not coalesce(p_is_history,false) and not exists (
        select 1
        from public.conversation_order_links l
        where l.conversation_id = v_conversation_id
          and l.is_primary = true
          and l.unlinked_at is null
      ),
      'exact_order_id',
      1,
      'Shopee webhook',
      jsonb_build_object('provider', 'shopee', 'shop_id', v_envelope_shop_id)
    ) on conflict do nothing;
  end if;

  if v_item_id is not null then
    insert into public.message_references(
      message_id, provider, reference_type, external_id, metadata
    ) values (
      v_message_id,
      'shopee',
      'item',
      v_item_id,
      jsonb_build_object('shop_id', coalesce(v_content->>'shop_id', v_envelope_shop_id))
    ) on conflict do nothing;
  end if;

  if v_message_type = 'image' and v_media_url is not null then
    insert into public.message_media(
      message_id,
      provider_media_id,
      media_type,
      download_status,
      cache_policy
    ) values (
      v_message_id,
      v_media_url,
      'image',
      'external',
      'provider_url'
    ) on conflict on constraint message_media_message_id_key do nothing;
  end if;

  insert into public.shopee_chat_ingest_receipts(
    source_event_id,
    provider_event_id,
    provider_message_id,
    conversation_id,
    message_id,
    source_received_at,
    provider_created_at,
    is_history,
    payload_fingerprint,
    metadata
  ) values (
    p_source_event_id,
    v_provider_event_id,
    v_provider_message_id,
    v_conversation_id,
    v_message_id,
    p_source_received_at,
    v_provider_created_at,
    coalesce(p_is_history, false),
    md5(p_payload::text),
    jsonb_strip_nulls(jsonb_build_object(
      'region', v_region,
      'shop_id', v_envelope_shop_id,
      'provider_message_type', v_provider_message_type
    ))
  )
  on conflict do nothing;

  return query
  select v_customer_id, v_conversation_id, v_message_id, v_inserted;
end;
$function$;
CREATE OR REPLACE FUNCTION public.index_shopee_order_reference_from_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_match text[];
  v_order_no text;
  v_username text;
  v_display_name text;
  v_buyer_id text;
  v_region text;
  v_shop_id text;
begin
  if coalesce(new.is_history,false) or new.channel is distinct from 'shopee'
     or coalesce(new.text_content, '') !~* '^\[Shopee order:[[:space:]]*[A-Za-z0-9_-]+\]$' then
    return new;
  end if;

  v_match := regexp_match(new.text_content, '(?i)^\[shopee order:[[:space:]]*([A-Za-z0-9_-]+)\]$');
  v_order_no := upper(nullif(v_match[1], ''));
  if v_order_no is null then
    return new;
  end if;

  select
    nullif(c.metadata ->> 'username', ''),
    nullif(cu.display_name, ''),
    nullif(c.external_customer_id, ''),
    coalesce(nullif(c.metadata ->> 'region', ''), 'MY'),
    nullif(c.metadata ->> 'shop_id', '')
  into v_username, v_display_name, v_buyer_id, v_region, v_shop_id
  from public.conversations c
  join public.customers cu on cu.id = c.customer_id
  where c.id = new.conversation_id;

  insert into public.external_order_summaries (
    source_project,
    source_channel,
    external_order_id,
    order_no,
    customer_name,
    shopee_username,
    shopee_buyer_id,
    payment_status,
    order_status,
    active_order,
    priority_level,
    metadata,
    last_synced_at,
    order_updated_at,
    source_payload_version,
    region,
    shop_id,
    detail_complete
  ) values (
    'icetak-order-system',
    'shopee',
    v_order_no,
    v_order_no,
    coalesce(v_username, v_display_name, v_buyer_id, 'Shopee customer'),
    coalesce(v_username, v_display_name),
    v_buyer_id,
    'unknown',
    'UNKNOWN',
    true,
    'P4',
    jsonb_build_object(
      'provider', 'shopee',
      'provisional', true,
      'source', 'shopee_chat_order_reference',
      'order_reference_message_id', new.id
    ),
    new.created_at,
    new.created_at,
    'shopee-chat-order-reference-v1',
    v_region,
    v_shop_id,
    false
  )
  on conflict (source_project, order_no) do nothing;

  insert into public.conversation_order_links (
    conversation_id,
    source_project,
    external_order_id,
    order_no,
    is_primary,
    match_method,
    match_confidence,
    linked_by_label,
    linked_at,
    metadata
  ) values (
    new.conversation_id,
    'icetak-order-system',
    v_order_no,
    v_order_no,
    false,
    'exact_order_id',
    1,
    'Shopee chat webhook',
    new.created_at,
    jsonb_build_object(
      'source', 'shopee_chat_order_reference',
      'message_id', new.id
    )
  )
  on conflict (conversation_id, source_project, order_no)
    where unlinked_at is null
  do nothing;

  return new;
end;
$function$;

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

  if v_conversation_id is not null and not public.shopee_reply_allowed(v_conversation_id) then
    update public.conversations set needs_reply=false,unread_count=0,updated_at=now() where id=v_conversation_id and (needs_reply or unread_count>0);
  end if;
  return new;
end;
$function$;

update public.shopee_order_sessions s set cutoff_at=(e.metadata->>'latest_provider_update_at')::timestamptz,updated_at=now()
from public.external_order_summaries e where e.order_no=s.order_no and s.status='closed' and s.cutoff_reason='shopee_terminal_status' and nullif(e.metadata->>'latest_provider_update_at','') is not null and (e.metadata->>'latest_provider_update_at')::timestamptz<s.cutoff_at;
