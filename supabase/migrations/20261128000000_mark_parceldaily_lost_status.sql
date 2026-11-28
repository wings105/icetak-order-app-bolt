-- Normalize ParcelDaily lost states and provide a permission-checked manual admin action.
CREATE OR REPLACE FUNCTION public.normalize_shipping_status(p_status text, p_group text DEFAULT NULL::text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  s text := lower(trim(coalesce(p_status,'')));
  g text := lower(trim(coalesce(p_group,'')));
BEGIN
  IF s = 'lost' OR s LIKE '% lost%' OR s LIKE 'lost %' OR g = 'lost' OR g LIKE '% lost%' OR g LIKE 'lost %'
  THEN RETURN 'lost'; END IF;

  -- Delivery attempt must be checked before the generic word "deliver".
  IF s LIKE '%out for delivery%'
     OR s LIKE '%on its way for delivery%'
     OR g LIKE '%on delivery%'
     OR g LIKE '%out for delivery%'
  THEN RETURN 'out_for_delivery'; END IF;

  IF s LIKE '%parcel has been received%'
     OR s = 'delivered'
     OR s LIKE '%successfully delivered%'
     OR g = 'delivered'
  THEN RETURN 'delivered'; END IF;

  IF s LIKE '%picked up%' OR g LIKE '%picked up%' THEN RETURN 'picked_up'; END IF;
  IF s LIKE '%transit%' OR s LIKE '%arrived hub%' OR s LIKE '%departed to hub%' OR g LIKE '%transit%' THEN RETURN 'in_transit'; END IF;
  IF s LIKE '%return%' OR g LIKE '%return%' THEN RETURN 'returning'; END IF;
  IF s LIKE '%cancel%' OR g LIKE '%cancel%' THEN RETURN 'cancelled'; END IF;
  IF s LIKE '%fail%' OR s LIKE '%exception%' OR g LIKE '%exception%' OR g LIKE '%failed%' THEN RETURN 'delivery_exception'; END IF;

  -- ParcelDaily CHECKOUT payload calls this "Shipment Data Received".
  IF s LIKE '%shipment data received%'
     OR s LIKE '%awb created%'
     OR s LIKE '%consignment created%'
     OR s LIKE '%connote created%'
  THEN RETURN 'awb_created'; END IF;

  IF s LIKE '%book%' OR s LIKE '%checkout%' OR s LIKE '%paid%' THEN RETURN 'awb_created'; END IF;
  IF s LIKE '%create%' OR s LIKE '%pending%' THEN RETURN 'shipment_created'; END IF;
  RETURN 'unknown';
END;
$function$;

CREATE OR REPLACE FUNCTION public.icetak_admin_mark_shipment_lost(p_shipment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  s public.shipments%rowtype;
  v_actor text;
  v_previous_status text;
  v_now timestamptz := now();
BEGIN
  IF NOT public.icetak_admin_can_manage_shipping_messages() THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;

  SELECT * INTO s FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHIPMENT_NOT_FOUND'; END IF;

  IF lower(coalesce(s.normalized_status, '')) = 'lost' THEN
    RETURN jsonb_build_object('ok', true, 'alreadyLost', true, 'shipmentId', s.id, 'trackingNo', s.tracking_no);
  END IF;

  v_previous_status := coalesce(nullif(s.status, ''), s.normalized_status, 'unknown');
  UPDATE public.shipments
  SET status = 'Lost',
      status_group = 'lost',
      normalized_status = 'lost',
      updated_at = v_now
  WHERE id = p_shipment_id;

  SELECT username INTO v_actor
  FROM public.admin_users
  WHERE auth_user_id = auth.uid() AND coalesce(is_active, true)
  LIMIT 1;

  INSERT INTO public.shipment_events (
    shipment_id, order_id, event_key, tracking_no, courier, status, status_group,
    previous_status, event_name, event_time, normalized_status, source,
    raw_payload
  ) VALUES (
    s.id, s.order_id, 'admin_mark_lost:' || s.id::text || ':' || extract(epoch FROM v_now)::text,
    s.tracking_no, s.courier, 'Lost', 'lost', v_previous_status, 'MARKED_LOST',
    v_now, 'lost', 'admin', jsonb_build_object('actor', v_actor, 'manual', true)
  );

  IF s.order_id IS NOT NULL THEN
    UPDATE public.orders
    SET shipment_status = 'Lost',
        shipment_status_group = 'lost',
        shipment_updated_at = v_now
    WHERE id = s.order_id;
  END IF;

  INSERT INTO public.admin_audit(order_db_id, order_id, action, actor, payload)
  SELECT s.order_id::text, coalesce(o.order_no, o.order_id, s.tracking_no),
         'mark_shipment_lost', v_actor,
         jsonb_build_object('shipment_id', s.id, 'tracking_no', s.tracking_no, 'previous_status', v_previous_status)
  FROM (SELECT 1) q
  LEFT JOIN public.orders o ON o.id = s.order_id;

  RETURN jsonb_build_object('ok', true, 'alreadyLost', false, 'shipmentId', s.id,
    'trackingNo', s.tracking_no, 'orderId', s.order_id, 'status', 'lost');
END;
$function$;

REVOKE ALL ON FUNCTION public.icetak_admin_mark_shipment_lost(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.icetak_admin_mark_shipment_lost(uuid) TO authenticated;

-- Reconcile shipments whose latest ParcelDaily status webhook already reported Lost.
WITH latest AS (
  SELECT DISTINCT ON (coalesce(payload->>'consign_no', payload->>'tracking_no', payload->>'connote'))
    coalesce(payload->>'consign_no', payload->>'tracking_no', payload->>'connote') AS tracking_no,
    lower(trim(coalesce(payload->>'status', payload->>'shipment_status', ''))) AS status
  FROM public.shipping_webhook_events
  WHERE provider = 'parceldaily'
    AND event_type = 'STATUS_UPDATED'
    AND coalesce(payload->>'consign_no', payload->>'tracking_no', payload->>'connote') IS NOT NULL
  ORDER BY coalesce(payload->>'consign_no', payload->>'tracking_no', payload->>'connote'), received_at DESC
),
lost AS (
  SELECT s.id, s.tracking_no
  FROM public.shipments s
  JOIN latest l ON l.tracking_no = s.tracking_no
  WHERE s.provider = 'parceldaily' AND l.status = 'lost'
)
UPDATE public.shipment_events e
SET status_group = 'lost', normalized_status = 'lost'
FROM lost l
WHERE e.shipment_id = l.id
  AND lower(coalesce(e.status, '')) = 'lost'
  AND (e.status_group IS DISTINCT FROM 'lost' OR e.normalized_status IS DISTINCT FROM 'lost');

WITH latest AS (
  SELECT DISTINCT ON (coalesce(payload->>'consign_no', payload->>'tracking_no', payload->>'connote'))
    coalesce(payload->>'consign_no', payload->>'tracking_no', payload->>'connote') AS tracking_no,
    lower(trim(coalesce(payload->>'status', payload->>'shipment_status', ''))) AS status
  FROM public.shipping_webhook_events
  WHERE provider = 'parceldaily'
    AND event_type = 'STATUS_UPDATED'
    AND coalesce(payload->>'consign_no', payload->>'tracking_no', payload->>'connote') IS NOT NULL
  ORDER BY coalesce(payload->>'consign_no', payload->>'tracking_no', payload->>'connote'), received_at DESC
)
UPDATE public.shipments s
SET status = 'Lost', status_group = 'lost', normalized_status = 'lost', updated_at = now()
FROM latest l
WHERE s.provider = 'parceldaily'
  AND s.tracking_no = l.tracking_no
  AND l.status = 'lost'
  AND (s.normalized_status IS DISTINCT FROM 'lost' OR s.status_group IS DISTINCT FROM 'lost' OR s.status IS DISTINCT FROM 'Lost');
