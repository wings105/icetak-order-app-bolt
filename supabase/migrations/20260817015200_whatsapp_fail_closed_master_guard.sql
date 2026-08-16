-- Final fail-closed guard for customer lifecycle WhatsApp automation.
-- Activation-neutral: this migration never turns customer lifecycle or pickup automation ON.

-- Ensure the canonical master switch row exists. Missing master state must mean OFF.
insert into public.whatsapp_settings(key,text_value,is_secret)
values ('enabled','false',false)
on conflict(key) do nothing;

-- Normalize only missing/blank master values to OFF. Explicit true/false is preserved.
update public.whatsapp_settings
set text_value='false', updated_at=now()
where key='enabled'
  and nullif(btrim(coalesce(text_value,'')),'') is null;

create or replace function public.icetak_whatsapp_master_setting_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
begin
  if tg_op='DELETE' then
    if old.key='enabled' then
      raise exception 'whatsapp master enabled setting cannot be deleted';
    end if;
    return old;
  end if;

  if new.key='enabled' then
    -- Fail closed: null/blank/unknown values become false; only explicit allow-list values become true.
    new.text_value := case
      when lower(btrim(coalesce(new.text_value,''))) in ('true','1','yes','enabled','on') then 'true'
      else 'false'
    end;
    new.secret_value := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists zz_icetak_whatsapp_master_setting_guard_write_trg on public.whatsapp_settings;
create trigger zz_icetak_whatsapp_master_setting_guard_write_trg
before insert or update on public.whatsapp_settings
for each row execute function public.icetak_whatsapp_master_setting_guard();

drop trigger if exists zz_icetak_whatsapp_master_setting_guard_delete_trg on public.whatsapp_settings;
create trigger zz_icetak_whatsapp_master_setting_guard_delete_trg
before delete on public.whatsapp_settings
for each row execute function public.icetak_whatsapp_master_setting_guard();

-- Override enqueue with fail-closed master-switch semantics.
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

  select text_value into enabled_global
  from public.whatsapp_settings where key='enabled' limit 1;
  if lower(coalesce(enabled_global,'false')) not in ('true','1','yes','enabled','on') then return null; end if;

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

revoke all on function public.icetak_whatsapp_master_setting_guard() from public;
comment on function public.icetak_whatsapp_master_setting_guard()
is 'Keeps the customer lifecycle WhatsApp master setting fail-closed; this function never enables automation by itself.';
