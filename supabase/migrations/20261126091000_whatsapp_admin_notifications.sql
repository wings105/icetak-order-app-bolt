begin;

create table public.admin_whatsapp_notifications (
  event_type text primary key,
  label text not null,
  cadence text not null,
  enabled boolean not null default true,
  message text,
  repeat_mode text check (repeat_mode in ('once','daily','weekly')),
  next_at timestamptz,
  updated_at timestamptz not null default now(),
  check (repeat_mode is null or (message is not null and (repeat_mode='once' or next_at is not null)))
);
create table public.admin_whatsapp_delivery_log (
  id bigint generated always as identity primary key,
  event_type text not null references public.admin_whatsapp_notifications(event_type),
  delivery_key text not null,
  phone text,
  status text not null check (status in ('sending','accepted','paused','window_closed','failed','uncertain')),
  detail text,
  provider_message_id text,
  created_at timestamptz not null default now()
);
create index admin_whatsapp_delivery_lookup on public.admin_whatsapp_delivery_log(event_type,delivery_key,id desc);
alter table public.admin_whatsapp_notifications enable row level security;
alter table public.admin_whatsapp_delivery_log enable row level security;
revoke all on public.admin_whatsapp_notifications,public.admin_whatsapp_delivery_log from public,anon,authenticated;
grant select on public.admin_whatsapp_notifications to service_role;

insert into public.admin_whatsapp_notifications(event_type,label,cadence) values
 ('admin_draft_review','Semakan draf order','Apabila draf sedia disemak'),
 ('manual_admin_draft_resend','Hantar semula semakan draf','Apabila diminta oleh admin'),
 ('admin_order_result','Order siap / semakan bayaran dipadankan','Apabila order atau task siap'),
 ('qrpay_unmatched_review','Semakan QRPay belum dipadankan','Apabila transaksi perlu disemak'),
 ('admin_qrpay_summary','Ringkasan QRPay','10 pagi dan 10 malam'),
 ('admin_payment_attention','Bayaran diterima, order belum terbina','Semakan setiap 5 minit'),
 ('admin_daily_business_report','Daily Business Report','Ikut jadual Daily Business Report'),
 ('finance_bill_reminder','Peringatan bil','Ikut tarikh bil'),
 ('admin_shipping_attention','Parcel tiada pergerakan','Semakan setiap 15 minit'),
 ('admin_pending_pickup','Ringkasan parcel Pending Pickup','Setiap hari sekitar 5 petang'),
 ('admin_postage_preparation','Persediaan kredit postage','Setiap hari, 8 pagi'),
 ('parceldaily_low_credit','Kredit ParcelDaily rendah','Semakan setiap 5 minit'),
 ('admin_stock_low_alert','Stok rendah atau negatif','Semakan setiap 5 minit'),
 ('admin_stock_reserve_review','Semakan reserve stok','Apabila reserve perlu disemak'),
 ('icetak_design_due_summary','Ringkasan design perlu dibuat','Jadual produksi sedia ada'),
 ('shopee_clickup_audit','Audit Shopee / ClickUp','Setiap 6 jam'),
 ('admin_ai_learning','Ringkasan AI Learning','Sabtu, 9 pagi'),
 ('admin_whatsapp_window_warning','Peringatan window WhatsApp 24 jam','6 jam, 2 jam dan 30 minit sebelum tamat'),
 ('admin_notification_test','Ujian free-form','Apabila ujian diminta');

create function public.icetak_admin_whatsapp_phone()
returns text language sql stable set search_path='' as $$
  select nullif(regexp_replace(text_value,'[^0-9]','','g'),'')
  from public.whatsapp_settings where key='admin_order_notify_phone'
$$;

