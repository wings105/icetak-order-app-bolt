-- WhatsApp automation production hardening.
-- IMPORTANT: this migration does NOT enable customer lifecycle auto-send, pickup auto-send,
-- or any notification rule. It only adds guards, bounded retries, cleanup and readiness checks.

create or replace function public.icetak_order_is_cancelled(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((
    select lower(concat_ws(' ', o.status, o.admin_status, o.fulfillment_stage)) like '%cancel%'
    from public.orders o
    where o.id = p_order_id
  ), false);
$function$;

create or replace function public.icetak_order_is_paid(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((
    select lower(btrim(coalesce(nullif(o.payment_status, ''), o.payment, ''))) in (
      'paid','matched','payment_received','payment received','received','verified',
      'success','successful','fully_paid','fully paid'
    )
    from public.orders o
    where o.id = p_order_id
  ), false);
$function$;

create or replace function public.icetak_whatsapp_cancel_invalid_jobs()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cancelled_customer integer := 0;
  v_opted_out integer := 0;
  v_paid_pending integer := 0;
  v_cancelled_admin integer := 0;
  v_cancelled_outbox integer := 0;
  v_exhausted_customer integer := 0;
  v_exhausted_admin integer := 0;
  v_lifecycle text[] := array[
    'order_created','payment_pending','payment_received','production_started','review_ready',
    'order_ready_pickup','order_shipped','order_delivered','order_cancelled'
  ];
begin
  update public.notification_queue q
  set status='cancelled',
      processed_at=now(),
      locked_at=null,
      decision_mode='cancelled',
      decision_reason='order_cancelled_before_send',
      last_error=null
  from public.orders o
  where q.order_id=o.id
    and q.status in ('pending','processing')
    and q.event_type=any(v_lifecycle)
    and q.event_type<>'order_cancelled'
    and public.icetak_order_is_cancelled(o.id);
  get diagnostics v_cancelled_customer = row_count;

  update public.notification_queue q
  set status='skipped',
      processed_at=now(),
      locked_at=null,
      decision_mode='skipped',
      decision_reason='order_whatsapp_opted_out',
      last_error=null
  from public.orders o
  where q.order_id=o.id
    and q.status in ('pending','processing')
    and q.event_type=any(v_lifecycle)
    and coalesce(o.whatsapp_opt_in,false)=false;
  get diagnostics v_opted_out = row_count;

  update public.notification_queue q
  set status='skipped',
      processed_at=now(),
      locked_at=null,
      decision_mode='skipped',
      decision_reason='payment_already_received',
      last_error=null
  where q.status in ('pending','processing')
    and q.event_type='payment_pending'
    and q.order_id is not null
    and public.icetak_order_is_paid(q.order_id);
  get diagnostics v_paid_pending = row_count;

  update public.notification_queue
  set status='failed',
      processed_at=now(),
      locked_at=null,
      decision_reason=coalesce(decision_reason,'retry_limit_reached'),
      last_error=coalesce(last_error,'retry_limit_reached')
  where status in ('pending','processing')
    and coalesce(attempts,0)>=5;
  get diagnostics v_exhausted_customer = row_count;

  update public.admin_order_notification_queue q
  set status='cancelled',
      locked_at=null,
      last_error='order_cancelled_before_admin_notification',
      updated_at=now()
  where q.status in ('pending','retry','sending','dispatching')
    and public.icetak_order_is_cancelled(q.order_id);
  get diagnostics v_cancelled_admin = row_count;

  update public.admin_order_notification_queue
  set status='failed',
      locked_at=null,
      last_error=coalesce(last_error,'retry_limit_reached'),
      updated_at=now()
  where status in ('pending','retry','sending','dispatching')
    and coalesce(attempts,0)>=5;
  get diagnostics v_exhausted_admin = row_count;

  update public.notification_outbox n
  set status='skipped',
      error_code='order_cancelled',
      error_message='Order cancelled before WhatsApp enqueue'
  where coalesce(n.channel,'whatsapp')='whatsapp'
    and coalesce(n.status,'pending')='pending'
    and coalesce(n.event_type,'')<>'order_cancelled'
    and exists (
      select 1
      from public.orders o
      where public.icetak_order_is_cancelled(o.id)
        and (
          n.order_token=o.public_token
          or n.order_id=o.order_no
          or n.order_id=o.order_id
        )
    );
  get diagnostics v_cancelled_outbox = row_count;

  return jsonb_build_object(
    'cancelled_customer',v_cancelled_customer,
    'opted_out_customer',v_opted_out,
    'paid_payment_pending',v_paid_pending,
    'retry_exhausted_customer',v_exhausted_customer,
    'cancelled_admin',v_cancelled_admin,
    'retry_exhausted_admin',v_exhausted_admin,
    'cancelled_notification_outbox',v_cancelled_outbox
  );
end;
$function$;

create or replace function public.icetak_enqueue_whatsapp_event(
  p_event_type text,
  p_order_id uuid,
  p_extra jsonb default '{}'::jsonb,
  p_suffix text default null,
  p_scheduled_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  o public.orders%rowtype;
  c public.customers%rowtype;
  r public.whatsapp_notification_rules%rowtype;
  qid uuid;
  idem text;
  vars jsonb;
  enabled_global text;
  v_lifecycle boolean;
begin
  select * into o from public.orders where id=p_order_id;
  if o.id is null or coalesce(o.whatsapp_opt_in,false)=false then return null; end if;

  v_lifecycle := p_event_type = any(array[
    'order_created','payment_pending','payment_received','production_started','review_ready',
    'order_ready_pickup','order_shipped','order_delivered','order_cancelled'
  ]::text[]);

  if v_lifecycle then
    if p_event_type='order_cancelled' then
      if not public.icetak_order_is_cancelled(o.id) then return null; end if;
    elsif public.icetak_order_is_cancelled(o.id) then
      return null;
    end if;
    if p_event_type='payment_pending' and public.icetak_order_is_paid(o.id) then return null; end if;
  end if;

  select * into r from public.whatsapp_notification_rules where event_type=p_event_type limit 1;
  if r.id is null or not coalesce(r.enabled,false) then return null; end if;

  select coalesce(text_value,'true') into enabled_global
  from public.whatsapp_settings where key='enabled' limit 1;
  if lower(coalesce(enabled_global,'true')) not in ('true','1','yes','enabled','on') then return null; end if;

  select * into c from public.customers where id=o.customer_id;
  vars := public.icetak_whatsapp_vars(p_order_id,p_extra)
    || jsonb_build_object('order_db_id',o.id::text);
  idem := p_event_type||':'||p_order_id::text||':'||coalesce(nullif(p_suffix,''),'default');

  insert into public.notification_queue(
    event_type,channel,order_id,customer_id,phone,payload,status,attempts,
    scheduled_at,created_at,idempotency_key
  )
  values(
    p_event_type,'whatsapp',o.id,o.customer_id,
    public.icetak_normalize_phone(coalesce(c.phone,o.delivery_phone)),
    jsonb_build_object(
      'event_type',p_event_type,
      'phone',public.icetak_normalize_phone(coalesce(c.phone,o.delivery_phone)),
      'order_db_id',o.id,
      'vars',vars,
      'source','database_trigger',
      'idempotency_key',idem
    ),
    'pending',0,coalesce(p_scheduled_at,now()),now(),idem
  )
  on conflict(idempotency_key) do nothing
  returning id into qid;
  return qid;
end;
$function$;

create or replace function public.icetak_claim_notification_jobs(
  p_queue_id uuid default null,
  p_limit integer default 20
)
returns setof public.notification_queue
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.icetak_whatsapp_cancel_invalid_jobs();

  return query
  with picked as (
    select q.id
    from public.notification_queue q
    where q.status='pending'
      and coalesce(q.attempts,0)<5
      and coalesce(q.scheduled_at,now())<=now()
      and (p_queue_id is null or q.id=p_queue_id)
    order by q.created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,20),100))
  )
  update public.notification_queue q
  set status='processing',
      locked_at=now(),
      attempts=coalesce(q.attempts,0)+1
  from picked
  where q.id=picked.id
  returning q.*;
