CREATE OR REPLACE FUNCTION clickup_gate.record_order_brief(p_task_id text, p_fingerprint text, p_state text, p_brief jsonb, p_media jsonb, p_comment_id text, p_error text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'clickup_gate'
AS $function$
declare done int; locked boolean;
begin
 if p_state not in ('completed','review','failed','uncertain') then return false;end if;

 select confirmed_at is not null into locked from public.clickup_autobrief_routes where task_id=p_task_id;
 if locked then
  select j.brief||jsonb_build_object('checked_message_ids',coalesce(p_brief->'checked_message_ids',j.checked_message_ids),
    'message_updates',coalesce(p_brief->'message_updates',j.brief->'message_updates','[]'::jsonb),
    'pending_change_ids',coalesce(p_brief->'pending_change_ids',j.brief->'pending_change_ids','[]'::jsonb))
  ,j.comment_id,j.media_receipts into p_brief,p_comment_id,p_media from public.clickup_order_brief_jobs j where j.task_id=p_task_id;
 end if;
 update public.clickup_order_brief_jobs j
 set state=p_state,brief=coalesce(p_brief,j.brief),media_receipts=coalesce(p_media,j.media_receipts),
 comment_id=coalesce(p_comment_id,j.comment_id),
 checked_message_ids=coalesce(p_brief->'checked_message_ids',j.checked_message_ids),
 field_receipts=coalesce(p_brief->'field_receipts',j.field_receipts),
 last_error=left(coalesce(p_error,''),300),
 lease_until=null,updated_at=now(),
 attempts=case when p_state in ('completed','review') then 0 else j.attempts end,
 next_poll_at=now()+interval '5 minutes',
 delivered_fingerprint=case when p_state='completed' then p_fingerprint else j.delivered_fingerprint end,
 completed_at=case when p_state='completed' then coalesce(j.completed_at,now()) else j.completed_at end,
 next_attempt_at=case when p_state='failed' then now()+make_interval(mins=>least(power(2,j.attempts)::int,60)) else j.next_attempt_at end
 where j.task_id=p_task_id and j.source_fingerprint=p_fingerprint and j.state='processing';
 
get diagnostics done=row_count;
 if done=1 and p_brief->>'confirmed'='true' and p_comment_id is not null then
 update public.clickup_autobrief_routes set confirmed_at=coalesce(nullif(p_brief->>'confirmed_at','')::timestamptz,now())
 where task_id=p_task_id and confirmed_at is null;
 end if;
 return done=1;
end $function$
;
