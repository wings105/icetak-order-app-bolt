-- Structured draft cancellation, follow-up work queue and safe WhatsApp scheduling.
-- Automation and auto-cancel are intentionally installed OFF until approved Meta
-- templates are mapped in WhatsApp Control Center.

alter table public.qrpay_order_drafts
  add column if not exists cancel_reason_code text,
  add column if not exists cancel_reason_detail text,
  add column if not exists cancel_source text,
  add column if not exists followup_enabled boolean not null default true,
  add column if not exists followup_paused_at timestamptz,
  add column if not exists followup_count integer not null default 0,
  add column if not exists last_followup_at timestamptz,
  add column if not exists next_followup_at timestamptz,
  add column if not exists customer_responded_at timestamptz;

create table if not exists public.draft_cancel_reasons (
  code text primary key,
  label text not null,
  enabled boolean not null default true,
  requires_detail boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.draft_cancel_reasons(code,label,requires_detail,sort_order) values
  ('customer_order_shopee','Customer mahu order melalui Shopee',false,10),
  ('price_not_suitable','Harga tidak sesuai',false,20),
  ('shipping_cost','Caj penghantaran tidak sesuai',false,30),
  ('date_unavailable','Tarikh diperlukan tidak sempat',false,40),
  ('changed_mind','Customer tukar fikiran',false,50),
  ('postponed','Customer tangguh dahulu',false,60),
  ('no_response','Tiada respons selepas follow-up',false,70),
  ('duplicate_or_mistake','Duplicate / salah buat draft',false,80),
  ('incomplete_customer_info','Maklumat customer tidak lengkap',false,90),
  ('product_unavailable','Produk tidak tersedia',false,100),
  ('other','Lain-lain',true,999)
on conflict(code) do update set label=excluded.label,requires_detail=excluded.requires_detail,sort_order=excluded.sort_order;

create table if not exists public.draft_followup_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  auto_cancel_enabled boolean not null default false,
  max_followups integer not null default 3 check(max_followups between 1 and 3),
  first_delay_hours integer not null default 24 check(first_delay_hours between 1 and 720),
  second_delay_hours integer not null default 48 check(second_delay_hours between 1 and 720),
  third_delay_hours integer not null default 48 check(third_delay_hours between 1 and 720),
  auto_cancel_delay_hours integer not null default 24 check(auto_cancel_delay_hours between 1 and 720),
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into public.draft_followup_settings(singleton) values(true) on conflict(singleton) do nothing;

create table if not exists public.draft_followup_events (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.qrpay_order_drafts(id) on delete cascade,
  event_type text not null,
  followup_number integer,
  notification_queue_id uuid references public.notification_queue(id) on delete set null,
  actor text not null default 'system',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists draft_followup_due_idx on public.qrpay_order_drafts(next_followup_at)
  where order_id is null and status not in ('confirmed','rejected') and followup_enabled=true;
create index if not exists draft_followup_events_draft_idx on public.draft_followup_events(draft_id,created_at desc);

alter table public.draft_cancel_reasons enable row level security;
alter table public.draft_followup_settings enable row level security;
alter table public.draft_followup_events enable row level security;
revoke all on public.draft_cancel_reasons,public.draft_followup_settings,public.draft_followup_events from anon,authenticated;

insert into public.whatsapp_notification_rules(
  event_type,label,enabled,prefer_template_when_closed,freeform_text,template_name,
  template_language,template_params,sort_order,trigger_status,notes,available_fields,
  freeform_enabled,template_enabled
) values
  ('draft_followup_1','Draft Follow-up 1',true,true,
   'Hi {customer_name}, peringatan untuk draft order anda berjumlah RM{draft_total}. Sila semak dan teruskan melalui link: {review_link}',
   null,'ms','["customer_name","draft_total","review_link"]'::jsonb,210,'scheduled',
   'Free-form dalam 24H; approved Meta template diperlukan selepas 24H.',
   array['customer_name','draft_total','review_link','followup_number'],true,true),
  ('draft_followup_2','Draft Follow-up 2',true,true,
   'Hi {customer_name}, adakah anda masih mahu teruskan draft order RM{draft_total}? Semak di sini: {review_link}',
   null,'ms','["customer_name","draft_total","review_link"]'::jsonb,211,'scheduled',
   'Free-form dalam 24H; approved Meta template diperlukan selepas 24H.',
   array['customer_name','draft_total','review_link','followup_number'],true,true),
  ('draft_followup_3','Draft Follow-up Terakhir',true,true,
   'Hi {customer_name}, ini peringatan terakhir untuk draft order RM{draft_total}. Jika masih mahu teruskan, buka: {review_link}',
   null,'ms','["customer_name","draft_total","review_link"]'::jsonb,212,'scheduled',
   'Free-form dalam 24H; approved Meta template diperlukan selepas 24H.',
   array['customer_name','draft_total','review_link','followup_number'],true,true)
on conflict(event_type) do update set
  label=excluded.label,freeform_text=excluded.freeform_text,template_params=excluded.template_params,
  sort_order=excluded.sort_order,notes=excluded.notes,available_fields=excluded.available_fields,
  updated_at=now();

create or replace function public.icetak_draft_followup_initialize()
returns trigger language plpgsql security invoker set search_path to 'public' as $function$
declare cfg public.draft_followup_settings%rowtype;
begin
  if new.customer_link_sent_at is not null
     and old.customer_link_sent_at is distinct from new.customer_link_sent_at
     and new.order_id is null and new.payment_mode='prepaid'
     and coalesce((new.working_draft->>'notify_whatsapp')::boolean,true) then
    select * into cfg from public.draft_followup_settings where singleton=true;
    new.followup_enabled:=true;
    new.followup_paused_at:=null;
    new.followup_count:=0;
    new.last_followup_at:=null;
    new.next_followup_at:=new.customer_link_sent_at + make_interval(hours=>coalesce(cfg.first_delay_hours,24));
  elsif coalesce((new.working_draft->>'notify_whatsapp')::boolean,true)=false then
    new.followup_enabled:=false;
    new.next_followup_at:=null;
  end if;
  if new.order_id is not null or new.status in ('confirmed','rejected') or new.payment_status in ('paid','matched','payment_received') then
    new.next_followup_at:=null;
  end if;
  return new;
end;
$function$;
drop trigger if exists qrpay_order_draft_followup_initialize on public.qrpay_order_drafts;
create trigger qrpay_order_draft_followup_initialize before update of customer_link_sent_at,working_draft,order_id,status,payment_status
on public.qrpay_order_drafts for each row execute function public.icetak_draft_followup_initialize();

create or replace function public.icetak_admin_cancel_draft(
  p_review_token text,p_reason_code text,p_reason_detail text default null,
  p_actor text default 'admin',p_source text default 'admin'
) returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare d public.qrpay_order_drafts%rowtype; r public.draft_cancel_reasons%rowtype;
begin
  select * into r from public.draft_cancel_reasons where code=p_reason_code and enabled=true;
  if not found then raise exception 'valid_cancel_reason_required'; end if;
  if r.requires_detail and nullif(btrim(coalesce(p_reason_detail,'')),'') is null then raise exception 'cancel_reason_detail_required'; end if;
  select * into d from public.qrpay_order_drafts where review_token=p_review_token for update;
  if not found then raise exception 'draft_not_found'; end if;
  if d.status='confirmed' or d.order_id is not null then raise exception 'confirmed_draft_cannot_be_rejected'; end if;
  update public.qrpay_order_drafts set
    status='rejected',rejected_at=now(),rejected_by=coalesce(nullif(p_actor,''),'admin'),
    cancel_reason_code=r.code,cancel_reason_detail=nullif(btrim(coalesce(p_reason_detail,'')),''),
    cancel_source=coalesce(nullif(p_source,''),'admin'),followup_enabled=false,followup_paused_at=now(),next_followup_at=null,
    last_error=null,updated_at=now()
  where id=d.id;
  update public.notification_queue set status='cancelled',processed_at=now(),locked_at=null,
    decision_reason='draft_cancelled',last_error='Draft cancelled'
  where status in ('pending','processing') and payload->>'draft_id'=d.id::text;
  insert into public.qrpay_order_draft_events(draft_id,event_type,actor,before_data,metadata)
  values(d.id,'admin_rejected',coalesce(nullif(p_actor,''),'admin'),d.working_draft,
    jsonb_build_object('reason_code',r.code,'reason_label',r.label,'reason_detail',nullif(btrim(coalesce(p_reason_detail,'')),''),'source',p_source));
  insert into public.draft_followup_events(draft_id,event_type,actor,metadata)
  values(d.id,'cancelled',coalesce(nullif(p_actor,''),'admin'),jsonb_build_object('reason_code',r.code,'reason_detail',p_reason_detail,'source',p_source));
  update public.admin_order_reviews set status='rejected',rejected_at=now(),completed_at=now(),updated_at=now() where draft_id=d.id;
  update public.qrpay_ai_jobs set status='needs_review',completed_at=null,locked_at=null,
    match_reason=concat_ws(',',nullif(match_reason,''),'admin_rejected_draft'),updated_at=now()
  where id=d.qrpay_job_id and order_id is null;
  return jsonb_build_object('success',true,'draft_id',d.id,'status','rejected','reason_code',r.code);
end;
$function$;

create or replace function public.icetak_admin_reopen_cancelled_draft(p_draft_id uuid,p_actor text default 'admin')
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare d public.qrpay_order_drafts%rowtype; cfg public.draft_followup_settings%rowtype;
begin
  select * into d from public.qrpay_order_drafts where id=p_draft_id for update;
  if not found then raise exception 'draft_not_found'; end if;
  if d.status<>'rejected' or d.order_id is not null then raise exception 'draft_not_reopenable'; end if;
  select * into cfg from public.draft_followup_settings where singleton=true;
  update public.qrpay_order_drafts set status=case when admin_approved_at is null then 'pending_admin' else 'ready_customer' end,
    rejected_at=null,rejected_by=null,cancel_reason_code=null,cancel_reason_detail=null,cancel_source=null,
    followup_enabled=admin_approved_at is not null and payment_mode='prepaid',followup_paused_at=null,
    next_followup_at=case when admin_approved_at is not null and payment_mode='prepaid' then now()+make_interval(hours=>cfg.first_delay_hours) end,
    updated_at=now() where id=d.id;
  insert into public.draft_followup_events(draft_id,event_type,actor) values(d.id,'reopened',coalesce(nullif(p_actor,''),'admin'));
  insert into public.qrpay_order_draft_events(draft_id,event_type,actor,metadata) values(d.id,'draft_reopened',coalesce(nullif(p_actor,''),'admin'),jsonb_build_object('previous_reason_code',d.cancel_reason_code));
  return jsonb_build_object('success',true,'draft_id',d.id,'status',case when d.admin_approved_at is null then 'pending_admin' else 'ready_customer' end);
end;
$function$;

create or replace function public.icetak_admin_set_draft_followup(
  p_draft_id uuid,p_action text,p_actor text default 'admin'
) returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare d public.qrpay_order_drafts%rowtype; cfg public.draft_followup_settings%rowtype; next_at timestamptz;
begin
  select * into d from public.qrpay_order_drafts where id=p_draft_id for update;
  if not found then raise exception 'draft_not_found'; end if;
  select * into cfg from public.draft_followup_settings where singleton=true;
  if p_action='pause' then
    update public.qrpay_order_drafts set followup_enabled=false,followup_paused_at=now(),next_followup_at=null,updated_at=now() where id=d.id;
  elsif p_action='resume' then
    next_at:=now()+make_interval(hours=>case when d.followup_count=0 then cfg.first_delay_hours when d.followup_count=1 then cfg.second_delay_hours else cfg.third_delay_hours end);
    update public.qrpay_order_drafts set followup_enabled=true,followup_paused_at=null,next_followup_at=next_at,updated_at=now() where id=d.id;
  elsif p_action='send_now' then
    update public.qrpay_order_drafts set followup_enabled=true,followup_paused_at=null,next_followup_at=now(),updated_at=now() where id=d.id;
  elsif p_action='responded' then
    update public.qrpay_order_drafts set customer_responded_at=now(),followup_enabled=false,followup_paused_at=now(),next_followup_at=null,updated_at=now() where id=d.id;
  else raise exception 'invalid_followup_action'; end if;
  insert into public.draft_followup_events(draft_id,event_type,actor) values(d.id,p_action,coalesce(nullif(p_actor,''),'admin'));
  return jsonb_build_object('success',true,'draft_id',d.id,'action',p_action);
end;
$function$;

create or replace function public.icetak_admin_draft_followup_settings(p_payload jsonb default null,p_actor text default 'admin')
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare cfg public.draft_followup_settings%rowtype;
begin
  if p_payload is not null then
    update public.draft_followup_settings set
      enabled=coalesce((p_payload->>'enabled')::boolean,enabled),
      auto_cancel_enabled=coalesce((p_payload->>'auto_cancel_enabled')::boolean,auto_cancel_enabled),
      max_followups=least(3,greatest(1,coalesce((p_payload->>'max_followups')::integer,max_followups))),
      first_delay_hours=least(720,greatest(1,coalesce((p_payload->>'first_delay_hours')::integer,first_delay_hours))),
      second_delay_hours=least(720,greatest(1,coalesce((p_payload->>'second_delay_hours')::integer,second_delay_hours))),
      third_delay_hours=least(720,greatest(1,coalesce((p_payload->>'third_delay_hours')::integer,third_delay_hours))),
      auto_cancel_delay_hours=least(720,greatest(1,coalesce((p_payload->>'auto_cancel_delay_hours')::integer,auto_cancel_delay_hours))),
      updated_at=now(),updated_by=p_actor where singleton=true;
  end if;
  select * into cfg from public.draft_followup_settings where singleton=true;
  return to_jsonb(cfg)||jsonb_build_object(
    'template_ready',not exists(select 1 from public.whatsapp_notification_rules r where r.event_type like 'draft_followup_%' and (nullif(r.template_name,'') is null or not exists(select 1 from public.whatsapp_templates t where t.name=r.template_name and t.language=r.template_language and upper(t.status)='APPROVED'))),
    'due_count',(select count(*) from public.qrpay_order_drafts d where d.next_followup_at<=now() and d.followup_enabled and d.status not in ('confirmed','rejected') and d.order_id is null)
  );
end;
$function$;

create or replace function public.icetak_schedule_due_draft_followups(p_limit integer default 50,p_force boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare cfg public.draft_followup_settings%rowtype; d public.qrpay_order_drafts%rowtype; n integer:=0; c integer:=0; qid uuid; event_name text; delay_hours integer; bsuid text; review_url text;
begin
  select * into cfg from public.draft_followup_settings where singleton=true;
  if not coalesce(cfg.enabled,false) and not p_force then return jsonb_build_object('enabled',false,'queued',0,'cancelled',0); end if;

  update public.notification_queue q set status='cancelled',processed_at=now(),locked_at=null,decision_reason='draft_no_longer_eligible',last_error='Draft paid, converted, paused or cancelled'
  where q.status in ('pending','processing') and q.event_type like 'draft_followup_%'
    and coalesce(q.payload->>'draft_id','') ~ '^[0-9a-fA-F-]{36}$' and exists(
    select 1 from public.qrpay_order_drafts x where x.id=(q.payload->>'draft_id')::uuid
      and (x.order_id is not null or x.status in ('confirmed','rejected') or x.payment_status in ('paid','matched','payment_received') or not x.followup_enabled));

  for d in select * from public.qrpay_order_drafts x
    where x.next_followup_at<=now() and x.followup_enabled and x.followup_paused_at is null
      and x.order_id is null and x.status not in ('confirmed','rejected')
      and x.payment_mode='prepaid' and x.payment_status not in ('paid','matched','payment_received')
      and x.customer_link_sent_at is not null and coalesce((x.working_draft->>'notify_whatsapp')::boolean,true)
    order by x.next_followup_at for update skip locked limit least(greatest(coalesce(p_limit,50),1),100)
  loop
    if d.followup_count>=cfg.max_followups then
      if cfg.auto_cancel_enabled and d.last_followup_at+make_interval(hours=>cfg.auto_cancel_delay_hours)<=now() then
        perform public.icetak_admin_cancel_draft(d.review_token,'no_response',null,'automation','automation'); c:=c+1;
      else update public.qrpay_order_drafts set next_followup_at=d.last_followup_at+make_interval(hours=>cfg.auto_cancel_delay_hours),updated_at=now() where id=d.id; end if;
      continue;
    end if;
    event_name:='draft_followup_'||(d.followup_count+1)::text;
    delay_hours:=case when d.followup_count+1=1 then cfg.second_delay_hours when d.followup_count+1=2 then cfg.third_delay_hours else cfg.auto_cancel_delay_hours end;
    bsuid:=coalesce(d.working_draft#>>'{whatsapp_identity,bsuid}',d.evidence#>>'{whatsapp_identity,bsuid}');
    review_url:='https://shop.decocake.my/order-review.html?token='||d.customer_review_token;
    insert into public.notification_queue(event_type,channel,phone,recipient_bsuid,recipient_username,payload,status,attempts,scheduled_at,created_at,idempotency_key)
    values(event_name,'whatsapp',nullif(public.icetak_normalize_phone(d.customer_phone),''),bsuid,
      coalesce(d.working_draft#>>'{whatsapp_identity,username}',d.evidence#>>'{whatsapp_identity,username}'),
      jsonb_build_object('event_type',event_name,'phone',nullif(public.icetak_normalize_phone(d.customer_phone),''),'recipient_bsuid',bsuid,'draft_id',d.id,
        'vars',jsonb_build_object('customer_name',coalesce(d.customer_name,'Customer'),'draft_total',to_char(d.draft_total,'FM999999990.00'),'review_link',review_url,'followup_number',d.followup_count+1),
        'source','draft_followup','idempotency_key','draft-followup:'||d.id::text||':'||(d.followup_count+1)::text),
      'pending',0,now(),now(),'draft-followup:'||d.id::text||':'||(d.followup_count+1)::text)
    on conflict(idempotency_key) do nothing returning id into qid;
    if qid is not null then
      update public.qrpay_order_drafts set followup_count=followup_count+1,last_followup_at=now(),next_followup_at=now()+make_interval(hours=>delay_hours),updated_at=now() where id=d.id;
      insert into public.draft_followup_events(draft_id,event_type,followup_number,notification_queue_id,actor)
      values(d.id,'queued',d.followup_count+1,qid,'automation'); n:=n+1;
    end if;
  end loop;
  return jsonb_build_object('enabled',true,'queued',n,'cancelled',c);
end;
$function$;

create or replace function public.finance_admin_draft_followups(p_filter text default null,p_query text default null,p_limit integer default 200)
returns jsonb language sql stable security definer set search_path to '' as $function$
with base as materialized (
  select d.*,q.status queue_status,q.last_error queue_error,q.decision_mode,q.provider_message_id
  from public.qrpay_order_drafts d
  left join lateral (select nq.* from public.notification_queue nq where nq.payload->>'draft_id'=d.id::text order by nq.created_at desc limit 1) q on true
  where d.order_id is null and d.customer_link_sent_at is not null and d.payment_mode='prepaid' and d.status not in ('confirmed','rejected')
    and d.payment_status not in ('paid','matched','payment_received')
    and (nullif(btrim(coalesce(p_query,'')),'') is null or coalesce(d.customer_name,'') ilike '%'||btrim(p_query)||'%' or coalesce(d.customer_phone,'') ilike '%'||regexp_replace(p_query,'[^0-9]','','g')||'%')
    and (coalesce(p_filter,'')='' or (p_filter='due' and d.next_followup_at<=now()) or (p_filter='paused' and not d.followup_enabled) or (p_filter='failed' and q.status='failed') or (p_filter='final' and d.followup_count>=2) or (p_filter='waiting' and d.followup_enabled and d.next_followup_at>now()))
  order by d.next_followup_at nulls last limit least(greatest(coalesce(p_limit,200),1),300)
)
select jsonb_build_object(
 'counts',jsonb_build_object('all',count(*),'due',count(*) filter(where next_followup_at<=now() and followup_enabled),'paused',count(*) filter(where not followup_enabled),'failed',count(*) filter(where queue_status='failed'),'final',count(*) filter(where followup_count>=2)),
 'drafts',coalesce(jsonb_agg(jsonb_build_object('id',id,'review_token',review_token,'status',status,'customer_name',customer_name,'customer_phone',customer_phone,'draft_total',draft_total,'date_need',working_draft->>'date_need','followup_enabled',followup_enabled,'followup_count',followup_count,'last_followup_at',last_followup_at,'next_followup_at',next_followup_at,'customer_link_sent_at',customer_link_sent_at,'customer_responded_at',customer_responded_at,'queue_status',queue_status,'queue_error',queue_error,'decision_mode',decision_mode,'provider_message_id',provider_message_id) order by next_followup_at nulls last),'[]'::jsonb)
) from base;
$function$;

create or replace function public.finance_admin_draft_orders(p_query text default null,p_status text default null,p_limit integer default 100)
returns jsonb language sql stable security definer set search_path to '' as $function$
with rows as materialized (
 select * from public.qrpay_order_drafts d where d.order_id is null
 and ((p_status='rejected' and d.status='rejected') or (coalesce(p_status,'')<>'rejected' and d.status not in ('confirmed','rejected') and (nullif(btrim(coalesce(p_status,'')),'') is null or d.status=p_status)))
 and (nullif(btrim(coalesce(p_query,'')),'') is null or d.id::text ilike '%'||btrim(p_query)||'%' or coalesce(d.customer_name,'') ilike '%'||btrim(p_query)||'%' or (regexp_replace(p_query,'[^0-9]','','g')<>'' and coalesce(d.customer_phone,'') ilike '%'||regexp_replace(p_query,'[^0-9]','','g')||'%') or coalesce(d.transaction_id,'') ilike '%'||btrim(p_query)||'%')
 order by coalesce(d.rejected_at,d.updated_at) desc limit least(greatest(coalesce(p_limit,100),1),300)
)
select jsonb_build_object('counts',jsonb_build_object(
 'all',(select count(*) from public.qrpay_order_drafts d where d.order_id is null and d.status not in ('confirmed','rejected')),
 'linked',(select count(*) from public.qrpay_order_drafts d where d.order_id is null and d.status not in ('confirmed','rejected') and d.transaction_id is not null),
 'unlinked',(select count(*) from public.qrpay_order_drafts d where d.order_id is null and d.status not in ('confirmed','rejected') and d.transaction_id is null),
 'cancelled',(select count(*) from public.qrpay_order_drafts d where d.order_id is null and d.status='rejected')),
 'reasons',(select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_order),'[]'::jsonb) from public.draft_cancel_reasons r where r.enabled),
 'drafts',coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'source_type',source_type,'customer_name',customer_name,'customer_phone',customer_phone,'customer_bsuid',coalesce(working_draft#>>'{whatsapp_identity,bsuid}',evidence#>>'{whatsapp_identity,bsuid}'),'customer_username',coalesce(working_draft#>>'{whatsapp_identity,username}',evidence#>>'{whatsapp_identity,username}'),'conversation_id',conversation_id,'draft_total',draft_total,'payment_status',payment_status,'payment_required',payment_required,'payment_mode',payment_mode,'transaction_id',transaction_id,'payment_amount',payment_amount,'review_token',review_token,'admin_approved_at',admin_approved_at,'customer_confirmed_at',customer_confirmed_at,'date_need',working_draft->>'date_need','delivery',working_draft->>'delivery','item_count',jsonb_array_length(coalesce(working_draft->'items','[]'::jsonb)),'created_at',created_at,'updated_at',updated_at,'rejected_at',rejected_at,'rejected_by',rejected_by,'cancel_reason_code',cancel_reason_code,'cancel_reason_detail',cancel_reason_detail,'cancel_source',cancel_source,'followup_count',followup_count,'payment_available',case when transaction_id is null then null else exists(select 1 from public.unmatched_payment_transactions u where u.transaction_id=rows.transaction_id) end) order by coalesce(rejected_at,updated_at) desc),'[]'::jsonb)) from rows;
$function$;

revoke all on function public.icetak_admin_cancel_draft(text,text,text,text,text),public.icetak_admin_reopen_cancelled_draft(uuid,text),public.icetak_admin_set_draft_followup(uuid,text,text),public.icetak_admin_draft_followup_settings(jsonb,text),public.icetak_schedule_due_draft_followups(integer,boolean),public.finance_admin_draft_followups(text,text,integer),public.finance_admin_draft_orders(text,text,integer) from public,anon,authenticated;
grant execute on function public.icetak_admin_cancel_draft(text,text,text,text,text),public.icetak_admin_reopen_cancelled_draft(uuid,text),public.icetak_admin_set_draft_followup(uuid,text,text),public.icetak_admin_draft_followup_settings(jsonb,text),public.icetak_schedule_due_draft_followups(integer,boolean),public.finance_admin_draft_followups(text,text,integer),public.finance_admin_draft_orders(text,text,integer) to service_role;

insert into public.private_runtime_settings(setting_key,setting_value,updated_at)
values('draft_followup_scheduler_token',replace(gen_random_uuid()::text,'-',''),now())
on conflict(setting_key) do nothing;

create or replace function public.icetak_invoke_draft_followup_scheduler()
returns bigint language plpgsql security definer set search_path to 'public','extensions','net' as $function$
declare token text; request_id bigint;
begin
  select setting_value into token from public.private_runtime_settings where setting_key='draft_followup_scheduler_token' limit 1;
  if nullif(token,'') is null then raise exception 'draft_followup_scheduler_token_missing'; end if;
  select net.http_post(
    url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/draft-followup-scheduler',
    headers:=jsonb_build_object('content-type','application/json'),
    body:=jsonb_build_object('token',token,'limit',50),timeout_milliseconds:=15000
  ) into request_id;
  return request_id;
end;
$function$;
revoke all on function public.icetak_invoke_draft_followup_scheduler() from public,anon,authenticated;
grant execute on function public.icetak_invoke_draft_followup_scheduler() to service_role;

do $block$
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    if exists(select 1 from cron.job where jobname='icetak-draft-followup-scheduler') then perform cron.unschedule('icetak-draft-followup-scheduler'); end if;
    perform cron.schedule('icetak-draft-followup-scheduler','*/15 * * * *','select public.icetak_invoke_draft_followup_scheduler();');
  end if;
end;
$block$;
