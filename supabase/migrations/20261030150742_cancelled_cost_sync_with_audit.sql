create function finance.sync_cancelled_cost_policy(p_order_id uuid,p_kind text) returns void language plpgsql set search_path='' as $$
declare mc finance.marketplace_order_costs%rowtype;dc finance.direct_order_costs%rowtype;mo public.marketplace_orders%rowtype;d public.orders%rowtype;
cancelled boolean;before_row jsonb;after_row jsonb;original_row jsonb;est jsonb;sig text;entity text;
begin
if p_kind='marketplace' then
 select * into mo from public.marketplace_orders where id=p_order_id for update;
 if not found then return;end if;
 cancelled:=upper(trim(mo.current_status))='CANCELLED';entity:='marketplace_order_costs';
 select * into mc from finance.marketplace_order_costs where order_id=p_order_id for update;
 if found then before_row:=to_jsonb(mc);end if;
elsif p_kind='direct' then
 select * into d from public.orders where id=p_order_id for update;
 if not found then return;end if;
 cancelled:=coalesce('CANCELLED'=any(array[upper(trim(d.status)),upper(trim(d.admin_status)),upper(trim(d.fulfillment_stage))]),false);entity:='direct_order_costs';
 select * into dc from finance.direct_order_costs where order_id=p_order_id for update;
 if found then before_row:=to_jsonb(dc);end if;
 select md5(coalesce(jsonb_agg(jsonb_build_array(id,title,qty,price,k,product_type,product_id,product_variant_id,product_snapshot) order by id),'[]')::text||coalesce(d.total::text,'')||coalesce(d.delivery_fee::text,'')||coalesce(d.delivery_method,'')||coalesce(d.delivery,'')) into sig from public.order_items where order_id=p_order_id;
else raise exception 'Unknown cost policy kind';
end if;
if cancelled then
 if before_row->>'actor'='cancelled_zero_policy' then return;end if;
 if p_kind='marketplace' then
  est:=finance.order_material_estimate(p_order_id,mc.settings_version);
  insert into finance.marketplace_order_costs(order_id,version,settings_version,source_signature,material_lines,extra_costs,work_minutes,reviewed,note,actor)
  values(p_order_id,coalesce(mc.version,0)+1,(est->>'settings_version')::bigint,est->>'signature',finance.cancelled_zero_lines(coalesce(mc.material_lines,est->'lines')),finance.cancelled_zero_extras(),0,false,coalesce(mc.note,''),'cancelled_zero_policy')
  on conflict(order_id) do update set version=excluded.version,settings_version=excluded.settings_version,source_signature=excluded.source_signature,material_lines=excluded.material_lines,extra_costs=excluded.extra_costs,work_minutes=0,reviewed=false,actor=excluded.actor,updated_at=clock_timestamp()
  returning to_jsonb(marketplace_order_costs) into after_row;
 else
  insert into finance.direct_order_costs(order_id,version,source_signature,material,courier,extras,material_actual,courier_actual,extras_actual,note,actor)
  values(p_order_id,coalesce(dc.version,0)+1,sig,0,0,0,false,false,false,coalesce(dc.note,''),'cancelled_zero_policy')
  on conflict(order_id) do update set version=excluded.version,source_signature=excluded.source_signature,material=0,courier=0,extras=0,material_actual=false,courier_actual=false,extras_actual=false,actor=excluded.actor,updated_at=clock_timestamp()
  returning to_jsonb(direct_order_costs) into after_row;
 end if;
 insert into finance.audit_log(actor,action,entity_type,entity_id,before_data,after_data) values('admin1','cancelled_zero_apply',entity,p_order_id::text,before_row,after_row);
elsif before_row->>'actor'='cancelled_zero_policy' then
 select before_data into original_row from finance.audit_log where action='cancelled_zero_apply' and entity_type=entity and entity_id=p_order_id::text order by id desc limit 1;
 if p_kind='marketplace' then
  if original_row is not null and original_row<>'null'::jsonb then
   mc:=jsonb_populate_record(null::finance.marketplace_order_costs,original_row);
  else
   est:=finance.order_material_estimate(p_order_id);
   mc.settings_version:=(est->>'settings_version')::bigint;mc.source_signature:=est->>'signature';mc.material_lines:=est->'lines';mc.extra_costs:=finance.empty_order_extras();mc.work_minutes:=null;mc.reviewed:=false;mc.note:='';mc.actor:='snapshot';
  end if;
  update finance.marketplace_order_costs set version=version+1,settings_version=mc.settings_version,source_signature=mc.source_signature,material_lines=mc.material_lines,extra_costs=mc.extra_costs,work_minutes=mc.work_minutes,reviewed=mc.reviewed,note=mc.note,actor=mc.actor,updated_at=clock_timestamp() where order_id=p_order_id returning to_jsonb(marketplace_order_costs) into after_row;
 else
  if original_row is not null and original_row<>'null'::jsonb then dc:=jsonb_populate_record(null::finance.direct_order_costs,original_row);
  else
   dc.source_signature:=sig;dc.material:=null;dc.courier:=null;dc.extras:=0;dc.material_actual:=false;dc.courier_actual:=false;dc.extras_actual:=false;dc.note:='';dc.actor:='snapshot';
  end if;
  update finance.direct_order_costs set version=version+1,source_signature=dc.source_signature,material=dc.material,courier=dc.courier,extras=dc.extras,material_actual=dc.material_actual,courier_actual=dc.courier_actual,extras_actual=dc.extras_actual,note=dc.note,actor=dc.actor,updated_at=clock_timestamp() where order_id=p_order_id returning to_jsonb(direct_order_costs) into after_row;
 end if;
 insert into finance.audit_log(actor,action,entity_type,entity_id,before_data,after_data) values('admin1','cancelled_zero_restore',entity,p_order_id::text,before_row,after_row);
end if;
end $$;
revoke all on function finance.sync_cancelled_cost_policy(uuid,text) from public,anon,authenticated;
grant execute on function finance.sync_cancelled_cost_policy(uuid,text) to service_role;
