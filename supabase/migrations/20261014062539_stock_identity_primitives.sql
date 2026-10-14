select pg_advisory_xact_lock(hashtextextended('stock:writer',0));
-- Late canonical linking transfers reservations or keeps the proven prior deduction.
alter table stock.order_state add column source_hash text, add column first_consume_evidence timestamptz;
create function stock.input_hash(p jsonb) returns text language sql immutable set search_path='' as $$
 select md5(coalesce(jsonb_agg(jsonb_build_object('line_key',x->>'line_key','part',x->>'part','quantity',x->>'quantity','size',coalesce(stock.size_key(x->>'size'),x->>'size'),'choice',case when x->>'category'='acrylic' then coalesce(stock.colour_name(x->>'style'),stock.colour_name(split_part(coalesce(x->>'variation',''),',',1)),x->>'style',x->>'variation') else stock.shape_key(x->>'style') end) order by x->>'line_key',x->>'part'),'[]')::text) from jsonb_array_elements(p->'lines') x
$$;
revoke all on function stock.input_hash(jsonb) from public,anon,authenticated;
grant execute on function stock.input_hash(jsonb) to service_role;
create or replace function stock.apply_order(p_source text,p_id uuid,p_stage text,p_desired jsonb,p_evidence timestamptz) returns text language plpgsql set search_path='' as $$
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
 if p_stage in ('cancelled','waiting','excluded','ownership_transfer') then
  for a in select * from stock.allocations where source=p_source and order_id=p_id and state='reserved' loop
   update stock.materials set reserved=reserved-a.quantity,updated_at=now() where code=a.material_code;
   update stock.allocations set state='released',updated_at=now() where source=a.source and order_id=a.order_id and line_key=a.line_key and part=a.part and material_code=a.material_code;
   insert into stock.movements(material_code,reserved_delta,kind,idempotency_key,source,order_id,reference,line_key,part,reason,actor)
   values(a.material_code,-a.quantity,'release',concat('release:',p_source,':',p_id,':',a.line_key,':',a.part,':',a.material_code,':',rev),p_source,p_id,st.reference,a.line_key,a.part,case when p_stage='ownership_transfer' then 'Reserve dipindah kepada order linked' when p_stage='excluded' then 'Penggunaan sudah termasuk dalam baki awal' else 'Order batal atau belum To Ship' end,'system');
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
create function stock.reconcile_link(p_marketplace uuid,p_direct uuid) returns text language plpgsql set search_path='' as $$
declare prior stock.order_state%rowtype; current_state stock.order_state%rowtype; ref text;
begin
 select * into prior from stock.order_state where source='icetak' and order_id=p_direct for update;
 if not found or prior.excluded_at is not null then return 'done';end if;
 select * into current_state from stock.order_state where source='shopee' and order_id=p_marketplace for update;
 if prior.consumed_at is not null then
  if current_state.excluded_at is not null then return 'done';end if;
  if current_state.consumed_at is not null then
   perform stock.issue('shopee',p_marketplace,'','linked_duplicate','Dua order linked sudah mempunyai rekod potongan. Semak adjustment manual.',jsonb_build_object('icetak_order_id',p_direct));
   return 'blocked';
  end if;
  if current_state.order_id is not null then perform stock.apply_order('shopee',p_marketplace,'ownership_transfer','[]',null);
  else
   select order_sn into ref from public.marketplace_orders where id=p_marketplace;
   insert into stock.order_state(source,order_id,reference,stage) values('shopee',p_marketplace,coalesce(ref,p_marketplace::text),'linked_accounted');
  end if;
  update stock.order_state set excluded_at=now(),review='Stock sudah dipotong pada order iCetak linked',updated_at=now() where source='shopee' and order_id=p_marketplace;
  update stock.issues set resolved_at=now() where source='shopee' and order_id=p_marketplace and code<>'linked_duplicate';
 else
  perform stock.apply_order('icetak',p_direct,'ownership_transfer','[]',null);
  update stock.order_state set excluded_at=now(),review='Stock dimiliki order marketplace linked',updated_at=now() where source='icetak' and order_id=p_direct;
  update stock.issues set resolved_at=now() where source='icetak' and order_id=p_direct;
 end if;
 insert into stock.audit(action,actor,target,details) values('linked_order_stock','system',p_marketplace::text,jsonb_build_object('icetak_order_id',p_direct,'already_consumed',prior.consumed_at is not null));
 return 'done';
end $$;
revoke all on function stock.reconcile_link(uuid,uuid) from public,anon,authenticated;
grant execute on function stock.reconcile_link(uuid,uuid) to service_role;
