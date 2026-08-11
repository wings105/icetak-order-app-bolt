-- WhatsApp 2026 username/BSUID identity split.
-- Messaging recipient may be a real phone (WasapFlow `to`) or BSUID (`recipient`).
-- Courier/login phone fields remain real-phone-only and are intentionally untouched.

alter table public.whatsapp_contacts
  alter column phone drop not null,
  add column if not exists username text;

alter table public.whatsapp_contacts drop constraint if exists whatsapp_contacts_phone_key;
drop index if exists public.whatsapp_contacts_phone_key;
create unique index if not exists whatsapp_contacts_phone_unique_nonnull
  on public.whatsapp_contacts (phone)
  where phone is not null;
create unique index if not exists whatsapp_contacts_bsuid_unique_nonnull
  on public.whatsapp_contacts (bsuid)
  where bsuid is not null;
create index if not exists whatsapp_contacts_username_idx
  on public.whatsapp_contacts (lower(username))
  where username is not null;

alter table public.whatsapp_outbox
  alter column phone drop not null,
  add column if not exists recipient_bsuid text,
  add column if not exists recipient_username text,
  add column if not exists recipient_type text;

create index if not exists whatsapp_outbox_bsuid_created_idx
  on public.whatsapp_outbox (recipient_bsuid, created_at desc)
  where recipient_bsuid is not null;

alter table public.notification_queue
  add column if not exists recipient_bsuid text,
  add column if not exists recipient_username text;

alter table public.notification_outbox
  add column if not exists recipient_bsuid text,
  add column if not exists recipient_username text;

alter table public.admin_order_reviews
  add column if not exists candidate_bsuid text,
  add column if not exists candidate_username text;

create or replace function public.icetak_whatsapp_deep_link(p_phone text, p_username text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when nullif(btrim(p_username), '') is not null
      then 'https://wa.me/@' || regexp_replace(btrim(p_username), '^@+', '')
    when nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '') is not null
      then 'https://wa.me/' || regexp_replace(p_phone, '\D', '', 'g')
    else null
  end;
$$;

comment on column public.whatsapp_contacts.bsuid is
  'Stable business-scoped WhatsApp user ID (MY.x...). Preferred backend identity when present.';
comment on column public.whatsapp_contacts.username is
  'Current mutable WhatsApp username; display/deep-link only, not a stable identity key.';
comment on column public.whatsapp_outbox.recipient_bsuid is
  'WasapFlow Bridge recipient value for phone-hidden customers. Send as JSON field `recipient`.';
