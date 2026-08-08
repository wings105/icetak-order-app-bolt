-- Legacy orders that already reached shipping/pickup completion states necessarily passed production approval.
update public.orders
set production_approved=true,
    updated_at=greatest(coalesce(updated_at,created_at,now()),coalesce(pickup_ready_at,pickup_collected_at,updated_at,created_at,now()))
where coalesce(production_approved,false)=false
  and (
    lower(coalesce(fulfillment_stage,'')) in ('ready_to_ship','ready_for_pickup','collected','completed')
    or pickup_ready_at is not null
    or pickup_collected_at is not null
  );
