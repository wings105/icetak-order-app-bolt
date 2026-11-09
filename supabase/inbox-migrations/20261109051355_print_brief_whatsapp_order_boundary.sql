-- Resolve each source independently. Customer order anchors are distinct from internal alerts.
create or replace function public.icetak_print_brief_shopee_context(p_scope jsonb)
returns jsonb language plpgsql stable set search_path = '' as $fn$
declare
  sn text := p_scope->>'order_no';
  phone text := p_scope->>'phone';
  buyer text := p_scope->>'buyer_user_id';
  placed timestamptz := (p_scope->>'placed_at')::timestamptz;
  day_start timestamptz;
  day_end timestamptz;
  channel_name text;
  conversation uuid;
  candidates int;
  anchor timestamptz;
  scope_start timestamptz;
  scope_end timestamptz;
  other_before timestamptz;
  previous_closed timestamptz := nullif(p_scope->>'previous_whatsapp_closed_at','')::timestamptz;
  closed timestamptz := nullif(p_scope->>'whatsapp_closed_at','')::timestamptz;
  whatsapp_last timestamptz;
  rows jsonb;
  messages jsonb := '[]';
  channels jsonb := '{}';
  states text;
  pattern text;
begin
  if sn !~ '^[0-9]{6}[A-Z0-9]{6,18}$' or placed is null or placed > now() then
    return jsonb_build_object('messages','[]'::jsonb,'unavailable',true,'reason','INVALID_ORDER_SCOPE');
  end if;
  day_start := date_trunc('day',placed at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur';
  day_end := day_start + interval '1 day';
  pattern := '(?i)\m'||sn||'\M';

  foreach channel_name in array array['shopee','whatsapp'] loop
    conversation := null; candidates := 0; anchor := null; rows := '[]';
    if channel_name='shopee' then
      select count(distinct c.id),min(c.id::text)::uuid,min(s.started_at)
        into candidates,conversation,anchor
      from public.shopee_order_sessions s
      join public.conversations c on c.id=s.conversation_id and c.channel='shopee' and not c.archived
      where s.order_no=sn;
      if candidates=0 and buyer ~ '^\d{3,20}$' then
        select count(*),min(c.id::text)::uuid into candidates,conversation
        from public.conversations c
        where c.channel='shopee' and not c.archived and c.external_customer_id=buyer;
        if candidates=1 then
          select min(m.created_at) into anchor from public.messages m
          where m.conversation_id=conversation and m.created_at>=day_start and m.created_at<day_end
            and m.direction='inbound' and not m.is_history and m.text_content ~ pattern;
        end if;
      end if;
    else
      -- Look up the WhatsApp identity first. Where CF Phone is missing, only an
      -- exact SN in a real inbound customer message can identify a candidate.
      select count(distinct c.id),min(c.id::text)::uuid,min(m.created_at)
        into candidates,conversation,anchor
      from public.messages m join public.conversations c on c.id=m.conversation_id
      where m.channel='whatsapp' and c.channel='whatsapp' and not c.archived
        and m.created_at>=day_start and m.created_at<least(now(),day_end+interval '2 days')
        and m.direction='inbound' and m.sender_type='customer' and not m.is_history
        and (m.text_content ~ pattern or m.caption ~ pattern)
        and (coalesce(phone,'')='' or exists(
          select 1 from public.customer_identities ci where ci.customer_id=c.customer_id
           and ci.channel='whatsapp' and ci.is_verified and ci.normalized_phone in (phone,'+'||phone,'0'||substring(phone from 3))
        ) or regexp_replace(coalesce(m.sender_phone,''),'[^0-9]','','g') in (phone,'0'||substring(phone from 3)));
    end if;
    if candidates>1 then states:='ambiguous';
    elsif candidates=0 or anchor is null or conversation is null then states:='identity_unavailable';
    else
      -- Start at the order day or prior order boundary. After another SN enters
      -- the thread, the following unlabelled messages belong to that transaction.
      select max(m.created_at) into other_before from public.messages m
       where m.conversation_id=conversation and m.created_at>=day_start and m.created_at<anchor
         and m.direction='inbound' and not m.is_history and
         exists(select 1
           from regexp_matches(concat_ws(' ',m.text_content,m.caption),'\m[0-9]{6}[A-Z0-9]{6,18}\M','gi') refs
           where upper(refs[1])<>sn);
      scope_start := case when other_before is not null or anchor>=day_end then anchor else day_start end;
      -- A ready brief closes at its last bound message, not the worker's later
      -- processing time. An exact newer anchor can predate that processing run.
      if channel_name='whatsapp' and previous_closed<anchor then
        scope_start:=greatest(scope_start,previous_closed+interval '1 microsecond');
      end if;
      select min(m.created_at) into scope_end from public.messages m
       where m.conversation_id=conversation and m.created_at>anchor and m.created_at<day_end+interval '2 days'
         and m.direction='inbound' and not m.is_history and
         exists(select 1
           from regexp_matches(concat_ws(' ',m.text_content,m.caption),'\m[0-9]{6}[A-Z0-9]{6,18}\M','gi') refs
           where upper(refs[1])<>sn);
      if channel_name='shopee' then
        select least(scope_end,min(s.started_at)) into scope_end from public.shopee_order_sessions s
         where s.conversation_id=conversation and s.order_no<>sn and s.started_at>anchor;
        if exists(select 1 from public.shopee_order_sessions s where s.conversation_id=conversation and s.order_no<>sn and s.started_at>=day_start and s.started_at<=anchor) then
          scope_start:=anchor;
        end if;
      end if;
      select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at,m.id),'[]'::jsonb) into rows
      from (
        select m.id,m.conversation_id,m.channel,m.direction,m.message_type,left(m.text_content,2000) text_content,
         left(m.caption,2000) caption,m.media_url,m.created_at,m.sent_at,m.is_history,m.provider_message_id,m.reply_to_provider_message_id
        from public.messages m where m.conversation_id=conversation and not m.is_history
         and m.created_at>=scope_start and m.created_at<least(coalesce(scope_end,now()),day_end+interval '2 days')
         and (channel_name<>'whatsapp' or closed is null or m.created_at<=closed)
         and (m.created_at<day_end or m.created_at<=anchor+interval '2 hours'
          or m.direction='inbound' and (m.text_content ~ pattern or m.caption ~ pattern)
          or m.reply_to_provider_message_id in (
            select a.provider_message_id from public.messages a where a.conversation_id=conversation
             and a.created_at>=scope_start and a.created_at<least(coalesce(scope_end,now()),day_end+interval '2 days')
             and a.direction='inbound' and (a.text_content ~ pattern or a.caption ~ pattern)
          ))
         and coalesce(m.sender_type,'')<>'system'
        order by m.created_at desc,m.id desc limit 121
      ) m;
      states:=case when jsonb_array_length(rows)>120 then 'truncated' when jsonb_array_length(rows)>0 then 'matched' else 'checked_no_relevant_message' end;
      if states='matched' then
        messages:=messages||rows;
        if channel_name='whatsapp' then
          select max((m->>'created_at')::timestamptz) into whatsapp_last
           from jsonb_array_elements(rows) m
           where m->>'direction'='inbound' and coalesce(m->>'text_content','')<>'[unsupported]';
        end if;
      end if;
    end if;
    channels:=channels||jsonb_build_object(channel_name,states);
  end loop;
  return jsonb_build_object('order_id',p_scope->>'order_id','messages',messages,'channels',channels,'whatsapp_last_at',whatsapp_last,
    'ambiguous',channels->>'shopee' in ('ambiguous','truncated') or channels->>'whatsapp' in ('ambiguous','truncated'),
    'unavailable',channels->>'shopee'='identity_unavailable' and channels->>'whatsapp'='identity_unavailable');
end
$fn$;
revoke all on function public.icetak_print_brief_shopee_context(jsonb) from public,anon,authenticated;
grant execute on function public.icetak_print_brief_shopee_context(jsonb) to service_role;
