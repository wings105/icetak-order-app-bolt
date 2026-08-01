create or replace function public.icetak_admin_order_sync_status(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_temp'
as $$
begin
  if not public.icetak_admin_has_permission('view_orders') then raise exception 'Forbidden'; end if;
  return jsonb_build_object(
    'order_id',p_order_id,
    'links',public.icetak_order_links(p_order_id),
    'clickup',jsonb_build_object(
      'components_total',(select count(*) from public.production_components where order_id=p_order_id),
      'components_linked',(select count(*) from public.production_components where order_id=p_order_id and clickup_task_id is not null),
      'outbox_status',(select status from public.integration_outbox where order_id=p_order_id and event_type='clickup.production.create' order by created_at desc limit 1),
      'outbox_error',(select coalesce(last_error,error) from public.integration_outbox where order_id=p_order_id and event_type='clickup.production.create' order by created_at desc limit 1)
    ),
    'shipment',coalesce((select jsonb_build_object(
      'id',s.id,'reference',s.reference,'courier',s.courier,'tracking_no',s.tracking_no,
      'tracking_link',s.tracking_link,'status',s.status,'normalized_status',s.normalized_status,
      'awb_pdf_url',coalesce(s.awb_pdf_url,s.connote_url),'updated_at',s.updated_at
    ) from public.shipments s where s.order_id=p_order_id order by s.created_at desc limit 1),'null'::jsonb)
  );
end;
$$;

create or replace function public.enqueue_clickup_shipping_update(p_shipment_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  s public.shipments%rowtype;
  o public.orders%rowtype;
  v_tasks jsonb;
  v_hash text;
  v_id uuid;
begin
  select * into s from public.shipments where id=p_shipment_id;
  if s.id is null or s.order_id is null then return null; end if;
  select * into o from public.orders where id=s.order_id;
  if o.id is null then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'clickup_task_id',x.clickup_task_id,'component_id',x.component_id,'component_label',x.component_label,
    'awb_primary',x.rn=1,'system_link',public.icetak_public_app_base_url() || '/?admin=1&order=' || o.public_token || '&component=' || x.component_id::text
  ) order by x.rn),'[]'::jsonb)
  into v_tasks
  from (
    select ct.clickup_task_id,ct.component_id,pc.label component_label,
      row_number() over(order by pc.created_at nulls last,ct.created_at,ct.id) rn
    from public.clickup_tasks ct
    left join public.production_components pc on pc.id=ct.component_id
    where ct.order_id=o.id and nullif(ct.clickup_task_id,'') is not null
  ) x;
  if jsonb_array_length(v_tasks)=0 then return null; end if;

  v_hash:=md5(concat_ws('|',coalesce(s.tracking_no,''),coalesce(s.courier,''),coalesce(s.status,''),
    coalesce(s.normalized_status,''),coalesce(s.awb_pdf_url,s.connote_url,''),coalesce(s.tracking_link,''),coalesce(s.updated_at::text,'')));
  insert into public.integration_outbox(provider,event_type,order_id,order_token,payload,status,next_attempt_at,source,channel,idempotency_key)
  values('activepieces','clickup.shipping.update',o.id,o.public_token,jsonb_build_object(
    'order',jsonb_build_object('id',o.id,'order_no',coalesce(o.order_no,o.order_id),'public_token',o.public_token,
      'customer_order_link',public.icetak_public_app_base_url() || '/?order=' || o.public_token),
    'shipment',jsonb_build_object('id',s.id,'reference',s.reference,'courier',coalesce(s.courier,s.service_provider),
      'tracking_no',s.tracking_no,'tracking_link',s.tracking_link,'status',s.status,'status_group',s.status_group,
      'normalized_status',s.normalized_status,'awb_pdf_url',coalesce(s.awb_pdf_url,s.connote_url),'thermal_connote_url',s.thermal_connote_url,
      'booked_at',s.booked_at,'shipped_at',s.shipped_at,'delivered_at',s.delivered_at,'updated_at',s.updated_at),
    'tasks',v_tasks
  ),'pending',now(),'supabase','clickup','clickup:shipping:update:'||s.id::text||':'||v_hash)
  on conflict(idempotency_key) where idempotency_key is not null do update set
    payload=excluded.payload,status=case when public.integration_outbox.status='processed' then 'processed' else 'pending' end,
    next_attempt_at=case when public.integration_outbox.status='processed' then public.integration_outbox.next_attempt_at else now() end,
    last_error=null,error=null
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.shipments_enqueue_clickup_update()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
begin
  if new.order_id is not null and (
    tg_op='INSERT' or new.tracking_no is distinct from old.tracking_no or new.courier is distinct from old.courier
    or new.status is distinct from old.status or new.status_group is distinct from old.status_group
    or new.normalized_status is distinct from old.normalized_status or new.awb_pdf_url is distinct from old.awb_pdf_url
    or new.connote_url is distinct from old.connote_url or new.tracking_link is distinct from old.tracking_link
  ) then perform public.enqueue_clickup_shipping_update(new.id); end if;
  return new;
end;
$$;
drop trigger if exists trg_shipments_enqueue_clickup_update on public.shipments;
create trigger trg_shipments_enqueue_clickup_update
after insert or update on public.shipments
for each row execute function public.shipments_enqueue_clickup_update();

create or replace function public.clickup_tasks_enqueue_existing_shipping()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare v_shipment_id uuid;
begin
  if new.order_id is not null and nullif(new.clickup_task_id,'') is not null then
    select id into v_shipment_id from public.shipments where order_id=new.order_id order by created_at desc limit 1;
    if v_shipment_id is not null then perform public.enqueue_clickup_shipping_update(v_shipment_id); end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_clickup_tasks_enqueue_existing_shipping on public.clickup_tasks;
create trigger trg_clickup_tasks_enqueue_existing_shipping
after insert or update of clickup_task_id on public.clickup_tasks
for each row execute function public.clickup_tasks_enqueue_existing_shipping();

create or replace function public.claim_clickup_shipping_outbox(p_limit integer default 10)
returns setof public.integration_outbox
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
begin
  return query
  with picked as (
    select id from public.integration_outbox
    where provider='activepieces' and event_type='clickup.shipping.update'
      and status in ('pending','retry') and coalesce(next_attempt_at,now())<=now()
    order by created_at limit greatest(1,least(coalesce(p_limit,10),50))
    for update skip locked
  )
  update public.integration_outbox o set status='processing',locked_at=now(),attempts=coalesce(attempts,0)+1
  from picked where o.id=picked.id returning o.*;
end;
$$;
