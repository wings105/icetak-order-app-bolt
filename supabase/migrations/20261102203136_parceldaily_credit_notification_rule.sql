insert into public.whatsapp_notification_rules(event_type,label,enabled,freeform_text,template_name,template_language,template_params,freeform_enabled,template_enabled,notes)
values ('parceldaily_low_credit','ParcelDaily low credit — admin',true,'Kredit ParcelDaily rendah. Baki RM{{balance}}. Sila semak Shipping & Tracking.','icetak_parceldaily_credit_low_ms','ms','["balance"]'::jsonb,true,true,'One notification per low-credit episode; recipient uses admin order notification phone')
on conflict (event_type) do nothing;
