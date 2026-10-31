CREATE OR REPLACE FUNCTION public.claim_marketplace_identity_sync(p_limit integer DEFAULT 50, p_order_sn text DEFAULT NULL)
RETURNS TABLE(id uuid, order_sn text, shop_id text, lease_id text)
LANGUAGE sql SET search_path = '' AS $fn$
WITH candidates AS (
 SELECT o.id FROM public.marketplace_orders o
 WHERE o.provider='shopee' AND o.order_sn ~ '^[0-9]{6}[A-Z0-9]{6,12}$' AND o.shop_id IN ('188218638','1635364464')
 AND (nullif(o.buyer_user_id,'') IS NULL OR nullif(o.buyer_username,'') IS NULL)
 AND (p_order_sn IS NULL OR o.order_sn=p_order_sn)
 AND (p_order_sn IS NOT NULL OR o.current_status IN ('READY_TO_SHIP','PROCESSED') OR o.created_at>now()-interval '30 days')
 AND (p_order_sn IS NOT NULL OR coalesce(o.metadata#>>'{identity_sync,next_at}','')='' OR (o.metadata#>>'{identity_sync,next_at}')::timestamptz<=now())
 AND (coalesce(o.metadata#>>'{identity_sync,lease_until}','')='' OR (o.metadata#>>'{identity_sync,lease_until}')::timestamptz<=now())
 ORDER BY CASE WHEN o.current_status IN ('READY_TO_SHIP','PROCESSED') THEN 0 ELSE 1 END, o.created_at DESC
 LIMIT greatest(1,least(coalesce(p_limit,50),50)) FOR UPDATE SKIP LOCKED
), claimed AS (
 UPDATE public.marketplace_orders o SET metadata=coalesce(o.metadata,'{}'::jsonb)||jsonb_build_object('identity_sync',
  coalesce(o.metadata->'identity_sync','{}'::jsonb)||jsonb_build_object(
   'lease_id',gen_random_uuid()::text,'lease_until',now()+interval '5 minutes',
   'attempts',coalesce((o.metadata#>>'{identity_sync,attempts}')::integer,0)+1,'started_at',now()
  )),updated_at=now()
 FROM candidates c WHERE o.id=c.id RETURNING o.*
)
SELECT c.id,c.order_sn,c.shop_id,c.metadata#>>'{identity_sync,lease_id}' FROM claimed c;
$fn$;
REVOKE ALL ON FUNCTION public.claim_marketplace_identity_sync(integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_marketplace_identity_sync(integer,text) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_marketplace_identity_sync(
 p_order_id uuid,p_lease_id text,p_buyer_id text,p_username text,p_error text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SET search_path = '' AS $fn$
DECLARE o public.marketplace_orders%rowtype; uid text:=nullif(btrim(p_buyer_id),''); uname text:=nullif(btrim(p_username),''); err text:=p_error; changed boolean:=false;
BEGIN
 SELECT * INTO o FROM public.marketplace_orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND OR o.metadata#>>'{identity_sync,lease_id}' IS DISTINCT FROM p_lease_id THEN RETURN jsonb_build_object('updated',false,'stale_lease',true); END IF;
 IF err IS NULL AND (uid IS NULL OR uid !~ '^[1-9][0-9]{0,15}$' OR uname IS NULL OR length(uname)>100 OR uname ~ '[[:cntrl:]]') THEN err:='BUYER_IDENTITY_NOT_RETURNED'; END IF;
 IF err IS NULL AND nullif(o.buyer_user_id,'') IS NOT NULL AND o.buyer_user_id<>uid THEN err:='BUYER_IDENTITY_CONFLICT'; END IF;
 changed:=err IS NULL;
 UPDATE public.marketplace_orders SET
  buyer_user_id=CASE WHEN changed THEN uid ELSE buyer_user_id END,
  buyer_username=CASE WHEN changed THEN uname ELSE buyer_username END,
  raw_detail=CASE WHEN changed THEN coalesce(raw_detail,'{}'::jsonb)||jsonb_build_object('identity_read',jsonb_build_object('source','shopee_get_order_detail','buyer_user_id',uid,'buyer_username',uname,'shop_id',o.shop_id,'checked_at',now())) ELSE raw_detail END,
  metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('identity_sync',
   (coalesce(metadata->'identity_sync','{}'::jsonb)-'lease_id'-'lease_until')||jsonb_build_object(
    'checked_at',now(),'status',CASE WHEN changed THEN 'completed' ELSE 'retry' END,
    'last_error',left(err,100),'next_at',now()+CASE WHEN err='BUYER_IDENTITY_NOT_RETURNED' THEN interval '6 hours' ELSE interval '15 minutes' END
   )),updated_at=now()
 WHERE id=o.id;
 RETURN jsonb_build_object('updated',changed,'error',err);
END $fn$;
REVOKE ALL ON FUNCTION public.finish_marketplace_identity_sync(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_marketplace_identity_sync(uuid,text,text,text,text) TO service_role;


SELECT cron.schedule(
 'icetak-shopee-order-identity',
 '* * * * *',
 $job$SELECT net.http_post(
  url:='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/shopee-order-identity-sync',
  headers:=jsonb_build_object('content-type','application/json','x-admin-window-token',
    (select setting_value from public.private_runtime_settings where setting_key='admin_window_bridge_token')),
  body:='{}'::jsonb,timeout_milliseconds:=60000
 )$job$
);