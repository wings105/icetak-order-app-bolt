-- Admin WhatsApp manual-QR paid order flow, ClickUp production handoff,
-- and shipment-to-ClickUp outbox. All changes are idempotent.

alter table public.orders
  add column if not exists delivery_fee numeric not null default 0,
  add column if not exists payment_method text,
  add column if not exists payment_transaction_id text,
  add column if not exists payment_verified_at timestamptz,
  add column if not exists payment_verified_by text,
  add column if not exists manual_order_request_id uuid;

do $$ begin
  alter table public.orders add constraint orders_delivery_fee_nonnegative check (delivery_fee >= 0);
exception when duplicate_object then null;
end $$;
create unique index if not exists orders_manual_order_request_id_uidx
  on public.orders(manual_order_request_id)
  where manual_order_request_id is not null;
create index if not exists orders_payment_transaction_id_idx
  on public.orders(payment_transaction_id)
  where payment_transaction_id is not null;

insert into public.system_settings(key,value)
values ('public_app', jsonb_build_object('base_url','https://8ab71fa9c33743fd70.v2.appdeploy.ai'))
on conflict(key) do nothing;

-- Existing owner keeps working after the new verification permission is enforced.
update public.admin_permissions p
set permissions=(
  select array_agg(distinct permission order by permission)
  from unnest(coalesce(p.permissions,'{}'::text[]) || array['verify_payments']::text[]) permission
)
from public.admin_users u
where u.username=p.username
  and u.is_active=true
  and (u.role='owner' or 'manage_admins'=any(coalesce(p.permissions,'{}'::text[])));

create or replace function public.icetak_public_app_base_url()
returns text
language sql
stable
security definer
set search_path to 'public','pg_temp'
as $$
  select rtrim(coalesce(
    (select value->>'base_url' from public.system_settings where key='public_app' limit 1),
    'https://8ab71fa9c33743fd70.v2.appdeploy.ai'
  ),'/');
$$;

create or replace function public.icetak_order_links(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public','pg_temp'
as $$
  with target as (
    select o.*, public.icetak_public_app_base_url() base_url
    from public.orders o where o.id=p_order_id
  )
  select coalesce((
    select jsonb_build_object(
      'order_link',t.base_url || '/?order=' || t.public_token,
      'customer_history_link',t.base_url || '/?c=' || coalesce(t.customer_token,''),
      'admin_order_link',t.base_url || '/?admin=1&order=' || t.public_token,
      'components',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',pc.id,
          'label',pc.label,
          'customer_link',t.base_url || '/?order=' || t.public_token || '#component-' || pc.id::text,
          'system_link',t.base_url || '/?admin=1&order=' || t.public_token || '&component=' || pc.id::text,
          'clickup_task_id',pc.clickup_task_id,
          'clickup_status',pc.clickup_status
        ) order by pc.created_at,pc.id)
        from public.production_components pc where pc.order_id=t.id
      ),'[]'::jsonb)
    ) from target t
  ),'{}'::jsonb);
$$;
