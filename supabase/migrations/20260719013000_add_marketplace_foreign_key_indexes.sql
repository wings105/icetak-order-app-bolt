create index if not exists idx_marketplace_financials_detail_source_event
  on public.marketplace_order_financials (detail_source_event_id)
  where detail_source_event_id is not null;
create index if not exists idx_marketplace_items_source_event
  on public.marketplace_order_items (source_event_id)
  where source_event_id is not null;
create index if not exists idx_marketplace_orders_detail_source_event
  on public.marketplace_orders (detail_source_event_id)
  where detail_source_event_id is not null;
create index if not exists idx_marketplace_returns_order
  on public.marketplace_returns (order_id);
