alter table public.customers
  add column if not exists admin_name_override text,
  add column if not exists admin_name_updated_at timestamptz,
  add column if not exists admin_name_updated_by text;

create or replace function public.icetak_customers_preserve_admin_name()
returns trigger
language plpgsql
set search_path='public','pg_temp'
as $$
begin
  if nullif(btrim(coalesce(new.admin_name_override,'')),'') is not null then
    new.admin_name_override := btrim(new.admin_name_override);
    new.name := new.admin_name_override;
  elsif tg_op='UPDATE' and nullif(btrim(coalesce(old.admin_name_override,'')),'') is not null
        and new.admin_name_override is not distinct from old.admin_name_override then
    new.name := old.admin_name_override;
  end if;
  return new;
end;
$$;

drop trigger if exists icetak_customers_preserve_admin_name_trg on public.customers;
create trigger icetak_customers_preserve_admin_name_trg
before insert or update of name,admin_name_override on public.customers
for each row execute function public.icetak_customers_preserve_admin_name();

create or replace function public.icetak_orders_apply_customer_admin_name()
returns trigger
language plpgsql
set search_path='public','pg_temp'
as $$
declare v_name text;
begin
  if new.customer_id is not null then
    select nullif(btrim(c.admin_name_override),'') into v_name
    from public.customers c where c.id=new.customer_id;
    if v_name is not null then new.delivery_name:=v_name; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists icetak_orders_apply_customer_admin_name_trg on public.orders;
create trigger icetak_orders_apply_customer_admin_name_trg
before insert on public.orders
for each row execute function public.icetak_orders_apply_customer_admin_name();

create or replace function public.icetak_admin_customer_profile(p_order_db_id uuid)
returns jsonb
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
declare o public.orders%rowtype; c public.customers%rowtype; cm public.customer_master%rowtype;
begin
  if not exists(select 1 from public.admin_users a where a.auth_user_id=auth.uid() and a.is_active=true) then raise exception 'Unauthorized'; end if;
  select * into o from public.orders where id=p_order_db_id;
  if o.id is null then raise exception 'Order not found'; end if;
  select * into c from public.customers where id=o.customer_id;
  if c.id is null then return jsonb_build_object('customer_id',null,'name',coalesce(o.delivery_name,''),'phone',coalesce(o.delivery_phone,''),'locked',false); end if;
  if c.customer_master_id is not null then select * into cm from public.customer_master where id=c.customer_master_id; end if;
  return jsonb_build_object(
    'customer_id',c.id,'customer_master_id',c.customer_master_id,'name',coalesce(nullif(c.admin_name_override,''),nullif(c.name,''),nullif(o.delivery_name,''),'Customer'),
    'phone',coalesce(nullif(c.phone,''),nullif(o.delivery_phone,'')),
    'locked',nullif(c.admin_name_override,'') is not null,
    'admin_name_override',c.admin_name_override,
    'admin_name_updated_at',c.admin_name_updated_at,
    'admin_name_updated_by',c.admin_name_updated_by,
    'master_display_name',cm.display_name,
    'source',c.source
  );
end;
$$;

create or replace function public.icetak_admin_customer_profile_update(p_order_db_id uuid,p_display_name text,p_clear_override boolean default false)
returns jsonb
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
declare o public.orders%rowtype; c public.customers%rowtype; v_name text:=nullif(btrim(coalesce(p_display_name,'')),''); v_actor text;
begin
  if not public.icetak_admin_has_permission('edit_order') then raise exception 'Forbidden'; end if;
  select username into v_actor from public.admin_users where auth_user_id=auth.uid() and is_active=true limit 1;
  select * into o from public.orders where id=p_order_db_id for update;
  if o.id is null then raise exception 'Order not found'; end if;
  select * into c from public.customers where id=o.customer_id for update;
  if c.id is null then raise exception 'Customer profile not found'; end if;
  if not coalesce(p_clear_override,false) and v_name is null then raise exception 'Customer name is required'; end if;
  if v_name is not null and length(v_name)>200 then raise exception 'Customer name cannot exceed 200 characters'; end if;

  if coalesce(p_clear_override,false) then
    update public.customers set admin_name_override=null,admin_name_updated_at=now(),admin_name_updated_by=v_actor,updated_at=now() where id=c.id;
  else
    update public.customers set admin_name_override=v_name,name=v_name,admin_name_updated_at=now(),admin_name_updated_by=v_actor,updated_at=now() where id=c.id;
    if c.customer_master_id is not null then
      update public.customer_master set display_name=v_name,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('admin_name_override',v_name,'admin_name_updated_by',v_actor,'admin_name_updated_at',now()),
        updated_at=now()
      where id=c.customer_master_id;
    end if;
  end if;

  insert into public.admin_audit(order_db_id,order_id,action,actor,payload)
  values(o.id::text,coalesce(o.order_no,o.order_id),'update_customer_profile',v_actor,jsonb_build_object(
    'customer_id',c.id,'customer_master_id',c.customer_master_id,'previous_name',c.name,'previous_admin_name_override',c.admin_name_override,
    'new_admin_name_override',case when coalesce(p_clear_override,false) then null else v_name end,'clear_override',coalesce(p_clear_override,false)
  ));
  return public.icetak_admin_customer_profile(p_order_db_id);
end;
$$;

revoke all on function public.icetak_admin_customer_profile(uuid) from public,anon;
grant execute on function public.icetak_admin_customer_profile(uuid) to authenticated;
revoke all on function public.icetak_admin_customer_profile_update(uuid,text,boolean) from public,anon;
grant execute on function public.icetak_admin_customer_profile_update(uuid,text,boolean) to authenticated;
