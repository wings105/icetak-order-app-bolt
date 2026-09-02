-- Enforce the Burn Away contract for every writer, including legacy and automation payloads.
create or replace function public.icetak_normalize_burnaway_single_shape_v1()
returns trigger
language plpgsql
set search_path='public','pg_temp'
as $function$
declare
  v_shape text;
  v_edible_size text;
  v_wafer_size text;
  v_allowed_edible constant text[]:=array['3 inch','3.5 inch','4 inch','4.5 inch','5 inch','5.5 inch','6 inch','6.5 inch','7 inch','7.5 inch'];
  v_allowed_wafer constant text[]:=array['3 inch','3.5 inch','4 inch','4.5 inch','5 inch','5.5 inch','6 inch','6.5 inch','7 inch','7.5 inch','8 inch'];
begin
  if lower(coalesce(new.k,new.product_type,''))<>'burnaway' then return new; end if;

  v_shape:=coalesce(
    nullif(new.customization->>'shape',''),
    nullif(new.style,''),
    nullif(new.customization#>>'{layers,edible,shape}',''),
    nullif(new.customization#>>'{layers,wafer,shape}',''),
    'Round / Bulat'
  );
  if v_shape<>all(array['Round / Bulat','Square / Petak','Love Shape / Hati']) then
    v_shape:='Round / Bulat';
  end if;

  v_edible_size:=coalesce(
    nullif(new.customization#>>'{layers,edible,size}',''),
    case when new.size=any(v_allowed_edible) then new.size end,
    '5 inch'
  );
  if v_edible_size<>all(v_allowed_edible) then v_edible_size:='5 inch'; end if;

  v_wafer_size:=coalesce(
    nullif(new.customization#>>'{layers,wafer,size}',''),
    case when new.size=any(v_allowed_wafer) then new.size end,
    '5 inch'
  );
  if v_wafer_size<>all(v_allowed_wafer) then v_wafer_size:='5 inch'; end if;

  new.style:=v_shape;
  new.size:=format('Edible %s • Wafer %s',v_edible_size,v_wafer_size);
  new.customization:=coalesce(new.customization,'{}'::jsonb)||jsonb_build_object(
    'shape',v_shape,
    'layers',jsonb_build_object(
      'edible',coalesce(new.customization#>'{layers,edible}','{}'::jsonb)||jsonb_build_object('size',v_edible_size,'shape',v_shape),
      'wafer',coalesce(new.customization#>'{layers,wafer}','{}'::jsonb)||jsonb_build_object('size',v_wafer_size,'shape',v_shape)
    )
  );
  return new;
end
$function$;

drop trigger if exists trg_normalize_burnaway_single_shape_v1 on public.order_items;
create trigger trg_normalize_burnaway_single_shape_v1
before insert or update of k,product_type,size,style,customization
on public.order_items
for each row execute function public.icetak_normalize_burnaway_single_shape_v1();

revoke all on function public.icetak_normalize_burnaway_single_shape_v1() from public,anon,authenticated;
