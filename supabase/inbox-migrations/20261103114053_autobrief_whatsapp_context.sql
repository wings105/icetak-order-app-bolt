-- Inbox: read only the Order-certified current order-session window.
create function public.icetak_autobrief_whatsapp_context(p_scope jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare cid uuid; n integer; start_at timestamptz; end_at timestamptz; rows jsonb; v_phone text:=p_scope->>'phone'; exact_session boolean:=nullif(p_scope->>'session_id','') is not null;
begin
 if coalesce((p_scope->>'eligible')::boolean,false) is not true or coalesce(p_scope->>'order_id','') !~ '^[0-9a-f-]{36}$' or p_scope->>'start_at' is null then return jsonb_build_object('messages','[]'::jsonb,'bindings','[]'::jsonb,'unavailable',true,'reason','INVALID_DIRECT_SCOPE');end if;
 start_at:=(p_scope->>'start_at')::timestamptz;end_at:=nullif(p_scope->>'end_at','')::timestamptz;
 if start_at>now() or (end_at is not null and end_at<=start_at) then return jsonb_build_object('messages','[]'::jsonb,'bindings','[]'::jsonb,'unavailable',true,'reason','INVALID_SESSION_WINDOW');end if;
 if nullif(p_scope->>'conversation_id','') is not null then
  select c.id into cid from public.conversations c where c.id=(p_scope->>'conversation_id')::uuid and c.channel='whatsapp' and not c.archived;
 else
  -- Website orders without a draft use a unique verified WhatsApp identity;
  -- their window begins at checkout, never arbitrary earlier v_phone history.
  select count(*),min(c.id::text)::uuid into n,cid from public.conversations c where c.channel='whatsapp' and not c.archived and (exists(select 1 from public.customer_identities ci where ci.customer_id=c.customer_id and ci.channel='whatsapp' and ci.normalized_phone=v_phone and length(v_phone) between 9 and 15));
  if n<>1 then cid:=null;end if;
  if exists(select 1 from public.external_order_summaries o where o.active_order and o.order_system_order_id is distinct from (p_scope->>'order_id')::uuid and o.customer_phone_normalized=v_phone) then cid:=null;end if;
 end if;
 if cid is null then return jsonb_build_object('messages','[]'::jsonb,'bindings','[]'::jsonb,'ambiguous',true,'order_id',p_scope->>'order_id','session_id',p_scope->>'session_id','evidence_source','exact_direct_session','reason','WHATSAPP_SESSION_NOT_UNIQUE');end if;
 select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at,m.id),'[]'::jsonb) into rows from (
 select id,conversation_id,channel,direction,message_type,left(text_content,2000) text_content,left(caption,2000) caption,media_url,created_at,is_history from public.messages where conversation_id=cid and direction='inbound' and not is_history and created_at>start_at and created_at<=now() and (end_at is null or created_at<end_at) order by created_at desc,id desc limit 121) m;
 return jsonb_build_object('evidence_source','exact_direct_session','session_id',p_scope->>'session_id','order_id',p_scope->>'order_id','draft_id',p_scope->>'draft_id','scope_start',start_at,'scope_end',end_at,
 'ambiguous',false,'unavailable',false,'truncated',jsonb_array_length(rows)>120,'messages',rows,'bindings',jsonb_build_array(jsonb_build_object('id',cid,'channel','whatsapp','usable',true,'start_at',start_at,'end_at',end_at,'source',case when exact_session then 'canonical_draft_session' else 'canonical_website_window' end)));
end $$;
revoke all on function public.icetak_autobrief_whatsapp_context(jsonb) from public,anon,authenticated;
grant execute on function public.icetak_autobrief_whatsapp_context(jsonb) to service_role;
notify pgrst,'reload schema';
