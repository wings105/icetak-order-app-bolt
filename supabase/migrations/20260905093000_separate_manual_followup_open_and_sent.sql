create or replace function public.icetak_admin_record_manual_draft_followup(
  p_draft_id uuid,
  p_remark text,
  p_message text,
  p_actor text default 'admin'
) returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  d public.qrpay_order_drafts%rowtype;
  cfg public.draft_followup_settings%rowtype;
  followup_number integer;
  next_at timestamptz;
begin
  select * into d from public.qrpay_order_drafts where id=p_draft_id for update;
  if not found then raise exception 'draft_not_found'; end if;
  if d.order_id is not null or d.status in ('confirmed','rejected') or d.payment_status in ('paid','matched','payment_received') then
    raise exception 'draft_not_eligible_for_followup';
  end if;
  if nullif(btrim(coalesce(p_remark,'')),'') is null then raise exception 'manual_followup_remark_required'; end if;
  if char_length(p_remark)>500 or char_length(coalesce(p_message,''))>2000 then raise exception 'manual_followup_content_too_long'; end if;

  select * into cfg from public.draft_followup_settings where singleton=true;
  followup_number:=least(d.followup_count+1,coalesce(cfg.max_followups,3));
  next_at:=case
    when followup_number>=coalesce(cfg.max_followups,3) then now()+make_interval(hours=>cfg.auto_cancel_delay_hours)
    when followup_number=1 then now()+make_interval(hours=>cfg.second_delay_hours)
    else now()+make_interval(hours=>cfg.third_delay_hours)
  end;

  update public.qrpay_order_drafts
  set followup_count=followup_number,last_followup_at=now(),next_followup_at=next_at,updated_at=now()
  where id=d.id;

  insert into public.draft_followup_events(draft_id,event_type,followup_number,actor,metadata)
  values(d.id,'manual_sent',followup_number,coalesce(nullif(p_actor,''),'admin'),jsonb_build_object(
    'remark',btrim(p_remark),'message',coalesce(p_message,''),'channel','whatsapp_direct_link','uses_meta_api',false,
    'previous_followup_count',d.followup_count,'previous_last_followup_at',d.last_followup_at,'previous_next_followup_at',d.next_followup_at
  ));

  return jsonb_build_object('success',true,'draft_id',d.id,'action','manual_sent','followup_number',followup_number,'next_followup_at',next_at);
end;
$function$;

create or replace function public.icetak_admin_undo_manual_draft_followup(
  p_draft_id uuid,
  p_actor text default 'admin'
) returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  d public.qrpay_order_drafts%rowtype;
  e public.draft_followup_events%rowtype;
  previous_count integer;
  previous_last timestamptz;
  previous_next timestamptz;
begin
  select * into d from public.qrpay_order_drafts where id=p_draft_id for update;
  if not found then raise exception 'draft_not_found'; end if;
  if d.order_id is not null or d.status in ('confirmed','rejected') or d.payment_status in ('paid','matched','payment_received') then
    raise exception 'draft_not_eligible_for_followup_undo';
  end if;

  select * into e from public.draft_followup_events where draft_id=d.id order by created_at desc,id desc limit 1;
  if not found or e.event_type<>'manual_sent' or e.followup_number is distinct from d.followup_count then
    raise exception 'latest_followup_is_not_manual_sent';
  end if;

  previous_count:=coalesce((e.metadata->>'previous_followup_count')::integer,greatest(d.followup_count-1,0));
  previous_last:=case when e.metadata ? 'previous_last_followup_at' and e.metadata->>'previous_last_followup_at' is not null then (e.metadata->>'previous_last_followup_at')::timestamptz else null end;
  previous_next:=case when e.metadata ? 'previous_next_followup_at' and e.metadata->>'previous_next_followup_at' is not null then (e.metadata->>'previous_next_followup_at')::timestamptz else now() end;

  update public.qrpay_order_drafts set followup_count=previous_count,last_followup_at=previous_last,next_followup_at=previous_next,updated_at=now() where id=d.id;
  insert into public.draft_followup_events(draft_id,event_type,followup_number,actor,metadata)
  values(d.id,'manual_undo',previous_count,coalesce(nullif(p_actor,''),'admin'),jsonb_build_object('undone_event_id',e.id,'reason','opened_without_sending'));
  return jsonb_build_object('success',true,'draft_id',d.id,'action','manual_undo','followup_number',previous_count,'next_followup_at',previous_next);
