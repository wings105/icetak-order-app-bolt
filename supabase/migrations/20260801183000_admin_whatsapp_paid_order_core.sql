-- Legacy optional admin QR fields retained for schema compatibility.
-- The active runtime remains the Bolt order system backed by Supabase.

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
values ('order_app','{}'::jsonb)
on conflict(key) do nothing;

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
  select nullif(rtrim(coalesce(
    (select value->>'base_url' from public.system_settings where key='order_app' limit 1),
    ''
  ),'/'),'');
$$;

create or replace function public.icetak_order_links(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public','pg_temp'
as $$
  with target as (
    select o.*,public.icetak_public_app_base_url() base_url
    from public.orders o where o.id=p_order_id
  )
  select coalesce((
    select jsonb_build_object(
      'order_path','/?order='||t.public_token,
      'customer_history_path','/?c='||coalesce(t.customer_token,''),
      'admin_order_path','/?admin=1&order='||t.public_token,
      'order_link',case when t.base_url is null then null else t.base_url||'/?order='||t.public_token end,
      'customer_history_link',case when t.base_url is null then null else t.base_url||'/?c='||coalesce(t.customer_token,'') end,
      'admin_order_link',case when t.base_url is null then null else t.base_url||'/?admin=1&order='||t.public_token end,
      'components',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',pc.id,
          'label',pc.label,
          'customer_path','/?order='||t.public_token||'#component-'||pc.id::text,
          'system_path','/?admin=1&order='||t.public_token||'&component='||pc.id::text,
          'customer_link',case when t.base_url is null then null else t.base_url||'/?order='||t.public_token||'#component-'||pc.id::text end,
          'system_link',case when t.base_url is null then null else t.base_url||'/?admin=1&order='||t.public_token||'&component='||pc.id::text end,
          'clickup_task_id',pc.clickup_task_id,
          'clickup_status',pc.clickup_status
        ) order by pc.created_at,pc.id)
        from public.production_components pc where pc.order_id=t.id
      ),'[]'::jsonb)
    ) from target t
  ),'{}'::jsonb);
$$;
