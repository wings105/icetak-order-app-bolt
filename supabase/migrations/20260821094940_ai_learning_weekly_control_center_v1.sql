-- AI draft learning control center.
-- Additive production migration: weekly feedback promotion, audit, rollback and locks.

alter table public.qrpay_ai_learning_rules
  add column if not exists auto_update_locked boolean not null default false,
  add column if not exists auto_update_locked_at timestamptz,
  add column if not exists auto_update_locked_by text,
  add column if not exists last_auto_updated_at timestamptz,
  add column if not exists rule_version integer not null default 1;

create table if not exists public.qrpay_ai_learning_settings (
  singleton boolean primary key default true check (singleton),
  auto_update_enabled boolean not null default true,
  notify_admin_enabled boolean not null default true,
  auto_promote_candidates boolean not null default true,
  minimum_occurrences integer not null default 3 check (minimum_occurrences between 2 and 100),
  lookback_days integer not null default 7 check (lookback_days between 1 and 30),
  schedule_label text not null default 'Setiap Sabtu, 9:00 pagi Malaysia',
  cron_expression_utc text not null default '0 1 * * 6',
  last_run_at timestamptz,
  last_success_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by text
);

insert into public.qrpay_ai_learning_settings (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.qrpay_ai_learning_runs (
  id uuid primary key default gen_random_uuid(),
  trigger_source text not null check (trigger_source in ('scheduled', 'manual')),
  actor text not null default 'system',
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'skipped')),
  window_started_at timestamptz not null,
  window_ended_at timestamptz not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  corrections_reviewed integer not null default 0,
  drafts_reviewed integer not null default 0,
  activated_rules integer not null default 0,
  updated_rules integer not null default 0,
  skipped_locked_rules integer not null default 0,
  skipped_candidate_rules integer not null default 0,
  notification_status text not null default 'pending'
    check (notification_status in ('pending', 'sent', 'failed', 'disabled', 'skipped')),
  notification_sent_at timestamptz,
  notification_error text,
  provider_message_id text,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists qrpay_ai_learning_runs_started_idx
  on public.qrpay_ai_learning_runs (started_at desc);

create table if not exists public.qrpay_ai_learning_rule_history (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.qrpay_ai_learning_rules (id) on delete cascade,
  run_id uuid references public.qrpay_ai_learning_runs (id) on delete set null,
  action text not null,
  actor text not null default 'system',
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  details jsonb not null default '{}'::jsonb,
  rolled_back_at timestamptz,
  rolled_back_by text,
  created_at timestamptz not null default now()
);

create index if not exists qrpay_ai_learning_history_rule_idx
  on public.qrpay_ai_learning_rule_history (rule_id, created_at desc);
create index if not exists qrpay_ai_learning_history_run_idx
  on public.qrpay_ai_learning_rule_history (run_id, created_at desc);

alter table public.qrpay_ai_learning_settings enable row level security;
alter table public.qrpay_ai_learning_runs enable row level security;
alter table public.qrpay_ai_learning_rule_history enable row level security;

revoke all on public.qrpay_ai_learning_settings,
              public.qrpay_ai_learning_runs,
              public.qrpay_ai_learning_rule_history
  from public, anon, authenticated;
grant select, insert, update, delete on public.qrpay_ai_learning_settings,
                                        public.qrpay_ai_learning_runs,
                                        public.qrpay_ai_learning_rule_history
  to service_role;

-- Preserve the existing draft workflow while freezing rules explicitly locked by admin.
create or replace function public.icetak_upsert_qrpay_learning_candidates(
  p_draft_id uuid,
  p_candidates jsonb,
  p_actor text default 'system'
)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $function$
declare
  v_draft public.qrpay_order_drafts%rowtype;
  candidate jsonb;
  rule_id uuid;
  rule_ids jsonb := '[]'::jsonb;
