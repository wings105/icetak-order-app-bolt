alter table public.order_items add column if not exists sort_index integer;

with ranked as (
  select id,row_number() over(partition by order_id order by id)::integer rn
  from public.order_items
)
update public.order_items i set sort_index=r.rn
from ranked r where r.id=i.id and i.sort_index is null;

create index if not exists order_items_order_sort_index_idx on public.order_items(order_id,sort_index,id);

create or replace function public.icetak_assign_order_item_sort_index()
returns trigger language plpgsql set search_path to 'public','pg_temp' as $$
begin
  if new.sort_index is null or new.sort_index<1 then
    select coalesce(max(i.sort_index),0)+1 into new.sort_index from public.order_items i where i.order_id=new.order_id;
  end if;
  return new;
end;$$;

drop trigger if exists trg_icetak_assign_order_item_sort_index on public.order_items;
create trigger trg_icetak_assign_order_item_sort_index before insert on public.order_items
for each row execute function public.icetak_assign_order_item_sort_index();

alter table public.production_components add column if not exists clickup_link_source text not null default 'auto';
update public.production_components set clickup_link_source='auto' where clickup_link_source is null or btrim(clickup_link_source)='';

create or replace function public.icetak_admin_order_thumbnails(p_order_ids uuid[])
returns table(order_id uuid,thumbnail_url text)
language plpgsql security definer set search_path to 'public','pg_temp' as $$
begin
  if not exists(select 1 from public.admin_users where auth_user_id=auth.uid() and is_active=true) then raise exception 'Unauthorized'; end if;
  return query
  select x.order_id,(
    select coalesce(nullif(btrim(i.design_preview_url),''),nullif(btrim(i.product_snapshot->>'image_url'),''),nullif(btrim(i.customization->>'image_url'),''))
    from public.order_items i
    where i.order_id=x.order_id
      and coalesce(nullif(btrim(i.design_preview_url),''),nullif(btrim(i.product_snapshot->>'image_url'),''),nullif(btrim(i.customization->>'image_url'),'')) is not null
    order by coalesce(i.sort_index,2147483647),i.id limit 1
  ) thumbnail_url
  from unnest(coalesce(p_order_ids,array[]::uuid[])) x(order_id);
end;$$;
revoke all on function public.icetak_admin_order_thumbnails(uuid[]) from public,anon;
grant execute on function public.icetak_admin_order_thumbnails(uuid[]) to authenticated,service_role;

create or replace function public.icetak_admin_link_clickup_component(p_component_id uuid,p_task_ref text)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare
  v_component public.production_components%rowtype;
  v_task_id text; v_task_url text; v_result jsonb; v_outbox_status text; v_locked_at timestamptz;
begin
  if not exists(select 1 from public.admin_users where auth_user_id=auth.uid() and is_active=true) then raise exception 'Unauthorized'; end if;
  select * into v_component from public.production_components where id=p_component_id;
  if not found then raise exception 'Component not found'; end if;
  if nullif(btrim(coalesce(p_task_ref,'')),'') is null then raise exception 'ClickUp task ID or URL required'; end if;

  select status,locked_at into v_outbox_status,v_locked_at from public.integration_outbox
  where order_id=v_component.order_id and provider='activepieces' and event_type='clickup.production.create'
  order by created_at desc limit 1;
  if v_outbox_status='processing' and v_locked_at is not null and v_locked_at>now()-interval '3 minutes' then
    raise exception 'Auto ClickUp creation is processing now. Wait a moment before manual link.';
  elsif v_outbox_status='processing' then
    update public.integration_outbox set status='retry',locked_at=null,next_attempt_at=now(),last_error=coalesce(last_error,'stale_processing_lease_recovered_before_manual_link')
    where order_id=v_component.order_id and provider='activepieces' and event_type='clickup.production.create' and status='processing';
  end if;

  v_task_id:=btrim(p_task_ref);
  if lower(v_task_id) like 'http%' then
    v_task_url:=v_task_id;
    v_task_id:=regexp_replace(v_task_id,'^.*/t/(?:[0-9]+/)?([^/?#]+).*$','\1');
  else
    v_task_url:='https://app.clickup.com/t/3747262/'||v_task_id;
  end if;
  if v_task_id is null or v_task_id='' or v_task_id like 'http%' then raise exception 'Invalid ClickUp task ID or URL'; end if;

  v_result:=public.link_clickup_production_task(v_component.order_id::text,p_component_id,v_task_id,'18375902',v_task_url,null);
  update public.production_components set clickup_link_source='manual',updated_at=now() where id=p_component_id;
  return coalesce(v_result,'{}'::jsonb)||jsonb_build_object('manual',true,'task_url',v_task_url,'task_id',v_task_id);
end;$$;
revoke all on function public.icetak_admin_link_clickup_component(uuid,text) from public,anon;
grant execute on function public.icetak_admin_link_clickup_component(uuid,text) to authenticated,service_role;

create or replace function public.icetak_admin_retry_clickup_component(p_component_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_component public.production_components%rowtype; v_order public.orders%rowtype; v_outbox uuid;
begin
  if not exists(select 1 from public.admin_users where auth_user_id=auth.uid() and is_active=true) then raise exception 'Unauthorized'; end if;
  select * into v_component from public.production_components where id=p_component_id;
  if not found then raise exception 'Component not found'; end if;
  if nullif(btrim(coalesce(v_component.clickup_task_id,'')),'') is not null then return jsonb_build_object('ok',true,'queued',false,'reason','already_linked','task_id',v_component.clickup_task_id); end if;
  select * into v_order from public.orders where id=v_component.order_id;
  if not public.icetak_order_is_production_ready(v_order) then return jsonb_build_object('ok',true,'queued',false,'reason','order_not_production_ready'); end if;
  update public.production_components set clickup_link_source='auto',updated_at=now() where id=p_component_id;
  v_outbox:=public.enqueue_clickup_production_order(v_component.order_id);
  return jsonb_build_object('ok',true,'queued',v_outbox is not null,'outbox_id',v_outbox);
end;$$;
revoke all on function public.icetak_admin_retry_clickup_component(uuid) from public,anon;
grant execute on function public.icetak_admin_retry_clickup_component(uuid) to authenticated,service_role;

do $$
declare v text;
begin
  select pg_get_functiondef('public.icetak_admin_order_detail_v2(text)'::regprocedure) into v;
  if position('order by i.updated_at nulls last,i.id' in v)>0 then
    v:=replace(v,'order by i.updated_at nulls last,i.id','order by coalesce(i.sort_index,2147483647),i.id'); execute v;
  end if;
  select pg_get_functiondef('public.icetak_customer_order_dashboard(text)'::regprocedure) into v;
  if position(') order by i.id)' in v)>0 then
    v:=replace(v,') order by i.id)',') order by coalesce(i.sort_index,2147483647),i.id)'); execute v;
  end if;
end$$;

update public.integration_outbox o set status='processed',processed_at=coalesce(processed_at,now()),sent_at=coalesce(sent_at,now()),locked_at=null,last_error=null,error=null
where o.provider='activepieces' and o.event_type='clickup.production.create' and o.status in ('pending','retry','processing')
  and not exists(select 1 from public.production_components pc where pc.order_id=o.order_id and nullif(btrim(coalesce(pc.clickup_task_id,'')),'') is null);
