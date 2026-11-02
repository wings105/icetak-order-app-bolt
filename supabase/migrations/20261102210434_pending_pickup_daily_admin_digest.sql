create schema if not exists shipping_ops;
revoke all on schema shipping_ops from public,anon,authenticated;
grant usage on schema shipping_ops to service_role;
create table shipping_ops.pending_pickup_digests (
 day date primary key,status text not null,parcel_count integer not null default 0,
 queue_id uuid references public.notification_queue(id),snapshot jsonb not null default '{}'::jsonb,
 checked_at timestamptz not null default now(),last_error text
);
alter table shipping_ops.pending_pickup_digests enable row level security;
grant all on shipping_ops.pending_pickup_digests to service_role;
create function public.icetak_pending_pickup_snapshot() returns jsonb language sql stable security invoker set search_path='' as $$
 with eligible as (
 select s.id,s.tracking_no,coalesce(o.order_no,s.reference,'—') order_no,
 upper(coalesce(public.icetak_tracking_courier(s.tracking_no,s.courier),s.courier,'Courier')) courier,
 coalesce(s.awb_pdf_generated_at,s.booked_at,s.created_at) awb_at
 from public.shipments s left join public.shipment_tracking_state st on st.shipment_id=s.id
 left join public.orders o on o.id=s.order_id
 where nullif(btrim(s.tracking_no),'') is not null
 and (s.booked_at is not null or nullif(s.connote_url,'') is not null or nullif(s.thermal_connote_url,'') is not null or nullif(s.awb_pdf_url,'') is not null)
 and s.cancelled_at is null and s.delivered_at is null and s.archived_at is null
 and st.first_scan_at is null and st.manual_cancelled_at is null and coalesce(st.send_status,'')<>'cancelled'
 and lower(concat_ws(' ',s.normalized_status,s.status,s.status_group)) !~ '(delivered|cancel|return|refund)'
 and (o.id is null or not public.icetak_order_is_cancelled(o.id))
 and not exists(select 1 from public.shipment_events e where e.shipment_id=s.id
 and public.icetak_is_first_physical_scan(e.normalized_status,e.status_group,e.status))
 ) select jsonb_build_object('count',count(*),'checked_at',now(),'items',coalesce(jsonb_agg(to_jsonb(eligible) order by awb_at,id),'[]'::jsonb)) from eligible;
$$;
create function public.icetak_pending_pickup_enqueue(p_day date) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r shipping_ops.pending_pickup_digests; q public.notification_queue; snapshot jsonb;
 phone text; msg text; listing text; short_list text; queue_id uuid; count_items integer; idem text;
