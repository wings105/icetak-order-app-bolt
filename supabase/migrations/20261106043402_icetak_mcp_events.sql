-- Owner-only MCP bridge. All persistence is inaccessible to browser database roles.
create schema if not exists mcp_internal;
revoke all on schema mcp_internal from public,anon,authenticated;
create table public.icetak_mcp_clients(client_id text primary key,redirect_uris jsonb not null,created_at timestamptz not null default now());
create table public.icetak_mcp_codes(code_hash text primary key,client_id text not null references public.icetak_mcp_clients,owner_id uuid not null,redirect_uri text not null,challenge text not null,scope text not null,expires_at timestamptz not null,created_at timestamptz not null default now());
create table public.icetak_mcp_tokens(access_hash text primary key,refresh_hash text unique not null,client_id text not null references public.icetak_mcp_clients,owner_id uuid not null,scope text not null,expires_at timestamptz not null,refresh_expires_at timestamptz not null,revoked_at timestamptz,created_at timestamptz not null default now());
create table public.icetak_mcp_subscriptions(id text primary key,owner_id uuid not null,client_id text not null,order_reference text not null,callback_url text not null,signing_secret text not null,previous_signing_secret text,rotation_until timestamptz,expires_at timestamptz not null,active boolean not null default true,created_at timestamptz not null default now());
create table public.icetak_mcp_events(seq bigint generated always as identity primary key,id uuid unique not null default gen_random_uuid(),name text not null default 'autobrief.confirmed',task_id text not null,order_reference text not null,brief_revision text not null,confirmed_at timestamptz not null,created_at timestamptz not null default now(),unique(task_id,brief_revision));
create table public.icetak_mcp_deliveries(subscription_id text not null references public.icetak_mcp_subscriptions,event_id uuid not null references public.icetak_mcp_events(id),state text not null default 'queued' check(state in ('queued','sending','delivered','failed','stopped')),attempts int not null default 0,next_attempt_at timestamptz not null default now(),lease_until timestamptz,http_status int,last_error text,delivered_at timestamptz,primary key(subscription_id,event_id));
create index icetak_mcp_deliveries_due on public.icetak_mcp_deliveries(next_attempt_at) where state in ('queued','sending');
create table public.icetak_mcp_comments(event_id uuid primary key references public.icetak_mcp_events(id),owner_id uuid not null,task_id text not null,content_hash text not null,state text not null default 'sending' check(state in ('sending','sent','uncertain')),comment_id text,created_at timestamptz not null default now());
do $$ declare t text;begin foreach t in array array['clients','codes','tokens','subscriptions','events','deliveries','comments'] loop execute format('alter table public.%I enable row level security','icetak_mcp_'||t);execute format('revoke all on public.%I from public,anon,authenticated','icetak_mcp_'||t);execute format('grant all on public.%I to service_role','icetak_mcp_'||t);end loop;end $$;
grant usage,select on sequence public.icetak_mcp_events_seq_seq to service_role;

create function public.icetak_mcp_consume_code(p_hash text,p_client text,p_redirect text,p_challenge text) returns setof public.icetak_mcp_codes language sql security invoker set search_path='' as $$
 delete from public.icetak_mcp_codes where code_hash=p_hash and client_id=p_client and redirect_uri=p_redirect and challenge=p_challenge and expires_at>now() returning *;
$$;
create function public.icetak_mcp_consume_refresh(p_hash text,p_client text) returns setof public.icetak_mcp_tokens language sql security invoker set search_path='' as $$
 update public.icetak_mcp_tokens set revoked_at=now() where refresh_hash=p_hash and client_id=p_client and revoked_at is null and refresh_expires_at>now() returning *;
$$;
create function public.icetak_mcp_claim_deliveries() returns jsonb language plpgsql security invoker set search_path='' as $$
declare answer jsonb;begin
 update public.icetak_mcp_deliveries d set state='stopped',last_error='SUBSCRIPTION_INACTIVE' from public.icetak_mcp_subscriptions s where s.id=d.subscription_id and (not s.active or s.expires_at<=now()) and d.state in ('queued','sending');
 with claimed as (select d.subscription_id,d.event_id from public.icetak_mcp_deliveries d where d.state in ('queued','sending') and d.next_attempt_at<=now() and (d.lease_until is null or d.lease_until<now()) and d.attempts<8 order by d.next_attempt_at for update skip locked limit 5), updated as (update public.icetak_mcp_deliveries d set state='sending',lease_until=now()+interval '90 seconds',attempts=d.attempts+1 from claimed c where d.subscription_id=c.subscription_id and d.event_id=c.event_id returning d.*)
 select coalesce(jsonb_agg(jsonb_build_object('delivery',to_jsonb(u),'subscription',to_jsonb(s),'event',to_jsonb(e))),'[]') into answer from updated u join public.icetak_mcp_subscriptions s on s.id=u.subscription_id join public.icetak_mcp_events e on e.id=u.event_id;
 return answer;end $$;

