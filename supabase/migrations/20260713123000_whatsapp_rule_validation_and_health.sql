create or replace function public.icetak_meta_template_param_count(p_components jsonb)
returns integer
language sql
immutable
set search_path to 'public'
as $$
  select coalesce(max((match_arr)[1]::integer),0)
  from jsonb_array_elements(coalesce(p_components,'[]'::jsonb)) component
  cross join lateral regexp_matches(coalesce(component->>'text',''), '\{\{([0-9]+)\}\}', 'g') match_arr;
$$;

create or replace function public.icetak_admin_whatsapp_save_rule(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  ev text := p_payload->>'event_type';
  use_template boolean := coalesce((p_payload->>'template_enabled')::boolean,false);
  template_name_value text := nullif(p_payload->>'template_name','');
  language_value text := coalesce(nullif(p_payload->>'template_language',''),'ms');
  mapped_params jsonb := coalesce(p_payload->'template_params','[]'::jsonb);
  template_row public.whatsapp_templates%rowtype;
  mapped_count integer := 0;
  meta_count integer := 0;
  unknown_field text;
begin
  if not public.icetak_admin_can_manage_whatsapp() then raise exception 'forbidden'; end if;
  if nullif(ev,'') is null then raise exception 'event_type required'; end if;
  if jsonb_typeof(mapped_params) <> 'array' then raise exception 'template_params must be array'; end if;

  select match_value into unknown_field
  from regexp_matches(coalesce(p_payload->>'freeform_text',''), '\{\s*([a-zA-Z0-9_]+)\s*\}', 'g') as matches(match_value)
  where match_value not in (
    'customer_name','phone','order_id','order_token','order_total','date_need','order_link',
    'payment_link','review_link','tracking_number','courier','tracking_link','pickup_location',
    'otp','otp_code','magic_link','expiry_minutes','support_phone'
  )
  limit 1;
  if unknown_field is not null then raise exception 'unknown free-form field: %', unknown_field; end if;

  if use_template then
    if template_name_value is null then raise exception 'approved template required'; end if;
    select * into template_row from public.whatsapp_templates
    where name=template_name_value and language=language_value and upper(status)='APPROVED' limit 1;
    if template_row.id is null then raise exception 'template not approved/synced: % (%)',template_name_value,language_value; end if;
    mapped_count := jsonb_array_length(mapped_params);
    meta_count := public.icetak_meta_template_param_count(template_row.components);
    if mapped_count <> meta_count then
      raise exception 'template parameter mismatch: % expects %, mapping has %',template_name_value,meta_count,mapped_count;
    end if;
  end if;

  update public.whatsapp_notification_rules set
    enabled=coalesce((p_payload->>'enabled')::boolean,enabled),
    freeform_enabled=coalesce((p_payload->>'freeform_enabled')::boolean,freeform_enabled),
    template_enabled=coalesce((p_payload->>'template_enabled')::boolean,template_enabled),
    freeform_text=coalesce(p_payload->>'freeform_text',freeform_text),
    template_name=case when p_payload ? 'template_name' then template_name_value else template_name end,
    template_language=coalesce(nullif(p_payload->>'template_language',''),template_language),
    template_params=coalesce(p_payload->'template_params',template_params),
    available_fields=case when p_payload ? 'available_fields' then array(select jsonb_array_elements_text(p_payload->'available_fields')) else available_fields end,
    updated_at=now()
  where event_type=ev;
  if not found then raise exception 'rule not found'; end if;
  return jsonb_build_object('ok',true,'validation','OK','meta_params',meta_count,'mapped_params',mapped_count);
end;
$$;

create or replace function public.icetak_admin_whatsapp_health()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  invalid_rules jsonb;
  enabled_rules integer;
  valid_rules integer;
  trigger_count integer;
  connected boolean;
  dispatcher_ready boolean;
begin
  if not public.icetak_admin_can_manage_whatsapp() then raise exception 'forbidden'; end if;
  connected := exists(select 1 from public.whatsapp_settings where key='partner_key' and nullif(secret_value,'') is not null)
    and exists(select 1 from public.whatsapp_settings where key='waba_id' and nullif(text_value,'') is not null);
  dispatcher_ready := exists(select 1 from public.whatsapp_settings where key='dispatch_url' and nullif(text_value,'') is not null)
    and exists(select 1 from public.whatsapp_settings where key='dispatch_internal_key' and nullif(secret_value,'') is not null);

  select count(*) into trigger_count from pg_trigger t join pg_proc p on p.oid=t.tgfoid
  where not t.tgisinternal and p.proname in (
    'icetak_notification_outbox_queue_trigger','icetak_kick_whatsapp_dispatch','icetak_orders_whatsapp_trigger',
    'icetak_payment_session_whatsapp_trigger','icetak_shipment_event_whatsapp_trigger',
    'icetak_order_item_review_trigger','icetak_component_review_trigger'
  );
  select count(*) into enabled_rules from public.whatsapp_notification_rules where enabled=true;

  with checks as (
    select r.event_type,r.template_name,r.template_language,
      jsonb_array_length(coalesce(r.template_params,'[]'::jsonb)) mapped_count,
      public.icetak_meta_template_param_count(t.components) meta_count,
      t.id is not null as template_found,r.template_enabled
    from public.whatsapp_notification_rules r
    left join public.whatsapp_templates t
      on t.name=r.template_name and t.language=r.template_language and upper(t.status)='APPROVED'
    where r.enabled=true
  )
  select count(*) filter(where not template_enabled or (template_found and mapped_count=meta_count)),
    coalesce(jsonb_agg(jsonb_build_object(
      'event_type',event_type,'template_name',template_name,'language',template_language,
      'mapped_params',mapped_count,'meta_params',meta_count,
      'reason',case when not template_found then 'template_not_approved' else 'parameter_mismatch' end
    )) filter(where template_enabled and (not template_found or mapped_count<>meta_count)),'[]'::jsonb)
  into valid_rules,invalid_rules from checks;

  return jsonb_build_object(
    'overall_ready',connected and dispatcher_ready and trigger_count>=7 and jsonb_array_length(invalid_rules)=0,
    'connected',connected,'dispatcher_ready',dispatcher_ready,'trigger_count',trigger_count,
    'expected_trigger_count',7,'enabled_rules',enabled_rules,'valid_rules',valid_rules,
    'invalid_rules',invalid_rules,
    'approved_templates',(select count(*) from public.whatsapp_templates where upper(status)='APPROVED'),
    'pending',(select count(*) from public.notification_queue where status='pending'),
    'failed',(select count(*) from public.notification_queue where status='failed'),
    'last_sent_at',(select max(sent_at) from public.whatsapp_outbox where status='sent'),
    'last_failed_at',(select max(updated_at) from public.whatsapp_outbox where status='failed')
  );
end;
$$;

grant execute on function public.icetak_meta_template_param_count(jsonb) to authenticated;
grant execute on function public.icetak_admin_whatsapp_health() to authenticated;

create or replace function public.icetak_admin_whatsapp_snapshot()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.icetak_admin_can_manage_whatsapp() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'status',jsonb_build_object(
      'configured',jsonb_build_object(
        'partner_key',exists(select 1 from public.whatsapp_settings where key='partner_key' and nullif(secret_value,'') is not null),
        'waba_id',exists(select 1 from public.whatsapp_settings where key='waba_id' and nullif(text_value,'') is not null),
        'webhook_secret',exists(select 1 from public.whatsapp_settings where key='webhook_secret' and nullif(secret_value,'') is not null)
      ),
      'enabled',coalesce((select lower(coalesce(text_value,'')) in ('true','1','yes','enabled') from public.whatsapp_settings where key='enabled' limit 1),true),
      'base_url',coalesce((select text_value from public.whatsapp_settings where key='base_url' limit 1),'https://officialapi.wasapflow.com/bridge/v1'),
      'waba_id',(select text_value from public.whatsapp_settings where key='waba_id' limit 1),
      'default_language',coalesce((select text_value from public.whatsapp_settings where key='default_language' limit 1),'ms'),
      'customer_app_base_url',(select text_value from public.whatsapp_settings where key='customer_app_base_url' limit 1),
      'unified_inbox_24h_url',(select text_value from public.whatsapp_settings where key='unified_inbox_24h_url' limit 1)
    ),
    'health',public.icetak_admin_whatsapp_health(),
    'rules',(select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_order),'[]'::jsonb) from public.whatsapp_notification_rules r),
    'templates',(select coalesce(jsonb_agg(to_jsonb(t) order by t.name),'[]'::jsonb) from public.whatsapp_templates t),
    'outbox',(select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at desc),'[]'::jsonb) from (select * from public.whatsapp_outbox order by created_at desc limit 100) o)
  );
end;
$$;