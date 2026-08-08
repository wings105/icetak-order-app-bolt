-- Enterprise Orders V2: indexes, saved views, bulk-safe controls and richer audit payloads.

create index if not exists idx_orders_date_need on public.orders(date_need);
create index if not exists idx_orders_created_at_desc on public.orders(created_at desc);
create index if not exists idx_orders_updated_at_desc on public.orders(updated_at desc);
create index if not exists idx_orders_payment_verified_at_desc on public.orders(payment_verified_at desc);
create index if not exists idx_payment_transactions_order_paid on public.payment_transactions(order_id, paid_at desc);
create index if not exists idx_notification_queue_order_created on public.notification_queue(order_id, created_at desc);
create index if not exists idx_admin_audit_order_created on public.admin_audit(order_db_id, created_at desc);

create table if not exists public.admin_order_saved_views (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null,
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  sort_key text not null default 'urgency',
  sort_dir text not null default 'asc',
  visible_columns text[] not null default array['created','need','customer','items','payment','delivery','production','whatsapp','updated','action']::text[],
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(auth_user_id,name)
);

alter table public.admin_order_saved_views enable row level security;
revoke all on public.admin_order_saved_views from anon, authenticated;

create or replace function public.icetak_admin_order_saved_views()
returns jsonb language sql security definer set search_path to 'public','pg_temp' as $$
  select case when exists(select 1 from public.admin_users where auth_user_id=auth.uid() and is_active=true)
    then coalesce((select jsonb_agg(jsonb_build_object(
      'id',v.id,'name',v.name,'filters',v.filters,'sortKey',v.sort_key,'sortDir',v.sort_dir,
      'visibleColumns',v.visible_columns,'isDefault',v.is_default,'updatedAt',v.updated_at
    ) order by v.is_default desc,v.name) from public.admin_order_saved_views v where v.auth_user_id=auth.uid()),'[]'::jsonb)
    else '[]'::jsonb end;
$$;

create or replace function public.icetak_admin_order_saved_view_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  view_id uuid;
  view_name text:=left(trim(coalesce(p_payload->>'name','')),60);
  cols text[];
  result_row public.admin_order_saved_views%rowtype;
begin
  if not exists(select 1 from public.admin_users where auth_user_id=auth.uid() and is_active=true) then raise exception 'Unauthorized'; end if;
  if view_name='' then raise exception 'View name required'; end if;
  begin view_id:=nullif(p_payload->>'id','')::uuid; exception when invalid_text_representation then view_id:=null; end;
  select coalesce(array_agg(value),array[]::text[]) into cols from jsonb_array_elements_text(coalesce(p_payload->'visibleColumns','[]'::jsonb));
  if coalesce(array_length(cols,1),0)=0 then cols:=array['created','need','customer','items','payment','delivery','production','whatsapp','updated','action']; end if;
  if coalesce((p_payload->>'isDefault')::boolean,false) then update public.admin_order_saved_views set is_default=false,updated_at=now() where auth_user_id=auth.uid(); end if;

  if view_id is not null then
    update public.admin_order_saved_views set name=view_name,filters=coalesce(p_payload->'filters','{}'::jsonb),sort_key=coalesce(nullif(p_payload->>'sortKey',''),'urgency'),sort_dir=case when lower(p_payload->>'sortDir')='desc' then 'desc' else 'asc' end,visible_columns=cols,is_default=coalesce((p_payload->>'isDefault')::boolean,false),updated_at=now()
    where id=view_id and auth_user_id=auth.uid() returning * into result_row;
  else
    insert into public.admin_order_saved_views(auth_user_id,name,filters,sort_key,sort_dir,visible_columns,is_default)
    values(auth.uid(),view_name,coalesce(p_payload->'filters','{}'::jsonb),coalesce(nullif(p_payload->>'sortKey',''),'urgency'),case when lower(p_payload->>'sortDir')='desc' then 'desc' else 'asc' end,cols,coalesce((p_payload->>'isDefault')::boolean,false))
    on conflict(auth_user_id,name) do update set filters=excluded.filters,sort_key=excluded.sort_key,sort_dir=excluded.sort_dir,visible_columns=excluded.visible_columns,is_default=excluded.is_default,updated_at=now()
    returning * into result_row;
  end if;
  if result_row.id is null then raise exception 'Saved view not found'; end if;
  return jsonb_build_object('id',result_row.id,'name',result_row.name,'filters',result_row.filters,'sortKey',result_row.sort_key,'sortDir',result_row.sort_dir,'visibleColumns',result_row.visible_columns,'isDefault',result_row.is_default);
end;$$;

create or replace function public.icetak_admin_order_saved_view_delete(p_id uuid)
returns boolean language plpgsql security definer set search_path to 'public','pg_temp' as $$
begin
  if not exists(select 1 from public.admin_users where auth_user_id=auth.uid() and is_active=true) then raise exception 'Unauthorized'; end if;
  delete from public.admin_order_saved_views where id=p_id and auth_user_id=auth.uid();
  return found;
end;$$;

