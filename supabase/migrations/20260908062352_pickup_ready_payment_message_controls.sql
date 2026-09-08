begin;

alter table public.whatsapp_notification_rules
  add column if not exists freeform_text_paid text,
  add column if not exists freeform_text_unpaid text;

update public.whatsapp_notification_rules
set freeform_text_paid = coalesce(freeform_text_paid, E'Hi {customer_name},\n\norder {order_id} sudah siap untuk pickup.\nBayaran telah diterima.\n\nOrder anda boleh diambil di Pickup Box di luar kedai.\n\nLokasi:\nswiy.co/decocakePP\n\nTerima kasih.'),
    freeform_text_unpaid = coalesce(freeform_text_unpaid, E'Hi {customer_name},\n\norder {order_id} sudah siap untuk pickup.\nBayaran masih belum diterima.\n\nSila buat bayaran pada link:\n{payment_link}\n\nSelepas bayaran diterima, order boleh diambil di Pickup Box di luar kedai.\n\nTerima kasih.'),
    notes = 'Dalam 24H, sistem semak payment dan pilih wording Paid atau Unpaid. Selepas 24H, template Meta sedia ada dikekalkan.',
    updated_at = now()
where event_type = 'order_ready_pickup_auto';

create or replace function public.icetak_admin_whatsapp_save_rule(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  message_text text;
begin
  if not public.icetak_admin_can_manage_whatsapp() then raise exception 'forbidden'; end if;
  if nullif(ev,'') is null then raise exception 'event_type required'; end if;
  if jsonb_typeof(mapped_params) <> 'array' then raise exception 'template_params must be array'; end if;

  foreach message_text in array array[
    coalesce(p_payload->>'freeform_text',''),
    coalesce(p_payload->>'freeform_text_paid',''),
    coalesce(p_payload->>'freeform_text_unpaid','')
  ] loop
    select match_value[1] into unknown_field
    from regexp_matches(message_text, '\\{\\s*([a-zA-Z0-9_]+)\\s*\\}', 'g') as match_value
    where not (match_value[1] = any(array[
      'customer_name','phone','order_id','order_token','order_total','draft_total','followup_number',
      'date_need','order_link','payment_link','review_link','items_summary','pickup_order_count',
      'payment_status','delivery_method','tracking_number','courier','tracking_link','pickup_location',
      'otp','otp_code','magic_link','expiry_minutes','support_phone'
    ]::text[]))
    limit 1;
    if unknown_field is not null then raise exception 'unknown free-form field: %', unknown_field; end if;
  end loop;

  if use_template then
    if template_name_value is null then raise exception 'approved template required'; end if;
    select * into template_row
    from public.whatsapp_templates
    where name=template_name_value and language=language_value and upper(status)='APPROVED'
    limit 1;
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
    freeform_text_paid=case when p_payload ? 'freeform_text_paid' then p_payload->>'freeform_text_paid' else freeform_text_paid end,
    freeform_text_unpaid=case when p_payload ? 'freeform_text_unpaid' then p_payload->>'freeform_text_unpaid' else freeform_text_unpaid end,
    template_name=case when p_payload ? 'template_name' then template_name_value else template_name end,
    template_language=coalesce(nullif(p_payload->>'template_language',''),template_language),
    template_params=coalesce(p_payload->'template_params',template_params),
    available_fields=case when p_payload ? 'available_fields' then array(select jsonb_array_elements_text(p_payload->'available_fields')) else available_fields end,
    updated_at=now()
  where event_type=ev;
  if not found then raise exception 'rule not found'; end if;
  return jsonb_build_object('ok',true,'validation','OK','meta_params',meta_count,'mapped_params',mapped_count);
end;
$function$;

commit;
