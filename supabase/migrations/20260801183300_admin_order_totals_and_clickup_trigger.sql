-- Keep the generic admin create route correct and protected when an admin selects Paid.
create or replace function public.icetak_admin_create_order(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  username_value text;
  payload_value jsonb;
  result_value jsonb;
  order_uuid uuid;
  computed_total numeric;
  delivery_fee_value numeric:=greatest(0,coalesce(nullif(p_payload->>'delivery_fee','')::numeric,0));
begin
  if not public.icetak_admin_has_permission('create_order') then raise exception 'Forbidden'; end if;
  if lower(coalesce(p_payload->>'payment',''))='paid' and not public.icetak_admin_has_permission('verify_payments') then
    raise exception 'Forbidden: verify_payments';
  end if;
  select username into username_value from public.admin_users where auth_user_id=auth.uid() and is_active=true limit 1;
  select coalesce(sum(greatest(1,coalesce(nullif(item->>'qty','')::integer,1))*greatest(0,coalesce(nullif(item->>'price','')::numeric,0))),0)+delivery_fee_value
    into computed_total from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) item;
  payload_value := coalesce(p_payload,'{}'::jsonb) - 'session_token';
  payload_value := payload_value || jsonb_build_object(
    'source','admin','created_by',username_value,
    'notify_whatsapp',coalesce((p_payload->>'notify_whatsapp')::boolean,true),
    'total',coalesce(nullif(p_payload->>'total','')::numeric,computed_total)
  );
  result_value:=public.icetak_create_order(payload_value);
  order_uuid:=nullif(result_value->>'order_db_id','')::uuid;
  if order_uuid is not null then
    update public.orders set delivery_fee=delivery_fee_value,updated_at=now() where id=order_uuid;
    perform public.enqueue_clickup_production_order(order_uuid);
  end if;
  return result_value || jsonb_build_object('links',public.icetak_order_links(order_uuid));
end;
$$;

create or replace function public.icetak_admin_order_update(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  order_uuid uuid := nullif(p_payload->>'order_db_id','')::uuid;
  order_value public.orders%rowtype;
  item jsonb;
  username_value text;
  total_value numeric;
begin
  if not public.icetak_admin_has_permission('edit_order') then raise exception 'Forbidden'; end if;
  if order_uuid is null then raise exception 'order_db_id required'; end if;
  select * into order_value from public.orders where id=order_uuid;
  if order_value.id is null then raise exception 'Order not found'; end if;

  update public.orders set
    date_need=coalesce(nullif(p_payload->>'date_need','')::date,date_need),
    admin_remark=coalesce(p_payload->>'admin_remark',admin_remark),updated_at=now()
  where id=order_uuid;

  if jsonb_typeof(p_payload->'items')='array' then
    for item in select value from jsonb_array_elements(p_payload->'items') loop
      update public.order_items set
        qty=greatest(1,coalesce(nullif(item->>'qty','')::integer,qty)),
        price=greatest(0,coalesce(nullif(item->>'price','')::numeric,price)),
        custom_text=coalesce(item->>'custom_text',custom_text),wording=coalesce(item->>'custom_text',wording),
        design_preview_url=coalesce(item->>'design_preview_url',design_preview_url),updated_at=now()
      where id=nullif(item->>'id','')::uuid and order_id=order_uuid;
    end loop;
  end if;

  select coalesce(sum(coalesce(qty,1)*coalesce(price,0)),0)+coalesce(order_value.delivery_fee,0)
    into total_value from public.order_items where order_id=order_uuid;
  update public.orders set total=total_value,updated_at=now() where id=order_uuid;
  select username into username_value from public.admin_users where auth_user_id=auth.uid() and is_active=true limit 1;
  insert into public.admin_audit(order_db_id,order_id,action,actor)
  values(order_uuid::text,coalesce(order_value.order_id,order_value.order_no),'update_order',username_value);
  return jsonb_build_object('ok',true,'total',total_value);
end;
$$;

create or replace function public.production_components_enqueue_clickup_after_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
begin
  perform public.enqueue_clickup_production_order(new.order_id);
  return new;
end;
$$;
drop trigger if exists trg_components_enqueue_clickup_after_insert on public.production_components;
create trigger trg_components_enqueue_clickup_after_insert
after insert on public.production_components
for each row execute function public.production_components_enqueue_clickup_after_insert();
