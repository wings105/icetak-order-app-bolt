select pg_advisory_xact_lock(hashtextextended('stock:writer',0));
create or replace function public.icetak_stock_admin(p_action text,p_payload jsonb,p_actor text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m stock.materials%rowtype; previous stock.admin_requests%rowtype; request uuid; h text; answer jsonb;
 v_code text:=p_payload->>'material_code'; q numeric; old_quantity numeric; delta numeric; kind text; auto boolean; reason text:=trim(coalesce(p_payload->>'reason',''));
 v_source text:=p_payload->>'source'; oid uuid; n integer;
begin
 if nullif(trim(p_actor),'') is null then raise exception 'ACTOR_REQUIRED';end if;
 if p_action='snapshot' then
  return jsonb_build_object(
   'checked_at',now(),'settings',(select to_jsonb(s) from stock.settings s where singleton),
   'materials',(select coalesce(jsonb_agg(to_jsonb(mat) order by auto_eligible desc,category,name),'[]') from stock.materials mat),
   'rules',(select coalesce(jsonb_agg(to_jsonb(r) order by category,size_key,shape_key),'[]') from stock.size_rules r),
   'item_rules',(select coalesce(jsonb_agg(to_jsonb(r) order by updated_at desc),'[]') from (select * from stock.item_rules order by updated_at desc limit 100) r),
   'issues',(select coalesce(jsonb_agg(to_jsonb(x) order by updated_at desc),'[]') from (select i.*,s.reference,s.stage from stock.issues i left join stock.order_state s using(source,order_id) where i.resolved_at is null order by i.updated_at desc limit 100) x),
   'movements',(select coalesce(jsonb_agg(to_jsonb(x) order by created_at desc,id desc),'[]') from (select a.*,mat.name,mat.base_unit from stock.movements a join stock.materials mat on mat.code=a.material_code where (nullif(p_payload->>'material_code','') is null or a.material_code=p_payload->>'material_code') order by created_at desc,id desc limit 100 offset least(10000,greatest(0,coalesce((p_payload->>'offset')::integer,0)))) x),
   'summary',jsonb_build_object('missing_opening',(select count(*) from stock.materials where on_hand is null),'low_stock',(select count(*) from stock.materials where on_hand-reserved<0 or on_hand-reserved<=minimum),'open_issues',(select count(*) from stock.issues where resolved_at is null),'reserved_orders',(select count(distinct (source,order_id)) from stock.allocations where state='reserved'),'pending',(select count(*) from stock.work_queue where status='pending'),'failed',(select count(*) from stock.work_queue where status='failed'))
  );
 end if;
 if p_action not in ('opening','purchase','manual_use','waste','adjustment','material_save','size_rule','item_rule','retry','exclude','resolve_issue','settings') then raise exception 'INVALID_ACTION';end if;
 request:=(p_payload->>'request_id')::uuid;
 if request is null then raise exception 'REQUEST_ID_REQUIRED';end if;
 perform pg_advisory_xact_lock(hashtextextended('stock:writer',0));
 perform pg_advisory_xact_lock(hashtextextended(request::text,0));
 h:=md5(p_payload::text);
 select * into previous from stock.admin_requests where request_id=request;
 if found then
  if previous.actor<>p_actor or previous.action<>p_action or previous.payload_hash<>h then raise exception 'REQUEST_CONFLICT';end if;
  return previous.result;
 end if;
 if p_action in ('opening','purchase','manual_use','waste','adjustment') then
  select * into m from stock.materials where materials.code=v_code for update;
  if not found then raise exception 'MATERIAL_NOT_FOUND';end if;
  q:=(p_payload->>'quantity')::numeric;
  if q is null or q<0 or q>1000000 or scale(q)>6 then raise exception 'INVALID_QUANTITY';end if;
  if nullif(m.base_unit,'') is null then
   if length(trim(coalesce(p_payload->>'base_unit',''))) not between 1 and 50 then raise exception 'SET_BASE_UNIT_FIRST';end if;
   update stock.materials set base_unit=trim(p_payload->>'base_unit') where materials.code=v_code;
  end if;
  old_quantity:=m.on_hand;
  if p_action='opening' then
   if old_quantity is not null then raise exception 'OPENING_ALREADY_SET_USE_ADJUSTMENT';end if;
   delta:=q;kind:='opening';reason:=coalesce(nullif(reason,''),'Kiraan stok awal');
  elsif p_action='adjustment' then
   if old_quantity is null then raise exception 'OPENING_REQUIRED';end if;
   if length(reason)<3 then raise exception 'REASON_REQUIRED';end if;
   delta:=q-old_quantity;kind:='adjustment';
  else
   if old_quantity is null then raise exception 'OPENING_REQUIRED';end if;
   if q<=0 then raise exception 'POSITIVE_QUANTITY_REQUIRED';end if;
   delta:=case when p_action='purchase' then q else -q end;kind:=p_action;
   if length(reason)<3 then raise exception 'REASON_REQUIRED';end if;
  end if;
  auto:=coalesce((p_payload->>'auto_enabled')::boolean,m.auto_enabled);
  if auto and not m.auto_eligible then raise exception 'MANUAL_MATERIAL_ONLY';end if;
  update stock.materials set on_hand=coalesce(on_hand,0)+delta,counted_at=case when p_action in ('opening','adjustment') then now() else counted_at end,
   auto_enabled=auto,activated_at=case when auto and activated_at is null then now() else activated_at end,actor=p_actor,updated_at=now() where materials.code=v_code;
  if p_action='opening' and m.category='wafer' and coalesce((p_payload->>'is_default')::boolean,false) then
   update stock.materials set is_default=false where category='wafer' and materials.code<>v_code and is_default;
   update stock.materials set is_default=true where materials.code=v_code;
  end if;
  insert into stock.movements(material_code,delta,kind,idempotency_key,reason,actor,cost)
   values(v_code,delta,kind,'admin:'||request::text,reason,p_actor,case when p_action='purchase' then nullif(p_payload->>'cost','')::numeric end);
  if p_action='opening' or auto is distinct from m.auto_enabled then perform stock.wake();end if;
 elsif p_action='material_save' then
  if length(coalesce(v_code,'')) not between 1 and 80 or length(trim(coalesce(p_payload->>'name',''))) not between 1 and 160 then raise exception 'MATERIAL_FIELDS_REQUIRED';end if;
  select * into m from stock.materials where materials.code=v_code for update;
  if found then
   if m.on_hand is not null and m.base_unit is distinct from p_payload->>'base_unit' then raise exception 'BASE_UNIT_LOCKED';end if;
   auto:=coalesce((p_payload->>'auto_enabled')::boolean,m.auto_enabled);
   if auto and (not m.auto_eligible or m.on_hand is null) then raise exception 'CONFIRM_OPENING_FIRST';end if;
   if coalesce((p_payload->>'is_default')::boolean,false) then update stock.materials set is_default=false where category=m.category and is_default and materials.code<>v_code;end if;
   update stock.materials set name=trim(p_payload->>'name'),base_unit=nullif(p_payload->>'base_unit',''),minimum=nullif(p_payload->>'minimum','')::numeric,note=left(p_payload->>'note',500),
    is_default=coalesce((p_payload->>'is_default')::boolean,is_default),auto_enabled=auto,activated_at=case when auto and activated_at is null then now() else activated_at end,actor=p_actor,updated_at=now() where materials.code=v_code;
  else
   if nullif(p_payload->>'base_unit','') is null then raise exception 'BASE_UNIT_REQUIRED';end if;
   insert into stock.materials(code,name,category,base_unit,minimum,note,actor) values(v_code,trim(p_payload->>'name'),'other',p_payload->>'base_unit',nullif(p_payload->>'minimum','')::numeric,left(p_payload->>'note',500),p_actor);
  end if;
  perform stock.wake();
 elsif p_action='size_rule' then
  if p_payload->>'category' not in ('edible','wafer','glossy','artpaper_gold','acrylic') then raise exception 'INVALID_CATEGORY';end if;
  if length(coalesce(p_payload->>'size_key','')) not between 1 and 50 or p_payload->>'shape_key' not in ('*','round','square','heart','rectangle') then raise exception 'SIZE_SHAPE_REQUIRED';end if;
  q:=(p_payload->>'rate')::numeric;if q is null or q<=0 or q>100 or scale(q)>6 then raise exception 'INVALID_RATE';end if;
  insert into stock.size_rules(category,size_key,shape_key,rate,approved,actor) values(p_payload->>'category',p_payload->>'size_key',p_payload->>'shape_key',q,true,p_actor)
  on conflict(category,size_key,shape_key) do update set rate=excluded.rate,approved=true,actor=p_actor,updated_at=now();
  perform stock.wake();
 elsif p_action='item_rule' then
  if coalesce(p_payload->>'match_key','') !~ '^[0-9a-f]{32}$' then raise exception 'MATCH_KEY_REQUIRED';end if;
  if not coalesce((p_payload->>'manual_only')::boolean,false) then
   select * into m from stock.materials where materials.code=v_code and auto_eligible;
   q:=(p_payload->>'rate')::numeric;
   if m.code is null or q is null or q<=0 or q>100 or scale(q)>6 then raise exception 'MATERIAL_RATE_REQUIRED';end if;
  end if;
  insert into stock.item_rules(match_key,label,material_code,rate,manual_only,actor) values(p_payload->>'match_key',left(coalesce(p_payload->>'label','Item mapping'),200),case when coalesce((p_payload->>'manual_only')::boolean,false) then null else v_code end,q,coalesce((p_payload->>'manual_only')::boolean,false),p_actor)
   on conflict(match_key) do update set material_code=excluded.material_code,rate=excluded.rate,manual_only=excluded.manual_only,actor=p_actor,updated_at=now();
  perform stock.wake();
 elsif p_action in ('retry','exclude') then
  if v_source not in ('icetak','shopee') then raise exception 'SOURCE_REQUIRED';end if;
  oid:=(p_payload->>'order_id')::uuid;
  if not exists(select 1 from stock.order_state where order_id=oid and order_state.source=v_source) then raise exception 'STOCK_ORDER_NOT_FOUND';end if;
  if p_action='exclude' then
   if length(reason)<5 then raise exception 'REASON_REQUIRED';end if;
   if exists(select 1 from stock.order_state where order_id=oid and order_state.source=v_source and consumed_at is not null) then raise exception 'ALREADY_CONSUMED';end if;
   perform stock.apply_order(v_source,oid,'excluded','[]',null);
   update stock.order_state set excluded_at=now(),review=reason where order_id=oid and order_state.source=v_source;
   update stock.issues set resolved_at=now() where order_id=oid and issues.source=v_source;
  else perform stock.enqueue(v_source,oid);end if;
 elsif p_action='resolve_issue' then
  if v_source not in ('icetak','shopee') or length(reason)<5 then raise exception 'SOURCE_REASON_REQUIRED';end if;
  oid:=(p_payload->>'order_id')::uuid;
  if p_payload->>'issue_code' not in ('shortage','after_dispatch_edit','linked_duplicate') then raise exception 'ISSUE_NEEDS_MAPPING_OR_OPENING';end if;
  if p_payload->>'issue_code'='shortage' and exists(select 1 from stock.materials mat join stock.issues issue on mat.code=issue.details->>'material_code' where issue.source=v_source and issue.order_id=oid and issue.line_key=coalesce(p_payload->>'line_key','') and issue.code='shortage' and mat.on_hand<0) then raise exception 'ADJUST_STOCK_FIRST';end if;
  update stock.issues set resolved_at=now() where issues.source=v_source and order_id=oid and line_key=coalesce(p_payload->>'line_key','') and issues.code=p_payload->>'issue_code';
  if not found then raise exception 'ISSUE_NOT_FOUND';end if;
  if p_payload->>'issue_code'='after_dispatch_edit' then update stock.order_state set source_hash=stock.input_hash(stock.order_input(v_source,oid)),review=reason where source=v_source and order_id=oid;end if;
  if p_payload->>'issue_code'='linked_duplicate' then update stock.order_state set excluded_at=now(),review=reason where source=v_source and order_id=oid;end if;
 elsif p_action='settings' then
  update stock.settings set enabled=(p_payload->>'enabled')::boolean,actor=p_actor,updated_at=now() where singleton;
  if coalesce((p_payload->>'enabled')::boolean,false) then perform stock.wake();end if;
 end if;
 insert into stock.audit(action,actor,target,details) values(p_action,p_actor,coalesce(v_code,v_source||':'||oid,p_payload->>'size_key'),p_payload-'request_id');
 answer:=jsonb_build_object('saved',true,'request_id',request);
 insert into stock.admin_requests(request_id,actor,action,payload_hash,result) values(request,p_actor,p_action,h,answer);
 return answer;
end $$;