create or replace function public.icetak_admin_orders_bulk_whatsapp(p_order_ids uuid[],p_enabled boolean)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare actor_value text; changed_count integer:=0; queue_count integer:=0; outbox_count integer:=0;
begin
  if not (public.icetak_admin_has_permission('edit_order') or public.icetak_admin_can_manage_whatsapp()) then raise exception 'Forbidden'; end if;
  if coalesce(array_length(p_order_ids,1),0)=0 then return jsonb_build_object('changed',0,'cancelledPending',0); end if;
  if array_length(p_order_ids,1)>100 then raise exception 'Maximum 100 orders per bulk action'; end if;
  select username into actor_value from public.admin_users where auth_user_id=auth.uid() and is_active=true limit 1;
  update public.orders set whatsapp_opt_in=coalesce(p_enabled,false),updated_at=now() where id=any(p_order_ids); get diagnostics changed_count=row_count;
  if not coalesce(p_enabled,false) then
    update public.notification_queue set status='skipped',processed_at=now(),locked_at=null,decision_mode='skipped',decision_reason='order_disabled_by_admin_bulk',last_error=null where order_id=any(p_order_ids) and status='pending'; get diagnostics queue_count=row_count;
    update public.notification_outbox n set status='skipped',error_code='order_whatsapp_disabled',error_message='Disabled by admin bulk action' where n.status='pending' and exists(select 1 from public.orders o where o.id=any(p_order_ids) and (n.order_id=o.order_no or n.order_id=o.order_id or n.order_token=o.public_token)); get diagnostics outbox_count=row_count;
  end if;
  insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
  select o.id::text,coalesce(o.order_no,o.order_id),case when coalesce(p_enabled,false) then 'whatsapp_enabled_bulk' else 'whatsapp_disabled_bulk' end,coalesce(actor_value,'admin'),jsonb_build_object('enabled',coalesce(p_enabled,false)) from public.orders o where o.id=any(p_order_ids);
  return jsonb_build_object('changed',changed_count,'cancelledPending',queue_count+outbox_count,'enabled',coalesce(p_enabled,false));
end;$$;

create or replace function public.icetak_admin_order_update(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  order_uuid uuid := nullif(p_payload->>'order_db_id','')::uuid;
  order_value public.orders%rowtype;
  item jsonb; username_value text; total_value numeric; before_items jsonb; after_items jsonb; before_order jsonb; after_order jsonb;
begin
  if not public.icetak_admin_has_permission('edit_order') then raise exception 'Forbidden'; end if;
  if order_uuid is null then raise exception 'order_db_id required'; end if;
  select * into order_value from public.orders where id=order_uuid;
  if order_value.id is null then raise exception 'Order not found'; end if;
  before_order:=jsonb_build_object('dateNeed',order_value.date_need,'adminRemark',order_value.admin_remark,'total',order_value.total);
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'qty',i.qty,'price',i.price,'customText',coalesce(i.custom_text,i.wording,''),'previewUrl',coalesce(i.design_preview_url,'')) order by i.id),'[]'::jsonb) into before_items from public.order_items i where i.order_id=order_uuid;
  update public.orders set date_need=coalesce(nullif(p_payload->>'date_need','')::date,date_need),admin_remark=coalesce(p_payload->>'admin_remark',admin_remark),updated_at=now() where id=order_uuid;
  if jsonb_typeof(p_payload->'items')='array' then
    for item in select value from jsonb_array_elements(p_payload->'items') loop
      update public.order_items set qty=greatest(1,coalesce(nullif(item->>'qty','')::integer,qty)),price=greatest(0,coalesce(nullif(item->>'price','')::numeric,price)),custom_text=coalesce(item->>'custom_text',custom_text),wording=coalesce(item->>'custom_text',wording),design_preview_url=coalesce(item->>'design_preview_url',design_preview_url),updated_at=now()
      where id=nullif(item->>'id','')::uuid and order_id=order_uuid;
    end loop;
  end if;
  select coalesce(sum(coalesce(qty,1)*coalesce(price,0)),0)+coalesce(order_value.delivery_fee,0) into total_value from public.order_items where order_id=order_uuid;
  update public.orders set total=total_value,updated_at=now() where id=order_uuid;
  select * into order_value from public.orders where id=order_uuid;
  after_order:=jsonb_build_object('dateNeed',order_value.date_need,'adminRemark',order_value.admin_remark,'total',order_value.total);
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'qty',i.qty,'price',i.price,'customText',coalesce(i.custom_text,i.wording,''),'previewUrl',coalesce(i.design_preview_url,'')) order by i.id),'[]'::jsonb) into after_items from public.order_items i where i.order_id=order_uuid;
  select username into username_value from public.admin_users where auth_user_id=auth.uid() and is_active=true limit 1;
  insert into public.admin_audit(order_db_id,order_id,action,actor,payload) values(order_uuid::text,coalesce(order_value.order_id,order_value.order_no),'update_order',username_value,jsonb_build_object('before',jsonb_build_object('order',before_order,'items',before_items),'after',jsonb_build_object('order',after_order,'items',after_items)));
  return jsonb_build_object('ok',true,'total',total_value);
end;$$;

revoke execute on function public.icetak_admin_order_saved_views() from public,anon;
revoke execute on function public.icetak_admin_order_saved_view_save(jsonb) from public,anon;
revoke execute on function public.icetak_admin_order_saved_view_delete(uuid) from public,anon;
revoke execute on function public.icetak_admin_orders_bulk_whatsapp(uuid[],boolean) from public,anon;
grant execute on function public.icetak_admin_order_saved_views() to authenticated;
grant execute on function public.icetak_admin_order_saved_view_save(jsonb) to authenticated;
grant execute on function public.icetak_admin_order_saved_view_delete(uuid) to authenticated;
grant execute on function public.icetak_admin_orders_bulk_whatsapp(uuid[],boolean) to authenticated;
