-- Order-owned inventory. No old quantity import and no historical consumption.
create schema if not exists stock;
revoke all on schema stock from public,anon,authenticated;
grant usage on schema stock to service_role;

create table stock.settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default true,
 started_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), actor text
);
insert into stock.settings(singleton) values(true);
create table stock.materials (
 code text primary key, name text not null, category text not null,
 colour text, base_unit text, is_default boolean not null default false,
 auto_eligible boolean not null default false, auto_enabled boolean not null default false,
 activated_at timestamptz, on_hand numeric(16,6), reserved numeric(16,6) not null default 0 check(reserved>=0),
 minimum numeric(16,6) check(minimum>=0), counted_at timestamptz,
 note text, updated_at timestamptz not null default now(), actor text
);
create unique index stock_one_default on stock.materials(category) where is_default;
create index stock_colour_lookup on stock.materials(category,colour) where auto_eligible;
create table stock.size_rules (
 category text not null, size_key text not null, shape_key text not null default '*',
 rate numeric(16,6) check(rate>0), approved boolean not null default false,
 actor text, updated_at timestamptz not null default now(), primary key(category,size_key,shape_key)
);
create table stock.item_rules (
 match_key text primary key, label text not null, material_code text references stock.materials(code),
 rate numeric(16,6) check(rate>0), manual_only boolean not null default false,
 actor text not null, updated_at timestamptz not null default now(),
 check(manual_only or (material_code is not null and rate is not null))
);
create table stock.order_state (
 source text not null check(source in ('icetak','shopee')), order_id uuid not null,
 reference text not null, stage text not null, enrolled_at timestamptz not null default now(),
 evidence_at timestamptz, consumed_at timestamptz, excluded_at timestamptz,
 desired_hash text, desired jsonb not null default '[]', revision integer not null default 0,
 review text, updated_at timestamptz not null default now(), primary key(source,order_id)
);
create table stock.allocations (
 source text not null, order_id uuid not null, line_key text not null, part text not null,
 material_code text not null references stock.materials(code), quantity numeric(16,6) not null check(quantity>0),
 state text not null check(state in ('reserved','consumed','released')),
 updated_at timestamptz not null default now(),
 primary key(source,order_id,line_key,part,material_code),
 foreign key(source,order_id) references stock.order_state(source,order_id)
);
create index stock_material_reservations on stock.allocations(material_code) where state='reserved';
create table stock.movements (
 id uuid primary key default gen_random_uuid(), material_code text not null references stock.materials(code),
 delta numeric(16,6) not null default 0, reserved_delta numeric(16,6) not null default 0,
 kind text not null, idempotency_key text not null unique,
 source text, order_id uuid, reference text, line_key text, part text,
 reason text not null, actor text not null, cost numeric(16,2) check(cost>=0),
 created_at timestamptz not null default now()
);
create index stock_movement_history on stock.movements(created_at desc,id desc);
create index stock_movement_material on stock.movements(material_code,created_at desc);
create table stock.issues (
 source text not null, order_id uuid not null, line_key text not null default '', code text not null,
 message text not null, details jsonb not null default '{}',
 resolved_at timestamptz, updated_at timestamptz not null default now(),
 primary key(source,order_id,line_key,code)
);
create index stock_open_issues on stock.issues(updated_at desc) where resolved_at is null;
create table stock.work_queue (
 source text not null,order_id uuid not null,
 status text not null default 'pending' check(status in ('pending','blocked','done','failed')),
 attempts integer not null default 0, available_at timestamptz not null default now(),
 last_error text, updated_at timestamptz not null default now(), primary key(source,order_id)
);
create index stock_pending_work on stock.work_queue(available_at,updated_at) where status='pending';
create table stock.admin_requests (
 request_id uuid primary key,actor text not null,action text not null,payload_hash text not null,
 result jsonb not null,created_at timestamptz not null default now()
);
create table stock.audit (
 id uuid primary key default gen_random_uuid(),action text not null,actor text not null,
 target text,details jsonb not null,created_at timestamptz not null default now()
);

create function stock.colour_name(p text) returns text language sql immutable set search_path='' as $$
 select coalesce(finance.acrylic_colour_name(p),case when lower(trim(p)) in ('lilac','lilac / light purple','light purple') then 'Lilac' end)
