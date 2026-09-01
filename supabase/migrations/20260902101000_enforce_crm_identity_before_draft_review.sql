-- Customer details on AI/chat drafts must come from iCetak CRM before the
-- WhatsApp profile. The function is safe when CRM has no match.
create or replace function public.icetak_apply_crm_customer_to_draft_payload(
  p_customer_phone text, p_fallback_name text, p_payload jsonb
) returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $function$
declare
  v_phone text:=nullif(public.icetak_normalize_phone(p_customer_phone),'');
  v_payload jsonb:=coalesce(p_payload,'{}'::jsonb);
  v_customer jsonb:=coalesce(p_payload->'customer','{}'::jsonb);
  v_master_id uuid; v_customer_id uuid; v_name text; v_address record; v_address_id uuid;
begin
  if v_phone is not null then
    select cm.id,c.id,coalesce(nullif(btrim(cm.admin_name_override),''),nullif(btrim(c.admin_name_override),''),nullif(btrim(c.name),''),nullif(btrim(cm.display_name),''))
      into v_master_id,v_customer_id,v_name
      from public.customer_master cm left join public.customers c on c.customer_master_id=cm.id
     where cm.merged_into_id is null and (cm.primary_phone_normalized=v_phone
       or exists(select 1 from public.customer_identifiers_master i where i.customer_master_id=cm.id and i.identifier_type='phone' and i.normalized_value=v_phone and i.scope='global')
       or public.icetak_normalize_phone(c.phone)=v_phone)
     order by case when nullif(btrim(cm.admin_name_override),'') is not null then 0 else 1 end,
              case when nullif(btrim(c.admin_name_override),'') is not null then 0 else 1 end,
              c.updated_at desc nulls last,cm.updated_at desc nulls last limit 1;
  end if;
  v_name:=coalesce(v_name,nullif(btrim(p_fallback_name),''),nullif(btrim(v_customer->>'name'),''));
  v_customer:=v_customer||jsonb_strip_nulls(jsonb_build_object('name',v_name,'phone',coalesce(v_phone,nullif(btrim(v_customer->>'phone'),''))));
  if v_master_id is not null and lower(coalesce(v_payload->>'delivery',''))<>'pickup' then
    select a.* into v_address from public.customer_addresses a
     where a.archived_at is null and (a.customer_master_id=v_master_id or (v_customer_id is not null and a.customer_id=v_customer_id))
       and nullif(btrim(a.address_line1),'') is not null and a.postcode~'^[0-9]{5}$'
       and nullif(btrim(a.city),'') is not null and nullif(btrim(a.state),'') is not null
     order by a.is_default desc,a.is_verified desc,a.last_used_at desc nulls last,a.updated_at desc nulls last limit 1;
    if found then
      v_address_id:=v_address.id;
      v_customer:=v_customer||jsonb_strip_nulls(jsonb_build_object('address_id',v_address_id,'name',coalesce(v_name,nullif(btrim(v_address.recipient_name),'')),'phone',coalesce(v_phone,nullif(btrim(v_address.phone),'')),'address_line1',v_address.address_line1,'address_line2',nullif(btrim(v_address.address_line2),''),'postcode',v_address.postcode,'city',v_address.city,'state',v_address.state,'country',coalesce(nullif(btrim(v_address.country),''),'Malaysia')));
    end if;
  end if;
  v_payload:=jsonb_set(v_payload,'{customer}',v_customer,true);
  v_payload:=jsonb_set(v_payload,'{crm_customer_resolution}',jsonb_strip_nulls(jsonb_build_object('customer_master_id',v_master_id,'customer_id',v_customer_id,'address_id',v_address_id,'resolved_at',now())),true);
  return jsonb_build_object('payload',v_payload,'customer_phone',coalesce(v_phone,nullif(btrim(v_customer->>'phone'),'')),'customer_name',coalesce(v_name,nullif(btrim(v_customer->>'name'),'')),'customer_master_id',v_master_id,'address_id',v_address_id);
end;
$function$;

-- Inject resolution in the shared generic-draft gateway before an order session
-- and the admin-review record are created.
do $do$
declare fn oid; def text;
begin
  select p.oid into fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='icetak_create_generic_order_draft'
     and pg_get_function_identity_arguments(p.oid)='p_source_type text, p_conversation_id uuid, p_customer_phone text, p_customer_name text, p_payload jsonb, p_request_key text, p_cutoff_at timestamp with time zone, p_trigger_message_id uuid, p_payment_mode text, p_actor text';
  if fn is null then raise exception 'generic draft gateway not found'; end if;
  def:=pg_get_functiondef(fn);
  if position('icetak_apply_crm_customer_to_draft_payload' in def)>0 then return; end if;
  if position('pmode text:=lower(coalesce(nullif(p_payment_mode,''),''prepaid''));' in def)=0
     or position('s:=public.icetak_open_order_session' in def)=0 then
    raise exception 'generic draft CRM injection point not found';
  end if;
  def:=replace(def,'pmode text:=lower(coalesce(nullif(p_payment_mode,''),''prepaid''));','pmode text:=lower(coalesce(nullif(p_payment_mode,''),''prepaid'')); resolved jsonb;');
  def:=replace(def,'s:=public.icetak_open_order_session','resolved:=public.icetak_apply_crm_customer_to_draft_payload(p_customer_phone,p_customer_name,p_payload); p_payload:=resolved->''payload''; p_customer_phone:=resolved->>''customer_phone''; p_customer_name:=resolved->>''customer_name'';
  s:=public.icetak_open_order_session');
  execute def;
end $do$;

revoke all on function public.icetak_apply_crm_customer_to_draft_payload(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.icetak_apply_crm_customer_to_draft_payload(text,text,jsonb) to service_role;
