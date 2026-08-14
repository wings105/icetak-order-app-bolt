do $$
declare
  r record;
  ddl text;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f','p')
      and pg_get_functiondef(p.oid) ilike '%https://icetak.bolt.host%'
  loop
    ddl := replace(pg_get_functiondef(r.oid), 'https://icetak.bolt.host', 'https://shop.decocake.my');
    execute ddl;
  end loop;
end $$;

create or replace function public.icetak_public_app_base_url()
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with candidate as (
    select coalesce(
      nullif((select value->>'base_url' from public.system_settings where key='order_app' limit 1),''),
      nullif((select coalesce(text_value,value->>'url') from public.whatsapp_settings where key='customer_app_base_url' limit 1),''),
      'https://shop.decocake.my'
    ) as url
  )
  select case
    when public.icetak_is_safe_public_app_url(url) then rtrim(url,'/')
    else 'https://shop.decocake.my'
  end
  from candidate;
$function$;

update public.whatsapp_settings
set text_value = 'https://shop.decocake.my',
    value = coalesce(value,'{}'::jsonb) || jsonb_build_object('url','https://shop.decocake.my')
where key = 'customer_app_base_url';

update public.system_settings
set value = coalesce(value,'{}'::jsonb) || jsonb_build_object('base_url','https://shop.decocake.my')
where key = 'order_app';