$$;
create function stock.size_key(p text) returns text language plpgsql immutable set search_path='' as $$
declare a text[]; n text:=lower(regexp_replace(coalesce(p,''),'[×✕]','x','g')); d text[]; x numeric;y numeric;
begin
 select array_agg(distinct upper(m[1])) into a from regexp_matches(n,'\m(a[4-7])\M','g') m;
 if cardinality(a)=1 then return a[1]; elsif cardinality(a)>1 then return null; end if;
 d:=regexp_match(n,'([0-9]+(?:\.[0-9]+)?)\s*x\s*([0-9]+(?:\.[0-9]+)?)\s*(?:inch|in\M|")');
 if d is not null then
  x:=d[1]::numeric;y:=d[2]::numeric;
  if least(x,y)=7.5 and greatest(x,y)=11 then return 'A4'; end if;
  if least(x,y)=5.5 and greatest(x,y)=7.5 then return 'A5'; end if;
  if least(x,y) in (3.7,3.75) and greatest(x,y)=5.5 then return 'A6'; end if;
  if x=y then return rtrim(to_char(x,'FM999990.999'),'.')||'in'; end if;
  return rtrim(to_char(least(x,y),'FM999990.999'),'.')||'x'||rtrim(to_char(greatest(x,y),'FM999990.999'),'.')||'in';
 end if;
 d:=regexp_match(n,'([0-9]+(?:\.[0-9]+)?)\s*(?:inch|in\M|")');
 if d is not null then return rtrim(to_char(d[1]::numeric,'FM999990.999'),'.')||'in'; end if;
 if trim(n) in ('1 pc','1pcs','1 set','1pc') then return '1pc'; end if;
 return null;
end $$;
create function stock.shape_key(p text) returns text language sql immutable set search_path='' as $$
 select case when lower(coalesce(p,''))~'(square|petak)' then 'square'
 when lower(coalesce(p,''))~'(round|bulat)' then 'round'
 when lower(coalesce(p,''))~'(love|heart|hati)' then 'heart'
 when lower(coalesce(p,''))~'(portrait|landscape|rect)' then 'rectangle' else '*' end
$$;
create function stock.category(p_type text,p_title text,p_sku text) returns text language plpgsql stable set search_path='' as $$
declare t text:=lower(coalesce(p_type,'')); title text:=lower(coalesce(p_title,'')); c text;
begin
 if t='mirror' or title~'(mirror gold artpaper|artpaper.*gold|gold.*artpaper)' then return 'artpaper_gold'; end if;
 if t='burnaway' or lower(coalesce(p_sku,''))~'burn.?away' or title~'burn[ -]?away' then return 'burnaway'; end if;
 if t in ('edible','wafer','acrylic') then return t; end if;
 if t in ('printed','topper') then return 'glossy'; end if;
 c:=finance.material_category(p_sku,p_title);
 return case when c='topper' then 'glossy' else c end;
end $$;
create function stock.match_key(p jsonb) returns text language sql immutable set search_path='' as $$
 select md5(jsonb_build_array(p->>'source',p->>'product_id',p->>'provider_item_id',p->>'provider_variation_id',p->>'sku',p->>'variation',p->>'category',p->>'part',p->>'size',p->>'style')::text)
$$;
create function stock.issue(p_source text,p_order uuid,p_line text,p_code text,p_message text,p_details jsonb default '{}') returns void language sql set search_path='' as $$
 insert into stock.issues(source,order_id,line_key,code,message,details) values(p_source,p_order,coalesce(p_line,''),p_code,p_message,p_details)
 on conflict(source,order_id,line_key,code) do update set message=excluded.message,details=excluded.details,resolved_at=null,updated_at=now()
$$;
create function stock.enqueue(p_source text,p_order uuid) returns void language sql set search_path='' as $$
 insert into stock.work_queue(source,order_id) values(p_source,p_order)
 on conflict(source,order_id) do update set status='pending',attempts=0,available_at=now(),last_error=null,updated_at=now()
