-- Burn Away stays one commercial order item, with independent edible/wafer production specs.
alter table public.production_components
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create or replace function public.icetak_burnaway_component_metadata(
  p_item public.order_items,
  p_component_type text
) returns jsonb
language sql
stable
as $function$
  select case
    when lower(coalesce(p_item.k,p_item.product_type,'')) <> 'burnaway' then '{}'::jsonb
    else jsonb_strip_nulls(jsonb_build_object(
      'size', coalesce(nullif(p_item.customization#>>array['layers',lower(p_component_type),'size'],''),nullif(p_item.size,'')),
      'shape', coalesce(nullif(p_item.customization#>>array['layers',lower(p_component_type),'shape'],''),nullif(p_item.style,'')),
      'wording', coalesce(nullif(p_item.customization#>>array['layers',lower(p_component_type),'wording'],''),nullif(p_item.wording,''),nullif(p_item.custom_text,'')),
      'reference_url', coalesce(nullif(p_item.customization#>>array['layers',lower(p_component_type),'referenceUrl'],''),nullif(p_item.customization#>>array['layers',lower(p_component_type),'reference_url'],''),nullif(p_item.customization->>'reference_url',''),nullif(p_item.product_snapshot->>'image_url',''))
    ))
  end
$function$;

create or replace function public.icetak_set_component_metadata_v1()
returns trigger language plpgsql security definer set search_path='public','pg_temp' as $function$
declare v_item public.order_items%rowtype;
begin
  select * into v_item from public.order_items where id=new.order_item_id;
  if found and lower(coalesce(v_item.k,v_item.product_type,''))='burnaway' then
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)||public.icetak_burnaway_component_metadata(v_item,new.component_type);
  end if;
  return new;
end
$function$;

drop trigger if exists trg_set_component_metadata_v1 on public.production_components;
create trigger trg_set_component_metadata_v1 before insert or update of component_type,order_item_id
on public.production_components for each row execute function public.icetak_set_component_metadata_v1();

create or replace function public.icetak_sync_burnaway_component_metadata_v1()
returns trigger language plpgsql security definer set search_path='public','pg_temp' as $function$
begin
  if lower(coalesce(new.k,new.product_type,''))='burnaway' then
    update public.production_components pc
    set metadata=coalesce(pc.metadata,'{}'::jsonb)||public.icetak_burnaway_component_metadata(new,pc.component_type),updated_at=now()
    where pc.order_item_id=new.id;
  end if;
  return new;
end
$function$;

drop trigger if exists trg_sync_burnaway_component_metadata_v1 on public.order_items;
create trigger trg_sync_burnaway_component_metadata_v1 after update of customization,size,style,wording,custom_text
on public.order_items for each row execute function public.icetak_sync_burnaway_component_metadata_v1();

create or replace function public.icetak_quick_order_price(
  p_kind text,p_process text,p_size text,p_style text default '',p_review text default 'No Review'
) returns numeric language plpgsql immutable as $function$
declare k text:=lower(coalesce(p_kind,''));proc text:=coalesce(p_process,'Pre-order');sz text:=replace(coalesce(p_size,''),'Custom ','');sty text:=coalesce(p_style,'');rev text:=coalesce(p_review,'No Review');inches numeric;base numeric;
begin
  if k in ('topper','cake_topper') then k:='printed'; end if;
  if k='printed' then return 10; end if;
  if k='mirror' then return case when proc='Urgent' then 18 else 15 end; end if;
  if k='acrylic' then if proc='Urgent' then return case when sz='A7 Mini' then 15 when sz='A6 Standard' then 25 else 40 end; end if; return case when sz='A7 Mini' then 12 when sz='A6 Standard' then 20 else 35 end; end if;
  if k='wafer' then
    if sz='A4' then base:=12; elsif sz in ('A5','A6') then base:=6; else begin inches:=split_part(sz,' ',1)::numeric; exception when others then inches:=0; end; base:=case when inches<=6 then 6 else 12 end; end if;
    if proc='Urgent' and rev='Need Review' then base:=base+2; end if; return base;
  end if;
  if sz in ('A4','Cupcake') then base:=24; elsif sz='A5' then base:=12; elsif sz='A6' then base:=6; else begin inches:=split_part(sz,' ',1)::numeric; exception when others then inches:=0; end; if sty='Square / Petak' and sz='4 inch' then base:=12; elsif inches>=6 then base:=24; elsif inches>=4.5 then base:=12; else base:=6; end if; end if;
  if k='burnaway' then return base + case when sz='A4' then 12 when sz in ('A5','A6') then 6 when inches<=6 then 6 else 12 end; end if;
  if proc='Urgent' and rev='Need Review' then return case when base=6 then 7 when base=12 then 14 when base=24 then 28 else base end; end if;
  return base;
end
$function$;

revoke all on function public.icetak_burnaway_component_metadata(public.order_items,text) from public,anon,authenticated;
grant execute on function public.icetak_burnaway_component_metadata(public.order_items,text) to service_role;
revoke all on function public.icetak_quick_order_price(text,text,text,text,text) from public,anon;
grant execute on function public.icetak_quick_order_price(text,text,text,text,text) to authenticated,service_role;

update public.production_components pc set metadata=coalesce(pc.metadata,'{}'::jsonb)||public.icetak_burnaway_component_metadata(oi,pc.component_type)
from public.order_items oi where oi.id=pc.order_item_id and lower(coalesce(oi.k,oi.product_type,''))='burnaway';
