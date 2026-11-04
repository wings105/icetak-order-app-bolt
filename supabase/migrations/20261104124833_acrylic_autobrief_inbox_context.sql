-- Service-only exact-order reader. Includes seller context for short customer answers.
create or replace function public.icetak_acrylic_brief_context(p_scope jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare cid uuid; n int; start_at timestamptz; end_at timestamptz; rows jsonb; buyer text:=p_scope->>'buyer_user_id'; phone text:=p_scope->>'phone';
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
  select greatest(start_at,max(s.started_at)) into start_at from public.shopee_order_sessions s
   where s.order_no=p_scope->>'order_no' and s.conversation_id=cid;
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
 if cid is null then return jsonb_build_object('unavailable',true,'reason','EXACT_CONVERSATION_UNAVAILABLE','messages','[]'::jsonb);end if;
 select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at,m.id),'[]') into rows from (
  select id,conversation_id,channel,direction,message_type,left(text_content,2000) text_content,left(caption,2000) caption,
   media_url,created_at,sent_at,is_history,provider_message_id,reply_to_provider_message_id
  from public.messages where conversation_id=cid and not is_history and created_at>start_at and created_at<=now()
   and (end_at is null or created_at<end_at) order by created_at desc,id desc limit 401
 ) m;
 return jsonb_build_object('order_id',p_scope->>'order_id','session_id',p_scope->>'session_id','conversation_id',cid,
  'scope_start',start_at,'scope_end',end_at,'messages',rows,'truncated',jsonb_array_length(rows)>400,
  'unavailable',false,'ambiguous',false,'bindings',jsonb_build_array(jsonb_build_object('id',cid,'usable',true)));
end $$;
revoke all on function public.icetak_acrylic_brief_context(jsonb) from public,anon,authenticated;
grant execute on function public.icetak_acrylic_brief_context(jsonb) to service_role;

