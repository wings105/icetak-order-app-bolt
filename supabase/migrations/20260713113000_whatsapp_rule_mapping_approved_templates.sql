begin;

update public.whatsapp_notification_rules
set freeform_text = replace(freeform_text, E'\\n', E'\n'), updated_at=now()
where freeform_text like '%\\n%';

update public.whatsapp_notification_rules
set label='Customer Login OTP / Magic Link', enabled=true, freeform_enabled=true, template_enabled=true,
    prefer_template_when_closed=true,
    freeform_text=E'Hi {customer_name}, kod login iCetak anda ialah {otp_code}.\n\nKod sah selama 10 minit. Anda juga boleh guna link ini:\n{magic_link}\n\nTerima kasih.',
    template_name='customer_login_otp', template_language='ms',
    template_params=jsonb_build_array('otp_code'),
    notes='Dalam 24H hantar OTP + magic link sebagai free-form. Selepas 24H hantar template Authentication OTP.',
    updated_at=now()
where event_type='customer_login';

update public.whatsapp_notification_rules
set label='Customer Login OTP', enabled=true, freeform_enabled=true, template_enabled=true,
    prefer_template_when_closed=true,
    freeform_text=E'Kod login iCetak anda ialah {otp_code}.\n\nKod sah selama 10 minit.',
    template_name='customer_login_otp', template_language='ms',
    template_params=jsonb_build_array('otp_code'),
    notes='Authentication template Meta hanya mempunyai satu parameter OTP.',
    updated_at=now()
where event_type='customer_login_otp';

update public.whatsapp_notification_rules
set label='Legacy Magic Login (Disabled)', enabled=false, freeform_enabled=false, template_enabled=false,
    prefer_template_when_closed=false, template_name=null, template_params='[]'::jsonb,
    notes='Rule duplicate lama. Customer login sebenar menggunakan event customer_login.', updated_at=now()
where event_type='magic_login';

update public.whatsapp_notification_rules
set template_name='order_created', template_language='ms', template_enabled=true,
    prefer_template_when_closed=true,
    template_params=jsonb_build_array('customer_name','order_id','order_total','date_need','order_link'), updated_at=now()
where event_type='order_created';

update public.whatsapp_notification_rules
set template_name='payment_pending', template_language='ms', template_enabled=true,
    prefer_template_when_closed=true,
    template_params=jsonb_build_array('customer_name','order_id','order_total','payment_link'), updated_at=now()
where event_type='payment_pending';

update public.whatsapp_notification_rules
set template_name='order_paid_notice', template_language='ms', template_enabled=true,
    prefer_template_when_closed=true,
    template_params=jsonb_build_array('customer_name','order_id','order_total'), updated_at=now()
where event_type='payment_received';

update public.whatsapp_notification_rules
set template_name='order_shipped_notice_ms', template_language='ms', template_enabled=true,
    prefer_template_when_closed=true,
    template_params=jsonb_build_array('customer_name','order_id','courier','tracking_number','tracking_link'), updated_at=now()
where event_type='order_shipped';

update public.whatsapp_notification_rules
set template_name='order_delivered_notice', template_language='en', template_enabled=true,
    prefer_template_when_closed=true,
    template_params=jsonb_build_array('customer_name','order_id'),
    notes='Template Meta ini tersimpan sebagai language en walaupun wording Melayu. Guna en sehingga versi ms dibuat.', updated_at=now()
where event_type='order_delivered';

update public.whatsapp_notification_rules
set template_enabled=false, prefer_template_when_closed=false,
    notes='Template selepas 24H dimatikan sehingga template Meta APPROVED dan disync.', updated_at=now()
where event_type in ('order_cancelled','order_ready_pickup','production_started','review_ready');

commit;