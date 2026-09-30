create table if not exists public.render_templates (
 sku text primary key check (sku ~ '^[A-Z0-9_-]{1,40}$'),
 image_path text not null,
 font_path text,
 config jsonb not null,
 version integer not null default 1,
 updated_by text not null,
 updated_at timestamptz not null default now()
);
create table if not exists public.render_template_events (
 id uuid primary key default gen_random_uuid(),
 sku text not null,
 actor text not null,
 previous_template jsonb,
 saved_template jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.render_templates enable row level security;
alter table public.render_template_events enable row level security;
revoke all on public.render_templates, public.render_template_events from public, anon, authenticated;
grant all on public.render_templates, public.render_template_events to service_role;
create or replace function public.icetak_render_template_save(p_actor text,p_sku text,p_image_path text,p_font_path text,p_config jsonb,p_expected_version integer)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare old public.render_templates; saved public.render_templates;
begin
 perform pg_advisory_xact_lock(hashtextextended('render-template:'||p_sku,0));
 select * into old from public.render_templates where sku=p_sku for update;
 if coalesce(old.version,0)<>p_expected_version then raise exception 'TEMPLATE_CHANGED: Reload template sebelum Save'; end if;
 insert into public.render_templates(sku,image_path,font_path,config,version,updated_by)
 values(p_sku,p_image_path,p_font_path,p_config,1,p_actor)
 on conflict(sku) do update set image_path=excluded.image_path,font_path=excluded.font_path,config=excluded.config,
 version=render_templates.version+1,updated_by=p_actor,updated_at=now()
 returning * into saved;
 insert into public.render_template_events(sku,actor,previous_template,saved_template)
 values(p_sku,p_actor,case when old.sku is null then null else to_jsonb(old) end,to_jsonb(saved));
 return to_jsonb(saved);
end $$;
revoke all on function public.icetak_render_template_save(text,text,text,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.icetak_render_template_save(text,text,text,text,jsonb,integer) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('render-templates','render-templates',true,6291456,array['image/png','image/jpeg','image/webp','font/ttf','font/otf'])
on conflict(id) do nothing;
