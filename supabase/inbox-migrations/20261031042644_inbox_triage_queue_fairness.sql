-- Prevent newest-chat traffic starving already queued older work.
create or replace function public.claim_conversation_ai_jobs(p_limit integer default 10)
returns setof public.conversation_ai_jobs language plpgsql security definer set search_path='public' as $$
begin
 return query with picked as (
  select j.id from public.conversation_ai_jobs j join public.conversations c on c.id=j.conversation_id
  where j.status in ('pending','failed') and j.run_after<=now() and j.attempts<5
  order by (j.run_after<now()-interval '10 minutes') desc,
   case when j.run_after<now()-interval '10 minutes' then j.run_after end asc,
   c.archived asc,c.needs_reply desc,c.last_message_at desc nulls last,j.updated_at,j.id
  for update of j skip locked limit greatest(1,least(coalesce(p_limit,10),50))
 ) update public.conversation_ai_jobs j set status='processing',attempts=j.attempts+1,locked_at=now(),updated_at=now()
 from picked p where j.id=p.id returning j.*;
end $$;
-- Existing dispatcher/worker already cap batches at four; no extra provider/model API is introduced.
select cron.alter_job(job_id:=(select jobid from cron.job where jobname='conversation-ai-triage-every-minute'),command:='select public.recover_stale_conversation_ai_jobs(90); select util.invoke_conversation_triage_dispatch(4,null);');
