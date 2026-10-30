-- Unified Inbox only. Rules, immutable attempts and message-driven durable work.
create schema if not exists wa_automation;
revoke all on schema wa_automation from public, anon, authenticated;
grant usage on schema wa_automation to service_role;

create table wa_automation.rules (
 id text primary key, name text not null, keyword text not null,
 action text not null check(action in ('draft_prepaid','draft_pickup','send_qr')),
 mode text not null default 'observe' check(mode in ('native','observe','paused')),
 case_sensitive boolean not null default false,
 config jsonb not null default '{}'::jsonb,
 rate_per_hour integer not null default 60 check(rate_per_hour between 1 and 300),
 revision integer not null default 1, updated_at timestamptz not null default now(),
 updated_by text not null default 'migration', activated_at timestamptz not null default now(),
 check(length(keyword) between 2 and 60 and left(keyword,1)='#')
);
create table wa_automation.runs (
 id uuid primary key default gen_random_uuid(), rule_id text not null references wa_automation.rules,
 message_id uuid not null references public.messages(id), provider_message_id text not null,
 conversation_id uuid not null, action text not null, rule_snapshot jsonb not null,
 message_text text not null, message_at timestamptz not null, customer_name text,
 phone text, bsuid text, status text not null check(status in ('observed','pending','processing','retry','succeeded','failed','blocked','uncertain','skipped')),
 reason text, attempts integer not null default 0, available_at timestamptz not null default now(),
 lease_id uuid, lease_until timestamptz, result jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(rule_id,provider_message_id)
);
create index wa_runs_due on wa_automation.runs(available_at) where status in ('pending','retry','processing');
create index wa_runs_recent on wa_automation.runs(created_at desc);
create index wa_runs_conversation on wa_automation.runs(conversation_id,created_at desc);
create table wa_automation.events (
 id bigint generated always as identity primary key, run_id uuid references wa_automation.runs,
 rule_id text references wa_automation.rules, event text not null, actor text not null,
 data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index wa_events_run on wa_automation.events(run_id,id);
create table wa_automation.receipts(request_id uuid primary key, action text not null, response jsonb not null, created_at timestamptz not null default now());
create table wa_automation.health(singleton boolean primary key default true check(singleton), last_worker_at timestamptz, last_worker_error text);
insert into wa_automation.health(singleton) values(true);
alter table wa_automation.rules enable row level security;
alter table wa_automation.runs enable row level security;
alter table wa_automation.events enable row level security;
alter table wa_automation.receipts enable row level security;
alter table wa_automation.health enable row level security;
grant all on all tables in schema wa_automation to service_role;
grant usage,select on all sequences in schema wa_automation to service_role;
insert into wa_automation.rules(id,name,keyword,action) values
 ('prepaid','Draft prepaid','#ok','draft_prepaid'),
 ('pickup','Pay at pickup','#noted','draft_pickup'),
 ('qr','Hantar gambar QR','#qr','send_qr');

create function wa_automation.matches(p_text text,p_keyword text,p_case boolean) returns boolean
language sql immutable strict security invoker set search_path='' as $$
 select case when p_case then strpos(p_text,p_keyword)>0 else strpos(lower(p_text),lower(p_keyword))>0 end
$$;

create function wa_automation.kick() returns bigint language plpgsql security invoker set search_path='' as $$
declare token text; request_id bigint;
begin
 if not exists(select 1 from wa_automation.runs where status in ('pending','retry','processing') and available_at<=now()) then return null; end if;
 select setting_value into token from public.private_runtime_settings where setting_key='qrpay_ai_worker_token';
 if nullif(token,'') is null then return null; end if;
 select net.http_post(url:='https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/automation-engine',
   headers:=jsonb_build_object('content-type','application/json','x-automation-token',token),
   body:='{"action":"process"}'::jsonb,timeout_milliseconds:=1000) into request_id;
 return request_id;
end $$;

create function wa_automation.capture() returns trigger language plpgsql security definer set search_path='' as $$
declare r wa_automation.rules%rowtype; rid uuid; target_status text; why text; draft_matches integer; at_time timestamptz;
begin
 -- Only trusted, persisted human seller output. System echoes, imports and buyer text never execute commands.
 if tg_table_schema<>'public' or tg_table_name<>'messages' or new.channel<>'whatsapp'
  or new.direction<>'outbound' or new.sender_type<>'seller' or coalesce(new.is_history,false)
  or coalesce(new.status,'') not in ('sent','delivered','read')
  or coalesce(new.source,'') not in ('business_app','inbox','seller','admin','manual')
  or nullif(new.provider_message_id,'') is null or nullif(new.text_content,'') is null then return new; end if;
 at_time:=coalesce(new.sent_at,new.created_at);
 -- No historical replay on deployment. Late delivery beyond one day is retained as blocked evidence.
 select count(*) into draft_matches from wa_automation.rules q where q.mode<>'paused' and q.action in ('draft_prepaid','draft_pickup')
   and wa_automation.matches(new.text_content,q.keyword,q.case_sensitive);
 for r in select * from wa_automation.rules q where wa_automation.matches(new.text_content,q.keyword,q.case_sensitive) loop
  if at_time<r.activated_at then continue; end if;
  why:=null;
  target_status:=case r.mode when 'native' then 'pending' when 'observe' then 'observed' else 'skipped' end;
  if r.mode='paused' then why:='RULE_PAUSED';
  elsif at_time<now()-interval '1 day' or at_time>now()+interval '5 minutes' then target_status:='blocked';why:='STALE_OR_FUTURE_MESSAGE';
  elsif r.action in ('draft_prepaid','draft_pickup') and draft_matches>1 then target_status:='blocked';why:='CONFLICTING_DRAFT_COMMANDS';
  elsif (select count(*) from wa_automation.runs q where q.rule_id=r.id and q.created_at>now()-interval '1 hour' and q.status not in ('observed','skipped','blocked'))>=r.rate_per_hour then target_status:='blocked';why:='HOURLY_LIMIT'; end if;
  insert into wa_automation.runs(rule_id,message_id,provider_message_id,conversation_id,action,rule_snapshot,message_text,message_at,customer_name,phone,bsuid,status,reason)
   select r.id,new.id,new.provider_message_id,new.conversation_id,r.action,to_jsonb(r),left(new.text_content,2000),at_time,
    c.display_name,new.recipient_phone,new.recipient_bsuid,target_status,why
   from public.conversations cv left join public.customers c on c.id=cv.customer_id where cv.id=new.conversation_id
   on conflict(rule_id,provider_message_id) do nothing returning id into rid;
  if rid is not null then insert into wa_automation.events(run_id,rule_id,event,actor,data)
   values(rid,r.id,'matched','message-trigger',jsonb_build_object('status',target_status,'reason',why)); end if;
 end loop;
 perform wa_automation.kick();
 return new;
exception when others then
 update wa_automation.health set last_worker_error='CAPTURE_FAILED:'||sqlstate;
 return new;
end $$;
revoke all on function wa_automation.capture() from public,anon,authenticated;
create trigger wa_keyword_automation after insert or update of provider_message_id,status,text_content on public.messages
 for each row execute function wa_automation.capture();

-- One service-only entrypoint. Admin staff identity is asserted by the Order gateway.
create function public.icetak_wa_automation(p_action text,p_payload jsonb default '{}'::jsonb,p_actor text default 'worker') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r wa_automation.rules%rowtype; run wa_automation.runs%rowtype; result jsonb; req uuid; rev integer;
 lim integer:=least(100,greatest(1,coalesce((p_payload->>'limit')::integer,30)));
 offst integer:=greatest(0,least(100000,coalesce((p_payload->>'offset')::integer,0)));
begin
 if p_action in ('save','retry') then
  req:=(p_payload->>'request_id')::uuid;
  if req is null then raise exception 'REQUEST_ID_REQUIRED';end if;
  perform pg_advisory_xact_lock(hashtextextended(req::text,0));
  select response into result from wa_automation.receipts where request_id=req;
  if found then return result||'{"duplicate":true}'::jsonb;end if;
 end if;
 if p_action='snapshot' then
  return jsonb_build_object('rules',(select coalesce(jsonb_agg(to_jsonb(q)||jsonb_build_object(
   'last_run_at',(select max(created_at) from wa_automation.runs where rule_id=q.id),
   'counts',(select jsonb_object_agg(status,n) from (select status,count(*) n from wa_automation.runs where rule_id=q.id and created_at>now()-interval '1 day' group by status) x)
  ) order by q.id),'[]'::jsonb) from wa_automation.rules q),
  'health',(select to_jsonb(h) from wa_automation.health h),
  'totals',(select coalesce(jsonb_object_agg(status,n),'{}'::jsonb) from (select status,count(*) n from wa_automation.runs where created_at>now()-interval '1 day' group by status) x),
  'runs',(select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]'::jsonb) from (
   select * from wa_automation.runs where (coalesce(p_payload->>'rule','')='' or rule_id=p_payload->>'rule')
    and (coalesce(p_payload->>'status','')='' or status=p_payload->>'status')
    and (coalesce(p_payload->>'query','')='' or concat_ws(' ',message_text,customer_name,phone,bsuid,provider_message_id,id::text) ilike '%'||left(p_payload->>'query',100)||'%')
   order by created_at desc limit lim offset offst) q),
  'total',(select count(*) from wa_automation.runs where (coalesce(p_payload->>'rule','')='' or rule_id=p_payload->>'rule')
    and (coalesce(p_payload->>'status','')='' or status=p_payload->>'status')
    and (coalesce(p_payload->>'query','')='' or concat_ws(' ',message_text,customer_name,phone,bsuid,provider_message_id,id::text) ilike '%'||left(p_payload->>'query',100)||'%')));
 elsif p_action='detail' then
  return jsonb_build_object('run',(select to_jsonb(q) from wa_automation.runs q where id=(p_payload->>'id')::uuid),
   'events',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]'::jsonb) from wa_automation.events e where run_id=(p_payload->>'id')::uuid));
 elsif p_action='preview' then
  return jsonb_build_object('dry_run',true,'eligible',coalesce(p_payload->>'direction','outbound')='outbound',
    'matches',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'keyword',keyword,'action',action,'mode',mode,'would_run',mode='native' and coalesce(p_payload->>'direction','outbound')='outbound')),'[]'::jsonb)
    from wa_automation.rules where wa_automation.matches(left(coalesce(p_payload->>'text',''),4000),keyword,case_sensitive)));
 elsif p_action='save' then
  select * into r from wa_automation.rules where id=p_payload->>'id' for update;
  if not found then raise exception 'RULE_NOT_FOUND';end if;
  if r.revision<>coalesce((p_payload->>'revision')::integer,0) then raise exception 'RULE_CHANGED_REFRESH';end if;
  if p_payload->>'mode' not in ('native','observe','paused') then raise exception 'INVALID_MODE';end if;
  if (p_payload->>'mode')='native' and r.mode<>'native' and coalesce((p_payload->>'external_disabled')::boolean,false)<>true then raise exception 'DISABLE_EXTERNAL_BRANCH_FIRST';end if;
  if length(coalesce(p_payload->>'keyword','')) not between 2 and 60 or left(p_payload->>'keyword',1)<>'#' then raise exception 'INVALID_KEYWORD';end if;
  if exists(select 1 from wa_automation.rules where id<>r.id and lower(keyword)=lower(p_payload->>'keyword')) then raise exception 'KEYWORD_ALREADY_USED';end if;
  if r.action='send_qr' and p_payload->>'mode'='native' and coalesce(p_payload#>>'{config,image_url}','') !~ '^https://[^/]+/.+' then raise exception 'QR_IMAGE_REQUIRED';end if;
  update wa_automation.rules set keyword=p_payload->>'keyword',mode=p_payload->>'mode',case_sensitive=coalesce((p_payload->>'case_sensitive')::boolean,false),
   config=case when r.action='send_qr' then jsonb_build_object('image_url',left(p_payload#>>'{config,image_url}',2000),'caption',left(p_payload#>>'{config,caption}',1000)) else '{}'::jsonb end,
   rate_per_hour=coalesce((p_payload->>'rate_per_hour')::integer,60),revision=revision+1,updated_at=now(),updated_by=p_actor where id=r.id;
  insert into wa_automation.events(rule_id,event,actor,data) values(r.id,'rule_saved',p_actor,jsonb_build_object('before',to_jsonb(r),'after',(select to_jsonb(q) from wa_automation.rules q where id=r.id)));
  result:=jsonb_build_object('saved',true,'id',r.id);
 elsif p_action='claim' then
  update wa_automation.health set last_worker_at=now(),last_worker_error=null;
  -- Provider uncertainty must never become an automatic QR resend.
  update wa_automation.runs set status=case when action='send_qr' then 'uncertain' when attempts>=4 then 'failed' else 'retry' end,
   reason='WORKER_LEASE_EXPIRED',lease_id=null,lease_until=null,updated_at=now() where status='processing' and lease_until<now();
  for run in select x.* from wa_automation.runs x where x.status in ('pending','retry') and x.available_at<=now()
    order by x.available_at limit least(lim,5) for update skip locked loop
   select * into r from wa_automation.rules where id=run.rule_id;
   if r.mode<>'native' or run.message_at<now()-interval '1 day' then
    update wa_automation.runs set status='skipped',reason='PAUSED_OR_EXPIRED_BEFORE_EXECUTION',updated_at=now() where id=run.id;continue;
   end if;
   update wa_automation.runs set status='processing',attempts=attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '3 minutes',updated_at=now() where id=run.id returning * into run;
   insert into wa_automation.events(run_id,rule_id,event,actor,data) values(run.id,run.rule_id,'attempt_started','worker',jsonb_build_object('attempt',run.attempts));
   result:=coalesce(result,'[]'::jsonb)||jsonb_build_array(to_jsonb(run));
  end loop;
  return coalesce(result,'[]'::jsonb);
 elsif p_action='finish' then
  select * into run from wa_automation.runs where id=(p_payload->>'id')::uuid for update;
  if not found or run.status<>'processing' or run.lease_id is distinct from (p_payload->>'lease_id')::uuid then return '{"stale":true}'::jsonb;end if;
  if p_payload->>'status' not in ('succeeded','failed','blocked','uncertain','retry') then raise exception 'INVALID_STATUS';end if;
  update wa_automation.runs set status=case when p_payload->>'status'='retry' and attempts>=4 then 'failed' else p_payload->>'status' end,
   reason=left(p_payload->>'reason',500),result=coalesce(p_payload->'result','{}'::jsonb),available_at=now()+make_interval(secs=>least(900,attempts*60)),lease_id=null,lease_until=null,updated_at=now() where id=run.id;
  insert into wa_automation.events(run_id,rule_id,event,actor,data) values(run.id,run.rule_id,'attempt_finished','worker',p_payload-'lease_id');
  return '{"saved":true}'::jsonb;
 elsif p_action='retry' then
  select * into run from wa_automation.runs where id=(p_payload->>'id')::uuid for update;
  if not found or run.status not in ('failed','blocked') or run.action='send_qr' or run.message_at<now()-interval '1 day' then raise exception 'RETRY_NOT_SAFE';end if;
  if (select mode from wa_automation.rules where id=run.rule_id)<>'native' then raise exception 'RULE_NOT_NATIVE';end if;
  update wa_automation.runs set status='pending',available_at=now(),updated_at=now() where id=run.id;
  insert into wa_automation.events(run_id,rule_id,event,actor,data) values(run.id,run.rule_id,'retry_requested',p_actor,'{}');
  perform wa_automation.kick();result:='{"queued":true}'::jsonb;
 else raise exception 'INVALID_ACTION';end if;
 if req is not null then insert into wa_automation.receipts(request_id,action,response) values(req,p_action,result);end if;
 return result;
end $$;
revoke all on function public.icetak_wa_automation(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.icetak_wa_automation(text,jsonb,text) to service_role;
revoke all on all functions in schema wa_automation from public,anon,authenticated;
grant execute on all functions in schema wa_automation to service_role;
select cron.schedule('whatsapp-keyword-automation','* * * * *','select wa_automation.kick()');
