-- Cover foreign-key history and process only active/new order events.
create index stock_allocations_material_fk on stock.allocations(material_code);
create index stock_item_rules_material_fk on stock.item_rules(material_code);

-- Initial active cohort: reserve current To Ship, never replay closed history.
insert into stock.work_queue(source,order_id)
select 'shopee',id from public.marketplace_orders
where provider='shopee' and current_status in ('READY_TO_SHIP','PROCESSED')
order by created_at desc limit 500
on conflict(source,order_id) do nothing;
insert into stock.work_queue(source,order_id)
select 'icetak',id from public.orders
where lower(coalesce(source,'')) not like '%shopee%'
and pickup_collected_at is null and delivered_at is null
and lower(coalesce(fulfillment_stage,'')) not in ('cancelled','collected','completed','delivered','in_transit')
and lower(coalesce(shipment_status_group,'')) not in ('shipped','picked_up','accepted_by_courier','in_transit','out_for_delivery','delivered')
and lower(coalesce(status,'')) not like '%cancel%' and lower(coalesce(status,'')) not in ('completed','delivered','customer collected','shipped')
and (customer_confirmed or production_approved or lower(coalesce(payment_status,'')) in ('paid','cash_counter','matched'))
order by created_at desc limit 500
on conflict(source,order_id) do nothing;

do $$begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('icetak-stock-worker','* * * * *','select public.icetak_stock_process_queue(20);');
 end if;
end $$;
