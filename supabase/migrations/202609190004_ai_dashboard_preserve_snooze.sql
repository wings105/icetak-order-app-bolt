-- Preserve snooze expiry when an admin saves notes on a snoozed card.
create or replace function public.icetak_ai_dashboard_review(
 p_conversation_id uuid,p_inbound_revision text,p_expected_version integer,p_actor text,
 p_request_id uuid,p_action text,p_response text default '',p_note text default '',
 p_intent text default null,p_snoozed_until timestamptz default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_old public.ai_dashboard_reviews%rowtype; v_new public.ai_dashboard_reviews%rowtype; v_saved jsonb; v_status text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_conversation_id::text,0));
 select after_state into v_saved from ai_dashboard_events where request_id=p_request_id and conversation_id=p_conversation_id;
 if found then return jsonb_build_object('review',v_saved,'duplicate',true); end if;
 select * into v_old from ai_dashboard_reviews where conversation_id=p_conversation_id for update;
 if coalesce(v_old.version,0)<>p_expected_version then raise exception 'REVIEW_CHANGED: Muat semula; admin lain telah mengemas kini kad ini.'; end if;
 if p_actor is null or length(p_actor)=0 or p_inbound_revision is null then raise exception 'Invalid review identity'; end if;
 if p_action not in ('save','manual_replied','resolve','reopen','snooze') then raise exception 'Invalid review action'; end if;
 if length(coalesce(p_response,''))>8000 or length(coalesce(p_note,''))>2000 then raise exception 'Text too long'; end if;
 if p_action='manual_replied' and length(trim(coalesce(p_response,'')))=0 then raise exception 'Balasan diperlukan untuk rekod manual.'; end if;
 if p_action='snooze' and (p_snoozed_until is null or p_snoozed_until<=now() or p_snoozed_until>now()+interval '30 days') then raise exception 'Invalid snooze time'; end if;
 v_status:=case p_action when 'manual_replied' then 'waiting_customer' when 'resolve' then 'resolved' when 'snooze' then 'snoozed' when 'reopen' then 'needs_review' else
   case when v_old.inbound_revision=p_inbound_revision then coalesce(v_old.status,'needs_review') else 'needs_review' end end;
 insert into ai_dashboard_reviews(conversation_id,inbound_revision,status,snoozed_until,response_text,note,intent_override,updated_by,version)
 values(p_conversation_id,p_inbound_revision,v_status,case when v_status='snoozed' then coalesce(p_snoozed_until,v_old.snoozed_until) end,
 coalesce(p_response,''),coalesce(p_note,''),nullif(p_intent,''),p_actor,coalesce(v_old.version,0)+1)
 on conflict(conversation_id) do update set inbound_revision=excluded.inbound_revision,status=excluded.status,
 snoozed_until=excluded.snoozed_until,response_text=excluded.response_text,note=excluded.note,
 intent_override=excluded.intent_override,updated_by=excluded.updated_by,version=excluded.version,updated_at=now()
 returning * into v_new;
 insert into ai_dashboard_events(request_id,conversation_id,actor,action,before_state,after_state)
 values(p_request_id,p_conversation_id,p_actor,p_action,case when v_old.conversation_id is null then null else to_jsonb(v_old) end,to_jsonb(v_new));
 return jsonb_build_object('review',to_jsonb(v_new),'duplicate',false);
end; $$;
revoke all on function public.icetak_ai_dashboard_review(uuid,text,integer,text,uuid,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.icetak_ai_dashboard_review(uuid,text,integer,text,uuid,text,text,text,text,timestamptz) to service_role;

