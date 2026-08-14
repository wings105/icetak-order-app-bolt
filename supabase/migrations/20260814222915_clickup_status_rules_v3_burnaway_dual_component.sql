create or replace function public.icetak_clickup_initial_status_v2(
  p_component_type text,
  p_label text default null,
  p_product_type text default null,
  p_title text default null,
  p_process text default null,
  p_review_required boolean default null,
  p_ai_job_type text default null,
  p_style text default null
) returns text
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
declare
  comp text:=lower(coalesce(p_component_type,''));
  label_text text:=lower(coalesce(p_label,''));
  combined text:=lower(concat_ws(' ',p_component_type,p_label,p_product_type,p_title));
  job text:=lower(coalesce(p_ai_job_type,''));
  sty text:=lower(coalesce(p_style,''));
  parent_burnaway boolean:=combined like '%burnaway%' or combined like '%burn away%';
  desired text;
  resolved text;
begin
  if parent_burnaway then
    if comp like '%wafer%' or label_text like '%wafer%' then
      desired:='wafer paper';
    else
      desired:='design edible image';
    end if;
  elsif job='topper_new_design_glossy' or sty like '%new design%' or combined like '%new design%' then
    desired:='new custom';
  elsif combined like '%mirror gold%' or combined like '%artpaper%' or combined like '%acrylic%' then
    desired:='acrylic';
  elsif combined like '%wafer%' then
    desired:='wafer paper';
  elsif combined like '%edible%' then
    desired:='design edible image';
  elsif combined like '%topper%' or combined like '%printed%' then
    desired:='design editing -topper';
  else
    desired:='design editing -topper';
  end if;

  select status_name into resolved
  from public.clickup_status_mapping
  where active=true and lower(status_name)=lower(desired)
  limit 1;

  if resolved is null then
    select status_name into resolved
    from public.clickup_status_mapping
    where active=true and lower(status_name)='design editing -topper'
    limit 1;
  end if;

  if resolved is null then
    raise exception 'No active ClickUp status mapping for %',desired;
  end if;
  return resolved;
end
$$;

create or replace function public.icetak_clickup_initial_status(
  p_component_type text,
  p_label text default null,
  p_product_type text default null,
  p_title text default null
) returns text
language sql
stable
set search_path to 'public','pg_temp'
as $$
  select public.icetak_clickup_initial_status_v2(
    p_component_type,
    p_label,
    p_product_type,
    p_title,
    null,
    null,
    null,
    null
  )
$$;

revoke execute on function public.icetak_clickup_initial_status_v2(text,text,text,text,text,boolean,text,text) from public, anon, authenticated;
grant execute on function public.icetak_clickup_initial_status_v2(text,text,text,text,text,boolean,text,text) to service_role;
