-- Admin approval + final notification pipeline for QRPay and pickup AI orders.

create table if not exists public.admin_order_reviews (
  id uuid primary key default gen_random_uuid(),
  review_token text not null unique default ('ar_'||replace(gen_random_uuid()::text,'-','')),
  source_type text not null check (source_type in ('qrpay','pickup_ai','manual')),
  source_key text not null,
  qrpay_job_id uuid null references public.qrpay_ai_jobs(id) on delete set null,
  transaction_id text null,
  amount numeric null,
  candidate_phone text null,
  candidate_name text null,
  match_score numeric null,
  extraction jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'pending_admin',
  admin_phone text not null default '60129554732',
  order_id uuid null references public.orders(id) on delete set null,
  order_no text null,
  approved_at timestamptz null,
  rejected_at timestamptz null,
  completed_at timestamptz null,
  last_notified_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_type,source_key)
);
create index if not exists idx_admin_order_reviews_status on public.admin_order_reviews(status,created_at desc);
create index if not exists idx_admin_order_reviews_admin_phone on public.admin_order_reviews(admin_phone,status,created_at desc);

create table if not exists public.admin_order_notification_queue (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  event_type text not null,
  source_type text null,
  source_key text null,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text null,
  provider_message_id text null,
  scheduled_at timestamptz not null default now(),
  locked_at timestamptz null,
  sent_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id,event_type)
);
create index if not exists idx_admin_order_notification_ready on public.admin_order_notification_queue(status,scheduled_at,created_at);

insert into public.whatsapp_settings(provider,key,text_value,is_secret,created_at,updated_at)
values ('icetak','admin_order_notify_phone','60129554732',false,now(),now())
on conflict (key) do update set text_value=excluded.text_value,updated_at=now();

create or replace function public.icetak_kick_admin_order_notification(p_order_id uuid)
returns integer language plpgsql security definer set search_path='public','pg_temp'
as $function$
declare v_count integer:=0; v_key text; q record;
begin
  if p_order_id is null then return 0; end if;
  if not exists(select 1 from public.production_components where order_id=p_order_id) then return 0; end if;
  if exists(select 1 from public.production_components where order_id=p_order_id and clickup_task_id is null) then return 0; end if;
  select setting_value into v_key from public.private_runtime_settings where setting_key='qrpay_ai_worker_token' limit 1;
  if nullif(v_key,'') is null then return 0; end if;
  for q in select id from public.admin_order_notification_queue
    where order_id=p_order_id and status in ('pending','retry') and scheduled_at<=now()
    order by created_at for update skip locked
  loop
    update public.admin_order_notification_queue set status='sending',locked_at=now(),attempts=attempts+1,updated_at=now() where id=q.id;
    perform net.http_post(
      url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/admin-order-control',
      headers:=jsonb_build_object('content-type','application/json','x-admin-order-token',v_key),
      body:=jsonb_build_object('action','send_final_notification','queue_id',q.id)
    );
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$function$;

create or replace function public.icetak_enqueue_admin_order_notification(p_order_id uuid,p_event_type text default 'auto_order_created',p_source_type text default null,p_source_key text default null)
returns uuid language plpgsql security definer set search_path='public','pg_temp'
as $function$
declare v_id uuid;
begin
  if p_order_id is null then return null; end if;
  insert into public.admin_order_notification_queue(order_id,event_type,source_type,source_key,status,scheduled_at,updated_at)
  values(p_order_id,coalesce(nullif(p_event_type,''),'auto_order_created'),p_source_type,p_source_key,'pending',now(),now())
  on conflict(order_id,event_type) do update set
    source_type=coalesce(excluded.source_type,public.admin_order_notification_queue.source_type),
    source_key=coalesce(excluded.source_key,public.admin_order_notification_queue.source_key),
    status=case when public.admin_order_notification_queue.status='sent' then 'sent' else 'pending' end,
    scheduled_at=case when public.admin_order_notification_queue.status='sent' then public.admin_order_notification_queue.scheduled_at else now() end,
    last_error=case when public.admin_order_notification_queue.status='sent' then public.admin_order_notification_queue.last_error else null end,
    updated_at=now()
  returning id into v_id;
  perform public.icetak_kick_admin_order_notification(p_order_id);
  return v_id;
end;
$function$;

