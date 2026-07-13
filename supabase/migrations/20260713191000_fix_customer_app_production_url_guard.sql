create or replace function public.icetak_is_safe_public_app_url(p_url text)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select coalesce(
    p_url ~* '^https://[^[:space:]]+$'
    and p_url !~* '(localhost|127\.0\.0\.1|0\.0\.0\.0|webcontainer-api\.io|local-credentialless|\.local($|/)|bolt\.new)',
    false
  );
$$;

update public.whatsapp_settings
set text_value='https://icetak.bolt.host',
    value=jsonb_set(coalesce(value,'{}'::jsonb),'{url}',to_jsonb('https://icetak.bolt.host'::text),true),
    updated_at=now()
where key='customer_app_base_url'
  and not public.icetak_is_safe_public_app_url(coalesce(text_value,value->>'url',''));

create or replace function public.icetak_admin_whatsapp_save_settings(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  kv record;
  secret boolean;
  clean_value text;
begin
  if not public.icetak_admin_can_manage_whatsapp() then raise exception 'forbidden'; end if;
  for kv in select * from jsonb_each_text(coalesce(p_payload,'{}'::jsonb)) loop
    clean_value := btrim(coalesce(kv.value,''));
    if clean_value='' then continue; end if;
    if kv.key='customer_app_base_url' then
      clean_value := rtrim(clean_value,'/');
      if not public.icetak_is_safe_public_app_url(clean_value) then
        raise exception 'Customer App URL mesti URL production HTTPS, bukan localhost atau preview WebContainer';
      end if;
    end if;
    secret:=kv.key in ('partner_key','webhook_secret','unified_inbox_24h_key','dispatch_internal_key');
    insert into public.whatsapp_settings(provider,key,text_value,secret_value,is_secret,created_at,updated_at)
    values (case when kv.key='customer_app_base_url' then 'icetak' else 'wasapflow' end,kv.key,case when secret then null else clean_value end,case when secret then clean_value else null end,secret,now(),now())
    on conflict (key) do update set text_value=case when secret then public.whatsapp_settings.text_value else excluded.text_value end,secret_value=case when secret then excluded.secret_value else public.whatsapp_settings.secret_value end,is_secret=excluded.is_secret,updated_at=now();
  end loop;
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function public.icetak_whatsapp_vars(p_order_id uuid, p_extra jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  o public.orders%rowtype;
  c public.customers%rowtype;
  base_url text;
  support_phone text;
  review_url text;
  result jsonb;
begin
  select * into o from public.orders where id=p_order_id;
  if o.id is null then return coalesce(p_extra,'{}'::jsonb); end if;
  select * into c from public.customers where id=o.customer_id;
  select coalesce(text_value,value->>'url') into base_url from public.whatsapp_settings where key='customer_app_base_url' limit 1;
  base_url := rtrim(coalesce(nullif(base_url,''),'https://icetak.bolt.host'),'/');
  if not public.icetak_is_safe_public_app_url(base_url) then base_url := 'https://icetak.bolt.host'; end if;
  select coalesce(text_value,secret_value) into support_phone from public.whatsapp_settings where key='support_phone' limit 1;
  support_phone := coalesce(nullif(support_phone,''),'60179860656');
  select coalesce(pc.preview_url,oi.design_preview_url) into review_url
  from public.order_items oi
  left join public.production_components pc on pc.order_item_id=oi.id and nullif(pc.preview_url,'') is not null
  where oi.order_id=o.id and (nullif(oi.design_preview_url,'') is not null or nullif(pc.preview_url,'') is not null)
  order by coalesce(pc.updated_at,oi.updated_at) desc nulls last limit 1;

  result := jsonb_strip_nulls(jsonb_build_object(
    'customer_name',coalesce(c.name,o.delivery_name,'Customer'),
    'phone',public.icetak_normalize_phone(coalesce(c.phone,o.delivery_phone)),
    'order_id',coalesce(o.order_id,o.order_no),
    'order_token',o.public_token,
    'order_total','RM' || trim(to_char(coalesce(o.total,0),'FM999999990.00')),
    'date_need',case when o.date_need is null then null else to_char(o.date_need,'DD/MM/YYYY') end,
    'order_link',base_url || '/?order=' || coalesce(o.public_token,o.id::text),
    'payment_link',base_url || '/?order=' || coalesce(o.public_token,o.id::text) || '&page=payment',
    'review_link',coalesce(nullif(review_url,''),base_url || '/?order=' || coalesce(o.public_token,o.id::text)),
    'tracking_number',coalesce(o.tracking,''),
    'courier',coalesce(o.courier,''),
    'tracking_link',coalesce(o.tracking_link,''),
    'pickup_location','Bandar Baru Pasir Puteh',
    'support_phone',support_phone,
    'expiry_minutes','10'
  ));
  return result || coalesce(p_extra,'{}'::jsonb);
end;
$$;

grant execute on function public.icetak_is_safe_public_app_url(text) to authenticated;