begin
  select * into v_draft
  from public.qrpay_order_drafts
  where id = p_draft_id;

  if not found then
    raise exception 'draft_not_found';
  end if;

  if jsonb_typeof(coalesce(p_candidates, '[]'::jsonb)) <> 'array' then
    return rule_ids;
  end if;

  for candidate in
    select value from jsonb_array_elements(coalesce(p_candidates, '[]'::jsonb))
  loop
    if nullif(candidate->>'signature', '') is null
       or nullif(candidate->>'strategy_key', '') is null then
      continue;
    end if;

    insert into public.qrpay_ai_learning_rules (
      signature, strategy_key, field_group, title, lesson, status,
      occurrence_count, examples, metadata, last_seen_at, updated_at
    )
    values (
      candidate->>'signature',
      candidate->>'strategy_key',
      coalesce(nullif(candidate->>'field_group', ''), 'other'),
      coalesce(nullif(candidate->>'title', ''), 'QRPay correction pattern'),
      coalesce(
        nullif(candidate->>'lesson', ''),
        'Use the human-confirmed value when evidence supports it.'
      ),
      'candidate',
      1,
      jsonb_build_array(jsonb_build_object(
        'draft_id', p_draft_id,
        'transaction_id', v_draft.transaction_id,
        'field_path', candidate->>'field_path',
        'ai_value', candidate->'ai_value',
        'human_value', candidate->'human_value'
      )),
      jsonb_build_object('created_by', p_actor),
      now(),
      now()
    )
    on conflict (signature) do update
      set occurrence_count = case
            when public.qrpay_ai_learning_rules.auto_update_locked then
              public.qrpay_ai_learning_rules.occurrence_count
            else public.qrpay_ai_learning_rules.occurrence_count + 1
          end,
          examples = case
            when public.qrpay_ai_learning_rules.auto_update_locked then
              public.qrpay_ai_learning_rules.examples
            when jsonb_array_length(public.qrpay_ai_learning_rules.examples) >= 20 then
              public.qrpay_ai_learning_rules.examples
            else public.qrpay_ai_learning_rules.examples || excluded.examples
          end,
          last_seen_at = case
            when public.qrpay_ai_learning_rules.auto_update_locked then
              public.qrpay_ai_learning_rules.last_seen_at
            else now()
          end,
          updated_at = case
            when public.qrpay_ai_learning_rules.auto_update_locked then
              public.qrpay_ai_learning_rules.updated_at
            else now()
          end
    returning id into rule_id;

    rule_ids := rule_ids || jsonb_build_array(rule_id);
  end loop;

  return rule_ids;
end;
$function$;