end;
$function$;

create or replace function public.icetak_requeue_stale_notification_jobs()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n integer := 0;
begin
  perform public.icetak_whatsapp_cancel_invalid_jobs();

  update public.notification_queue
  set status='pending',
      locked_at=null,
      last_error=concat_ws(' | ',nullif(last_error,''),'stale_processing_requeued'),
      scheduled_at=now()
  where status='processing'
    and locked_at<now()-interval '5 minutes'
    and coalesce(attempts,0)<5;
  get diagnostics n=row_count;
  return n;
end;
$function$;

create or replace function public.icetak_enqueue_admin_order_notification(
  p_order_id uuid,
  p_event_type text default 'auto_order_created',
  p_source_type text default null,
  p_source_key text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_id uuid;
begin
  if p_order_id is null or public.icetak_order_is_cancelled(p_order_id) then return null; end if;

  insert into public.admin_order_notification_queue(
    order_id,event_type,source_type,source_key,status,scheduled_at,updated_at
  )
  values(
    p_order_id,coalesce(nullif(p_event_type,''),'auto_order_created'),
    p_source_type,p_source_key,'pending',now(),now()
  )
  on conflict(order_id,event_type) do update set
    source_type=coalesce(excluded.source_type,public.admin_order_notification_queue.source_type),
    source_key=coalesce(excluded.source_key,public.admin_order_notification_queue.source_key),
    status=case
      when public.admin_order_notification_queue.status='sent' then 'sent'
      when public.icetak_order_is_cancelled(excluded.order_id) then 'cancelled'
      else 'pending'
    end,
    scheduled_at=case
      when public.admin_order_notification_queue.status='sent' then public.admin_order_notification_queue.scheduled_at
      else now()
    end,
    locked_at=null,
    last_error=case
      when public.admin_order_notification_queue.status='sent' then public.admin_order_notification_queue.last_error
      else null
    end,
    updated_at=now()
  returning id into v_id;

  perform public.icetak_kick_admin_order_notification(p_order_id);
  return v_id;
end;
$function$;

create or replace function public.icetak_kick_admin_order_notification(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_count integer := 0;
  v_key text;
  q record;
  v_ready boolean;
begin
  if p_order_id is null then return 0; end if;
  perform public.icetak_whatsapp_cancel_invalid_jobs();
  if public.icetak_order_is_cancelled(p_order_id) then return 0; end if;

  update public.admin_order_notification_queue
  set status='failed',
      locked_at=null,
      last_error=coalesce(last_error,'retry_limit_reached'),
      updated_at=now()
  where order_id=p_order_id
    and status in ('pending','retry','sending','dispatching')
    and coalesce(attempts,0)>=5;

  select setting_value into v_key
  from public.private_runtime_settings
  where setting_key='qrpay_ai_worker_token'
  limit 1;
  if nullif(v_key,'') is null then return 0; end if;

  for q in
    select id,event_type
    from public.admin_order_notification_queue
    where order_id=p_order_id
      and status in ('pending','retry')
      and coalesce(attempts,0)<5
      and scheduled_at<=now()
    order by created_at
    for update skip locked
  loop
    v_ready := q.event_type in ('ai_order_draft_created','ai_order_created')
      or (
        exists(select 1 from public.production_components where order_id=p_order_id)
        and not exists(
          select 1 from public.production_components
          where order_id=p_order_id and clickup_task_id is null
        )
      );
    if not v_ready then continue; end if;

    update public.admin_order_notification_queue
    set status='sending',locked_at=now(),attempts=attempts+1,updated_at=now()
    where id=q.id and status in ('pending','retry');
    if not found then continue; end if;

    perform net.http_post(
      url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/admin-order-control',
      headers:=jsonb_build_object(
        'content-type','application/json',
        'x-admin-order-token',v_key
      ),
      body:=jsonb_build_object('action','send_final_notification','queue_id',q.id)
    );
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$function$;

create or replace function public.icetak_retry_admin_order_notifications()
returns integer
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  r record;
  n integer := 0;
begin
  perform public.icetak_whatsapp_cancel_invalid_jobs();

  update public.admin_order_notification_queue
  set status=case when coalesce(attempts,0)>=5 then 'failed' else 'retry' end,
      locked_at=null,
      scheduled_at=case when coalesce(attempts,0)>=5 then scheduled_at else now() end,
      last_error=case
        when coalesce(attempts,0)>=5 then coalesce(last_error,'retry_limit_reached')
        else concat_ws(' | ',nullif(last_error,''),'stale_dispatch_recovered')
      end,
      updated_at=now()
  where status in ('sending','dispatching')
    and locked_at<now()-interval '10 minutes';

  update public.admin_order_notification_queue
  set status='failed',
      locked_at=null,
      last_error=coalesce(last_error,'retry_limit_reached'),
      updated_at=now()
  where status in ('pending','retry')
    and coalesce(attempts,0)>=5;

  for r in
    select distinct order_id
    from public.admin_order_notification_queue
    where status in ('pending','retry')
      and coalesce(attempts,0)<5
      and scheduled_at<=now()
  loop
    n:=n+public.icetak_kick_admin_order_notification(r.order_id);
  end loop;
  return n;
end;
$function$;

create or replace function public.icetak_whatsapp_cancel_on_order_cancelled()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_old_cancelled boolean;
  v_new_cancelled boolean;
begin
  v_old_cancelled := lower(concat_ws(' ',old.status,old.admin_status,old.fulfillment_stage)) like '%cancel%';
  v_new_cancelled := lower(concat_ws(' ',new.status,new.admin_status,new.fulfillment_stage)) like '%cancel%';
  if v_old_cancelled or not v_new_cancelled then return new; end if;

  update public.notification_queue
  set status='cancelled',
      processed_at=now(),
      locked_at=null,
      decision_mode='cancelled',
      decision_reason='order_cancelled_before_send',
      last_error=null
  where order_id=new.id
    and status in ('pending','processing')
    and event_type=any(array[
      'order_created','payment_pending','payment_received','production_started','review_ready',
      'order_ready_pickup','order_shipped','order_delivered'
    ]::text[]);

  update public.admin_order_notification_queue
  set status='cancelled',
      locked_at=null,
      last_error='order_cancelled_before_admin_notification',
      updated_at=now()
  where order_id=new.id
    and status in ('pending','retry','sending','dispatching');

  update public.notification_outbox
  set status='skipped',
      error_code='order_cancelled',
      error_message='Order cancelled before WhatsApp enqueue'
  where coalesce(channel,'whatsapp')='whatsapp'
    and coalesce(status,'pending')='pending'
    and coalesce(event_type,'')<>'order_cancelled'
    and (
      order_token=new.public_token
      or order_id=new.order_no
      or order_id=new.order_id
    );

  return new;
end;
$function$;

drop trigger if exists zz_icetak_whatsapp_cancel_invalid_on_order_cancel_trg on public.orders;
create trigger zz_icetak_whatsapp_cancel_invalid_on_order_cancel_trg
after update of status,admin_status,fulfillment_stage on public.orders
for each row
execute function public.icetak_whatsapp_cancel_on_order_cancelled();

create or replace function public.icetak_whatsapp_auto_readiness()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_global boolean := false;
  v_partner boolean := false;
  v_waba boolean := false;
  v_dispatch_url boolean := false;
  v_dispatch_key boolean := false;
  v_window_url boolean := false;
  v_template_blockers integer := 0;
  v_template_details jsonb := '[]'::jsonb;
  v_invalid_customer integer := 0;
  v_invalid_admin integer := 0;
  v_exhausted integer := 0;
  v_pickup jsonb := '{}'::jsonb;
  v_tracking jsonb := '{}'::jsonb;
  v_activation_ready boolean := false;
  v_lifecycle text[] := array[
    'order_created','payment_pending','payment_received','production_started','review_ready',
    'order_ready_pickup','order_shipped','order_delivered','order_cancelled'
  ];
begin
  if coalesce(auth.role(),'')<>'service_role' and not public.icetak_admin_can_manage_whatsapp() then
    raise exception 'forbidden';
  end if;

  select coalesce(lower(coalesce(text_value,'false')) in ('true','1','yes','enabled','on'),false)
  into v_global
  from public.whatsapp_settings where key='enabled' limit 1;

  select exists(select 1 from public.whatsapp_settings where key='partner_key' and nullif(secret_value,'') is not null) into v_partner;
  select exists(select 1 from public.whatsapp_settings where key='waba_id' and nullif(text_value,'') is not null) into v_waba;
  select exists(select 1 from public.whatsapp_settings where key='dispatch_url' and nullif(text_value,'') is not null) into v_dispatch_url;
  select exists(select 1 from public.whatsapp_settings where key='dispatch_internal_key' and nullif(secret_value,'') is not null) into v_dispatch_key;
  select exists(select 1 from public.whatsapp_settings where key='unified_inbox_24h_url' and nullif(text_value,'') is not null) into v_window_url;

  select count(*)::int,
         coalesce(jsonb_agg(jsonb_build_object(
           'event_type',x.event_type,
           'template_name',x.template_name,
           'language',x.template_language,
           'reason',x.reason
         ) order by x.event_type),'[]'::jsonb)
  into v_template_blockers,v_template_details
  from (
    select r.event_type,r.template_name,r.template_language,
      case
        when coalesce(r.template_enabled,false)=false then 'template_disabled'
        when nullif(r.template_name,'') is null then 'template_name_missing'
        when not exists(
          select 1 from public.whatsapp_templates t
          where t.name=r.template_name
            and t.language=coalesce(nullif(r.template_language,''),'ms')
            and upper(coalesce(t.status,''))='APPROVED'
        ) then 'template_not_approved'
        else null
      end reason
    from public.whatsapp_notification_rules r
    where r.event_type=any(v_lifecycle)
      and coalesce(r.enabled,false)
      and coalesce(r.prefer_template_when_closed,true)
  ) x
  where x.reason is not null;

  select count(*)::int into v_invalid_customer
  from public.notification_queue q
  join public.orders o on o.id=q.order_id
  where q.status in ('pending','processing')
    and q.event_type=any(v_lifecycle)
    and (
      coalesce(o.whatsapp_opt_in,false)=false
      or (q.event_type<>'order_cancelled' and public.icetak_order_is_cancelled(o.id))
      or (q.event_type='order_cancelled' and not public.icetak_order_is_cancelled(o.id))
      or (q.event_type='payment_pending' and public.icetak_order_is_paid(o.id))
    );

  select count(*)::int into v_invalid_admin
  from public.admin_order_notification_queue q
  where q.status in ('pending','retry','sending','dispatching')
    and public.icetak_order_is_cancelled(q.order_id);

  select (
    (select count(*) from public.notification_queue where status in ('pending','processing') and coalesce(attempts,0)>=5)
    +
    (select count(*) from public.admin_order_notification_queue where status in ('pending','retry','sending','dispatching') and coalesce(attempts,0)>=5)
  )::int into v_exhausted;

  begin
    v_pickup := public.icetak_pickup_auto_provider_status();
  exception when undefined_function then
    v_pickup := jsonb_build_object('ready',false,'error','pickup_provider_status_function_missing');
  end;
  begin
    v_tracking := public.icetak_tracking_auto_provider_status();
  exception when undefined_function then
    v_tracking := jsonb_build_object('ready',false,'error','tracking_provider_status_function_missing');
  end;

  v_activation_ready := v_partner and v_waba and v_dispatch_url and v_dispatch_key
    and v_template_blockers=0 and v_invalid_customer=0 and v_invalid_admin=0 and v_exhausted=0;

  return jsonb_build_object(
    'activation_ready',v_activation_ready,
    'customer_lifecycle_enabled',coalesce(v_global,false),
    'provider_ready',v_partner and v_waba and v_dispatch_url and v_dispatch_key,
    'checks',jsonb_build_object(
      'partner_key',v_partner,
      'waba_id',v_waba,
      'dispatcher',v_dispatch_url and v_dispatch_key,
      'window_check_configured',v_window_url
    ),
    'template_blocker_count',v_template_blockers,
    'template_blockers',v_template_details,
    'invalid_customer_queue',v_invalid_customer,
    'invalid_admin_queue',v_invalid_admin,
    'retry_exhausted',v_exhausted,
    'pickup_provider_status',v_pickup,
    'tracking_provider_status',v_tracking,
    'note','activation_ready is independent of the master ON/OFF switch; no switch is changed by this migration'
  );
end;
$function$;

-- One-time cleanup runs only when this migration is deliberately applied later.
-- It is generic and does not hard-code any order ID.
select public.icetak_whatsapp_cancel_invalid_jobs();

revoke all on function public.icetak_order_is_cancelled(uuid) from public;
revoke all on function public.icetak_order_is_paid(uuid) from public;
revoke all on function public.icetak_whatsapp_cancel_invalid_jobs() from public;
revoke all on function public.icetak_whatsapp_auto_readiness() from public;
grant execute on function public.icetak_whatsapp_cancel_invalid_jobs() to service_role;
grant execute on function public.icetak_whatsapp_auto_readiness() to authenticated,service_role;

comment on function public.icetak_whatsapp_auto_readiness()
is 'Read-only readiness check for customer WhatsApp automation. It does not enable any automation.';
