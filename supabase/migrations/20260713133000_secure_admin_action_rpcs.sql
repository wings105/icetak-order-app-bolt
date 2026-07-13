create or replace function public.icetak_admin_has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.admin_users u
    left join public.admin_permissions p on p.username=u.username
    where u.auth_user_id=auth.uid()
      and u.is_active=true
      and p_permission=any(coalesce(p.permissions,'{}'::text[]))
  );
$$;

create or replace function public.icetak_admin_create_order(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare username_value text; payload_value jsonb;
begin
  if not public.icetak_admin_has_permission('create_order') then raise exception 'Forbidden'; end if;
  select username into username_value from public.admin_users where auth_user_id=auth.uid() and is_active=true limit 1;
  payload_value := coalesce(p_payload,'{}'::jsonb) - 'session_token';
  payload_value := payload_value || jsonb_build_object('source','admin','created_by',username_value,'notify_whatsapp',coalesce((p_payload->>'notify_whatsapp')::boolean,true));
  return public.icetak_create_order(payload_value);
end;
$$;

create or replace function public.icetak_admin_order_action(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  order_value public.orders%rowtype;
  action_value text := lower(coalesce(p_payload->>'action',''));
  order_uuid uuid := nullif(p_payload->>'order_db_id','')::uuid;
  username_value text;
  payment_value text;
begin
  if order_uuid is null then raise exception 'order_db_id required'; end if;
  select * into order_value from public.orders where id=order_uuid;
  if order_value.id is null then raise exception 'Order not found'; end if;
  select username into username_value from public.admin_users where auth_user_id=auth.uid() and is_active=true limit 1;
  if action_value='approve_production' then
    if not public.icetak_admin_has_permission('approve_production') then raise exception 'Forbidden'; end if;
    if order_value.customer_confirm_token is not null and coalesce(order_value.customer_confirmed,false)=false then raise exception 'Customer belum confirm order'; end if;
    payment_value := lower(coalesce(order_value.payment,order_value.payment_status,''));
    if payment_value like '%unpaid%' or payment_value like '%pending%' or payment_value like '%to_pay%' then raise exception 'Payment belum diterima'; end if;
    update public.orders set production_approved=true,admin_status='Ready to Process',status='Production Started',tab='progress',updated_at=now() where id=order_uuid;
  elsif action_value='cancel' then
    if not public.icetak_admin_has_permission('cancel_order') then raise exception 'Forbidden'; end if;
    update public.orders set status='Cancelled',admin_status='Cancelled',tab='completed',updated_at=now() where id=order_uuid;
  else raise exception 'Unsupported action'; end if;
  insert into public.admin_audit(order_db_id,order_id,action,actor)
  values(order_uuid::text,coalesce(order_value.order_id,order_value.order_no),action_value,username_value);
  return jsonb_build_object('ok',true,'action',action_value,'order_db_id',order_uuid);
end;
$$;

create or replace function public.icetak_admin_order_update(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
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
  update public.orders set date_need=coalesce(nullif(p_payload->>'date_need','')::date,date_need),admin_remark=coalesce(p_payload->>'admin_remark',admin_remark),updated_at=now() where id=order_uuid;
  if jsonb_typeof(p_payload->'items')='array' then
    for item in select value from jsonb_array_elements(p_payload->'items') loop
      update public.order_items set qty=greatest(1,coalesce(nullif(item->>'qty','')::integer,qty)),price=greatest(0,coalesce(nullif(item->>'price','')::numeric,price)),custom_text=coalesce(item->>'custom_text',custom_text),wording=coalesce(item->>'custom_text',wording),design_preview_url=coalesce(item->>'design_preview_url',design_preview_url),updated_at=now()
      where id=nullif(item->>'id','')::uuid and order_id=order_uuid;
    end loop;
  end if;
  select coalesce(sum(coalesce(qty,1)*coalesce(price,0)),0) into total_value from public.order_items where order_id=order_uuid;
  update public.orders set total=total_value,updated_at=now() where id=order_uuid;
  select username into username_value from public.admin_users where auth_user_id=auth.uid() and is_active=true limit 1;
  insert into public.admin_audit(order_db_id,order_id,action,actor) values(order_uuid::text,coalesce(order_value.order_id,order_value.order_no),'update_order',username_value);
  return jsonb_build_object('ok',true,'total',total_value);
end;
$$;

create or replace function public.icetak_admin_save_permissions(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  target_username text := nullif(p_payload->>'username','');
  requested text[] := array(select jsonb_array_elements_text(coalesce(p_payload->'permissions','[]'::jsonb)));
  existing text[]; protected text[]; final_permissions text[];
begin
  if not public.icetak_admin_has_permission('manage_admins') then raise exception 'Forbidden'; end if;
  if target_username is null then raise exception 'username required'; end if;
  if not exists(select 1 from public.admin_users where username=target_username) then raise exception 'Admin not found'; end if;
  select coalesce(permissions,'{}'::text[]) into existing from public.admin_permissions where username=target_username limit 1;
  protected := array(select unnest(coalesce(existing,'{}'::text[])) intersect select unnest(array['manage_admins','manage_whatsapp']::text[]));
  final_permissions := array(select distinct value from unnest(coalesce(requested,'{}'::text[]) || coalesce(protected,'{}'::text[])) value order by value);
  insert into public.admin_permissions(username,permissions,created_at) values(target_username,final_permissions,now())
  on conflict(username) do update set permissions=excluded.permissions;
  return jsonb_build_object('ok',true,'username',target_username,'permissions',to_jsonb(final_permissions));
end;
$$;

create or replace function public.icetak_admin_export_data()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.icetak_admin_has_permission('export_data') then raise exception 'Forbidden'; end if;
  return jsonb_build_object('generated_at',now(),'orders',(select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at desc),'[]'::jsonb) from public.orders o),'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.updated_at desc nulls last),'[]'::jsonb) from public.order_items i));
end;
$$;

grant execute on function public.icetak_admin_has_permission(text) to authenticated;
grant execute on function public.icetak_admin_create_order(jsonb) to authenticated;
grant execute on function public.icetak_admin_order_action(jsonb) to authenticated;
grant execute on function public.icetak_admin_order_update(jsonb) to authenticated;
grant execute on function public.icetak_admin_save_permissions(jsonb) to authenticated;
grant execute on function public.icetak_admin_export_data() to authenticated;