create function public.icetak_mcp_subscribe(p_subscription jsonb,p_cursor bigint default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_cursor bigint;begin
 -- Serialise capture/subscribe so events cannot fall between the initial cursor and subscription.
 perform pg_advisory_xact_lock(8110261106);
 insert into public.icetak_mcp_subscriptions(id,owner_id,client_id,order_reference,callback_url,signing_secret,expires_at,active)
 values(p_subscription->>'id',(p_subscription->>'owner_id')::uuid,p_subscription->>'client_id',p_subscription->>'order_reference',p_subscription->>'callback_url',p_subscription->>'signing_secret',(p_subscription->>'expires_at')::timestamptz,true)
 on conflict(id) do update set previous_signing_secret=case when icetak_mcp_subscriptions.signing_secret<>excluded.signing_secret then icetak_mcp_subscriptions.signing_secret else icetak_mcp_subscriptions.previous_signing_secret end,rotation_until=case when icetak_mcp_subscriptions.signing_secret<>excluded.signing_secret then now()+interval '5 minutes' else icetak_mcp_subscriptions.rotation_until end,signing_secret=excluded.signing_secret,expires_at=excluded.expires_at,active=true where icetak_mcp_subscriptions.owner_id=excluded.owner_id and icetak_mcp_subscriptions.client_id=excluded.client_id;
 select coalesce(max(seq),0) into v_cursor from public.icetak_mcp_events;
 if p_cursor is not null then
  insert into public.icetak_mcp_deliveries(subscription_id,event_id) select p_subscription->>'id',e.id from public.icetak_mcp_events e where e.seq>p_cursor and e.order_reference=p_subscription->>'order_reference' on conflict(subscription_id,event_id) do update set state='queued',attempts=0,next_attempt_at=now(),lease_until=null where icetak_mcp_deliveries.state='stopped' and icetak_mcp_deliveries.last_error='SUBSCRIPTION_INACTIVE';
 end if;
 return jsonb_build_object('id',p_subscription->>'id','refreshBefore',p_subscription->>'expires_at','cursor',coalesce(p_cursor,v_cursor)::text,'truncated',false);
end $$;

create function mcp_internal.capture() returns trigger language plpgsql security definer set search_path='' as $$
declare e public.icetak_mcp_events;begin
 if new.state<>'completed' or coalesce(new.brief->>'confirmed','false')<>'true' or new.order_reference is null then return new;end if;
 if tg_op='UPDATE' and old.state='completed' and coalesce(old.brief->>'confirmed','false')='true' then return new;end if;
 perform pg_advisory_xact_lock(8110261106);
 insert into public.icetak_mcp_events(task_id,order_reference,brief_revision,confirmed_at)
 values(new.task_id,new.order_reference,coalesce(nullif(new.content_hash,''),nullif(new.source_fingerprint,''),md5(new.brief::text)),coalesce((nullif(new.brief->>'confirmed_at',''))::timestamptz,new.completed_at,now()))
 on conflict(task_id,brief_revision) do nothing returning * into e;
 if e.id is not null then
 insert into public.icetak_mcp_deliveries(subscription_id,event_id)
 select s.id,e.id from public.icetak_mcp_subscriptions s join public.admin_users a on a.auth_user_id=s.owner_id and a.role='owner' and a.is_active where s.active and s.expires_at>now() and s.order_reference=e.order_reference on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function mcp_internal.capture() from public,anon,authenticated;
create trigger icetak_mcp_confirmed after insert or update of state,brief on public.clickup_order_brief_jobs for each row execute function mcp_internal.capture();

create function mcp_internal.dispatch() returns bigint language plpgsql security invoker set search_path='' as $$
declare t text;r bigint;begin
 if not exists(select 1 from public.icetak_mcp_deliveries where state in ('queued','sending') and next_attempt_at<=now() and (lease_until is null or lease_until<now()) and attempts<8) then return null;end if;
 select setting_value into t from public.private_runtime_settings where setting_key='order_brief_worker_token';
 if coalesce(t,'')='' then return null;end if;
 select net.http_post(url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/icetak-mcp/dispatch',headers:=jsonb_build_object('Content-Type','application/json','x-mcp-dispatch',t),body:='{}'::jsonb,timeout_milliseconds:=120000) into r;return r;
end $$;
revoke all on function mcp_internal.dispatch() from public,anon,authenticated;
grant usage on schema mcp_internal to service_role;
grant execute on function mcp_internal.dispatch() to service_role;
revoke all on function public.icetak_mcp_consume_code(text,text,text,text),public.icetak_mcp_consume_refresh(text,text),public.icetak_mcp_claim_deliveries(),public.icetak_mcp_subscribe(jsonb,bigint) from public,anon,authenticated;
grant execute on function public.icetak_mcp_consume_code(text,text,text,text),public.icetak_mcp_consume_refresh(text,text),public.icetak_mcp_claim_deliveries(),public.icetak_mcp_subscribe(jsonb,bigint) to service_role;
select cron.schedule('icetak-mcp-delivery','* * * * *','select mcp_internal.dispatch()');

-- Payload cursor must never skip an earlier event still awaiting delivery.
create function public.icetak_mcp_delivery_cursor(p_subscription text,p_event uuid) returns text language sql security invoker set search_path='' as $$
 select coalesce(min(e.seq) filter(where d.event_id<>p_event and d.state in ('queued','sending','failed'))-1,max(e.seq),0)::text from public.icetak_mcp_deliveries d join public.icetak_mcp_events e on e.id=d.event_id where d.subscription_id=p_subscription;
$$;
revoke all on function public.icetak_mcp_delivery_cursor(text,uuid) from public,anon,authenticated;
grant execute on function public.icetak_mcp_delivery_cursor(text,uuid) to service_role;