create function public.icetak_admin_whatsapp_notification_control(p_action text, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_event text := p_data->>'event_type';
  v_phone text;
  v_next timestamptz;
  v_label text := btrim(coalesce(p_data->>'label',''));
  v_message text := btrim(coalesce(p_data->>'message',''));
  v_mode text := p_data->>'repeat_mode';
  v_enabled boolean := coalesce((p_data->>'enabled')::boolean,false);
begin
  if not public.icetak_admin_can_manage_whatsapp() then raise exception 'forbidden'; end if;
  case p_action
    when 'read' then null;
    when 'phone' then
      v_phone := regexp_replace(coalesce(p_data->>'phone',''),'[^0-9]','','g');
      if v_phone like '01%' then v_phone := '6' || v_phone; end if;
      if v_phone !~ '^601[0-9]{8,9}$' then raise exception 'Masukkan nombor WhatsApp Malaysia yang sah'; end if;
      insert into public.whatsapp_settings(provider,key,text_value,is_secret,created_at,updated_at)
      values ('icetak','admin_order_notify_phone',v_phone,false,now(),now())
      on conflict (key) do update set text_value=excluded.text_value,updated_at=now();
    when 'toggle' then
      update public.admin_whatsapp_notifications
      set enabled=v_enabled,updated_at=now()
      where event_type=v_event and event_type<>'admin_notification_test'
        and (not v_enabled or repeat_mode is distinct from 'once' or next_at>now());
      if not found then raise exception 'Untuk reminder sekali yang sudah lepas, pilih tarikh baharu'; end if;
    when 'save' then
      v_next := (p_data->>'next_at')::timestamptz;
      if v_label='' or char_length(v_label)>100 or v_message='' or char_length(v_message)>4000
        or v_mode is null or v_mode not in ('once','daily','weekly') or v_next is null or v_next<=now()
      then raise exception 'Isi nama, mesej dan waktu akan datang yang sah'; end if;
      if v_event is null then
        v_event := 'admin_custom_' || replace(gen_random_uuid()::text,'-','');
        insert into public.admin_whatsapp_notifications(event_type,label,cadence,message,repeat_mode,next_at,enabled)
        values(v_event,v_label,'Jadual sendiri',v_message,v_mode,v_next,v_enabled);
      else
        update public.admin_whatsapp_notifications
        set label=v_label,message=v_message,repeat_mode=v_mode,next_at=v_next,enabled=v_enabled,updated_at=now()
        where event_type=v_event and repeat_mode is not null;
        if not found then raise exception 'Reminder tidak dijumpai'; end if;
      end if;
    when 'test' then
      if public.icetak_admin_whatsapp_phone() is null then raise exception 'Simpan nombor admin dahulu'; end if;
      if v_message='' or char_length(v_message)>4000 then raise exception 'Isi mesej ujian'; end if;
      v_event := 'admin_notification_test';
      insert into public.notification_queue(event_type,channel,phone,payload,status,idempotency_key)
      values(v_event,'whatsapp',public.icetak_admin_whatsapp_phone(),
        jsonb_build_object('event_type',v_event,'text',v_message),'pending','admin-test:' || gen_random_uuid());
    else raise exception 'Unsupported action';
  end case;
  return jsonb_build_object(
    'phone',public.icetak_admin_whatsapp_phone(),
    'notifications',coalesce((
      select jsonb_agg(to_jsonb(n) || jsonb_build_object('source_enabled', r.enabled)
                       order by n.repeat_mode is not null,n.label)
      from public.admin_whatsapp_notifications n
      left join public.whatsapp_notification_rules r using(event_type)
      where n.event_type<>'admin_notification_test'
    ),'[]'::jsonb),
    'logs',coalesce((
      select jsonb_agg(to_jsonb(l) order by l.created_at desc)
      from (
        select q.created_at,q.event_type,q.phone,
          case when q.status='sending' and q.created_at<now()-interval '2 minutes' then 'uncertain'
               when q.status='accepted' and o.status in ('delivered','read','failed') then o.status
               else q.status end status,
          coalesce(q.detail,o.error_code),q.provider_message_id
        from public.admin_whatsapp_delivery_log q
        left join public.whatsapp_outbox o on o.idempotency_key=q.delivery_key
          and o.event_type=q.event_type and o.provider_message_id=q.provider_message_id
        union all
        select o.created_at,o.event_type,o.phone,o.status,coalesce(o.error_code,o.decision_reason),o.provider_message_id
        from public.whatsapp_outbox o
        join public.admin_whatsapp_notifications n using(event_type)
        where o.created_at>now()-interval '30 days' and not exists (
          select 1 from public.admin_whatsapp_delivery_log d
          where d.event_type=o.event_type and d.delivery_key=o.idempotency_key
        )
        order by created_at desc limit 100
      ) l
    ),'[]'::jsonb)
  );
end;
$$;

create function public.icetak_admin_whatsapp_delivery(
  p_event text, p_key text, p_action text default 'begin',
  p_id bigint default null, p_status text default null, p_detail text default null, p_provider_id text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_rule public.admin_whatsapp_notifications%rowtype;
  v_previous public.admin_whatsapp_delivery_log%rowtype;
  v_phone text;
  v_id bigint;
  v_status text;
  v_detail text;
begin
  if p_action='finish' then
    if p_status not in ('accepted','paused','window_closed','failed','uncertain') then raise exception 'Invalid delivery status'; end if;
    update public.admin_whatsapp_delivery_log
    set status=p_status, detail=left(p_detail,300), provider_message_id=p_provider_id
    where id=p_id and event_type=p_event and delivery_key=p_key and status='sending';
    if not found then raise exception 'Delivery claim missing'; end if;
    return '{}'::jsonb;
  end if;
  if p_action<>'begin' or nullif(p_key,'') is null or char_length(p_key)>300 then raise exception 'Invalid delivery key'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_event || ':' || p_key,0));
  select * into v_rule from public.admin_whatsapp_notifications where event_type=p_event;
  if not found then raise exception 'Unknown admin notification'; end if;
  select * into v_previous from public.admin_whatsapp_delivery_log
  where event_type=p_event and delivery_key=p_key order by id desc limit 1;
  if v_previous.status in ('accepted','sending','uncertain') then
    v_status := case when v_previous.status='sending' and v_previous.created_at<now()-interval '2 minutes'
                     then 'uncertain' else v_previous.status end;
    return jsonb_build_object('status',v_status,'phone',v_previous.phone,'provider_message_id',v_previous.provider_message_id);
  end if;
  select o.provider_message_id,o.phone into v_previous.provider_message_id,v_phone
  from public.whatsapp_outbox o where o.idempotency_key=p_key and o.event_type=p_event and o.status='sent' limit 1;
  if found then
    return jsonb_build_object('status','accepted','phone',v_phone,'provider_message_id',v_previous.provider_message_id);
  end if;
  v_phone := public.icetak_admin_whatsapp_phone();
  v_status := 'sending';
  if not coalesce((select lower(coalesce(text_value,value#>>'{}')) in ('true','on','1','yes','enabled')
                  from public.whatsapp_settings where key='enabled'),false) then
    v_status := 'paused'; v_detail := 'whatsapp_master_off';
  elsif v_rule.repeat_mode is not null and
        split_part(p_key,':',2) <> extract(epoch from v_rule.updated_at)::text then
    v_status := 'paused'; v_detail := 'admin_schedule_changed';
  elsif not v_rule.enabled or exists(select 1 from public.whatsapp_notification_rules
                                    where event_type=p_event and (enabled=false or freeform_enabled=false)) then
    v_status := 'paused'; v_detail := 'admin_notification_off';
  elsif v_phone is null or v_phone !~ '^601[0-9]{8,9}$' then
    v_status := 'failed'; v_detail := 'admin_phone_invalid';
  end if;
  if v_previous.status=v_status and v_previous.detail=v_detail then
    return jsonb_build_object('status',v_status,'detail',v_detail,'phone',v_phone);
  end if;
  insert into public.admin_whatsapp_delivery_log(event_type,delivery_key,phone,status,detail)
  values(p_event,p_key,v_phone,v_status,v_detail) returning id into v_id;
  return jsonb_build_object('id',v_id,'status',v_status,'detail',v_detail,'phone',v_phone);
end;
$$;

create function public.icetak_admin_whatsapp_reminder_tick(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path='' as $$
declare
  reminder public.admin_whatsapp_notifications%rowtype;
  v_phone text := public.icetak_admin_whatsapp_phone();
  v_count integer := 0;
  v_period interval;
begin
  for reminder in select * from public.admin_whatsapp_notifications
    where enabled and repeat_mode is not null and next_at<=p_now
    order by next_at for update skip locked limit 50
  loop
    if p_now-reminder.next_at < interval '15 minutes' then
      insert into public.notification_queue(event_type,channel,phone,payload,status,idempotency_key)
      values(reminder.event_type,'whatsapp',coalesce(v_phone,''),
        jsonb_build_object('event_type',reminder.event_type,'text',reminder.message),
        'pending',reminder.event_type || ':' || extract(epoch from reminder.updated_at)::text || ':' || extract(epoch from reminder.next_at)::text)
      on conflict (idempotency_key) do nothing;
      if found then v_count := v_count+1; end if;
    else
      insert into public.admin_whatsapp_delivery_log(event_type,delivery_key,phone,status,detail)
      values(reminder.event_type,reminder.event_type || ':' || extract(epoch from reminder.updated_at)::text || ':' || extract(epoch from reminder.next_at)::text,
        v_phone,'failed','schedule_missed');
    end if;
    if reminder.repeat_mode='once' then
      -- Keep the rule enabled until the already queued occurrence has been dispatched.
      update public.admin_whatsapp_notifications set next_at=null where event_type=reminder.event_type;
    else
      v_period := case reminder.repeat_mode when 'daily' then interval '24 hours' else interval '168 hours' end;
      update public.admin_whatsapp_notifications
      set next_at=reminder.next_at + v_period*(1+floor(extract(epoch from p_now-reminder.next_at)/extract(epoch from v_period)))
      where event_type=reminder.event_type;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.icetak_admin_whatsapp_phone() from public,anon,authenticated;
revoke all on function public.icetak_admin_whatsapp_notification_control(text,jsonb) from public,anon;
grant execute on function public.icetak_admin_whatsapp_notification_control(text,jsonb) to authenticated;
revoke all on function public.icetak_admin_whatsapp_delivery(text,text,text,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.icetak_admin_whatsapp_delivery(text,text,text,bigint,text,text,text) to service_role;
revoke all on function public.icetak_admin_whatsapp_reminder_tick(timestamptz) from public,anon,authenticated;
grant execute on function public.icetak_admin_whatsapp_reminder_tick(timestamptz) to service_role;

select cron.schedule('icetak-admin-whatsapp-reminders','* * * * *',
  'select public.icetak_admin_whatsapp_reminder_tick()');

commit;
