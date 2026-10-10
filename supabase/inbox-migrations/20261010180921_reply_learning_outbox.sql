-- Inbox records only IDs. Batch actual confirmed human sends to the fixed Order bridge.
create table private.reply_learning_queue (
 message_id uuid primary key references public.messages(id) on delete cascade,
 attempts integer not null default 0, request_id bigint, next_at timestamptz not null default now(),
 done boolean not null default false, created_at timestamptz not null default now()
);
create index reply_learning_pending on private.reply_learning_queue(next_at) where not done and attempts<5;
alter table private.reply_learning_queue enable row level security;
revoke all on private.reply_learning_queue from public,anon,authenticated;
create function private.capture_reply_learning() returns trigger
language plpgsql security definer set search_path=public,private,pg_temp as $$
begin
 if new.direction='outbound' and new.sender_type='seller' and new.source in ('icetak-panel','admin-ai-dashboard','api','business_app') and new.message_type='text' and new.status in ('sent','delivered','read') and coalesce(new.is_history,false)=false and nullif(btrim(new.text_content),'') is not null and length(new.text_content)<=4000 and new.created_at>=TG_ARGV[0]::timestamptz then
  insert into private.reply_learning_queue(message_id) values(new.id) on conflict do nothing;
 end if;
 return new;
end; $$;
revoke all on function private.capture_reply_learning() from public,anon,authenticated;
do $$ begin execute format('create trigger capture_reply_learning after insert or update of status on public.messages for each row execute function private.capture_reply_learning(%L)',now()::text);end; $$;
create function public.dispatch_reply_learning() returns jsonb
language plpgsql security definer set search_path=public,private,pg_temp as $$
declare token text; ids uuid[]; payload jsonb; request bigint; n integer;
begin
 if not pg_try_advisory_xact_lock(hashtext('reply-learning-dispatch')) then return '{"busy":true}'; end if;
 -- Successful acknowledgements include an idempotent result for every queued event.
 update private.reply_learning_queue q set done=true,request_id=null
 from net._http_response r where r.id=q.request_id and r.status_code=200 and r.content ~ '"ok"\s*:\s*true';
 update private.reply_learning_queue q set request_id=null,next_at=now()+make_interval(mins=>least(720,15*power(2,q.attempts)::integer))
 where q.request_id is not null and (exists(select 1 from net._http_response r where r.id=q.request_id) or q.next_at<now()-interval '10 minutes');
 select setting_value into token from public.private_runtime_settings where setting_key='admin_window_bridge_token';
 if nullif(token,'') is null then return '{"configured":false}'; end if;
 select array_agg(message_id) into ids from (select message_id from private.reply_learning_queue where not done and attempts<5 and request_id is null and next_at<=now() order by next_at limit 20 for update skip locked) q;
 if ids is null then return '{"queued":0}';end if;
 select jsonb_agg(jsonb_build_object('message_id',m.id,'conversation_id',m.conversation_id,'channel',m.channel,'actual',m.text_content,'source',m.source,'sender_type',m.sender_type,'is_history',coalesce(m.is_history,false),'status',m.status,'sent_at',coalesce(m.sent_at,m.created_at))) into payload
 from messages m where m.id=any(ids) and m.direction='outbound' and m.sender_type='seller' and m.source in ('icetak-panel','admin-ai-dashboard','api','business_app') and m.status in ('sent','delivered','read');
 if payload is null then update private.reply_learning_queue set done=true where message_id=any(ids);return '{"queued":0}';end if;
 request=net.http_post(url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/inbox-reply-context',headers:=jsonb_build_object('content-type','application/json','x-admin-window-token',token),body:=jsonb_build_object('action','learn','items',payload),timeout_milliseconds:=30000);
 update private.reply_learning_queue set request_id=request,attempts=attempts+1,next_at=now() where message_id=any(ids);
 return jsonb_build_object('queued',array_length(ids,1));
end; $$;
revoke all on function public.dispatch_reply_learning() from public,anon,authenticated;
grant execute on function public.dispatch_reply_learning() to service_role;
select cron.schedule('reply-learning-batch','*/5 * * * *','select public.dispatch_reply_learning();');

select cron.schedule('reply-learning-queue-retention','17 3 * * *','delete from private.reply_learning_queue where created_at<now()-interval ''7 days'';');
