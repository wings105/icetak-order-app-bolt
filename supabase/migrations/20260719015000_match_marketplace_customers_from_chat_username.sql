
alter table public.marketplace_orders
  add column if not exists buyer_user_id text,
  add column if not exists buyer_shop_id text,
  add column if not exists buyer_customer_id uuid,
  add column if not exists buyer_match_method text,
  add column if not exists buyer_match_confidence numeric(4,3),
  add column if not exists buyer_matched_at timestamptz;

create table if not exists public.marketplace_customers (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'shopee',
  region text not null,
  provider_user_id text not null,
  provider_shop_id text,
  username text not null,
  username_normalized text generated always as (lower(btrim(username))) stored,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, region, provider_user_id)
);

do $constraint$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='marketplace_orders_buyer_customer_id_fkey'
      and conrelid='public.marketplace_orders'::regclass
  ) then
    alter table public.marketplace_orders
      add constraint marketplace_orders_buyer_customer_id_fkey
      foreign key (buyer_customer_id)
      references public.marketplace_customers(id)
      on delete set null;
  end if;
end;
$constraint$;

create table if not exists public.marketplace_order_customers (
  order_id uuid not null references public.marketplace_orders(id) on delete cascade,
  customer_id uuid not null references public.marketplace_customers(id) on delete cascade,
  role text not null default 'buyer',
  match_method text not null,
  match_confidence numeric(4,3) not null check (match_confidence between 0 and 1),
  source_event_id uuid references public.marketplace_webhook_events(id) on delete set null,
  matched_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key (order_id, role)
);

create index if not exists idx_marketplace_customers_username_region
  on public.marketplace_customers (provider, region, username_normalized);
create index if not exists idx_marketplace_customers_shop
  on public.marketplace_customers (provider_shop_id)
  where provider_shop_id is not null;
create index if not exists idx_marketplace_orders_buyer_customer
  on public.marketplace_orders (buyer_customer_id)
  where buyer_customer_id is not null;
create index if not exists idx_marketplace_orders_buyer_username_region
  on public.marketplace_orders (region, lower(btrim(buyer_username)))
  where buyer_username is not null;
create index if not exists idx_marketplace_order_customers_customer
  on public.marketplace_order_customers (customer_id);
create index if not exists idx_marketplace_order_customers_source_event
  on public.marketplace_order_customers (source_event_id)
  where source_event_id is not null;

alter table public.marketplace_customers enable row level security;
alter table public.marketplace_order_customers enable row level security;

drop policy if exists authenticated_read_marketplace_customers
  on public.marketplace_customers;
create policy authenticated_read_marketplace_customers
  on public.marketplace_customers for select to authenticated using (true);

drop policy if exists authenticated_read_marketplace_order_customers
  on public.marketplace_order_customers;
create policy authenticated_read_marketplace_order_customers
  on public.marketplace_order_customers for select to authenticated using (true);

create or replace function public.sync_marketplace_customer_identity(
  p_username text,
  p_user_id text,
  p_buyer_shop_id text,
  p_region text,
  p_source_event_id uuid default null,
  p_observed_at timestamptz default now()
)
returns table (
  customer_id uuid,
  matched_orders integer,
  conflicting_orders integer
)
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_customer_id uuid;
  v_username text;
  v_region text;
  v_observed_at timestamptz;
  v_matched integer := 0;
  v_conflicts integer := 0;
begin
  v_username := nullif(btrim(p_username),'');
  v_region := upper(coalesce(nullif(btrim(p_region),''),'MY'));
  v_observed_at := coalesce(p_observed_at,now());

  if v_username is null then raise exception 'username is required'; end if;
  if nullif(btrim(p_user_id),'') is null then raise exception 'user_id is required'; end if;

  insert into public.marketplace_customers (
    provider,region,provider_user_id,provider_shop_id,username,
    first_seen_at,last_seen_at,metadata,updated_at
  ) values (
    'shopee',v_region,btrim(p_user_id),nullif(btrim(p_buyer_shop_id),''),v_username,
    v_observed_at,v_observed_at,
    jsonb_build_object('identity_source','shopee_chat'),now()
  )
  on conflict (provider,region,provider_user_id) do update set
    provider_shop_id=coalesce(excluded.provider_shop_id,public.marketplace_customers.provider_shop_id),
    username=excluded.username,
    first_seen_at=least(public.marketplace_customers.first_seen_at,excluded.first_seen_at),
    last_seen_at=greatest(public.marketplace_customers.last_seen_at,excluded.last_seen_at),
    metadata=public.marketplace_customers.metadata || excluded.metadata,
    updated_at=now()
  returning id into v_customer_id;

  select count(*)::integer into v_conflicts
  from public.marketplace_orders o
  where o.provider='shopee'
    and upper(coalesce(o.region,'MY'))=v_region
    and lower(btrim(o.buyer_username))=lower(v_username)
    and o.buyer_user_id is not null
    and o.buyer_user_id<>btrim(p_user_id);

  with matched as (
    update public.marketplace_orders o
       set buyer_user_id=btrim(p_user_id),
           buyer_shop_id=coalesce(nullif(btrim(p_buyer_shop_id),''),o.buyer_shop_id),
           buyer_customer_id=v_customer_id,
           buyer_match_method='chat_username_exact',
           buyer_match_confidence=0.850,
           buyer_matched_at=v_observed_at,
           updated_at=now()
     where o.provider='shopee'
       and upper(coalesce(o.region,'MY'))=v_region
       and lower(btrim(o.buyer_username))=lower(v_username)
       and (o.buyer_user_id is null or o.buyer_user_id=btrim(p_user_id))
    returning o.id
  )
  insert into public.marketplace_order_customers (
    order_id,customer_id,role,match_method,match_confidence,
    source_event_id,matched_at,metadata
  )
  select id,v_customer_id,'buyer','chat_username_exact',0.850,
         p_source_event_id,v_observed_at,
         jsonb_build_object('matched_username',v_username,'region',v_region)
  from matched
  on conflict (order_id,role) do update set
    customer_id=excluded.customer_id,
    match_method=excluded.match_method,
    match_confidence=excluded.match_confidence,
    source_event_id=coalesce(excluded.source_event_id,public.marketplace_order_customers.source_event_id),
    matched_at=excluded.matched_at,
    metadata=public.marketplace_order_customers.metadata || excluded.metadata;

  get diagnostics v_matched=row_count;
  return query select v_customer_id,v_matched,v_conflicts;
end;
$function$;

revoke all on function public.sync_marketplace_customer_identity(
  text,text,text,text,uuid,timestamptz
) from public,anon,authenticated;
grant execute on function public.sync_marketplace_customer_identity(
  text,text,text,text,uuid,timestamptz
) to service_role;
