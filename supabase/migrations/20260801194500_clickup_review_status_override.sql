create or replace function public.icetak_sync_component_review_from_item()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare
  v_review boolean;
  v_status text:=lower(trim(coalesce(new.review_status,'')));
begin
  if v_status in ('waiting_customer_review','waiting_review','edit_requested','approved') then
    new.review_required:=true;
    return new;
  end if;

  if new.order_item_id is not null then
    select coalesce(review_required,false) into v_review
    from public.order_items where id=new.order_item_id;
    new.review_required:=coalesce(v_review,new.review_required,false);
    new.review_status:=case
      when new.review_required then coalesce(nullif(new.review_status,'not_required'),'pending')
      else 'not_required'
    end;
  end if;
  return new;
end;
$$;