$$;
create function stock.resolve_line(p jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare r stock.size_rules%rowtype; m stock.materials%rowtype; ov stock.item_rules%rowtype;
 key text:=stock.match_key(p); cat text:=p->>'category'; sz text:=stock.size_key(p->>'size'); shape text:=stock.shape_key(p->>'style');
 q numeric; rate numeric; v_colour text; allocations jsonb:='[]'; tape stock.materials%rowtype;
begin
 if coalesce(p->>'quantity','') !~ '^[0-9]+$' or (p->>'quantity')::numeric<=0 then return jsonb_build_object('error','Kuantiti item belum sah','match_key',key); end if;
 q:=(p->>'quantity')::numeric;
 select * into ov from stock.item_rules where match_key=key;
 if found then
  if ov.manual_only then return jsonb_build_object('allocations','[]'::jsonb); end if;
  select * into m from stock.materials where code=ov.material_code;
  rate:=ov.rate;
 else
  select * into r from stock.size_rules where category=cat and size_key=sz and shape_key in (shape,'*') order by (shape_key=shape) desc limit 1;
  if r.approved is not true or r.rate is null then return jsonb_build_object('error','Kadar saiz belum disahkan','match_key',key,'category',cat,'size_key',sz,'shape_key',shape); end if;
  rate:=r.rate;
  if cat='acrylic' then
   v_colour:=coalesce(stock.colour_name(p->>'style'),stock.colour_name(split_part(coalesce(p->>'variation',''),',',1)),finance.acrylic_colour(p->>'variation',p->>'sku',p->>'title'));
   if v_colour is null then return jsonb_build_object('error','Warna acrylic belum jelas','match_key',key); end if;
   select * into m from stock.materials where category=cat and colour=v_colour and auto_eligible;
  else select * into m from stock.materials where category=cat and is_default; end if;
 end if;
 if m.code is null or not m.auto_eligible then return jsonb_build_object('error','Bahan auto belum dipadankan','match_key',key,'category',cat,'size_key',sz,'colour',v_colour); end if;
 allocations:=jsonb_build_array(jsonb_build_object('line_key',p->>'line_key','part',p->>'part','material_code',m.code,'quantity',round(rate*q,6),'rate',rate,'match_key',key));
 if m.category='glossy' then
  select * into tape from stock.materials where category='double_tape' and is_default;
  if tape.code is null then return jsonb_build_object('error','Bahan double tape belum dipadankan','match_key',key); end if;
  allocations:=allocations||jsonb_build_array(jsonb_build_object('line_key',p->>'line_key','part',p->>'part','material_code',tape.code,'quantity',round(rate*q,6),'rate',rate,'match_key',key));
 end if;
 return jsonb_build_object('allocations',allocations);
end $$;

-- Stable internal JSON boundary. Public order/customer data is never returned by stock APIs.
create function stock.order_input(p_source text,p_id uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare o public.orders%rowtype; mp public.marketplace_orders%rowtype; stage text; evidence timestamptz;
 lines jsonb:='[]'; i record; cat text; part text; parts text[]; v jsonb; sz text; sty text;
begin
 if p_source='shopee' then
  select * into mp from public.marketplace_orders where id=p_id and provider='shopee';
  if not found then return null; end if;
  stage:=case when mp.current_status in ('READY_TO_SHIP','PROCESSED') then 'to_ship'
   when mp.current_status in ('SHIPPED','TO_CONFIRM_RECEIVE','COMPLETED','TO_RETURN','RETURNED') then 'consume'
   when mp.current_status='CANCELLED' then 'cancelled' else 'waiting' end;
  evidence:=mp.latest_provider_update_at;
  for i in select * from public.marketplace_order_items where order_id=p_id and is_current order by line_no,id loop
   cat:=stock.category(null,i.title,coalesce(nullif(i.variation_sku,'.'),i.item_sku));
   parts:=case when cat='burnaway' then array['edible','wafer'] else array[coalesce(cat,'unknown')] end;
   foreach part in array parts loop
    v:=jsonb_build_object('source','shopee','line_key',i.id::text,'part',part,'category',part,'title',i.title,'sku',coalesce(nullif(i.variation_sku,'.'),i.item_sku),
     'provider_item_id',i.provider_item_id,'provider_variation_id',i.provider_variation_id,'variation',i.variation_name,'size',i.variation_name,'style',i.variation_name,'quantity',i.quantity);
    lines:=lines||jsonb_build_array(v);
   end loop;
  end loop;
  return jsonb_build_object('source',p_source,'order_id',p_id,'reference',mp.order_sn,'stage',stage,'evidence_at',evidence,'created_at',mp.placed_at,'lines',lines,'detail_complete',mp.detail_complete);
 end if;
 select * into o from public.orders where id=p_id;
 if not found then return null; end if;
 -- Shopee's canonical marketplace record exclusively owns its stock effects.
 select * into mp from public.marketplace_orders where internal_order_id=o.id and provider='shopee' order by id limit 1;
 if found then return jsonb_build_object('redirect',mp.id); end if;
 if lower(coalesce(o.source,'')) like '%shopee%' then return jsonb_build_object('ignored','Shopee stock belongs to marketplace order'); end if;
 if lower(concat_ws(' ',o.status,o.admin_status,o.fulfillment_stage)) like '%cancel%' then stage:='cancelled';
 elsif lower(coalesce(o.delivery_method,o.delivery,'')) like '%pickup%' then
  select max(sent_at) into evidence from public.notification_queue where order_id=o.id and event_type in ('order_ready_pickup','order_ready_pickup_auto') and status='sent' and sent_at>=o.pickup_ready_at;
  if o.pickup_ready_at is not null and evidence is not null then stage:='consume';
  elsif o.customer_confirmed or o.production_approved or lower(coalesce(o.payment_status,'')) in ('paid','cash_counter','matched') then stage:='to_ship'; else stage:='waiting'; end if;
 elsif lower(coalesce(o.shipment_status_group,'')) in ('picked_up','accepted_by_courier','in_transit','shipped','out_for_delivery','delivered') then stage:='consume';evidence:=o.shipment_updated_at;
 elsif lower(replace(coalesce(o.status,''),' ','_'))='shipped' then stage:='consume';evidence:=o.updated_at;
 elsif o.customer_confirmed or o.production_approved or lower(coalesce(o.payment_status,'')) in ('paid','cash_counter','matched') then stage:='to_ship'; else stage:='waiting'; end if;
 for i in select * from public.order_items where order_id=o.id order by sort_index,id loop
  cat:=stock.category(coalesce(nullif(i.k,''),i.product_type),i.title,i.product_snapshot->>'sku');
  parts:=case when cat='burnaway' then array['edible','wafer'] else array[coalesce(cat,'unknown')] end;
  foreach part in array parts loop
   sz:=case when cat='burnaway' then coalesce(i.customization#>>array['layers',part,'size'],i.size) else coalesce(i.customization->>'size',i.size) end;
   sty:=case when cat='burnaway' then coalesce(i.customization#>>array['layers',part,'shape'],i.style) else coalesce(i.customization->>'colour',i.customization->>'color',i.style) end;
   v:=jsonb_build_object('source','icetak','line_key',i.id::text,'part',part,'category',part,'title',i.title,'sku',i.product_snapshot->>'sku','product_id',i.product_id,'size',sz,'style',sty,'quantity',i.qty);
   lines:=lines||jsonb_build_array(v);
  end loop;
 end loop;
 return jsonb_build_object('source',p_source,'order_id',p_id,'reference',coalesce(o.order_no,o.order_id,o.id::text),'stage',stage,'evidence_at',evidence,'created_at',o.created_at,'lines',lines,'detail_complete',true);
end $$;

create function stock.apply_order(p_source text,p_id uuid,p_stage text,p_desired jsonb,p_evidence timestamptz) returns text language plpgsql set search_path='' as $$
declare st stock.order_state%rowtype; a stock.allocations%rowtype; m stock.materials%rowtype; d jsonb; wanted numeric; diff numeric; sig text; rev integer; blocked boolean:=false; normalized jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('line_key',x->>'line_key','part',x->>'part','material_code',x->>'material_code','quantity',round((x->>'quantity')::numeric,6)) order by x->>'line_key',x->>'part',x->>'material_code'),'[]') into normalized from jsonb_array_elements(p_desired) x;
 sig:=md5(normalized::text);
 select * into st from stock.order_state where source=p_source and order_id=p_id for update;
 if st.excluded_at is not null then return 'done'; end if;
 if st.consumed_at is not null then
  if p_stage not in ('cancelled','waiting') and st.desired_hash is distinct from sig then perform stock.issue(p_source,p_id,'','after_dispatch_edit','Item berubah selepas stock dipotong. Semak adjustment manual.',jsonb_build_object('before',st.desired,'after',p_desired));return 'blocked'; end if;
  return 'done';
 end if;
 rev:=st.revision+case when st.desired_hash is distinct from sig or st.stage is distinct from p_stage then 1 else 0 end;
 -- Lock the union of old/new materials in one consistent order.
 perform code from stock.materials where code in (
  select material_code from stock.allocations where source=p_source and order_id=p_id
  union select x->>'material_code' from jsonb_array_elements(p_desired) x
 ) order by code for update;
 if p_stage in ('cancelled','waiting') then
  for a in select * from stock.allocations where source=p_source and order_id=p_id and state='reserved' loop
   update stock.materials set reserved=reserved-a.quantity,updated_at=now() where code=a.material_code;
   update stock.allocations set state='released',updated_at=now() where source=a.source and order_id=a.order_id and line_key=a.line_key and part=a.part and material_code=a.material_code;
   insert into stock.movements(material_code,reserved_delta,kind,idempotency_key,source,order_id,reference,line_key,part,reason,actor)
   values(a.material_code,-a.quantity,'release',concat('release:',p_source,':',p_id,':',a.line_key,':',a.part,':',a.material_code,':',rev),p_source,p_id,st.reference,a.line_key,a.part,'Order batal atau belum To Ship','system');
  end loop;
  update stock.order_state set stage=p_stage,desired_hash=sig,desired=p_desired,revision=rev,review=null,updated_at=now() where source=p_source and order_id=p_id;
  return 'done';
 end if;
 if p_stage='consume' then
  for d in select value from jsonb_array_elements(p_desired) loop
   select * into m from stock.materials where code=d->>'material_code';
   if not m.auto_enabled or m.on_hand is null then
    perform stock.issue(p_source,p_id,d->>'line_key','opening_needed','Isi baki awal dan aktifkan auto untuk bahan ini.',jsonb_build_object('material_code',m.code));blocked:=true;
   elsif p_evidence is null or p_evidence<m.activated_at then
    perform stock.issue(p_source,p_id,d->>'line_key','before_activation','Penghantaran berlaku sebelum baki awal disahkan. Semak manual.',jsonb_build_object('material_code',m.code,'evidence_at',p_evidence));blocked:=true;
   end if;
  end loop;
  if blocked then return 'blocked'; end if;
 end if;
 -- Releases handle removed lines, changed colour/material and reduced quantities.
 for a in select * from stock.allocations where source=p_source and order_id=p_id and state='reserved' loop
  select (x->>'quantity')::numeric into wanted from jsonb_array_elements(p_desired) x where x->>'line_key'=a.line_key and x->>'part'=a.part and x->>'material_code'=a.material_code;
  wanted:=coalesce(wanted,0);diff:=wanted-a.quantity;
  if diff<>0 then
   update stock.materials set reserved=reserved+diff,updated_at=now() where code=a.material_code;
   if wanted=0 then update stock.allocations set state='released',updated_at=now() where source=a.source and order_id=a.order_id and line_key=a.line_key and part=a.part and material_code=a.material_code;
   else update stock.allocations set quantity=wanted,updated_at=now() where source=a.source and order_id=a.order_id and line_key=a.line_key and part=a.part and material_code=a.material_code;end if;
   insert into stock.movements(material_code,reserved_delta,kind,idempotency_key,source,order_id,reference,line_key,part,reason,actor)
   values(a.material_code,diff,'reserve_adjust',concat('adjust:',p_source,':',p_id,':',a.line_key,':',a.part,':',a.material_code,':',rev),p_source,p_id,st.reference,a.line_key,a.part,'Saiz, warna atau kuantiti order berubah','system');
  end if;
 end loop;
 for d in select value from jsonb_array_elements(p_desired) loop
  wanted:=(d->>'quantity')::numeric;
  select * into a from stock.allocations where source=p_source and order_id=p_id and line_key=d->>'line_key' and part=d->>'part' and material_code=d->>'material_code';
  if not found or a.state='released' then
   update stock.materials set reserved=reserved+wanted,updated_at=now() where code=d->>'material_code';
   insert into stock.allocations(source,order_id,line_key,part,material_code,quantity,state) values(p_source,p_id,d->>'line_key',d->>'part',d->>'material_code',wanted,'reserved')
    on conflict(source,order_id,line_key,part,material_code) do update set quantity=excluded.quantity,state='reserved',updated_at=now();
   insert into stock.movements(material_code,reserved_delta,kind,idempotency_key,source,order_id,reference,line_key,part,reason,actor)
    values(d->>'material_code',wanted,'reserve',concat('reserve:',p_source,':',p_id,':',d->>'line_key',':',d->>'part',':',d->>'material_code',':',rev),p_source,p_id,st.reference,d->>'line_key',d->>'part','Order To Ship','system');
  end if;
  if p_stage='consume' then
   update stock.materials set reserved=reserved-wanted,on_hand=on_hand-wanted,updated_at=now() where code=d->>'material_code' returning * into m;
   update stock.allocations set state='consumed',updated_at=now() where source=p_source and order_id=p_id and line_key=d->>'line_key' and part=d->>'part' and material_code=d->>'material_code';
   insert into stock.movements(material_code,delta,reserved_delta,kind,idempotency_key,source,order_id,reference,line_key,part,reason,actor)
    values(m.code,-wanted,-wanted,'order_use',concat('consume:',p_source,':',p_id,':',d->>'line_key',':',d->>'part',':',m.code),p_source,p_id,st.reference,d->>'line_key',d->>'part','Shipped atau pickup siap dan notifikasi berjaya','system');
   if m.on_hand<0 then perform stock.issue(p_source,p_id,d->>'line_key','shortage','Baki negatif selepas penghantaran. Semak kiraan fizikal atau pembelian.',jsonb_build_object('material_code',m.code,'balance',m.on_hand));end if;
  end if;
 end loop;
 update stock.order_state set stage=p_stage,desired_hash=sig,desired=p_desired,revision=rev,evidence_at=p_evidence,consumed_at=case when p_stage='consume' then now() end,review=null,updated_at=now() where source=p_source and order_id=p_id;
 return 'done';
end $$;

create function stock.process_order(p_source text,p_id uuid) returns text language plpgsql set search_path='' as $$
declare input jsonb; st stock.order_state%rowtype; line jsonb; result jsonb; desired jsonb:='[]'; has_error boolean:=false; cfg stock.settings%rowtype; stage text;
begin
 perform pg_advisory_xact_lock(hashtextextended('stock:'||p_source||':'||p_id::text,0));
 select * into cfg from stock.settings where singleton;
 if not cfg.enabled then return 'blocked'; end if;
 input:=stock.order_input(p_source,p_id);
 if input is null or input ? 'ignored' then return 'done'; end if;
 if input ? 'redirect' then perform stock.enqueue('shopee',(input->>'redirect')::uuid);return 'done';end if;
 stage:=input->>'stage';
 select * into st from stock.order_state where source=p_source and order_id=p_id;
 if not found then
  if stage not in ('to_ship','consume') then return 'done';end if;
  if stage='consume' and ((input->>'created_at') is null or (input->>'created_at')::timestamptz<cfg.started_at) then return 'done';end if;
  insert into stock.order_state(source,order_id,reference,stage,evidence_at) values(p_source,p_id,input->>'reference',stage,(input->>'evidence_at')::timestamptz);
 end if;
 update stock.issues set resolved_at=now() where source=p_source and order_id=p_id and resolved_at is null and code not in ('shortage','after_dispatch_edit');
 if stage='cancelled' then return stock.apply_order(p_source,p_id,stage,'[]',null);end if;
 if stage='waiting' then return 'done';end if;
 if jsonb_array_length(input->'lines')=0 or not coalesce((input->>'detail_complete')::boolean,false) then
  perform stock.issue(p_source,p_id,'','details_needed','Detail item order belum lengkap. Sistem akan cuba selepas detail masuk.');return 'blocked';
 end if;
 for line in select value from jsonb_array_elements(input->'lines') loop
  result:=stock.resolve_line(line);
  if result ? 'error' then
   has_error:=true;perform stock.issue(p_source,p_id,line->>'line_key','mapping_needed',result->>'error',line||result);
  else desired:=desired||(result->'allocations');end if;
 end loop;
 if has_error then update stock.order_state set review='Mapping belum lengkap',updated_at=now() where source=p_source and order_id=p_id;return 'blocked';end if;
 if exists(select 1 from jsonb_array_elements(desired) d group by d->>'line_key',d->>'part',d->>'material_code' having count(*)>1) then raise exception 'DUPLICATE_ALLOCATION';end if;
 return stock.apply_order(p_source,p_id,stage,desired,(input->>'evidence_at')::timestamptz);
end $$;

create function public.icetak_stock_process_queue(p_limit integer default 20) returns jsonb language plpgsql security invoker set search_path='' as $$
declare q record; result text; processed integer:=0;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('stock:writer',0)) then return jsonb_build_object('processed',0,'busy',true);end if;
 for q in select * from stock.work_queue where status='pending' and available_at<=now() order by available_at,source,order_id limit least(20,greatest(1,p_limit)) for update skip locked loop
  begin
   result:=stock.process_order(q.source,q.order_id);
   update stock.work_queue set status=result,attempts=attempts+1,last_error=null,updated_at=now() where source=q.source and order_id=q.order_id;
  exception when others then
   update stock.work_queue set status=case when attempts>=2 then 'failed' else 'pending' end,attempts=attempts+1,available_at=now()+interval '5 minutes',last_error=left(sqlerrm,300),updated_at=now() where source=q.source and order_id=q.order_id;
  end;
  processed:=processed+1;
 end loop;
 return jsonb_build_object('processed',processed);
end $$;

-- New canonical changes enqueue bounded work. No ClickUp/production status hook.
create function stock.order_trigger() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='marketplace_orders' then if new.provider='shopee' then perform stock.enqueue('shopee',new.id);end if;
 elsif tg_table_name='marketplace_order_items' then perform stock.enqueue('shopee',case when tg_op='DELETE' then old.order_id else new.order_id end);
 elsif tg_table_name='order_items' then perform stock.enqueue('icetak',case when tg_op='DELETE' then old.order_id else new.order_id end);
 elsif tg_table_name='notification_queue' then
  if new.status='sent' and new.sent_at is not null and new.event_type in ('order_ready_pickup','order_ready_pickup_auto') and new.order_id is not null then perform stock.enqueue('icetak',new.order_id);end if;
 else perform stock.enqueue('icetak',new.id);end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
create trigger stock_marketplace_order after insert or update of current_status,detail_complete,internal_order_id on public.marketplace_orders for each row execute function stock.order_trigger();
create trigger stock_marketplace_items after insert or update of is_current,quantity,title,variation_name,item_sku,variation_sku or delete on public.marketplace_order_items for each row execute function stock.order_trigger();
create trigger stock_direct_order after insert or update of status,payment_status,customer_confirmed,production_approved,shipment_status_group,pickup_ready_at on public.orders for each row execute function stock.order_trigger();
create trigger stock_direct_items after insert or update of qty,size,style,customization,product_type,k,title or delete on public.order_items for each row execute function stock.order_trigger();
create trigger stock_pickup_sent after insert or update of status,sent_at on public.notification_queue for each row execute function stock.order_trigger();

-- Tables/functions remain private even when public trigger source tables are exposed.
do $$ declare t record;begin
 for t in select tablename from pg_tables where schemaname='stock' loop
  execute format('alter table stock.%I enable row level security',t.tablename);
  execute format('revoke all on stock.%I from public,anon,authenticated',t.tablename);
  execute format('grant select,insert,update,delete on stock.%I to service_role',t.tablename);
 end loop;
end $$;
revoke update,delete on stock.movements,stock.audit,stock.admin_requests from service_role;
revoke all on all functions in schema stock from public,anon,authenticated;
grant execute on all functions in schema stock to service_role;
revoke all on function public.icetak_stock_process_queue(integer) from public,anon,authenticated;
grant execute on function public.icetak_stock_process_queue(integer) to service_role;

-- Approve only the A-size ratios explicitly agreed by the owner.
insert into stock.size_rules(category,size_key,rate,approved,actor)
select c,s,r,true,'owner-agreed-20261014' from unnest(array['edible','wafer','glossy','artpaper_gold','acrylic']) c cross join (values('A4',1::numeric),('A5',0.5),('A6',0.25),('A7',0.125)) x(s,r);
insert into stock.size_rules(category,size_key,approved)
select c,s||'in',false from unnest(array['edible','wafer']) c cross join unnest(array['3','3.5','4','4.5','5','5.5','6','6.5','7','7.5','8']) s;
insert into stock.size_rules(category,size_key) values('glossy','1pc');

-- Material seed follows the supplied workbook, appended below. Quantities stay NULL.
create function stock.wake() returns void language plpgsql set search_path='' as $$
begin
 update stock.work_queue set status='pending',attempts=0,available_at=now(),last_error=null,updated_at=now() where status in ('blocked','failed');
 insert into stock.work_queue(source,order_id)
 select source,order_id from stock.order_state where consumed_at is null and excluded_at is null
 on conflict(source,order_id) do update set status='pending',attempts=0,available_at=now(),last_error=null,updated_at=now();
end
$$;

create function public.icetak_stock_admin(p_action text,p_payload jsonb,p_actor text) returns jsonb language plpgsql security invoker set search_path='' as $$
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
 if p_action not in ('opening','purchase','manual_use','waste','adjustment','material_save','size_rule','item_rule','retry','exclude','settings') then raise exception 'INVALID_ACTION';end if;
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
   perform stock.apply_order(v_source,oid,'cancelled','[]',null);
   update stock.order_state set excluded_at=now(),review=reason where order_id=oid and order_state.source=v_source;
   update stock.issues set resolved_at=now() where order_id=oid and issues.source=v_source;
  else perform stock.enqueue(v_source,oid);end if;
 elsif p_action='settings' then
  update stock.settings set enabled=(p_payload->>'enabled')::boolean,actor=p_actor,updated_at=now() where singleton;
  if coalesce((p_payload->>'enabled')::boolean,false) then perform stock.wake();end if;
 end if;
 insert into stock.audit(action,actor,target,details) values(p_action,p_actor,coalesce(v_code,v_source||':'||oid,p_payload->>'size_key'),p_payload-'request_id');
 answer:=jsonb_build_object('saved',true,'request_id',request);
 insert into stock.admin_requests(request_id,actor,action,payload_hash,result) values(request,p_actor,p_action,h,answer);
 return answer;
end $$;
revoke all on function public.icetak_stock_admin(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.icetak_stock_admin(text,jsonb,text) to service_role;
revoke all on function stock.wake() from public,anon,authenticated;
grant execute on function stock.wake() to service_role;

insert into stock.materials(code,name,category,colour,base_unit,is_default,auto_eligible,note) values
('CU-1yzqnfk','Edible Image (pcs) standard 7.5inch','edible',null,'20',true,true,'Edible standard 7.5inch sahaja.'),
('CU-86cz5hxaf','wafer paper 0.3mm','wafer',null,'20',false,true,'Asingkan ketebalan 0.3mm dan 0.5mm.'),
('CU-86cz5hxd9','wafer paper 0.5mm','wafer',null,'10',false,true,'Asingkan ketebalan 0.3mm dan 0.5mm.'),
('CU-69qvhj','Glossy Paper Kami 230gsm (pcs=helai)','glossy',null,'60',true,true,null),
('ARTPAPER-GOLD','Artpaper Gold (Mirror Gold Artpaper)','artpaper_gold',null,'30',true,true,'Stok artpaper gold berasingan.'),
('CU-86czdhy1n','Acrylic Black 2mm','acrylic','Black','3',false,true,'Warna, finish dan ketebalan diasingkan.'),
('CU-86czdj0e8','Acrylic Bronze 2mm','acrylic','Bronze','3',false,true,'Warna, finish dan ketebalan diasingkan.'),
('CU-86czdhy1v','Acrylic Clear 2mm','acrylic','Clear / Transparent','5',false,true,'Warna, finish dan ketebalan diasingkan.'),
('CU-86czdhy20','Acrylic Dark Blue 2mm','acrylic','Dark Blue','5',false,true,'Warna, finish dan ketebalan diasingkan.'),
('CU-86czdhy1c','Acrylic Gold 2mm','acrylic','Gold','5',false,true,'Warna, finish dan ketebalan diasingkan.'),
('CU-86czdhy31','Acrylic Gold Glitter 2mm','acrylic','Gold Glitter','5',false,true,'Warna, finish dan ketebalan diasingkan.'),
('CU-86czdj0em','Acrylic Green 2mm','acrylic','Green','5',false,true,'Warna, finish dan ketebalan diasingkan.'),
('CU-86czdhy2b','Acrylic Light Blue 2mm','acrylic','Light Blue','5',false,true,'Warna, finish dan ketebalan diasingkan.'),
('CU-86czdj0e3','Acrylic Lilac 2mm','acrylic','Lilac','5',false,true,'Warna, finish dan ketebalan diasingkan.'),
('CU-86czdj0ed','Acrylic Mirror Blue 2mm','acrylic','Mirror Blue','5',false,true,'Warna, finish dan ketebalan diasingkan.'),
('CU-86czdj0et','Acrylic Orange 2mm','acrylic','Orange','5',false,true,'Warna, finish dan ketebalan diasingkan.'),
('CU-86czdhy2u','Acrylic Pink 2mm','acrylic','Pink','5',false,true,'Warna, finish dan ketebalan diasingkan.'),
('CU-86czdhy2f','Acrylic Red 2mm','acrylic','Red','5',false,true,'Warna, finish dan ketebalan diasingkan.'),
('CU-86czdhy3k','Acrylic Rose Gold 2mm','acrylic','Rose Gold','5',false,true,'Warna, finish dan ketebalan diasingkan.'),
('CU-86czdhy3c','Acrylic Silver 2mm','acrylic','Silver','5',false,true,'Warna, finish dan ketebalan diasingkan.'),
('CU-86czdhy36','Acrylic Silver Glitter 2mm','acrylic','Silver Glitter','5',false,true,'Warna, finish dan ketebalan diasingkan.'),
('CU-86czdj0ex','Acrylic White 2mm','acrylic','White','5',false,true,'Warna, finish dan ketebalan diasingkan.'),
('CU-86czdhy2n','Acrylic Yellow 2mm','acrylic','Yellow','5',false,true,'Warna, finish dan ketebalan diasingkan.'),
('CU-1yzqnqt','Double Tape (1pcs=1helai)','double_tape',null,'30',true,true,'Kadar sama seperti glossy paper.'),
('CU-86czdtv8u','3M Scotch Spray Mount 6065','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-69qvrp','Cameo Blade v3','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-69qvt3','Cameo Blade v4','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-86czdj1vk','Clear 3mm (stick)','other',null,'50',false,false,'Isi unit stock yang digunakan.'),
('CU-69qvj8','Gam lilin (pcs)','other',null,'5',false,false,'Isi unit stock yang digunakan.'),
('CU-86czm99kj','Inflatable Bubble Wrap Air Bubble Extra Thick 25cm','other',null,'2',false,false,'Isi unit stock yang digunakan.'),
('CU-86czm9kj5','Ink G1020 Canon 71 Biru','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-86czm9mf7','Ink G1020 Canon 71 Hitam','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-86czm9kur','Ink G1020 Canon 71 Kuning','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-86czm9kpu','Ink G1020 Canon 71 Merah','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-86czm9my7','Ink G1020 Edible Biru','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-86czm9n8c','Ink G1020 Edible Hitam','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-86czm9n4e','Ink G1020 Edible Kuning','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-86czm9n18','Ink G1020 Edible Merah','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-86czm9nrq','Ink GX6070 Canon 75 Biru','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-86czm9nxm','Ink GX6070 Canon 75 Hitam','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-86czm9nwt','Ink GX6070 Canon 75 Kuning','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-86czm9nvr','Ink GX6070 Canon 75 Merah','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-1yzqp3x','Kertas A4 (rim)','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-69qvkn','Lidi [toothpick] (kotak)','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-69qvkr','Lidi 10cm (pack)','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-86czm9aeu','MC-G01 Maintenance Cartridge (Printer)','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-86czm99g0','MC-G02 Maintenance Cartridge (Printer)','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-86czdtvrx','OPP supit ready 10x24cm','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-86czdtvj4','Pelapit cutting topper PVC Holder Hard A3','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-69qvn1','Plastic 6x9 (supit)','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-69qvmk','Plastic 7x10 (supit)','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-86czmhne7','Plastic 7x11 (supit)','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-86czmhnhg','Plastic 9x14 (supit)','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-86czn3e3c','Plastic Parcel 32x41','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-86czn3dyj','Plastic Parcel 35x47','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-86czm9ff2','seal tape bsr','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-86czm9fgv','seal tape kecil','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-86czm9p10','Sticker Photo Paper Kami 150gsm (1pack 12pcs)','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-69qvm9','Straw Biru Gelap (pack)','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-69qvmb','Straw Biru Muda (pack)','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-1yzqpz4','Straw Hijau Gelap (pack)','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-1yzqpyn','Straw Hijau Muda (pack)','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-1yzqpw9','Straw Hitam (pack)','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-86czmhnzf','Straw Kuning (pack)','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-1yzqpvw','Straw Merah (pack)','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-86czmhp8r','Straw Oren (pack)','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-1yzqpy6','Straw Pink Muda (pack)','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-69qvm6','Straw Pink Terang (pack)','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-86czmhpen','Straw Purple (pack)','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-69qvua','Topper Rack','other',null,'1',false,false,'Isi unit stock yang digunakan.'),
('CU-86czm9fp7','wrapping acrylic','other',null,'1',false,false,'Isi unit stock yang digunakan.');
