create or replace function public.icetak_quick_order_price(
  p_kind text,
  p_process text,
  p_size text,
  p_style text default '',
  p_review text default 'No Review'
) returns numeric
language plpgsql
immutable
as $function$
declare
  k text:=lower(coalesce(p_kind,''));
  proc text:=coalesce(p_process,'Pre-order');
  sz text:=coalesce(p_size,'');
  sty text:=coalesce(p_style,'');
  rev text:=coalesce(p_review,'No Review');
  inches numeric;
  base numeric;
begin
  if k in ('topper','cake_topper') then k:='printed'; end if;
  if k='printed' then return 10; end if;
  if k='mirror' then return case when proc='Urgent' then 18 else 15 end; end if;
  if k='acrylic' then
    if proc='Urgent' then return case when sz='A7 Mini' then 15 when sz='A6 Standard' then 25 else 40 end; end if;
    return case when sz='A7 Mini' then 12 when sz='A6 Standard' then 20 else 35 end;
  end if;
  if k='burnaway' then
    if sz ilike '%A4%' then return 36; end if;
    if sz ilike '%A5%' then return 18; end if;
    begin inches:=split_part(sz,' ',1)::numeric; exception when others then inches:=0; end;
    return case when inches>=6 then 30 when inches>=5 then 18 else 12 end;
  end if;
  if k='wafer' then
    begin inches:=split_part(sz,' ',1)::numeric; exception when others then inches:=0; end;
    base:=case when inches<=6 then 6 else 12 end;
    if proc='Urgent' and rev='Need Review' then base:=base+2; end if;
    return base;
  end if;
  if sz in ('A4','Cupcake') then base:=24;
  elsif sz='A5' then base:=12;
  elsif sz='A6' then base:=6;
  else
    begin inches:=split_part(sz,' ',1)::numeric; exception when others then inches:=0; end;
    if sty='Square / Petak' and sz='4 inch' then base:=12;
    elsif inches>=6 then base:=24;
    elsif inches>=4.5 then base:=12;
    else base:=6;
    end if;
  end if;
  if proc='Urgent' and rev='Need Review' then
    return case when base=6 then 7 when base=12 then 14 when base=24 then 28 else base end;
  end if;
  return base;
end
$function$;

revoke all on function public.icetak_quick_order_price(text,text,text,text,text) from public, anon;
grant execute on function public.icetak_quick_order_price(text,text,text,text,text) to authenticated, service_role;

create or replace function public.icetak_admin_order_detail_v3(p_order_ref text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare base jsonb; enriched jsonb;
begin
  base:=public.icetak_admin_order_detail_v2(p_order_ref);
  if base is null then return null; end if;
  select coalesce(jsonb_agg(
    elem || jsonb_build_object(
      'process',coalesce(nullif(oi.customization->>'admin_process',''),nullif(elem->>'process',''),'Pre-order'),
      'review',case when coalesce(oi.review_required,false) then 'Need Review' else 'No Review' end,
      'referenceUrl',coalesce(nullif(oi.customization->>'reference_url',''),nullif(oi.product_snapshot->>'image_url',''),''),
      'previewUrl',coalesce(nullif(elem->>'previewUrl',''),nullif(oi.design_preview_url,''),nullif(oi.customization->>'reference_url',''),nullif(oi.product_snapshot->>'image_url',''),'')
    ) order by ord
  ),'[]'::jsonb)
  into enriched
  from jsonb_array_elements(coalesce(base->'items','[]'::jsonb)) with ordinality e(elem,ord)
  left join public.order_items oi on oi.id=nullif(elem->>'id','')::uuid;
  return jsonb_set(base,'{items}',enriched,true);
end
$function$;

revoke all on function public.icetak_admin_order_detail_v3(text) from public, anon;
grant execute on function public.icetak_admin_order_detail_v3(text) to authenticated, service_role;