revoke all on function public.icetak_upsert_qrpay_learning_candidates(uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.icetak_upsert_qrpay_learning_candidates(uuid, jsonb, text)
  to service_role;

create or replace function public.icetak_ai_learning_run(
  p_trigger_source text default 'scheduled',
  p_actor text default 'system'
)
returns jsonb
language plpgsql
security invoker
set search_path = 'public', 'pg_temp'
as $function$
declare
  settings_row public.qrpay_ai_learning_settings%rowtype;
  run_row public.qrpay_ai_learning_runs%rowtype;
  current_rule public.qrpay_ai_learning_rules%rowtype;
  updated_rule public.qrpay_ai_learning_rules%rowtype;
  before_snapshot jsonb;
  window_start timestamptz;
  window_end timestamptz := clock_timestamp();
  actor_name text := coalesce(nullif(trim(p_actor), ''), 'system');
  promoted_ids uuid[] := '{}'::uuid[];
  rule_changes jsonb := '[]'::jsonb;
  feedback_count integer;
begin
  if p_trigger_source not in ('scheduled', 'manual') then
    raise exception 'invalid_learning_trigger';
  end if;

  if not pg_try_advisory_xact_lock(hashtext('icetak_ai_learning_weekly_run')) then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'run_in_progress');
  end if;

  select * into settings_row
  from public.qrpay_ai_learning_settings
  where singleton = true
  for update;

  if not found then
    raise exception 'learning_settings_not_found';
  end if;

  if p_trigger_source = 'scheduled' and not settings_row.auto_update_enabled then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'auto_update_disabled');
  end if;

  window_start := coalesce(
    greatest(settings_row.last_success_at, window_end - make_interval(days => settings_row.lookback_days)),
    window_end - make_interval(days => settings_row.lookback_days)
  );

  insert into public.qrpay_ai_learning_runs (
    trigger_source, actor, window_started_at, window_ended_at, notification_status
  )
  values (
    p_trigger_source,
    actor_name,
    window_start,
    window_end,
    case when settings_row.notify_admin_enabled then 'pending' else 'disabled' end
  )
  returning * into run_row;

  select count(*), count(distinct draft_id)
  into run_row.corrections_reviewed, run_row.drafts_reviewed
  from public.qrpay_ai_corrections
  where created_at >= window_start and created_at <= window_end;

  select count(distinct rule.id)
  into run_row.skipped_locked_rules
  from public.qrpay_ai_learning_rules rule
  join public.qrpay_ai_corrections correction
    on correction.learning_rule_id = rule.id
  where rule.auto_update_locked
    and correction.created_at >= window_start
    and correction.created_at <= window_end;

  if settings_row.auto_promote_candidates then
    for current_rule in
      with ranked_candidates as (
        select rule.*,
               row_number() over (
                 partition by rule.strategy_key
                 order by rule.occurrence_count desc, rule.last_seen_at desc, rule.created_at
               ) as strategy_rank
        from public.qrpay_ai_learning_rules rule
        where rule.status = 'candidate'
          and not rule.auto_update_locked
          and rule.occurrence_count >= settings_row.minimum_occurrences
          and rule.last_seen_at >= window_start
          and not exists (
            select 1 from public.qrpay_ai_learning_rules active_rule
            where active_rule.strategy_key = rule.strategy_key
              and active_rule.status = 'active'
          )
      )
      select id, signature, strategy_key, field_group, title, lesson, status,
             occurrence_count, examples, metadata, first_seen_at, last_seen_at,
             activated_at, activated_by, rejected_at, rejected_by, created_at,
             updated_at, auto_update_locked, auto_update_locked_at,
             auto_update_locked_by, last_auto_updated_at, rule_version
      from ranked_candidates
      where strategy_rank = 1
    loop
      before_snapshot := to_jsonb(current_rule);

      update public.qrpay_ai_learning_rules
      set status = 'active',
          activated_at = window_end,
          activated_by = actor_name,
          rejected_at = null,
          rejected_by = null,
          last_auto_updated_at = window_end,
          rule_version = rule_version + 1,
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'last_auto_run_id', run_row.id,
            'last_auto_reason', 'candidate_threshold_met',
            'weekly_feedback_count', occurrence_count
          ),
          updated_at = window_end
      where id = current_rule.id
      returning * into updated_rule;

      insert into public.qrpay_ai_learning_rule_history (
        rule_id, run_id, action, actor, before_snapshot, after_snapshot, details
      )
      values (
        updated_rule.id,
        run_row.id,
        'auto_activated',
        actor_name,
        before_snapshot,
        to_jsonb(updated_rule),
        jsonb_build_object('minimum_occurrences', settings_row.minimum_occurrences)
      );

      promoted_ids := array_append(promoted_ids, updated_rule.id);
      run_row.activated_rules := run_row.activated_rules + 1;
      rule_changes := rule_changes || jsonb_build_array(jsonb_build_object(
        'rule_id', updated_rule.id,
        'title', updated_rule.title,
        'strategy_key', updated_rule.strategy_key,
        'action', 'activated',
        'occurrence_count', updated_rule.occurrence_count
      ));
    end loop;
  end if;

  for current_rule in
    select rule.*
    from public.qrpay_ai_learning_rules rule
    where rule.status = 'active'
      and not rule.auto_update_locked
      and not (rule.id = any(promoted_ids))
      and exists (
        select 1 from public.qrpay_ai_corrections correction
        where correction.learning_rule_id = rule.id
          and correction.created_at >= window_start
          and correction.created_at <= window_end
          and (
            rule.last_auto_updated_at is null
            or correction.created_at > rule.last_auto_updated_at
          )
      )
    order by rule.occurrence_count desc, rule.last_seen_at desc
  loop
    select count(*) into feedback_count
    from public.qrpay_ai_corrections correction
    where correction.learning_rule_id = current_rule.id
      and correction.created_at >= window_start
      and correction.created_at <= window_end
      and (
        current_rule.last_auto_updated_at is null
        or correction.created_at > current_rule.last_auto_updated_at
      );

    before_snapshot := to_jsonb(current_rule);

    update public.qrpay_ai_learning_rules
    set last_auto_updated_at = window_end,
        rule_version = rule_version + 1,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'last_auto_run_id', run_row.id,
          'weekly_feedback_count', feedback_count,
          'weekly_window_start', window_start,
          'weekly_window_end', window_end
        ),
        updated_at = window_end
    where id = current_rule.id
    returning * into updated_rule;

    insert into public.qrpay_ai_learning_rule_history (
      rule_id, run_id, action, actor, before_snapshot, after_snapshot, details
    )
    values (
      updated_rule.id,
      run_row.id,
      'weekly_updated',
      actor_name,
      before_snapshot,
      to_jsonb(updated_rule),
      jsonb_build_object('feedback_count', feedback_count)
    );

    run_row.updated_rules := run_row.updated_rules + 1;
    rule_changes := rule_changes || jsonb_build_array(jsonb_build_object(
      'rule_id', updated_rule.id,
      'title', updated_rule.title,
      'strategy_key', updated_rule.strategy_key,
      'action', 'updated',
      'feedback_count', feedback_count,
      'occurrence_count', updated_rule.occurrence_count
    ));
  end loop;

  select count(*) into run_row.skipped_candidate_rules
  from public.qrpay_ai_learning_rules
  where status = 'candidate';

  update public.qrpay_ai_learning_runs
  set status = 'succeeded',
      completed_at = clock_timestamp(),
      corrections_reviewed = run_row.corrections_reviewed,
      drafts_reviewed = run_row.drafts_reviewed,
      activated_rules = run_row.activated_rules,
      updated_rules = run_row.updated_rules,
      skipped_locked_rules = run_row.skipped_locked_rules,
      skipped_candidate_rules = run_row.skipped_candidate_rules,
      summary = jsonb_build_object(
        'changes', rule_changes,
        'active_rules', (
          select count(*) from public.qrpay_ai_learning_rules where status = 'active'
        ),
        'candidate_rules', run_row.skipped_candidate_rules,
        'locked_rules', (
          select count(*) from public.qrpay_ai_learning_rules where auto_update_locked
        )
      )
  where id = run_row.id
  returning * into run_row;

  update public.qrpay_ai_learning_settings
  set last_run_at = window_end,
      last_success_at = window_end,
      updated_at = window_end,
      updated_by = actor_name
  where singleton = true;

  insert into public.admin_audit (order_db_id, order_id, action, actor, payload)
  values (
    null,
    null,
    'ai_learning_weekly_' || p_trigger_source,
    actor_name,
    jsonb_build_object(
      'run_id', run_row.id,
      'corrections_reviewed', run_row.corrections_reviewed,
      'activated_rules', run_row.activated_rules,
      'updated_rules', run_row.updated_rules,
      'skipped_locked_rules', run_row.skipped_locked_rules
    )
  );

  return jsonb_build_object('ok', true, 'run', to_jsonb(run_row));
