CREATE OR REPLACE FUNCTION clickup_gate.protect_autobrief_route()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if (new.task_id,new.initial_status,new.profile,new.task_created_at,new.captured_from) is distinct from
    (old.task_id,old.initial_status,old.profile,old.task_created_at,old.captured_from)

 or(old.confirmed_at is not null and new.confirmed_at is distinct from old.confirmed_at
    and not (
      current_user='postgres' and new.confirmed_at is null and old.profile='acrylic'
      and coalesce(current_setting('icetak.reopen_incomplete_brief',true),'')=old.task_id
      and exists (
       select 1 from public.clickup_order_brief_jobs j where j.task_id=old.task_id
        and (j.lease_until is null or j.lease_until<now())
        and j.brief->>'confirmed'='false' and j.brief->>'ready'='false'
        and j.brief->>'state' in ('MEDIA_OR_AI_UNAVAILABLE','MISSING_DETAILS','CHAT_UNAVAILABLE','REVIEW_REQUIRED')
      )
    )) then
 raise exception 'AUTOBRIEF_ROUTE_IMMUTABLE';end if;return new;
end;$function$;
