-- Application configuration only: install a dedicated, admin-editable pickup
-- confirmation notification without changing any existing notification rule.
insert into public.whatsapp_notification_rules (
  event_type,
  label,
  enabled,
  prefer_template_when_closed,
  freeform_text,
  template_name,
  template_language,
  template_params,
  sort_order,
  trigger_status,
  notes,
  available_fields,
  freeform_enabled,
  template_enabled
)
select
  'pickup_order_confirmed',
  'Pickup Order Confirmed & Payment Link',
  true,
  source.prefer_template_when_closed,
  $pickup$Hi {customer_name} 👋

Tempahan pickup anda telah disahkan.

📅 Tarikh: {date_need}
📍 Pengambilan: Pickup
🧾 Order: {order_id}

*Item tempahan:*
{items_summary}

*Jumlah: {order_total}*
*Payment: {payment_status}*

Semak order:
{order_link}

Nak bayar sekarang? Tekan link ini:
{payment_link}

Terima kasih kerana memilih DecoCake.my 😊$pickup$,
  source.template_name,
  source.template_language,
  source.template_params,
  source.sort_order + 1,
  'Admin confirms pickup and chooses Send Link',
  'Sent only from Confirm Pickup & Send Link. The original pickup button never sends this message.',
  array[
    'customer_name','phone','order_id','order_token','order_total','date_need',
    'order_link','payment_link','items_summary','payment_status','delivery_method',
    'pickup_location','support_phone'
  ],
  true,
  source.template_enabled
from public.whatsapp_notification_rules as source
where source.event_type = 'order_created'
on conflict (event_type) do nothing;
