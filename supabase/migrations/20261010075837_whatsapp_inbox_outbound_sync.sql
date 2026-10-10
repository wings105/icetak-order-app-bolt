-- Order System only. Full index allows PostgREST ON CONFLICT without a predicate.
create unique index if not exists whatsapp_outbox_idempotency_full_uq on public.whatsapp_outbox(idempotency_key);
alter table public.whatsapp_outbox
 add column if not exists inbox_sync_status text not null default 'not_requested',
 add column if not exists inbox_sync_attempts integer not null default 0,
 add column if not exists inbox_synced_at timestamptz,
 add column if not exists inbox_sync_next_at timestamptz,
 add column if not exists inbox_sync_error text;
create index if not exists whatsapp_outbox_inbox_pending_idx on public.whatsapp_outbox(inbox_sync_next_at,created_at)
 where status='sent' and inbox_sync_status in ('pending','retry');