begin
 if p_day is distinct from (now() at time zone 'Asia/Kuala_Lumpur')::date then raise exception 'CURRENT_MYT_DAY_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('icetak-pending-pickup:'||p_day::text,0));
 select * into r from shipping_ops.pending_pickup_digests where day=p_day;
 if r.status='empty' then return jsonb_build_object('status','empty','count',0);end if;
 if r.queue_id is not null then
  select * into q from public.notification_queue where id=r.queue_id;
  if q.status is distinct from 'failed' or coalesce(q.last_error,'') !~ '(template_not_approved|template_name_required)' then
   return jsonb_build_object('status',q.status,'count',r.parcel_count,'queue_id',q.id,'duplicate',true);
  end if;
 end if;
 if coalesce((select text_value from public.whatsapp_settings where key='enabled'),'false')<>'true'
 or not coalesce((select enabled from public.whatsapp_notification_rules where event_type='admin_pending_pickup'),false) then
  insert into shipping_ops.pending_pickup_digests(day,status,last_error) values(p_day,'paused','WhatsApp master or rule disabled')
  on conflict(day) do update set status='paused',checked_at=now(),last_error=excluded.last_error;
  return '{"status":"paused"}'::jsonb;
 end if;
 select regexp_replace(coalesce(text_value,''),'[^0-9]','','g') into phone from public.whatsapp_settings where key='admin_order_notify_phone';
 if coalesce(phone,'') !~ '^601[0-9]{8,9}$' then raise exception 'ADMIN_PHONE_NOT_CONFIGURED';end if;
 snapshot:=public.icetak_pending_pickup_snapshot();count_items:=(snapshot->>'count')::integer;
 if count_items=0 then
  if r.queue_id is not null then
   update public.notification_queue set status='cancelled',last_error='No pending pickups remain',processed_at=now() where id=r.queue_id and status='failed';
  end if;
  insert into shipping_ops.pending_pickup_digests(day,status,parcel_count,snapshot) values(p_day,'empty',0,snapshot)
  on conflict(day) do update set status='empty',parcel_count=0,snapshot=excluded.snapshot,checked_at=now(),last_error=null;
  return '{"status":"empty","count":0}'::jsonb;
 end if;
 select string_agg(n||'. '||(item->>'courier')||' · '||(item->>'tracking_no')||E'\nOrder: '||(item->>'order_no')||E'\nAWB: '||to_char((item->>'awb_at')::timestamptz at time zone 'Asia/Kuala_Lumpur','DD/MM/YYYY HH24:MI'),E'\n\n' order by n)
 into listing from jsonb_array_elements(snapshot->'items') with ordinality x(item,n) where n<=25;
 select string_agg(item->>'tracking_no',', ' order by n) into short_list
 from jsonb_array_elements(snapshot->'items') with ordinality x(item,n) where n<=15;
 if count_items>15 then short_list:=short_list||' dan '||(count_items-15)||' lagi';end if;
 msg:='📦 *PENDING PICKUP — AWB BELUM SCAN*'||E'\nSemakan MYT: '||to_char(now() at time zone 'Asia/Kuala_Lumpur','DD/MM/YYYY HH24:MI')||E'\nJumlah: '||count_items||E' parcel\n\n'||listing||
 case when count_items>25 then E'\n\nDan '||(count_items-25)||' parcel lagi.' else '' end||E'\n\nSemak parcel fizikal dan pastikan courier scan.\nhttps://shop.decocake.my/?admin=v2&view=shipping';
 idem:='admin_pending_pickup:'||p_day;
 if r.queue_id is not null then
  update public.notification_queue set status='pending',attempts=0,last_error=null,scheduled_at=now(),locked_at=null,
   payload=jsonb_build_object('event_type','admin_pending_pickup','phone',phone,'mode','auto','text',msg,'template_name','icetak_pending_pickup_digest_ms','template_language','ms','template_params',jsonb_build_array('date','count','parcels'),'vars',jsonb_build_object('date',to_char(p_day,'DD/MM/YYYY'),'count',count_items::text,'parcels',short_list),'idempotency_key',idem)
  where id=r.queue_id and status='failed' returning id into queue_id;
 else
  insert into public.notification_queue(event_type,channel,phone,payload,status,scheduled_at,idempotency_key)
  values('admin_pending_pickup','whatsapp',phone,jsonb_build_object('event_type','admin_pending_pickup','phone',phone,'mode','auto','text',msg,'template_name','icetak_pending_pickup_digest_ms','template_language','ms','template_params',jsonb_build_array('date','count','parcels'),'vars',jsonb_build_object('date',to_char(p_day,'DD/MM/YYYY'),'count',count_items::text,'parcels',short_list),'idempotency_key',idem),'pending',now(),idem)
  on conflict(idempotency_key) do nothing returning id into queue_id;
 end if;
 if queue_id is null then raise exception 'DIGEST_QUEUE_CONFLICT';end if;
 insert into shipping_ops.pending_pickup_digests(day,status,parcel_count,queue_id,snapshot) values(p_day,'queued',count_items,queue_id,snapshot)
 on conflict(day) do update set status='queued',parcel_count=excluded.parcel_count,queue_id=excluded.queue_id,snapshot=excluded.snapshot,checked_at=now(),last_error=null;
 return jsonb_build_object('status','queued','count',count_items,'queue_id',queue_id);
end $$;
create function public.icetak_pending_pickup_kick() returns bigint language plpgsql security invoker set search_path='' as $$
declare token text; request_id bigint;
begin
 if (now() at time zone 'Asia/Kuala_Lumpur')::time < '17:00'::time then return null;end if;
 select setting_value into token from public.private_runtime_settings where setting_key='qrpay_ai_worker_token';
 if coalesce(token,'')='' then raise exception 'MISSING_INTERNAL_TOKEN';end if;
 select net.http_post(url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/shipping-pickup-digest',headers:=jsonb_build_object('content-type','application/json','x-pickup-digest-token',token),body:='{}'::jsonb,timeout_milliseconds:=60000) into request_id;
 return request_id;
end $$;
revoke all on function public.icetak_pending_pickup_snapshot(),public.icetak_pending_pickup_enqueue(date),public.icetak_pending_pickup_kick() from public,anon,authenticated;
grant execute on function public.icetak_pending_pickup_snapshot(),public.icetak_pending_pickup_enqueue(date),public.icetak_pending_pickup_kick() to service_role;
insert into public.whatsapp_notification_rules(event_type,label,enabled,freeform_text,template_name,template_language,template_params,freeform_enabled,template_enabled,notes)
values('admin_pending_pickup','Pending Pickup — daily admin digest',true,'Parcel sudah ada AWB tetapi belum discan courier. Semak Shipping & Tracking.','icetak_pending_pickup_digest_ms','ms','["date","count","parcels"]'::jsonb,true,true,'Daily 17:00 Asia/Kuala_Lumpur; admin only; one queue per date; old unresolved AWBs included; cancelled and physically scanned excluded') on conflict(event_type) do nothing;
-- 09:00 UTC is 17:00 MYT; later slots recover a pending template safely without a second digest.
select cron.schedule('icetak-pending-pickup-5pm','*/15 9-15 * * *','select public.icetak_pending_pickup_kick()');
