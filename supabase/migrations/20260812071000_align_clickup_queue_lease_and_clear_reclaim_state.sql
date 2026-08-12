do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef('public.icetak_admin_clickup_queue(text,text,integer,integer)'::regprocedure) into v_def;
  v_new := replace(v_def,
    $q$r.locked_at<now()-interval '10 minutes'$q$,
    $q$r.locked_at<now()-interval '3 minutes'$q$
  );
  if v_new = v_def then raise exception 'icetak_admin_clickup_queue stale lease pattern not found'; end if;
  execute v_new;

  select pg_get_functiondef('public.icetak_admin_clickup_queue_retry(uuid)'::regprocedure) into v_def;
  v_new := replace(v_def,
    $q$v_outbox.locked_at>now()-interval '10 minutes'$q$,
    $q$v_outbox.locked_at>now()-interval '3 minutes'$q$
  );
  if v_new = v_def then raise exception 'icetak_admin_clickup_queue_retry lease pattern not found'; end if;
  execute v_new;

  select pg_get_functiondef('public.claim_clickup_production_outbox(integer)'::regprocedure) into v_def;
  v_new := replace(
    v_def,
    E'  set status=''processing'',\n      locked_at=now(),\n      attempts=coalesce(o.attempts,0)+1,\n      payload=public.icetak_clickup_production_payload_data(o.order_id)',
    E'  set status=''processing'',\n      locked_at=now(),\n      next_attempt_at=null,\n      last_error=null,\n      error=null,\n      attempts=coalesce(o.attempts,0)+1,\n      payload=public.icetak_clickup_production_payload_data(o.order_id)'
  );
  if v_new = v_def then raise exception 'claim_clickup_production_outbox reclaim cleanup pattern not found'; end if;
  execute v_new;
end $$;

comment on function public.claim_clickup_production_outbox(integer) is
  'Claims missing ClickUp production components with a 3-minute lease; successful reclaims clear stale retry/error metadata.';
comment on function public.icetak_admin_clickup_queue_retry(uuid) is
  'Admin component-safe ClickUp retry using the same 3-minute processing lease as the AP claimer.';
