begin;

alter table public.orders
  add column if not exists pickup_payment_whatsapp_enabled boolean not null default true;

comment on column public.orders.pickup_payment_whatsapp_enabled is
  'Pickup Counter only: controls whether payment_received WhatsApp is sent for this order. Does not change lifecycle whatsapp_opt_in.';

create or replace function public.icetak_pickup_overview_for_master(p_master_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_master uuid;
  v_result jsonb;
begin
  select coalesce(m.merged_into_id,m.id) into v_master
  from public.customer_master m where m.id=p_master_id;
  if v_master is null then raise exception 'customer_not_found'; end if;

  select jsonb_build_object(
    'ok',true,
    'customer',jsonb_build_object(
      'id',m.id,
      'name',coalesce(nullif(m.display_name,''),'Customer'),
      'phone',m.primary_phone_normalized
    ),
    'orders',coalesce((
      select jsonb_agg(order_row.data order by
        case order_row.data->>'group'
          when 'ready_unpaid' then 1 when 'ready_paid' then 2
          when 'processing_unpaid' then 3 when 'processing_paid' then 4 else 5 end,
        order_row.data->>'createdAt' desc)
      from (
        select jsonb_build_object(
          'id',o.id,
          'orderNo',coalesce(o.order_no,o.order_id),
          'orderToken',o.public_token,
          'total',round(coalesce(o.total,0),2),
          'balance',case when paid.is_paid then 0 else round(coalesce(o.total,0),2) end,
          'paid',paid.is_paid,
          'ready',public.icetak_pickup_is_ready(o.id),
          'collected',o.pickup_collected_at is not null
            or lower(coalesce(o.fulfillment_stage,''))='collected',
          'group',case
            when o.pickup_collected_at is not null
              or lower(coalesce(o.fulfillment_stage,''))='collected' then 'collected'
            when public.icetak_pickup_is_ready(o.id) and paid.is_paid then 'ready_paid'
            when public.icetak_pickup_is_ready(o.id) then 'ready_unpaid'
            when paid.is_paid then 'processing_paid'
            else 'processing_unpaid'
          end,
          'status',coalesce(o.admin_status,o.status,'Processing'),
          'dateNeed',o.date_need,
          'createdAt',o.created_at,
          'paymentMethod',o.payment_method,
          'paymentWhatsappEnabled',coalesce(o.pickup_payment_whatsapp_enabled,true),
          'items',coalesce((
            select jsonb_agg(jsonb_build_object(
              'id',i.id,'title',coalesce(i.title,i.product_type,'Item'),
              'kind',coalesce(i.k,i.product_type),
              'qty',coalesce(i.qty,1),'price',coalesce(i.price,0),
              'size',i.size,'style',i.style,
              'wording',coalesce(i.custom_text,i.wording),
              'previewUrl',i.design_preview_url
            ) order by coalesce(i.sort_index,0),i.updated_at nulls last,i.id)
            from public.order_items i where i.order_id=o.id
          ),'[]'::jsonb)
        ) data
        from public.orders o
        join public.customers c on c.id=o.customer_id
        cross join lateral (
          select lower(coalesce(o.payment_status,'')) in ('paid','matched','payment_received')
              or lower(coalesce(o.payment,''))='paid' as is_paid
        ) paid
        where coalesce((select coalesce(cm.merged_into_id,cm.id)
                        from public.customer_master cm where cm.id=c.customer_master_id),c.customer_master_id)=v_master
          and (
            lower(coalesce(o.delivery_method,'')) like '%pickup%'
            or lower(coalesce(o.delivery,'')) like '%pickup%'
            or o.pickup_ready_at is not null
            or o.pickup_collected_at is not null
          )
          and lower(coalesce(o.status,'')) not in ('cancelled','canceled')
      ) order_row
    ),'[]'::jsonb),
    'generatedAt',now()
  ) into v_result
  from public.customer_master m where m.id=v_master;
  return v_result;
end;
$function$;

create or replace function public.icetak_admin_set_pickup_payment_whatsapp(
  p_order_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor text;
  v_order public.orders%rowtype;
begin
  if not public.icetak_admin_has_permission('verify_payments') then
    raise exception 'Forbidden: verify_payments';
  end if;

  select u.username into v_actor
  from public.admin_users u
  where u.auth_user_id=auth.uid() and u.is_active
  limit 1;

  select * into v_order
  from public.orders
  where id=p_order_id
  for update;

  if not found then raise exception 'order_not_found'; end if;
  if lower(coalesce(v_order.payment_status,'')) in ('paid','matched','payment_received')
     or lower(coalesce(v_order.payment,''))='paid' then
    raise exception 'payment_already_received';
  end if;
  if v_order.pickup_collected_at is not null then
    raise exception 'order_already_collected';
  end if;
  if not (
    lower(coalesce(v_order.delivery_method,'')) like '%pickup%'
    or lower(coalesce(v_order.delivery,'')) like '%pickup%'
    or v_order.pickup_ready_at is not null
  ) then
    raise exception 'not_pickup_order';
  end if;

  update public.orders
  set pickup_payment_whatsapp_enabled=coalesce(p_enabled,true),
      updated_at=now()
  where id=p_order_id;

  insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
  values(
    p_order_id::text,
    coalesce(v_order.order_no,v_order.order_id),
    'pickup_payment_whatsapp_toggle',
    coalesce(nullif(v_actor,''),'admin'),
    jsonb_build_object('enabled',coalesce(p_enabled,true))
  );

  return jsonb_build_object(
    'ok',true,
    'orderId',p_order_id,
    'enabled',coalesce(p_enabled,true)
  );
end;
$function$;

revoke all on function public.icetak_admin_set_pickup_payment_whatsapp(uuid,boolean) from public,anon;
grant execute on function public.icetak_admin_set_pickup_payment_whatsapp(uuid,boolean) to authenticated,service_role;

create or replace function public.icetak_pickup_bundle_paid_notification()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_first_order uuid;
  v_order_ids text;
  v_count integer;
  v_notify_total numeric;
  v_extra jsonb;
  v_queue_id uuid;
begin
  if old.status='paid' or new.status<>'paid' then return new; end if;

  select count(*)::integer,
         string_agg(coalesce(o.order_no,o.order_id),', ' order by o.order_no,o.order_id),
         round(coalesce(sum(po.amount),0),2),
         (array_agg(
           o.id
           order by case when o.whatsapp_opt_in then 0 else 1 end,o.order_no,o.order_id
         ))[1]
  into v_count,v_order_ids,v_notify_total,v_first_order
  from public.pickup_checkout_orders po
  join public.orders o on o.id=po.order_id
  where po.checkout_id=new.id
    and coalesce(o.pickup_payment_whatsapp_enabled,true)=true;

  if coalesce(v_count,0)=0 or v_first_order is null then
    update public.pickup_checkouts
    set metadata=coalesce(metadata,'{}'::jsonb)
      || jsonb_build_object(
        'payment_whatsapp_suppressed',true,
        'payment_whatsapp_suppressed_at',now()
      )
    where id=new.id;
    return new;
  end if;

  v_extra:=jsonb_build_object(
    'order_id',v_order_ids,
    'order_total','RM'||to_char(v_notify_total,'FM999999990.00'),
    'pickup_order_count',v_count,
    'pickup_checkout_no',new.checkout_no,
    'payment_method',case when new.payment_method='cash' then 'cash' else 'QRPay' end
  );

  v_queue_id:=public.icetak_enqueue_whatsapp_event(
    'payment_received',v_first_order,'{}'::jsonb,
    'pickup_bundle:'||new.id::text,now()
  );

  if v_queue_id is not null then
    update public.notification_queue
    set payload=coalesce(payload,'{}'::jsonb)
      ||jsonb_build_object('vars',coalesce(payload->'vars','{}'::jsonb)||v_extra)
    where id=v_queue_id;
  end if;

  return new;
end;
$function$;

commit;