create or replace function public.icetak_admin_notification_from_order_insert()
returns trigger language plpgsql security definer set search_path='public','pg_temp'
as $function$
begin
  if lower(coalesce(new.source,'')) in ('qrpay_ai','pickup_ai') then
    perform public.icetak_enqueue_admin_order_notification(new.id,'auto_order_created',lower(new.source),coalesce(new.external_order_id,new.order_id,new.id::text));
  end if;
  return new;
end;
$function$;
drop trigger if exists trg_admin_notify_ai_order_insert on public.orders;
create trigger trg_admin_notify_ai_order_insert after insert on public.orders for each row execute function public.icetak_admin_notification_from_order_insert();

create or replace function public.icetak_admin_notification_from_payment_insert()
returns trigger language plpgsql security definer set search_path='public','pg_temp'
as $function$
declare v_source text;
begin
  if new.order_id is null then return new; end if;
  select lower(coalesce(source,'')) into v_source from public.orders where id=new.order_id;
  if v_source='qrpay_ai' then return new; end if;
  if lower(coalesce(new.provider,'')) in ('duitnow','webhook','qrpay','qr_pay','payment_webhook') then
    perform public.icetak_enqueue_admin_order_notification(new.order_id,'qrpay_matched_existing','qrpay',new.transaction_id);
  end if;
  return new;
end;
$function$;
drop trigger if exists trg_admin_notify_qr_payment_insert on public.payment_transactions;
create trigger trg_admin_notify_qr_payment_insert after insert on public.payment_transactions for each row execute function public.icetak_admin_notification_from_payment_insert();

create or replace function public.icetak_admin_notification_clickup_ready()
returns trigger language plpgsql security definer set search_path='public','pg_temp'
as $function$
begin
  if new.order_id is not null and new.clickup_task_id is not null and (tg_op='INSERT' or new.clickup_task_id is distinct from old.clickup_task_id) then
    perform public.icetak_kick_admin_order_notification(new.order_id);
  end if;
  return new;
end;
$function$;
drop trigger if exists trg_admin_notify_clickup_component_ready on public.production_components;
create trigger trg_admin_notify_clickup_component_ready after insert or update of clickup_task_id on public.production_components for each row execute function public.icetak_admin_notification_clickup_ready();

create or replace function public.icetak_retry_admin_order_notifications()
returns integer language plpgsql security definer set search_path='public','pg_temp'
as $function$
declare r record; n integer:=0;
begin
  update public.admin_order_notification_queue set status='retry',locked_at=null,scheduled_at=now(),last_error=coalesce(last_error,'stale_sending_recovered'),updated_at=now()
  where status='sending' and locked_at<now()-interval '10 minutes';
  for r in select distinct order_id from public.admin_order_notification_queue where status in ('pending','retry') and scheduled_at<=now()
  loop n:=n+public.icetak_kick_admin_order_notification(r.order_id); end loop;
  return n;
end;
$function$;

create or replace function public.icetak_kick_admin_order_review(p_review_id uuid)
returns bigint language plpgsql security definer set search_path='public','pg_temp'
as $function$
declare r public.admin_order_reviews%rowtype; v_key text; v_req bigint;
begin
  select * into r from public.admin_order_reviews where id=p_review_id;
  if r.id is null then return null; end if;
  select setting_value into v_key from public.private_runtime_settings where setting_key='qrpay_ai_worker_token' limit 1;
  if nullif(v_key,'') is null then return null; end if;
  select net.http_post(url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/admin-order-control',headers:=jsonb_build_object('content-type','application/json','x-admin-order-token',v_key),body:=jsonb_build_object('action','create_review','source_type',r.source_type,'source_key',r.source_key,'qrpay_job_id',r.qrpay_job_id,'transaction_id',r.transaction_id,'amount',r.amount,'candidate_phone',r.candidate_phone,'candidate_name',r.candidate_name,'match_score',r.match_score,'extraction',r.extraction,'evidence',r.evidence)) into v_req;
  return v_req;
end;
$function$;

alter table public.admin_order_reviews enable row level security;
alter table public.admin_order_notification_queue enable row level security;

-- Production project also schedules this once per minute with pg_cron:
-- select cron.schedule('icetak-admin-order-notify-every-minute','* * * * *','select public.icetak_retry_admin_order_notifications();');
