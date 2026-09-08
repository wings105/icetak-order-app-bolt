begin;

update public.whatsapp_notification_rules
set freeform_text = E'Hi {customer_name},\n\nbayaran untuk order {order_id} telah diterima.\nKami akan proses order anda.\n\nCheck update order pada link:\n{order_link}\n\nTerima kasih.',
    updated_at = now()
where event_type = 'payment_received';

commit;
