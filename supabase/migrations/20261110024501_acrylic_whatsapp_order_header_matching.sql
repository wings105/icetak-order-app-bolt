-- Target: unified inbox database
CREATE OR REPLACE FUNCTION public.icetak_acrylic_brief_context(p_scope jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare preorder_product text; session_start timestamptz; preorder_start timestamptz; cid uuid; wa_cid uuid; wa_start timestamptz; wa_end timestamptz; wa_rows jsonb; wa_n int; n int; start_at timestamptz; end_at timestamptz; rows jsonb; buyer text:=p_scope->>'buyer_user_id'; phone text:=p_scope->>'phone';
begin
 if coalesce((p_scope->>'eligible')::boolean,false) is not true or coalesce(p_scope->>'order_id','') !~ '^[0-9a-f-]{36}$' then
 return jsonb_build_object('unavailable',true,'reason','INVALID_SCOPE','messages','[]'::jsonb);end if;
 start_at:=(p_scope->>'start_at')::timestamptz;end_at:=nullif(p_scope->>'end_at','')::timestamptz;
 if start_at is null or start_at>now() or (end_at is not null and end_at<=start_at) then
 return jsonb_build_object('unavailable',true,'reason','INVALID_WINDOW','messages','[]'::jsonb);end if;
 if p_scope->>'provider'='shopee' then
  if coalesce(buyer,'') !~ '^\d{3,20}$' then return jsonb_build_object('unavailable',true,'reason','BUYER_REQUIRED','messages','[]'::jsonb);end if;
  select count(*),min(c.id::text)::uuid into n,cid from public.conversations c
  where c.channel='shopee' and not c.archived and c.external_customer_id=buyer;
  if n<>1 then cid:=null;end if;
  if exists(select 1 from public.external_order_summaries o where o.active_order and o.shopee_buyer_id=buyer and o.order_no<>p_scope->>'order_no') then
   return jsonb_build_object('ambiguous',true,'reason','COMPETING_ACTIVE_ORDER','messages','[]'::jsonb);end if;
  -- Prefer the established session boundary, without extending into another order.
  select max(s.started_at) into session_start from public.shopee_order_sessions s
   where s.order_no=p_scope->>'order_no' and s.conversation_id=cid;
  if session_start is not null then
   -- A recent product-card episode may contain the buyer's design before checkout.
   -- Expand only the exact, single-item order session with no competing order.
   if p_scope->>'single_item_scope'='true' and session_start between (p_scope->>'placed_at')::timestamptz
    and (p_scope->>'placed_at')::timestamptz+interval '15 minutes' then
    select m.created_at,substring(m.text_content from '\[Shopee item: ([0-9]+)\]') into preorder_start,preorder_product
    from public.messages m
    where m.conversation_id=cid and m.direction='inbound' and not m.is_history
     and m.created_at>=greatest(start_at,(p_scope->>'placed_at')::timestamptz-interval '15 minutes')
     and m.created_at<(p_scope->>'placed_at')::timestamptz
     and m.text_content ~ '^\[Shopee item: [0-9]+\]$'
    order by m.created_at desc,m.id desc limit 1;
    if preorder_start is not null and not exists(
     select 1 from public.shopee_order_sessions other where other.conversation_id=cid
      and other.order_no<>p_scope->>'order_no' and other.started_at>=preorder_start and other.started_at<=session_start
    ) and not exists(
     select 1 from public.messages m where m.conversation_id=cid and not m.is_history
      and m.created_at>=preorder_start and m.created_at<session_start
      and m.text_content ~ '^\[Shopee order: [A-Z0-9]+\]$'
      and m.text_content<>('[Shopee order: '||(p_scope->>'order_no')||']')
    ) then
     start_at:=preorder_start;
    else
     start_at:=greatest(start_at,session_start);
    end if;
   else
    start_at:=greatest(start_at,session_start);
   end if;
  end if;
  select least(end_at,min(s.started_at)) into end_at from public.shopee_order_sessions s
   where s.conversation_id=cid and s.order_no<>p_scope->>'order_no' and s.started_at>(p_scope->>'placed_at')::timestamptz;
 else
  if nullif(p_scope->>'conversation_id','') is not null then
   select id into cid from public.conversations where id=(p_scope->>'conversation_id')::uuid and channel='whatsapp' and not archived;
  else
   select count(*),min(c.id::text)::uuid into n,cid from public.conversations c where c.channel='whatsapp' and not c.archived
    and exists(select 1 from public.customer_identities i where i.customer_id=c.customer_id and i.channel='whatsapp' and i.normalized_phone=phone and length(phone) between 9 and 15);
   if n<>1 then cid:=null;end if;
   if exists(select 1 from public.external_order_summaries o where o.active_order and o.order_system_order_id is distinct from (p_scope->>'order_id')::uuid and o.customer_phone_normalized=phone) then cid:=null;end if;
  end if;
 end if;

 -- Require verified phone AND exact inbound order number before importing WhatsApp.
 if p_scope->>'provider'='shopee' and coalesce(phone,'') ~ '^[0-9]{9,15}$' then
  select count(distinct c.id),min(c.id::text)::uuid,min(m.created_at) into wa_n,wa_cid,wa_start
  from public.conversations c join public.messages m on m.conversation_id=c.id
  where c.channel='whatsapp' and not c.archived and m.direction='inbound' and not m.is_history
   and substring(upper(btrim(split_part(coalesce(m.text_content,''),E'\n',1),E' \t\r')) from '^(?:(?:ORDER[[:blank:]]+(?:ID|NO)|ID)[[:blank:]]*[:#][[:blank:]]*)?([0-9]{6}[A-Z0-9]{6,18})$')=upper(p_scope->>'order_no')
   and m.created_at>=(p_scope->>'placed_at')::timestamptz-interval '2 days' and m.created_at<=now()
   and exists(select 1 from public.customer_identities i where i.customer_id=c.customer_id
    and i.channel='whatsapp' and i.normalized_phone=phone);
  if wa_n>1 then return jsonb_build_object('ambiguous',true,'reason','MULTIPLE_EXACT_WHATSAPP_ORDER_LINKS','messages','[]'::jsonb);end if;
  if wa_n<>1 then wa_cid:=null;end if;
  if wa_cid is not null then
   select min(m.created_at) into wa_end from public.messages m where m.conversation_id=wa_cid
    and m.direction='inbound' and not m.is_history and m.created_at>wa_start
    and substring(upper(btrim(split_part(coalesce(m.text_content,''),E'\n',1),E' \t\r')) from '^(?:(?:ORDER[[:blank:]]+(?:ID|NO)|ID)[[:blank:]]*[:#][[:blank:]]*)?([0-9]{6}[A-Z0-9]{6,18})$')<>upper(p_scope->>'order_no');
   select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at,m.id),'[]') into wa_rows from (
    select id,conversation_id,channel,direction,message_type,left(text_content,2000) text_content,left(caption,2000) caption,
      media_url,created_at,sent_at,is_history,provider_message_id,reply_to_provider_message_id
    from public.messages where conversation_id=wa_cid and not is_history and created_at>=wa_start
     and created_at<=now() and (wa_end is null or created_at<wa_end)
    order by created_at desc,id desc limit 401
   ) m;
  end if;
 end if;
 if cid is null and wa_cid is null then return jsonb_build_object('unavailable',true,'reason','EXACT_CONVERSATION_UNAVAILABLE','messages','[]'::jsonb);end if;
 select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at,m.id),'[]') into rows from (
  select id,conversation_id,channel,direction,message_type,left(text_content,2000) text_content,left(caption,2000) caption,
   media_url,created_at,sent_at,is_history,provider_message_id,reply_to_provider_message_id
  from public.messages where conversation_id=cid and not is_history and created_at>=start_at and created_at<=now()
   and (end_at is null or created_at<end_at) order by created_at desc,id desc limit 401
 ) m;
 rows:=coalesce(rows,'[]'::jsonb)||coalesce(wa_rows,'[]'::jsonb);
 return jsonb_build_object('cross_channel_exact_order',wa_cid is not null,'whatsapp_scope_start',wa_start,'whatsapp_scope_end',wa_end,'order_id',p_scope->>'order_id','session_id',p_scope->>'session_id','conversation_id',coalesce(cid,wa_cid),
  'scope_start',start_at,'scope_end',end_at,'order_session_start',session_start,
  'preorder_product_id',case when start_at=preorder_start then preorder_product else null end,'messages',rows,'truncated',jsonb_array_length(rows)>400,
  'unavailable',false,'ambiguous',false,'bindings',case when cid is not null then jsonb_build_array(jsonb_build_object('id',cid,'usable',true)) else '[]'::jsonb end || case when wa_cid is not null then jsonb_build_array(jsonb_build_object('id',wa_cid,'usable',true,'source','exact_whatsapp_order_and_phone','start_at',wa_start,'end_at',wa_end)) else '[]'::jsonb end);
end $function$;
