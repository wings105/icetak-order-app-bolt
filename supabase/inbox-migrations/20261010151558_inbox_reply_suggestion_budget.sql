-- Unified Inbox project ONLY. Bounded counters, never chat/order data or draft text.
create table public.inbox_reply_suggestion_budget (
  scope text primary key,
  window_start timestamptz not null,
  used integer not null default 0 check (used >= 0),
  next_allowed_at timestamptz not null default '-infinity',
  updated_at timestamptz not null default now()
);
alter table public.inbox_reply_suggestion_budget enable row level security;
revoke all on public.inbox_reply_suggestion_budget from public, anon, authenticated;
grant select, insert, update, delete on public.inbox_reply_suggestion_budget to service_role;

create function public.inbox_reply_suggestion_claim(p_conversation_id uuid)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  t timestamptz := clock_timestamp();
  day_start timestamptz := date_trunc('day', t at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur';
  day_end timestamptz := day_start + interval '1 day';
  hour_start timestamptz := date_trunc('hour', t);
  d public.inbox_reply_suggestion_budget%rowtype;
  h public.inbox_reply_suggestion_budget%rowtype;
  c public.inbox_reply_suggestion_budget%rowtype;
begin
  if not exists (select 1 from public.conversations where id = p_conversation_id) then
    return jsonb_build_object('allowed', false, 'code', 'NOT_FOUND');
  end if;
  -- Fixed lock order serializes claims across isolates, tabs and staff.
  insert into public.inbox_reply_suggestion_budget(scope, window_start) values ('workspace:day', day_start) on conflict do nothing;
  select * into d from public.inbox_reply_suggestion_budget where scope = 'workspace:day' for update;
  t := clock_timestamp();
  day_start := date_trunc('day', t at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur';
  day_end := day_start + interval '1 day';
  hour_start := date_trunc('hour', t);
  if d.window_start <> day_start then
    update public.inbox_reply_suggestion_budget set window_start = day_start, used = 0, updated_at = t where scope = d.scope;
    d.used := 0;
    -- At most one row per recently used conversation; no per-attempt history.
    delete from public.inbox_reply_suggestion_budget where scope like 'conversation:%' and updated_at < t - interval '7 days';
  end if;
  if d.used >= 1000 then
    return jsonb_build_object('allowed', false, 'code', 'DAILY_LIMIT', 'retry_after_seconds', greatest(1, ceil(extract(epoch from day_end - t))));
  end if;
  insert into public.inbox_reply_suggestion_budget(scope, window_start) values ('workspace:hour', hour_start) on conflict do nothing;
  select * into h from public.inbox_reply_suggestion_budget where scope = 'workspace:hour' for update;
  if h.window_start <> hour_start then
    update public.inbox_reply_suggestion_budget set window_start = hour_start, used = 0, updated_at = t where scope = h.scope;
    h.used := 0;
  end if;
  if h.used >= 120 then
    return jsonb_build_object('allowed', false, 'code', 'HOURLY_LIMIT', 'retry_after_seconds', greatest(1, ceil(extract(epoch from hour_start + interval '1 hour' - t))));
  end if;
  insert into public.inbox_reply_suggestion_budget(scope, window_start) values ('conversation:' || p_conversation_id, t) on conflict do nothing;
  select * into c from public.inbox_reply_suggestion_budget where scope = 'conversation:' || p_conversation_id for update;
  if c.next_allowed_at > t then
    return jsonb_build_object('allowed', false, 'code', 'CONVERSATION_COOLDOWN', 'retry_after_seconds', greatest(1, ceil(extract(epoch from c.next_allowed_at - t))));
  end if;
  update public.inbox_reply_suggestion_budget set used = used + 1, updated_at = t where scope in (d.scope, h.scope);
  update public.inbox_reply_suggestion_budget set used = 1, window_start = t, next_allowed_at = t + interval '30 seconds', updated_at = t where scope = c.scope;
  -- Failures also consume a claim, preventing outage-driven calculation loops.
  return jsonb_build_object('allowed', true);
end;
$$;
revoke all on function public.inbox_reply_suggestion_claim(uuid) from public, anon, authenticated;
grant execute on function public.inbox_reply_suggestion_claim(uuid) to service_role;
comment on function public.inbox_reply_suggestion_claim(uuid) is 'Service-only atomic draft-calculation guard: 120/hour, 1000/MYT day workspace-wide, 30s per chat. Does not cap other Supabase traffic.';