end;
$function$;

revoke all on function public.icetak_ai_learning_run(text, text)
  from public, anon, authenticated;
grant execute on function public.icetak_ai_learning_run(text, text)
  to service_role;

create or replace function public.icetak_ai_learning_rule_action(
  p_rule_id uuid,
  p_action text,
  p_actor text default 'admin',
  p_history_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = 'public', 'pg_temp'
as $function$
declare
  current_rule public.qrpay_ai_learning_rules%rowtype;
  updated_rule public.qrpay_ai_learning_rules%rowtype;
  target_history public.qrpay_ai_learning_rule_history%rowtype;
  before_snapshot jsonb;
  restore_snapshot jsonb;
  action_name text := lower(trim(coalesce(p_action, '')));
  actor_name text := coalesce(nullif(trim(p_actor), ''), 'admin');
begin
  if action_name not in ('activate', 'deactivate', 'reject', 'lock', 'unlock', 'rollback') then
    raise exception 'invalid_learning_rule_action';
  end if;

  select * into current_rule
  from public.qrpay_ai_learning_rules
  where id = p_rule_id
  for update;

  if not found then
    raise exception 'learning_rule_not_found';
  end if;

  before_snapshot := to_jsonb(current_rule);

  if action_name = 'rollback' then
    select * into target_history
    from public.qrpay_ai_learning_rule_history
    where rule_id = current_rule.id
      and (p_history_id is null or id = p_history_id)
      and action in ('auto_activated', 'weekly_updated', 'manual_activated', 'manual_deactivated', 'manual_rejected')
      and rolled_back_at is null
    order by created_at desc
    limit 1
    for update;

    if not found then
      raise exception 'rollback_history_not_found';
    end if;

    restore_snapshot := target_history.before_snapshot;

    update public.qrpay_ai_learning_rules
    set status = coalesce(restore_snapshot->>'status', status),
        occurrence_count = coalesce((restore_snapshot->>'occurrence_count')::integer, occurrence_count),
        examples = coalesce(restore_snapshot->'examples', examples),
        metadata = coalesce(restore_snapshot->'metadata', metadata),
        first_seen_at = coalesce((restore_snapshot->>'first_seen_at')::timestamptz, first_seen_at),
        last_seen_at = coalesce((restore_snapshot->>'last_seen_at')::timestamptz, last_seen_at),
        activated_at = nullif(restore_snapshot->>'activated_at', '')::timestamptz,
        activated_by = nullif(restore_snapshot->>'activated_by', ''),
        rejected_at = nullif(restore_snapshot->>'rejected_at', '')::timestamptz,
        rejected_by = nullif(restore_snapshot->>'rejected_by', ''),
        last_auto_updated_at = nullif(restore_snapshot->>'last_auto_updated_at', '')::timestamptz,
        rule_version = greatest(rule_version + 1, coalesce((restore_snapshot->>'rule_version')::integer, 1) + 1),
        updated_at = now()
    where id = current_rule.id
    returning * into updated_rule;

    update public.qrpay_ai_learning_rule_history
    set rolled_back_at = now(), rolled_back_by = actor_name
    where id = target_history.id;

  elsif action_name in ('lock', 'unlock') then
    update public.qrpay_ai_learning_rules
    set auto_update_locked = action_name = 'lock',
        auto_update_locked_at = case when action_name = 'lock' then now() else null end,
        auto_update_locked_by = case when action_name = 'lock' then actor_name else null end,
        rule_version = rule_version + 1,
        updated_at = now()
    where id = current_rule.id
    returning * into updated_rule;

  else
    update public.qrpay_ai_learning_rules
    set status = case
          when action_name = 'activate' then 'active'
          when action_name = 'deactivate' then 'candidate'
          else 'rejected'
        end,
        activated_at = case when action_name = 'activate' then now() else activated_at end,
        activated_by = case when action_name = 'activate' then actor_name else activated_by end,
        rejected_at = case when action_name = 'reject' then now() else null end,
        rejected_by = case when action_name = 'reject' then actor_name else null end,
        rule_version = rule_version + 1,
        updated_at = now()
    where id = current_rule.id
    returning * into updated_rule;
  end if;

  insert into public.qrpay_ai_learning_rule_history (
    rule_id, action, actor, before_snapshot, after_snapshot, details
  )
  values (
    updated_rule.id,
    case
      when action_name = 'activate' then 'manual_activated'
      when action_name = 'deactivate' then 'manual_deactivated'
      when action_name = 'reject' then 'manual_rejected'
      when action_name = 'lock' then 'rule_locked'
      when action_name = 'unlock' then 'rule_unlocked'
      else 'rollback'
    end,
    actor_name,
    before_snapshot,
    to_jsonb(updated_rule),
    case when action_name = 'rollback'
      then jsonb_build_object('rolled_back_history_id', target_history.id)
      else '{}'::jsonb
    end
  );

  insert into public.admin_audit (order_db_id, order_id, action, actor, payload)
  values (
    null,
    null,
    'ai_learning_rule_' || action_name,
    actor_name,
    jsonb_build_object(
      'rule_id', updated_rule.id,
      'strategy_key', updated_rule.strategy_key,
      'status', updated_rule.status,
      'locked', updated_rule.auto_update_locked,
      'history_id', target_history.id
    )
  );

  return jsonb_build_object('ok', true, 'rule', to_jsonb(updated_rule));
end;
$function$;

revoke all on function public.icetak_ai_learning_rule_action(uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.icetak_ai_learning_rule_action(uuid, text, text, uuid)
  to service_role;

create or replace function public.icetak_ai_learning_schedule_tick()
returns bigint
language plpgsql
security invoker
set search_path = 'public', 'pg_temp'
as $function$
declare
  worker_token text;
  request_id bigint;
begin
  if not exists (
    select 1 from public.qrpay_ai_learning_settings
    where singleton = true and auto_update_enabled = true
  ) then
    return null;
  end if;

  select setting_value into worker_token
  from public.private_runtime_settings
  where setting_key = 'qrpay_ai_worker_token'
  limit 1;

  if nullif(worker_token, '') is null then
    raise exception 'ai_learning_worker_token_not_configured';
  end if;

  select net.http_post(
    url := 'https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/admin-ai-learning',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-ai-learning-token', worker_token
    ),
    body := jsonb_build_object('action', 'scheduled_run', 'scheduled_at', now()),
    timeout_milliseconds := 15000
  ) into request_id;

  return request_id;
end;
$function$;

revoke all on function public.icetak_ai_learning_schedule_tick()
  from public, anon, authenticated;
grant execute on function public.icetak_ai_learning_schedule_tick()
  to service_role;

-- pg_cron uses GMT/UTC. 01:00 Saturday UTC is 09:00 Saturday in Malaysia.
select cron.schedule(
  'icetak-ai-learning-weekly',
  '0 1 * * 6',
  $cron$select public.icetak_ai_learning_schedule_tick()$cron$
);
