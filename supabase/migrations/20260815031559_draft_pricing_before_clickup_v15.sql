create or replace function public.icetak_sync_order_pricing_from_payload_v15(p_order_id uuid,p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare totals jsonb;
begin
  if p_order_id is null or p_payload is null then return '{}'::jsonb; end if;
  totals:=public.icetak_qrpay_draft_totals(coalesce(p_payload,'{}'::jsonb));
  update public.orders set total=(totals->>'draft_total')::numeric,delivery_fee=(totals->>'shipping_fee')::numeric,
    pricing_adjustments=coalesce(p_payload->'price_adjustments','{}'::jsonb)||jsonb_build_object('catalog_subtotal',(totals->>'catalog_subtotal')::numeric,'item_subtotal',(totals->>'item_subtotal')::numeric,'custom_addon',(totals->>'custom_addon')::numeric,'discount_type',totals->>'discount_type','discount_value',(totals->>'discount_value')::numeric,'discount_amount',(totals->>'discount_amount')::numeric,'shipping_fee',(totals->>'shipping_fee')::numeric,'rounding',(totals->>'rounding')::numeric,'final_total',(totals->>'draft_total')::numeric,'source','draft_pricing_v15'),updated_at=now() where id=p_order_id;
  with src as (select ord::int rn,item from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) with ordinality x(item,ord)), dst as (select id,row_number() over(order by sort_index nulls last,updated_at,id)::int rn from public.order_items where order_id=p_order_id)
  update public.order_items oi set price=coalesce(nullif(src.item->>'seller_deal_price','')::numeric,nullif(src.item->>'price','')::numeric,oi.price),customization=coalesce(oi.customization,'{}'::jsonb)||jsonb_build_object('pricing',jsonb_build_object('catalog_price',coalesce(nullif(src.item->>'catalog_price','')::numeric,nullif(src.item->>'price','')::numeric,oi.price),'seller_deal_price',case when nullif(src.item->>'seller_deal_price','') is null then null else (src.item->>'seller_deal_price')::numeric end,'price_reason',coalesce(src.item->>'price_reason',''),'price_source',case when nullif(src.item->>'seller_deal_price','') is null then 'catalog' else 'seller_deal' end)),updated_at=now() from src join dst on dst.rn=src.rn where oi.id=dst.id;
  return totals;
end
$function$;

create or replace function public.icetak_sync_confirmed_draft_pricing_v15()
returns trigger language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
begin
  if new.status='confirmed' and new.order_id is not null then perform public.icetak_sync_order_pricing_from_payload_v15(new.order_id,coalesce(new.working_draft,'{}'::jsonb)); end if;
  return new;
end
$function$;

create or replace function public.enqueue_clickup_production_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_id uuid; v_order public.orders; v_payload jsonb; v_draft_payload jsonb; v_draft_id uuid; v_txid text;
begin
  select * into v_order from public.orders where id=p_order_id;
  if not found then raise exception 'order_not_found'; end if;
  if coalesce(v_order.external_order_id,'') like 'draft:%' then
    begin v_draft_id:=substring(v_order.external_order_id from 7)::uuid; exception when others then v_draft_id:=null; end;
    if v_draft_id is not null then select working_draft into v_draft_payload from public.qrpay_order_drafts where id=v_draft_id limit 1; end if;
  elsif coalesce(v_order.external_order_id,'') like 'qrpay-ai:%' then
    v_txid:=substring(v_order.external_order_id from 10);
    select working_draft into v_draft_payload from public.qrpay_order_drafts where transaction_id=v_txid order by created_at desc limit 1;
  end if;
  if v_draft_payload is not null then perform public.icetak_sync_order_pricing_from_payload_v15(p_order_id,v_draft_payload); select * into v_order from public.orders where id=p_order_id; end if;
  if not public.icetak_order_is_production_ready(v_order) then return null; end if;
  if not exists(select 1 from public.production_components where order_id=p_order_id and clickup_task_id is null) then return null; end if;
  v_payload:=public.icetak_clickup_production_payload_data(p_order_id);
  insert into public.integration_outbox(provider,event_type,order_id,order_token,payload,status,next_attempt_at,source,channel,idempotency_key)
  values('activepieces','clickup.production.create',p_order_id,v_order.public_token,v_payload,'pending',now(),'supabase','clickup','clickup:production:create:'||p_order_id::text)
  on conflict(idempotency_key) where idempotency_key is not null do update set payload=excluded.payload,status=case when public.integration_outbox.status='processing' and public.integration_outbox.locked_at>now()-interval '3 minutes' then 'processing' else 'pending' end,next_attempt_at=case when public.integration_outbox.status='processing' and public.integration_outbox.locked_at>now()-interval '3 minutes' then public.integration_outbox.next_attempt_at else now() end,locked_at=case when public.integration_outbox.status='processing' and public.integration_outbox.locked_at>now()-interval '3 minutes' then public.integration_outbox.locked_at else null end,processed_at=case when public.integration_outbox.status='processing' and public.integration_outbox.locked_at>now()-interval '3 minutes' then public.integration_outbox.processed_at else null end,sent_at=case when public.integration_outbox.status='processing' and public.integration_outbox.locked_at>now()-interval '3 minutes' then public.integration_outbox.sent_at else null end,last_error=case when public.integration_outbox.status='processing' and public.integration_outbox.locked_at>now()-interval '3 minutes' then public.integration_outbox.last_error else null end,error=case when public.integration_outbox.status='processing' and public.integration_outbox.locked_at>now()-interval '3 minutes' then public.integration_outbox.error else null end returning id into v_id;
  return v_id;
end
$function$;
