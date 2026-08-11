alter table public.pickup_ai_requests
  add column if not exists customer_master_id uuid;

alter table public.pickup_ai_requests
  drop constraint if exists pickup_ai_requests_status_check;

alter table public.pickup_ai_requests
  add constraint pickup_ai_requests_status_check
  check (status = any (array[
    'received'::text,
    'extracting'::text,
    'matched'::text,
    'order_created'::text,
    'completed'::text,
    'failed'::text,
    'dry_run'::text,
    'needs_review'::text
  ]));

create index if not exists pickup_ai_requests_customer_master_idx
  on public.pickup_ai_requests(customer_master_id)
  where customer_master_id is not null;
