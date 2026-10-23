-- iCetak Roadmap schema. Safe to re-run; seeds stay private until owner publishes.
create schema if not exists icetak_private;
revoke all on schema icetak_private from public, anon;
grant usage on schema icetak_private to authenticated;
create or replace function icetak_private.roadmap_owner() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.admin_users a where a.auth_user_id=(select auth.uid()) and a.role='owner' and a.is_active=true);
$$;
revoke all on function icetak_private.roadmap_owner() from public,anon;
grant execute on function icetak_private.roadmap_owner() to authenticated;
create or replace function public.icetak_roadmap_can_edit() returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce(icetak_private.roadmap_owner(),false);
$$;
revoke all on function public.icetak_roadmap_can_edit() from public,anon;
grant execute on function public.icetak_roadmap_can_edit() to authenticated;
create table if not exists public.icetak_roadmap_items(
 id uuid primary key default gen_random_uuid(),
 title text not null check(char_length(trim(title)) between 3 and 160),
 summary text not null default '' check(char_length(summary)<=4000),
 category text not null default 'general' check(category in ('general','orders','inbox','automation','production','finance','shopee','design','infrastructure')),
 status text not null default 'idea' check(status in ('idea','planned','building','testing','completed','on_hold')),
 priority text not null default 'p2' check(priority in ('p0','p1','p2','p3')),
 progress smallint not null default 0 check(progress between 0 and 100),
 target_date date,
 is_public boolean not null default false,
 created_by uuid default auth.uid(),
 completed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists icetak_roadmap_items_status_idx on public.icetak_roadmap_items(status,priority,updated_at desc);
create index if not exists icetak_roadmap_items_public_idx on public.icetak_roadmap_items(is_public,updated_at desc);
create table if not exists public.icetak_roadmap_updates(
 id uuid primary key default gen_random_uuid(),
 item_id uuid not null references public.icetak_roadmap_items(id) on delete cascade,
 body text not null check(char_length(trim(body)) between 3 and 1000),
 kind text not null default 'progress' check(kind in ('created','progress','release','note')),
 is_public boolean not null default true,
 created_by uuid default auth.uid(),
 created_at timestamptz not null default now()
);
create index if not exists icetak_roadmap_updates_recent_idx on public.icetak_roadmap_updates(created_at desc);
create index if not exists icetak_roadmap_updates_item_idx on public.icetak_roadmap_updates(item_id,created_at desc);
create or replace function icetak_private.roadmap_set_updated_at() returns trigger
language plpgsql set search_path='' as $$
begin
 new.updated_at=now();
 if new.status='completed' and old.status is distinct from 'completed' then
   new.progress=100;new.completed_at=now();
 elsif new.status is distinct from 'completed' then new.completed_at=null;
 end if;
 return new;
end;
$$;
drop trigger if exists icetak_roadmap_updated_at on public.icetak_roadmap_items;
create trigger icetak_roadmap_updated_at before update on public.icetak_roadmap_items
for each row execute function icetak_private.roadmap_set_updated_at();
alter table public.icetak_roadmap_items enable row level security;
alter table public.icetak_roadmap_updates enable row level security;
revoke all on public.icetak_roadmap_items from public,anon,authenticated;
revoke all on public.icetak_roadmap_updates from public,anon,authenticated;
grant select on public.icetak_roadmap_items to anon,authenticated;
grant select on public.icetak_roadmap_updates to anon,authenticated;
grant insert,update,delete on public.icetak_roadmap_items to authenticated;
grant insert,update,delete on public.icetak_roadmap_updates to authenticated;
drop policy if exists roadmap_public_items on public.icetak_roadmap_items;
create policy roadmap_public_items on public.icetak_roadmap_items for select to anon,authenticated using(is_public=true);
drop policy if exists roadmap_owner_items on public.icetak_roadmap_items;
create policy roadmap_owner_items on public.icetak_roadmap_items for all to authenticated
using(icetak_private.roadmap_owner()) with check(icetak_private.roadmap_owner());
drop policy if exists roadmap_public_updates on public.icetak_roadmap_updates;
create policy roadmap_public_updates on public.icetak_roadmap_updates for select to anon,authenticated
using(is_public=true and exists(select 1 from public.icetak_roadmap_items i where i.id=item_id and i.is_public=true));
drop policy if exists roadmap_owner_updates on public.icetak_roadmap_updates;
create policy roadmap_owner_updates on public.icetak_roadmap_updates for all to authenticated
using(icetak_private.roadmap_owner()) with check(icetak_private.roadmap_owner());
insert into public.icetak_roadmap_items(title,summary,category,status,priority,progress,is_public)
select v.title,v.summary,v.category,'idea',v.priority,0,false from (values
('Shopee Keyword Intelligence','Analisis keyword, search volume dan cadangan SEO mengikut produk. Ujian API telah berjaya; status pelaksanaan dashboard perlu disahkan.','shopee','p1'),
('Shopee Stock POD Auto Refill','Semak stok sifar dan tambah stok secara terkawal selepas mengukur kadar order.','automation','p1'),
('ClickUp Task Sidepanel','Buka task dalam panel kanan, lengkap dengan copy SKU/gambar, print AWB, reference order, status dan customer review.','orders','p1'),
('AI Action Dashboard','Satu paparan untuk task ClickUp, chat pelanggan, detail order dan hantar design ke task.','inbox','p1'),
('Acrylic Production View','Senaraikan kerja acrylic mengikut warna, saiz dan status untuk production.','production','p2'),
('Smart Photo Collage Engine','Susun gambar pelanggan secara automatik tanpa mengubah wajah atau kandungan gambar.','design','p2')
) as v(title,summary,category,priority)
where not exists(select 1 from public.icetak_roadmap_items i where i.title=v.title);
