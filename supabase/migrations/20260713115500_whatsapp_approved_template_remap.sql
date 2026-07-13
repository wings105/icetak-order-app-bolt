begin;

update public.whatsapp_notification_rules
set template_name='order_ready_pickup_notice', template_language='ms', template_enabled=true,
    prefer_template_when_closed=true,
    template_params=jsonb_build_array('customer_name','order_id','pickup_location'),
    notes=null, updated_at=now()
where event_type='order_ready_pickup';

update public.whatsapp_notification_rules
set template_name='production_started_notice', template_language='ms', template_enabled=true,
    prefer_template_when_closed=true,
    template_params=jsonb_build_array('customer_name','order_id'),
    notes=null, updated_at=now()
where event_type='production_started';

update public.whatsapp_notification_rules
set template_name='review_ready_notice', template_language='ms', template_enabled=true,
    prefer_template_when_closed=true,
    template_params=jsonb_build_array('customer_name','order_id','review_link'),
    notes=null, updated_at=now()
where event_type='review_ready';

update public.whatsapp_notification_rules
set template_name='order_delivered_notice_ms', template_language='ms', template_enabled=true,
    prefer_template_when_closed=true,
    template_params=jsonb_build_array('customer_name','order_id'),
    notes=null, updated_at=now()
where event_type='order_delivered';

update public.whatsapp_notification_rules
set template_enabled=false, prefer_template_when_closed=false,
    notes='Template Meta order_cancelled_notice belum APPROVED/disync.', updated_at=now()
where event_type='order_cancelled';

update public.whatsapp_settings
set text_value='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/wasapflow-proxy', updated_at=now()
where key='base_url';

insert into public.whatsapp_settings(key,text_value,created_at,updated_at)
values('wasapflow_official_base_url','https://officialapi.wasapflow.com/bridge/v1',now(),now())
on conflict (key) do update set text_value=excluded.text_value,updated_at=now();

commit;