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
  dispatch_settings_ready boolean;
  scheduler_active boolean;
begin
  if not public.icetak_admin_can_manage_whatsapp() then raise exception 'forbidden'; end if;
  connected := exists(select 1 from public.whatsapp_settings where key='partner_key' and nullif(secret_value,'') is not null)
    and exists(select 1 from public.whatsapp_settings where key='waba_id' and nullif(text_value,'') is not null);
  dispatch_settings_ready := exists(select 1 from public.whatsapp_settings where key='dispatch_url' and nullif(text_value,'') is not null)
    and exists(select 1 from public.whatsapp_settings where key='dispatch_internal_key' and nullif(secret_value,'') is not null);
  scheduler_active := exists(select 1 from cron.job where jobname='icetak-whatsapp-dispatch-every-minute' and active=true);

  select count(*) into trigger_count
  from pg_trigger t join pg_proc p on p.oid=t.tgfoid
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
    'overall_ready',connected and dispatch_settings_ready and scheduler_active and trigger_count>=7 and jsonb_array_length(invalid_rules)=0,
    'connected',connected,
    'dispatcher_ready',dispatch_settings_ready,
    'scheduler_active',scheduler_active,
    'trigger_count',trigger_count,
    'expected_trigger_count',7,
    'enabled_rules',enabled_rules,
    'valid_rules',valid_rules,
    'invalid_rules',invalid_rules,
    'approved_templates',(select count(*) from public.whatsapp_templates where upper(status)='APPROVED'),
    'pending',(select count(*) from public.notification_queue where status='pending'),
    'failed',(select count(*) from public.notification_queue where status='failed'),
    'last_sent_at',(select max(sent_at) from public.whatsapp_outbox where status='sent'),
    'last_failed_at',(select max(updated_at) from public.whatsapp_outbox where status='failed')
  );
end;
$$;