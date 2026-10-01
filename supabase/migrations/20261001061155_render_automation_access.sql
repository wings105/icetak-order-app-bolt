create table public.render_automation_keys (
 token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
 created_by text not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '365 days',
 active boolean not null default true,
 window_start timestamptz not null default now(),
 window_count integer not null default 0,
 last_used_at timestamptz
);
alter table public.render_automation_keys enable row level security;
revoke all on public.render_automation_keys from public,anon,authenticated;
grant all on public.render_automation_keys to service_role;
create unique index render_automation_one_active_actor on public.render_automation_keys(created_by) where active;
create function public.icetak_render_key_rotate(p_actor text,p_hash text) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if p_actor is null or length(p_actor)=0 or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid key'; end if;
 perform pg_advisory_xact_lock(hashtextextended('render-key:'||p_actor,0));
 update public.render_automation_keys set active=false where created_by=p_actor and active;
 insert into public.render_automation_keys(token_hash,created_by) values(p_hash,p_actor);
end $$;
create function public.icetak_render_key_revoke(p_actor text) returns void
language sql security invoker set search_path=public,pg_temp as $$
 update public.render_automation_keys set active=false where created_by=p_actor and active
$$;
create function public.icetak_render_key_authorize(p_hash text) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare k public.render_automation_keys%rowtype;
begin
 select * into k from public.render_automation_keys where token_hash=p_hash for update;
 if not found or not k.active or k.expires_at<=now() then return jsonb_build_object('allowed',false,'status',401,'error','API key tidak sah / tamat tempoh'); end if;
 if k.window_start<=now()-interval '1 minute' then k.window_start:=now();k.window_count:=0;end if;
 if k.window_count>=20 then return jsonb_build_object('allowed',false,'status',429,'error','Had 20 request seminit. Cuba semula.');end if;
 update public.render_automation_keys set window_start=k.window_start,window_count=k.window_count+1,last_used_at=now() where token_hash=p_hash;
 return jsonb_build_object('allowed',true,'actor',k.created_by);
end $$;
revoke all on function public.icetak_render_key_rotate(text,text),public.icetak_render_key_revoke(text),public.icetak_render_key_authorize(text) from public,anon,authenticated;
grant execute on function public.icetak_render_key_rotate(text,text),public.icetak_render_key_revoke(text),public.icetak_render_key_authorize(text) to service_role;
