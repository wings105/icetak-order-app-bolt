-- Source-of-truth for the Admin V2 enterprise order drawer.

create or replace function public.icetak_admin_order_detail_v2(p_order_ref text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare order_uuid uuid; result_value jsonb;
begin
  if not exists(select 1 from public.admin_users where auth_user_id=auth.uid() and is_active=true) then raise exception 'Unauthorized'; end if;
  begin order_uuid:=nullif(p_order_ref,'')::uuid; exception when invalid_text_representation then order_uuid:=null; end;
  if order_uuid is null then
    select o.id into order_uuid from public.orders o
    where o.order_no=p_order_ref or o.order_id=p_order_ref or o.public_token=p_order_ref
    order by o.created_at desc limit 1;
  end if;
  if order_uuid is null then raise exception 'Order not found'; end if;

  select jsonb_build_object(
    'order',jsonb_build_object(
      'dbId',o.id,'id',coalesce(nullif(o.order_no,''),o.order_id,''),'orderToken',coalesce(o.public_token,''),
      'customerToken',coalesce(o.customer_token,c.public_token,''),'customerName',coalesce(c.name,o.delivery_name,''),
      'customerPhone',coalesce(c.phone,o.delivery_phone,''),'adminStatus',coalesce(o.admin_status,o.status,''),'status',coalesce(o.status,''),
      'dateNeed',o.date_need,'createdAt',o.created_at,'updatedAt',o.updated_at,'total',coalesce(o.total,0),'deliveryFee',coalesce(o.delivery_fee,0),
      'payment',case when lower(coalesce(o.payment_status,'')) in ('paid','matched','payment_received') or lower(coalesce(o.payment,''))='paid' then 'Paid' else coalesce(nullif(o.payment,''),nullif(o.payment_status,''),'Unpaid') end,
      'paymentMethod',coalesce(o.payment_method,''),'paidAt',coalesce(o.payment_verified_at,(select max(pt.paid_at) from public.payment_transactions pt where pt.order_id=o.id)),
      'paymentVerifiedBy',coalesce(o.payment_verified_by,''),'delivery',coalesce(o.delivery,o.delivery_method,''),
      'deliveryName',coalesce(o.delivery_name,''),'deliveryPhone',coalesce(o.delivery_phone,''),'deliveryAddress',coalesce(o.delivery_address,''),
      'deliveryCity',coalesce(o.delivery_city,''),'deliveryPostcode',coalesce(o.delivery_postcode,''),'deliveryState',coalesce(o.delivery_state,''),
      'courier',coalesce(o.courier,''),'tracking',coalesce(o.tracking,''),'trackingLink',coalesce(o.tracking_link,''),
      'shipmentStatus',coalesce(o.shipment_status,''),'shipmentStatusGroup',coalesce(o.shipment_status_group,''),'fulfillmentStage',coalesce(o.fulfillment_stage,''),
      'productionApproved',(coalesce(o.production_approved,false) or o.pickup_ready_at is not null or o.pickup_collected_at is not null or lower(coalesce(o.fulfillment_stage,'')) in ('ready_to_ship','ready_for_pickup','collected','completed')),
      'customerConfirmed',coalesce(o.customer_confirmed,false),'awaitingCustomerConfirmation',(o.customer_confirm_token is not null and not coalesce(o.customer_confirmed,false)),
      'customerConfirmedAt',o.customer_confirmed_at,'productionCompletedAt',o.production_completed_at,'pickupReadyAt',o.pickup_ready_at,
      'pickupCollectedAt',o.pickup_collected_at,'deliveredAt',o.delivered_at,'whatsappEnabled',coalesce(o.whatsapp_opt_in,false),
      'adminRemark',coalesce(o.admin_remark,''),'clickupOrderTaskId',coalesce(o.clickup_order_task_id,''),'clickupOrderUrl',coalesce(o.clickup_order_url,''),
      'isUnpaid',not (lower(case when lower(coalesce(o.payment_status,'')) in ('paid','matched','payment_received') or lower(coalesce(o.payment,''))='paid' then 'Paid' else coalesce(nullif(o.payment,''),nullif(o.payment_status,''),'Unpaid') end)='paid'),
      'isCash',((lower(coalesce(o.payment,'')) like '%cash%' or lower(coalesce(o.payment_method,'')) like '%cash%') and not (lower(coalesce(o.payment_status,'')) in ('paid','matched','payment_received') or lower(coalesce(o.payment,''))='paid')),
      'isCancelled',(lower(coalesce(o.admin_status,'')) like '%cancel%' or lower(coalesce(o.status,'')) like '%cancel%' or lower(coalesce(o.fulfillment_stage,''))='cancelled'),
      'isCompleted',(o.pickup_collected_at is not null or o.delivered_at is not null or lower(coalesce(o.fulfillment_stage,'')) in ('collected','delivered','completed') or lower(coalesce(o.status,'')) in ('completed','delivered')),
      'isProblem',(lower(coalesce(o.admin_status,'')) like '%action%required%' or lower(coalesce(o.shipment_status_group,'')) in ('delivery_failed','failed','exception','returned','return_to_sender'))
    ),
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,'k',coalesce(i.k,i.product_type,''),'title',coalesce(i.title,i.product_type,'Item'),'qty',coalesce(i.qty,1),
        'price',coalesce(i.price,0),'size',coalesce(i.size,''),'style',coalesce(i.style,''),'customText',coalesce(i.custom_text,i.wording,''),
        'workflow',coalesce(i.workflow,''),'reviewRequired',coalesce(i.review_required,false),'previewUrl',coalesce(i.design_preview_url,''),
        'components',coalesce((select jsonb_agg(jsonb_build_object(
          'id',pc.id,'label',coalesce(pc.label,''),'workflow',coalesce(pc.workflow,''),'customerLabel',coalesce(pc.customer_label,''),
          'reviewStatus',coalesce(pc.review_status,''),'previewUrl',coalesce(pc.preview_url,''),'progressPercent',coalesce(pc.progress_percent,0),
          'clickupTaskId',coalesce(pc.clickup_task_id,''),'clickupStatus',coalesce(pc.clickup_status,'')
        ) order by pc.created_at,pc.id) from public.production_components pc where pc.order_item_id=i.id),'[]'::jsonb)
      ) order by i.updated_at nulls last,i.id) from public.order_items i where i.order_id=o.id
    ),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(jsonb_build_object(
      'id',pt.id,'provider',pt.provider,'transactionId',pt.transaction_id,'amount',pt.amount,'paidAt',pt.paid_at,'senderName',pt.sender_name
    ) order by pt.paid_at desc nulls last,pt.created_at desc) from public.payment_transactions pt where pt.order_id=o.id),'[]'::jsonb),
    'notifications',coalesce((select jsonb_agg(jsonb_build_object(
      'id',n.id,'eventType',n.event_type,'status',n.status,'attempts',n.attempts,'at',coalesce(n.sent_at,n.processed_at,n.created_at),
      'error',coalesce(n.last_error,''),'mode',coalesce(n.decision_mode,'')
    ) order by coalesce(n.sent_at,n.processed_at,n.created_at) desc)
      from (select * from public.notification_queue nq where nq.order_id=o.id order by nq.created_at desc limit 30) n
    ),'[]'::jsonb),
    'timeline',coalesce((select jsonb_agg(jsonb_build_object(
      'type',t.event_type,'label',t.label,'at',t.event_at,'actor',t.actor,'detail',t.detail
    ) order by t.event_at desc nulls last) from (
      select 'order_created'::text event_type,'Order Created'::text label,o.created_at event_at,coalesce(o.created_by,'system')::text actor,jsonb_build_object('source',o.source) detail
      union all select 'customer_confirmed','Customer Confirmed',o.customer_confirmed_at,'customer','{}'::jsonb where o.customer_confirmed_at is not null
      union all select 'payment_received','Payment Received',coalesce(o.payment_verified_at,(select max(pt.paid_at) from public.payment_transactions pt where pt.order_id=o.id)),coalesce(o.payment_verified_by,'system'),jsonb_build_object('amount',o.total) where coalesce(o.payment_verified_at,(select max(pt.paid_at) from public.payment_transactions pt where pt.order_id=o.id)) is not null
      union all select 'production_completed','Production Completed',o.production_completed_at,'system','{}'::jsonb where o.production_completed_at is not null
      union all select 'ready_pickup','Ready for Pickup',o.pickup_ready_at,'system','{}'::jsonb where o.pickup_ready_at is not null
      union all select 'customer_collected','Customer Collected',o.pickup_collected_at,'system','{}'::jsonb where o.pickup_collected_at is not null
      union all select 'delivered','Delivered',o.delivered_at,'courier','{}'::jsonb where o.delivered_at is not null
      union all select coalesce(a.action,'admin_action'),initcap(replace(coalesce(a.action,'admin action'),'_',' ')),to_timestamp(a.created_at/1000.0),coalesce(a.actor,'admin'),coalesce(a.payload,'{}'::jsonb) from public.admin_audit a where a.order_db_id=o.id::text
    ) t),'[]'::jsonb)
  ) into result_value
  from public.orders o left join public.customers c on c.id=o.customer_id
  where o.id=order_uuid;
  return result_value;
end;$$;

revoke execute on function public.icetak_admin_order_detail_v2(text) from public,anon;
grant execute on function public.icetak_admin_order_detail_v2(text) to authenticated;
