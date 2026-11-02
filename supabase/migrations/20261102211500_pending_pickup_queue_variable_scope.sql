-- Qualify the PL/pgSQL recipient variable in the retry UPDATE path.
create or replace function public.icetak_pending_pickup_enqueue(p_day date) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r shipping_ops.pending_pickup_digests; q public.notification_queue; snapshot jsonb;
 v_phone text; msg text; listing text; short_list text; queue_id uuid; count_items integer; idem text;
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
 select regexp_replace(coalesce(text_value,''),'[^0-9]','','g') into v_phone from public.whatsapp_settings where key='admin_order_notify_phone';
 if coalesce(v_phone,'') !~ '^601[0-9]{8,9}$' then raise exception 'ADMIN_PHONE_NOT_CONFIGURED';end if;
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
   payload=jsonb_build_object('event_type','admin_pending_pickup','phone',v_phone,'mode','auto','text',msg,'template_name','icetak_pending_pickup_digest_ms','template_language','ms','template_params',jsonb_build_array('date','count','parcels'),'vars',jsonb_build_object('date',to_char(p_day,'DD/MM/YYYY'),'count',count_items::text,'parcels',short_list),'idempotency_key',idem)
  where id=r.queue_id and status='failed' returning id into queue_id;
 else
  insert into public.notification_queue(event_type,channel,phone,payload,status,scheduled_at,idempotency_key)
  values('admin_pending_pickup','whatsapp',v_phone,jsonb_build_object('event_type','admin_pending_pickup','phone',v_phone,'mode','auto','text',msg,'template_name','icetak_pending_pickup_digest_ms','template_language','ms','template_params',jsonb_build_array('date','count','parcels'),'vars',jsonb_build_object('date',to_char(p_day,'DD/MM/YYYY'),'count',count_items::text,'parcels',short_list),'idempotency_key',idem),'pending',now(),idem)
  on conflict(idempotency_key) do nothing returning id into queue_id;
 end if;
 if queue_id is null then raise exception 'DIGEST_QUEUE_CONFLICT';end if;
 insert into shipping_ops.pending_pickup_digests(day,status,parcel_count,queue_id,snapshot) values(p_day,'queued',count_items,queue_id,snapshot)
 on conflict(day) do update set status='queued',parcel_count=excluded.parcel_count,queue_id=excluded.queue_id,snapshot=excluded.snapshot,checked_at=now(),last_error=null;
 return jsonb_build_object('status','queued','count',count_items,'queue_id',queue_id);
end $$;