end;
$function$;

revoke all on function public.icetak_admin_record_manual_draft_followup(uuid,text,text,text),public.icetak_admin_undo_manual_draft_followup(uuid,text) from public,anon,authenticated;
grant execute on function public.icetak_admin_record_manual_draft_followup(uuid,text,text,text),public.icetak_admin_undo_manual_draft_followup(uuid,text) to service_role;

create or replace function public.finance_admin_draft_followups(p_filter text default null,p_query text default null,p_limit integer default 200)
returns jsonb language sql stable security definer set search_path to '' as $function$
with base as materialized (
  select d.*,q.status queue_status,q.last_error queue_error,q.decision_mode,q.provider_message_id,
    le.event_type last_followup_event_type,le.followup_number last_followup_event_number
  from public.qrpay_order_drafts d
  left join lateral (select nq.* from public.notification_queue nq where nq.payload->>'draft_id'=d.id::text order by nq.created_at desc limit 1) q on true
  left join lateral (select fe.event_type,fe.followup_number from public.draft_followup_events fe where fe.draft_id=d.id order by fe.created_at desc,fe.id desc limit 1) le on true
  where d.order_id is null and d.customer_link_sent_at is not null and d.payment_mode='prepaid' and d.status not in ('confirmed','rejected')
    and d.payment_status not in ('paid','matched','payment_received')
    and (nullif(btrim(coalesce(p_query,'')),'') is null or coalesce(d.customer_name,'') ilike '%'||btrim(p_query)||'%' or coalesce(d.customer_phone,'') ilike '%'||regexp_replace(p_query,'[^0-9]','','g')||'%')
    and (coalesce(p_filter,'')='' or (p_filter='due' and d.next_followup_at<=now()) or (p_filter='paused' and not d.followup_enabled) or (p_filter='failed' and q.status='failed') or (p_filter='final' and d.followup_count>=2) or (p_filter='waiting' and d.followup_enabled and d.next_followup_at>now()))
  order by d.next_followup_at nulls last limit least(greatest(coalesce(p_limit,200),1),300)
)
select jsonb_build_object(
 'counts',jsonb_build_object('all',count(*),'due',count(*) filter(where next_followup_at<=now() and followup_enabled),'paused',count(*) filter(where not followup_enabled),'failed',count(*) filter(where queue_status='failed'),'final',count(*) filter(where followup_count>=2)),
 'drafts',coalesce(jsonb_agg(jsonb_build_object('id',id,'review_token',review_token,'customer_review_token',customer_review_token,'status',status,'customer_name',customer_name,'customer_phone',customer_phone,'draft_total',draft_total,'date_need',working_draft->>'date_need','followup_enabled',followup_enabled,'followup_count',followup_count,'last_followup_at',last_followup_at,'next_followup_at',next_followup_at,'customer_link_sent_at',customer_link_sent_at,'customer_responded_at',customer_responded_at,'queue_status',queue_status,'queue_error',queue_error,'decision_mode',decision_mode,'provider_message_id',provider_message_id,'manual_undo_available',last_followup_event_type='manual_sent' and last_followup_event_number=followup_count) order by next_followup_at nulls last),'[]'::jsonb)
) from base;
$function$;

revoke all on function public.finance_admin_draft_followups(text,text,integer) from public,anon,authenticated;
grant execute on function public.finance_admin_draft_followups(text,text,integer) to service_role;
