create or replace function public.icetak_validate_catalog_order_item()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if new.wording_mode in ('custom_name','add_wording') then
    if nullif(trim(coalesce(new.custom_text,new.wording,'')),'') is null then
      raise exception 'custom_wording_required';
    end if;
    new.review_required:=true;
  elsif new.wording_mode='happy_birthday' then
    new.custom_text:=coalesce(nullif(trim(new.custom_text),''),'Happy Birthday');
    new.wording:=new.custom_text;
    new.review_required:=false;
  elsif new.wording_mode='no_wording' then
    new.custom_text:='';
    new.wording:='';
    new.review_required:=false;
  end if;
  return new;
end;
$$;

drop trigger if exists order_items_validate_catalog_customization on public.order_items;
create trigger order_items_validate_catalog_customization
before insert or update of wording_mode,custom_text,wording,review_required
on public.order_items
for each row execute function public.icetak_validate_catalog_order_item();

create or replace function public.icetak_sync_component_review_from_item()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare v_review boolean;
begin
  if new.order_item_id is not null then
    select coalesce(review_required,false) into v_review from public.order_items where id=new.order_item_id;
    new.review_required:=coalesce(v_review,new.review_required,false);
    new.review_status:=case when new.review_required then coalesce(nullif(new.review_status,'not_required'),'pending') else 'not_required' end;
  end if;
  return new;
end;
$$;

drop trigger if exists production_components_sync_item_review on public.production_components;
create trigger production_components_sync_item_review
before insert or update of order_item_id,review_required,review_status
on public.production_components
for each row execute function public.icetak_sync_component_review_from_item();
