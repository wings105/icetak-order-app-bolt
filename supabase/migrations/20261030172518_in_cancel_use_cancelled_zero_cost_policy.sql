CREATE OR REPLACE FUNCTION finance.cancelled_zero_row(p_row jsonb, p_cancelled boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare r jsonb:=p_row;k text;v jsonb;
begin
if not coalesce(p_cancelled,upper(trim(coalesce(r->>'status',''))) in ('CANCELLED','IN_CANCEL') or coalesce(r->>'zero_policy','')='cancelled_zero_v1',false) then return r;end if;
r:=r||jsonb_build_object('zero_policy','cancelled_zero_v1','included',false,'state','excluded','income_state','cancelled','profit_state','excluded','cost_state','estimated','detail_changed',false,'lifecycle_review',false,'reviewed',false,'reasons','[]'::jsonb,'finance_source','cancelled_policy','settlement_status','cancelled','released_at',null);
foreach k in array array['sales','goods_value','product_subtotal','buyer_paid','customer_paid','shipping_charged','shipping_fee','fee','nett','material','material_total','packing','extras','extra_total','cost_total','profit','contribution','margin','escrow_amount','estimated_escrow_amount','released_amount','commission_fee','service_fee','transaction_fee','other_fees','payout_difference','profit_per_hour','work_minutes','material_override','courier_override'] loop r:=r||jsonb_build_object(k,0);end loop;
if jsonb_typeof(r->'courier')='number' or r->>'channel'='deco' then r:=r||jsonb_build_object('courier',0);end if;
r:=r||jsonb_build_object('extra_costs',finance.cancelled_zero_extras(),'courier_state','cancelled','material_actual',false,'courier_actual',false,'extras_actual',false);
if r ? 'material_lines' then r:=jsonb_set(r,'{material_lines}',finance.cancelled_zero_lines(r->'material_lines'));end if;
if r ? 'lines' then r:=jsonb_set(r,'{lines}',finance.cancelled_zero_lines(r->'lines'));end if;
foreach k in array array['finance_metrics','metrics'] loop
select coalesce(jsonb_object_agg(key,case when jsonb_typeof(value)='number' then '0'::jsonb else value end),'{}') into v from jsonb_each(coalesce(r->k,'{}'));
v:=v||jsonb_build_object('shipping_net',0,'return_shipping',0,'fee_total',0,'refund_total',0,'seller_promotion',0,'platform_ads',0,'affiliate',0,'provider_nett',0,'reconstructed_nett',0,'reconciliation_delta',0,'reconciliation','matched','issues','[]'::jsonb,'reasons','[]'::jsonb,'field_count',0);
r:=r||jsonb_build_object(k,v);
end loop;
foreach k in array array['finance_fields','fields'] loop
if jsonb_typeof(r->k)='object' then
select coalesce(jsonb_object_agg(key,value||jsonb_build_object('amount',0,'value',case when value ? 'amount' or jsonb_typeof(value->'value')='number' then '0'::jsonb else value->'value' end)),'{}') into v from jsonb_each(r->k);
r:=r||jsonb_build_object(k,v);
end if;
end loop;
return r;
end $function$;

CREATE OR REPLACE FUNCTION finance.guard_cancelled_costs()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
if tg_table_name='marketplace_order_costs' then
if exists(select 1 from public.marketplace_orders o where o.id=new.order_id and upper(trim(o.current_status)) in ('CANCELLED','IN_CANCEL')) then
new.material_lines:=finance.cancelled_zero_lines(new.material_lines);new.extra_costs:=finance.cancelled_zero_extras();new.work_minutes:=0;new.reviewed:=false;new.actor:='cancelled_zero_policy';
end if;
else
if exists(select 1 from public.orders o where o.id=new.order_id and ('CANCELLED'=any(array[upper(trim(o.status)),upper(trim(o.admin_status)),upper(trim(o.fulfillment_stage))]) or 'IN_CANCEL'=any(array[upper(trim(o.status)),upper(trim(o.admin_status)),upper(trim(o.fulfillment_stage))]))) then
new.material:=0;new.courier:=0;new.extras:=0;new.material_actual:=false;new.courier_actual:=false;new.extras_actual:=false;new.actor:='cancelled_zero_policy';
end if;
end if;
return new;
end $function$;

CREATE OR REPLACE FUNCTION finance.sync_cancelled_cost_policy(p_order_id uuid, p_kind text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare mc finance.marketplace_order_costs%rowtype;dc finance.direct_order_costs%rowtype;mo public.marketplace_orders%rowtype;d public.orders%rowtype;
cancelled boolean;before_row jsonb;after_row jsonb;original_row jsonb;est jsonb;sig text;entity text;
begin
if p_kind='marketplace' then
 select * into mo from public.marketplace_orders where id=p_order_id for update;
 if not found then return;end if;
 cancelled:=upper(trim(mo.current_status)) in ('CANCELLED','IN_CANCEL');entity:='marketplace_order_costs';
 select * into mc from finance.marketplace_order_costs where order_id=p_order_id for update;
 if found then before_row:=to_jsonb(mc);end if;
elsif p_kind='direct' then
 select * into d from public.orders where id=p_order_id for update;
 if not found then return;end if;
 cancelled:=coalesce(('CANCELLED'=any(array[upper(trim(d.status)),upper(trim(d.admin_status)),upper(trim(d.fulfillment_stage))]) or 'IN_CANCEL'=any(array[upper(trim(d.status)),upper(trim(d.admin_status)),upper(trim(d.fulfillment_stage))])),false);entity:='direct_order_costs';
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
end $function$;

CREATE OR REPLACE FUNCTION finance.sync_cancelled_cost_policy_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
if tg_table_name='marketplace_orders' then
 if upper(trim(new.current_status)) in ('CANCELLED','IN_CANCEL') or (tg_op='UPDATE' and upper(trim(old.current_status)) in ('CANCELLED','IN_CANCEL')) then perform finance.sync_cancelled_cost_policy(new.id,'marketplace');end if;
else
 if coalesce(('CANCELLED'=any(array[upper(trim(new.status)),upper(trim(new.admin_status)),upper(trim(new.fulfillment_stage))]) or 'IN_CANCEL'=any(array[upper(trim(new.status)),upper(trim(new.admin_status)),upper(trim(new.fulfillment_stage))])),false)
 or (tg_op='UPDATE' and coalesce(('CANCELLED'=any(array[upper(trim(old.status)),upper(trim(old.admin_status)),upper(trim(old.fulfillment_stage))]) or 'IN_CANCEL'=any(array[upper(trim(old.status)),upper(trim(old.admin_status)),upper(trim(old.fulfillment_stage))])),false))
 then perform finance.sync_cancelled_cost_policy(new.id,'direct');end if;
end if;
return new;
end $function$;
