update public.whatsapp_notification_rules
set freeform_text = E'Hi,\nThis tracking number for your order\n\nTracking Number: {tracking_number}\nTrack here: {tracking_link}',
    updated_at = now()
where event_type = 'shipment_auto_tracking';
