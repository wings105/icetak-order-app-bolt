create table if not exists public.marketplace_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'shopee',
  event_key text not null,
  http_method text not null default 'POST',
  content_type text,
  event_code integer,
  region text,
  shop_id text,
  order_sn text,
  package_number text,
  conversation_id text,
  message_id text,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  request_headers jsonb not null default '{}'::jsonb,
  request_query jsonb not null default '{}'::jsonb,
  raw_body text not null default '',
  parsed_payload jsonb,
  parse_error text,
  request_size_bytes integer not null default 0 check (request_size_bytes >= 0),
  processing_status text not null default 'captured'
    check (processing_status in ('captured', 'processing', 'processed', 'ignored', 'failed')),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (provider, event_key)
);

create index if not exists marketplace_webhook_events_received_at_idx
  on public.marketplace_webhook_events (received_at desc);
create index if not exists marketplace_webhook_events_event_code_idx
  on public.marketplace_webhook_events (provider, event_code, received_at desc);
create index if not exists marketplace_webhook_events_order_sn_idx
  on public.marketplace_webhook_events (order_sn)
  where order_sn is not null;
create index if not exists marketplace_webhook_events_package_number_idx
  on public.marketplace_webhook_events (package_number)
  where package_number is not null;
create index if not exists marketplace_webhook_events_conversation_id_idx
  on public.marketplace_webhook_events (conversation_id)
  where conversation_id is not null;
create index if not exists marketplace_webhook_events_processing_status_idx
  on public.marketplace_webhook_events (processing_status, received_at)
  where processing_status in ('captured', 'failed');

alter table public.marketplace_webhook_events enable row level security;

revoke all on table public.marketplace_webhook_events from anon, authenticated;
grant select, insert, update on table public.marketplace_webhook_events to service_role;

create or replace function public.capture_marketplace_webhook(
  p_provider text,
  p_event_key text,
  p_http_method text default 'POST',
  p_content_type text default null,
  p_event_code integer default null,
  p_region text default null,
  p_shop_id text default null,
  p_order_sn text default null,
  p_package_number text default null,
  p_conversation_id text default null,
  p_message_id text default null,
  p_occurred_at timestamptz default null,
  p_request_headers jsonb default '{}'::jsonb,
  p_request_query jsonb default '{}'::jsonb,
  p_raw_body text default '',
  p_parsed_payload jsonb default null,
  p_parse_error text default null,
  p_request_size_bytes integer default 0
)
returns table (
  event_id uuid,
  is_duplicate boolean,
  duplicate_count integer
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  insert into public.marketplace_webhook_events (
    provider,
    event_key,
    http_method,
    content_type,
    event_code,
    region,
    shop_id,
    order_sn,
    package_number,
    conversation_id,
    message_id,
    occurred_at,
    request_headers,
    request_query,
    raw_body,
    parsed_payload,
    parse_error,
    request_size_bytes
  )
  values (
    coalesce(nullif(p_provider, ''), 'shopee'),
    p_event_key,
    coalesce(nullif(p_http_method, ''), 'POST'),
    p_content_type,
    p_event_code,
    nullif(p_region, ''),
    nullif(p_shop_id, ''),
    nullif(p_order_sn, ''),
    nullif(p_package_number, ''),
    nullif(p_conversation_id, ''),
    nullif(p_message_id, ''),
    p_occurred_at,
    coalesce(p_request_headers, '{}'::jsonb),
    coalesce(p_request_query, '{}'::jsonb),
    coalesce(p_raw_body, ''),
    p_parsed_payload,
    p_parse_error,
    greatest(coalesce(p_request_size_bytes, 0), 0)
  )
  on conflict (provider, event_key)
  do update set
    last_received_at = now(),
    duplicate_count = public.marketplace_webhook_events.duplicate_count + 1
  returning
    public.marketplace_webhook_events.id,
    public.marketplace_webhook_events.duplicate_count > 0,
    public.marketplace_webhook_events.duplicate_count;
end;
$$;

revoke all on function public.capture_marketplace_webhook(
  text, text, text, text, integer, text, text, text, text, text, text,
  timestamptz, jsonb, jsonb, text, jsonb, text, integer
) from public, anon, authenticated;
grant execute on function public.capture_marketplace_webhook(
  text, text, text, text, integer, text, text, text, text, text, text,
  timestamptz, jsonb, jsonb, text, jsonb, text, integer
) to service_role;

comment on table public.marketplace_webhook_events is
  'Append-only black-box capture for marketplace webhooks before normalization.';
comment on column public.marketplace_webhook_events.raw_body is
  'Exact request body as received. Never assume the payload is valid JSON.';
comment on column public.marketplace_webhook_events.parsed_payload is
  'Best-effort JSON parsing of raw_body; raw_body remains the source of truth.';

