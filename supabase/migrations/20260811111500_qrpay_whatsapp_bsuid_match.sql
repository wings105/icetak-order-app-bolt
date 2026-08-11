alter table public.qrpay_ai_jobs
  add column if not exists matched_bsuid text,
  add column if not exists matched_username text,
  add column if not exists matched_customer_master_id uuid;

alter table public.pickup_ai_requests
  add column if not exists bsuid text,
  add column if not exists username text;

create index if not exists qrpay_ai_jobs_matched_bsuid_idx
  on public.qrpay_ai_jobs (matched_bsuid)
  where matched_bsuid is not null;

create index if not exists pickup_ai_requests_bsuid_idx
  on public.pickup_ai_requests (bsuid)
  where bsuid is not null;

comment on column public.qrpay_ai_jobs.matched_bsuid is
  'Stable WhatsApp BSUID for the matched Unified Inbox conversation; phone may be null when Meta hides it.';
