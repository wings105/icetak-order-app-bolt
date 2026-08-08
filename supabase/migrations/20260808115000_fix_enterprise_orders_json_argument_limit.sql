create or replace function public.icetak_admin_order_row_json(p jsonb)
returns jsonb
language sql
immutable
set search_path to 'public','pg_temp'
as $$
select
  jsonb_build_object(
    'dbId',p->'db_id','id',p->'order_no','orderToken',p->'order_token','customerToken',p->'customer_token',
    'customerName',p->'customer_name','customerPhone',p->'customer_phone','adminStatus',p->'admin_status','status',p->'status',
    'dateNeed',p->'date_need','createdAt',p->'created_at','updatedAt',p->'updated_at','total',p->'total',
    'deliveryFee',p->'delivery_fee','payment',p->'payment','paymentMethod',p->'payment_method','paidAt',p->'paid_at',
    'paymentVerifiedBy',p->'payment_verified_by','delivery',p->'delivery','courier',p->'courier','tracking',p->'tracking',
    'trackingLink',p->'tracking_link','shipmentStatus',p->'shipment_status','shipmentStatusGroup',p->'shipment_status_group',
    'fulfillmentStage',p->'fulfillment_stage','productionApproved',p->'production_approved','customerConfirmed',p->'customer_confirmed',
    'awaitingCustomerConfirmation',p->'awaiting_customer_confirmation','productionCompletedAt',p->'production_completed_at',
    'pickupReadyAt',p->'pickup_ready_at','pickupCollectedAt',p->'pickup_collected_at','deliveredAt',p->'delivered_at'
  ) ||
  jsonb_build_object(
    'whatsappEnabled',p->'whatsapp_enabled','adminRemark',p->'admin_remark','clickupOrderTaskId',p->'clickup_order_task_id',
    'clickupOrderUrl',p->'clickup_order_url','componentsTotal',p->'components_total','componentsLinked',p->'components_linked',
    'reviewPending',p->'review_pending','progressPercent',p->'progress_percent','clickupSyncStatus',p->'clickup_sync_status',
    'itemsCount',p->'items_count','itemSummary',p->'item_summary','lastNotificationStatus',p->'last_notification_status',
    'lastNotificationEvent',p->'last_notification_event','lastNotificationAt',p->'last_notification_at',
    'lastNotificationError',p->'last_notification_error','isCancelled',p->'is_cancelled','isCompleted',p->'is_completed',
    'isUnpaid',p->'is_unpaid','isCash',p->'is_cash','isNew',p->'is_new','isProblem',p->'is_problem','urgencyRank',p->'urgency_rank'
  );
$$;

revoke all on function public.icetak_admin_order_row_json(jsonb) from public, anon, authenticated;
grant execute on function public.icetak_admin_order_row_json(jsonb) to service_role, postgres;

do $$
declare
  def text;
  start_pos integer;
  rel_end integer;
  end_pos integer;
  start_marker constant text := 'coalesce((select jsonb_agg(jsonb_build_object(';
  end_marker constant text := ')) from page_rows r),''[]''::jsonb)';
  replacement constant text := 'coalesce((select jsonb_agg(public.icetak_admin_order_row_json(to_jsonb(r))) from page_rows r),''[]''::jsonb)';
begin
  select pg_get_functiondef('public.icetak_admin_orders_enterprise(text,jsonb,text,text,integer,integer)'::regprocedure) into def;
  start_pos := strpos(def,start_marker);
  if start_pos = 0 then
    if strpos(def,'public.icetak_admin_order_row_json(to_jsonb(r))') > 0 then return; end if;
    raise exception 'enterprise row json start marker not found';
  end if;
  rel_end := strpos(substr(def,start_pos),end_marker);
  if rel_end = 0 then raise exception 'enterprise row json end marker not found'; end if;
  end_pos := start_pos + rel_end - 1 + length(end_marker);
  def := substr(def,1,start_pos-1) || replacement || substr(def,end_pos);
  execute def;
end $$;

revoke all on function public.icetak_admin_orders_enterprise(text,jsonb,text,text,integer,integer) from public, anon;
grant execute on function public.icetak_admin_orders_enterprise(text,jsonb,text,text,integer,integer) to authenticated, service_role, postgres;
