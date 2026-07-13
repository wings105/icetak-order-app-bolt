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
    'rules',(select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_order),'[]'::jsonb) from public.whatsapp_notification_rules r),
    'templates',(select coalesce(jsonb_agg(to_jsonb(t) order by t.name),'[]'::jsonb) from public.whatsapp_templates t),
    'outbox',(select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at desc),'[]'::jsonb) from (select * from public.whatsapp_outbox order by created_at desc limit 100) o)
  );
end;
$$;

create or replace function public.icetak_admin_notification_summary()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.icetak_admin_can_manage_whatsapp() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'pending',(select count(*) from public.notification_queue where status='pending'),
    'processing',(select count(*) from public.notification_queue where status='processing'),
    'sent',(select count(*) from public.notification_queue where status='sent'),
    'failed',(select count(*) from public.notification_queue where status='failed'),
    'skipped',(select count(*) from public.notification_queue where status='skipped'),
    'recent_queue',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
      select id,event_type,phone,status,attempts,last_error,scheduled_at,sent_at,created_at,payload
      from public.notification_queue where status <> 'skipped'
      order by created_at desc limit 50
    ) x),
    'recent_skipped',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (
      select id,event_type,phone,status,attempts,last_error,scheduled_at,sent_at,created_at,payload
      from public.notification_queue where status='skipped'
      order by created_at desc limit 20
    ) x)
  );
end;
$$;

grant execute on function public.icetak_admin_whatsapp_snapshot() to authenticated;
grant execute on function public.icetak_admin_notification_summary() to authenticated;
