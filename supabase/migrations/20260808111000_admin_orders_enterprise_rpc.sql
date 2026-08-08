-- Source-of-truth for the Admin V2 server-side Orders Work Queue.

create or replace function public.icetak_admin_orders_enterprise(
  p_query text default '',
  p_filters jsonb default '{}'::jsonb,
  p_sort text default 'urgency',
  p_direction text default 'asc',
  p_page integer default 1,
  p_page_size integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  result_value jsonb;
  page_value integer:=greatest(1,coalesce(p_page,1));
  size_value integer:=least(100,greatest(10,coalesce(p_page_size,50)));
  query_value text:=lower(trim(coalesce(p_query,'')));
  view_value text:=lower(coalesce(p_filters->>'view','active'));
  sort_value text:=lower(coalesce(p_sort,'urgency'));
  dir_value text:=case when lower(coalesce(p_direction,'asc'))='desc' then 'desc' else 'asc' end;
begin
  if not exists(select 1 from public.admin_users where auth_user_id=auth.uid() and is_active=true) then
    raise exception 'Unauthorized';
  end if;

  with base as (
    select
      o.id db_id,
      coalesce(nullif(o.order_no,''),o.order_id,'') order_no,
      coalesce(o.public_token,'') order_token,
      coalesce(o.customer_token,c.public_token,'') customer_token,
      coalesce(c.name,o.delivery_name,'') customer_name,
      coalesce(c.phone,o.delivery_phone,'') customer_phone,
      coalesce(o.admin_status,o.status,'New Order') admin_status,
      coalesce(o.status,'') status,
      o.date_need,o.created_at,o.updated_at,
      coalesce(o.total,0) total,
      coalesce(o.delivery_fee,0) delivery_fee,
      case
        when lower(coalesce(o.payment_status,'')) in ('paid','matched','payment_received') or lower(coalesce(o.payment,''))='paid' then 'Paid'
        else coalesce(nullif(o.payment,''),nullif(o.payment_status,''),'Unpaid')
      end payment,
      coalesce(o.payment_method,'') payment_method,
      coalesce(o.payment_verified_at,pt.paid_at,ps.matched_at) paid_at,
      coalesce(o.payment_verified_by,'') payment_verified_by,
      coalesce(o.delivery,o.delivery_method,'') delivery,
      coalesce(o.courier,'') courier,
      coalesce(o.tracking,'') tracking,
      coalesce(o.tracking_link,'') tracking_link,
      coalesce(o.shipment_status,'') shipment_status,
      coalesce(o.shipment_status_group,'') shipment_status_group,
      coalesce(o.fulfillment_stage,'') fulfillment_stage,
      (coalesce(o.production_approved,false)
        or o.pickup_ready_at is not null
        or o.pickup_collected_at is not null
        or lower(coalesce(o.fulfillment_stage,'')) in ('ready_to_ship','ready_for_pickup','collected','completed')) production_approved,
      coalesce(o.customer_confirmed,false) customer_confirmed,
      (o.customer_confirm_token is not null and not coalesce(o.customer_confirmed,false)) awaiting_customer_confirmation,
      o.production_completed_at,o.pickup_ready_at,o.pickup_collected_at,o.delivered_at,
      coalesce(o.whatsapp_opt_in,false) whatsapp_enabled,
      coalesce(o.admin_remark,'') admin_remark,
      coalesce(o.clickup_order_task_id,'') clickup_order_task_id,
      coalesce(o.clickup_order_url,'') clickup_order_url,
      coalesce(comp.components_total,0) components_total,
      coalesce(comp.components_linked,0) components_linked,
      coalesce(comp.review_pending,0) review_pending,
      coalesce(comp.progress_percent,0) progress_percent,
      case
        when coalesce(comp.components_total,0)=0 then 'not_required'
        when coalesce(comp.components_linked,0)=coalesce(comp.components_total,0) then 'linked'
        when exists(select 1 from public.integration_outbox x where x.order_id=o.id and x.event_type='clickup.production.create' and x.status in ('retry','error')) then 'error'
        else 'queued'
      end clickup_sync_status,
      coalesce(items.items_count,0) items_count,
      coalesce(items.item_summary,'') item_summary,
      coalesce(lastn.status,'') last_notification_status,
      lastn.event_type last_notification_event,
      lastn.event_at last_notification_at,
      coalesce(lastn.error_text,'') last_notification_error
    from public.orders o
    left join public.customers c on c.id=o.customer_id
    left join lateral (select max(paid_at) paid_at from public.payment_transactions x where x.order_id=o.id) pt on true
    left join lateral (select max(matched_at) matched_at from public.payment_sessions x where x.order_id=o.id and x.status='matched') ps on true
    left join lateral (
      select count(*)::int components_total,
             count(*) filter(where pc.clickup_task_id is not null)::int components_linked,
             count(*) filter(where coalesce(pc.review_required,false) and lower(coalesce(pc.review_status,'')) not in ('approved','ok','accepted','not_required'))::int review_pending,
             round(coalesce(avg(coalesce(pc.progress_percent,0)),0))::int progress_percent
      from public.production_components pc where pc.order_id=o.id
    ) comp on true
    left join lateral (
      select count(*)::int items_count,
             left(string_agg(coalesce(i.qty,1)::text||'× '||coalesce(i.title,i.product_type,'Item'),', ' order by i.updated_at nulls last,i.id),180) item_summary
      from public.order_items i where i.order_id=o.id
    ) items on true
    left join lateral (
      select z.status,z.event_type,z.event_at,z.error_text
      from (
        select nq.status,nq.event_type,coalesce(nq.sent_at,nq.processed_at,nq.created_at) event_at,coalesce(nq.last_error,'') error_text
        from public.notification_queue nq where nq.order_id=o.id
        union all
        select no.status,no.event_type,to_timestamp(coalesce(nullif(no.sent_at,0),no.created_at)/1000.0),coalesce(no.error_message,'')
        from public.notification_outbox no
        where no.order_id=coalesce(nullif(o.order_no,''),o.order_id) or no.order_token=o.public_token
      ) z
      order by z.event_at desc nulls last limit 1
    ) lastn on true
  ), flags as (
    select b.*,
      (lower(b.admin_status) like '%cancel%' or lower(b.status) like '%cancel%' or lower(b.fulfillment_stage)='cancelled') is_cancelled,
      (b.pickup_collected_at is not null or b.delivered_at is not null or lower(b.fulfillment_stage) in ('collected','delivered','completed') or lower(b.status) in ('completed','delivered')) is_completed,
      lower(b.payment)<>'paid' is_unpaid,
      ((lower(b.payment) like '%cash%' or lower(b.payment_method) like '%cash%') and lower(b.payment)<>'paid') is_cash,
      (lower(b.admin_status) like '%new%' or lower(b.status) in ('new','new order')) is_new,
      (lower(b.admin_status) like '%action%required%' or b.clickup_sync_status='error' or lower(b.last_notification_status)='failed' or lower(b.shipment_status_group) in ('delivery_failed','failed','exception','returned','return_to_sender')) is_problem,
      case
        when b.date_need is null then 5
        when b.date_need<current_date then 0
        when b.date_need=current_date then 1
        when b.date_need=current_date+1 then 2
        when b.date_need<=current_date+7 then 3
        else 4
      end urgency_rank
    from base b
  ), common_filtered as (
    select * from flags f
    where
      (query_value='' or lower(concat_ws(' ',f.order_no,f.customer_name,f.customer_phone,f.admin_status,f.status,f.payment,f.tracking,f.item_summary)) like '%'||query_value||'%')
      and (nullif(p_filters->>'customerToken','') is null or f.customer_token=p_filters->>'customerToken')
      and (nullif(p_filters->>'createdFrom','') is null or f.created_at::date >= (p_filters->>'createdFrom')::date)
      and (nullif(p_filters->>'createdTo','') is null or f.created_at::date <= (p_filters->>'createdTo')::date)
      and (nullif(p_filters->>'needFrom','') is null or f.date_need >= (p_filters->>'needFrom')::date)
      and (nullif(p_filters->>'needTo','') is null or f.date_need <= (p_filters->>'needTo')::date)
      and (nullif(p_filters->>'paidFrom','') is null or f.paid_at::date >= (p_filters->>'paidFrom')::date)
      and (nullif(p_filters->>'paidTo','') is null or f.paid_at::date <= (p_filters->>'paidTo')::date)
      and (nullif(p_filters->>'amountMin','') is null or f.total >= (p_filters->>'amountMin')::numeric)
      and (nullif(p_filters->>'amountMax','') is null or f.total <= (p_filters->>'amountMax')::numeric)
      and (coalesce(p_filters->>'payment','')='' or case lower(p_filters->>'payment') when 'paid' then not f.is_unpaid when 'unpaid' then f.is_unpaid when 'cash' then f.is_cash else lower(f.payment)=lower(p_filters->>'payment') end)
      and (coalesce(p_filters->>'delivery','')='' or lower(f.delivery) like '%'||lower(p_filters->>'delivery')||'%')
      and (coalesce(p_filters->>'production','')='' or case lower(p_filters->>'production') when 'approved' then f.production_approved when 'waiting' then not f.production_approved else true end)
      and (coalesce(p_filters->>'clickup','')='' or case lower(p_filters->>'clickup') when 'linked' then f.clickup_sync_status='linked' when 'not_linked' then f.components_linked<f.components_total when 'error' then f.clickup_sync_status='error' when 'queued' then f.clickup_sync_status='queued' else true end)
      and (coalesce(p_filters->>'whatsapp','')='' or case lower(p_filters->>'whatsapp') when 'on' then f.whatsapp_enabled when 'off' then not f.whatsapp_enabled when 'failed' then lower(f.last_notification_status)='failed' else true end)
  ), view_filtered as (
    select * from common_filtered f
    where case view_value
      when 'active' then not f.is_completed and not f.is_cancelled
      when 'all' then true
      when 'today' then f.date_need=current_date and not f.is_completed and not f.is_cancelled
      when 'overdue' then f.date_need<current_date and not f.is_completed and not f.is_cancelled
      when 'tomorrow' then f.date_need=current_date+1 and not f.is_completed and not f.is_cancelled
      when 'to_pay' then f.is_unpaid and not f.is_cancelled and not f.is_completed
      when 'cash' then f.is_cash and not f.is_cancelled and not f.is_completed
      when 'design' then f.review_pending>0 and not f.is_cancelled and not f.is_completed
      when 'production' then not f.is_unpaid and f.production_approved and (lower(f.delivery) like '%pickup%' or f.tracking='') and f.pickup_ready_at is null and f.delivered_at is null and not f.is_cancelled and not f.is_completed
      when 'ready_pickup' then (f.pickup_ready_at is not null or lower(f.fulfillment_stage)='ready_for_pickup') and f.pickup_collected_at is null and not f.is_cancelled
      when 'shipping' then lower(f.delivery) not like '%pickup%' and f.tracking<>'' and lower(f.shipment_status_group) not in ('delivered','cancelled') and not f.is_cancelled and not f.is_completed
      when 'problem' then f.is_problem and not f.is_completed
      when 'completed' then f.is_completed or f.is_cancelled
      else true
    end
  ), ordered as (
    select * from view_filtered
    order by
      case when sort_value='urgency' and dir_value='asc' then urgency_rank end asc,
      case when sort_value='urgency' and dir_value='desc' then urgency_rank end desc,
      case when sort_value='date_need' and dir_value='asc' then date_need end asc nulls last,
      case when sort_value='date_need' and dir_value='desc' then date_need end desc nulls last,
      case when sort_value='created_at' and dir_value='asc' then created_at end asc,
      case when sort_value='created_at' and dir_value='desc' then created_at end desc,
      case when sort_value='paid_at' and dir_value='asc' then paid_at end asc nulls last,
      case when sort_value='paid_at' and dir_value='desc' then paid_at end desc nulls last,
      case when sort_value='total' and dir_value='asc' then total end asc,
      case when sort_value='total' and dir_value='desc' then total end desc,
      case when sort_value='customer' and dir_value='asc' then lower(customer_name) end asc,
      case when sort_value='customer' and dir_value='desc' then lower(customer_name) end desc,
      case when sort_value='updated_at' and dir_value='asc' then updated_at end asc,
      case when sort_value='updated_at' and dir_value='desc' then updated_at end desc,
      created_at desc,db_id
  ), page_rows as (
    select * from ordered offset ((page_value-1)*size_value) limit size_value
  ), summary as (
    select jsonb_build_object(
      'all',count(*),
      'active',count(*) filter(where not is_completed and not is_cancelled),
      'today',count(*) filter(where date_need=current_date and not is_completed and not is_cancelled),
      'overdue',count(*) filter(where date_need<current_date and not is_completed and not is_cancelled),
      'tomorrow',count(*) filter(where date_need=current_date+1 and not is_completed and not is_cancelled),
      'toPay',count(*) filter(where is_unpaid and not is_completed and not is_cancelled),
      'cash',count(*) filter(where is_cash and not is_completed and not is_cancelled),
      'design',count(*) filter(where review_pending>0 and not is_completed and not is_cancelled),
      'production',count(*) filter(where not is_unpaid and production_approved and (lower(delivery) like '%pickup%' or tracking='') and pickup_ready_at is null and delivered_at is null and not is_completed and not is_cancelled),
      'readyPickup',count(*) filter(where (pickup_ready_at is not null or lower(fulfillment_stage)='ready_for_pickup') and pickup_collected_at is null and not is_cancelled),
      'shipping',count(*) filter(where lower(delivery) not like '%pickup%' and tracking<>'' and lower(shipment_status_group) not in ('delivered','cancelled') and not is_completed and not is_cancelled),
      'problem',count(*) filter(where is_problem and not is_completed),
      'completed',count(*) filter(where is_completed or is_cancelled)
    ) value from common_filtered
  )
  select jsonb_build_object(
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'dbId',r.db_id,'id',r.order_no,'orderToken',r.order_token,'customerToken',r.customer_token,
      'customerName',r.customer_name,'customerPhone',r.customer_phone,'adminStatus',r.admin_status,'status',r.status,
      'dateNeed',r.date_need,'createdAt',r.created_at,'updatedAt',r.updated_at,'total',r.total,'deliveryFee',r.delivery_fee,
      'payment',r.payment,'paymentMethod',r.payment_method,'paidAt',r.paid_at,'paymentVerifiedBy',r.payment_verified_by,
      'delivery',r.delivery,'courier',r.courier,'tracking',r.tracking,'trackingLink',r.tracking_link,
      'shipmentStatus',r.shipment_status,'shipmentStatusGroup',r.shipment_status_group,'fulfillmentStage',r.fulfillment_stage,
      'productionApproved',r.production_approved,'customerConfirmed',r.customer_confirmed,'awaitingCustomerConfirmation',r.awaiting_customer_confirmation,
      'productionCompletedAt',r.production_completed_at,'pickupReadyAt',r.pickup_ready_at,'pickupCollectedAt',r.pickup_collected_at,'deliveredAt',r.delivered_at,
      'whatsappEnabled',r.whatsapp_enabled,'adminRemark',r.admin_remark,'clickupOrderTaskId',r.clickup_order_task_id,'clickupOrderUrl',r.clickup_order_url,
      'componentsTotal',r.components_total,'componentsLinked',r.components_linked,'reviewPending',r.review_pending,'progressPercent',r.progress_percent,
      'clickupSyncStatus',r.clickup_sync_status,'itemsCount',r.items_count,'itemSummary',r.item_summary,
      'lastNotificationStatus',r.last_notification_status,'lastNotificationEvent',r.last_notification_event,'lastNotificationAt',r.last_notification_at,'lastNotificationError',r.last_notification_error,
      'isCancelled',r.is_cancelled,'isCompleted',r.is_completed,'isUnpaid',r.is_unpaid,'isCash',r.is_cash,'isNew',r.is_new,'isProblem',r.is_problem,'urgencyRank',r.urgency_rank
    )) from page_rows r),'[]'::jsonb),
    'summary',(select value from summary),
    'pagination',jsonb_build_object(
      'page',page_value,'pageSize',size_value,'total',(select count(*) from view_filtered),
      'totalPages',greatest(1,ceil((select count(*) from view_filtered)::numeric/size_value)::int)
    ),
    'serverTime',now()
  ) into result_value;
  return result_value;
end;$$;

revoke execute on function public.icetak_admin_orders_enterprise(text,jsonb,text,text,integer,integer) from public,anon;
grant execute on function public.icetak_admin_orders_enterprise(text,jsonb,text,text,integer,integer) to authenticated;
