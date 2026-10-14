-- The supplied unit column contains numeric pack hints, not a physical unit.
-- No opening balance has been entered; existing reservations already use A4 rates.
select pg_advisory_xact_lock(hashtextextended('stock:writer',0));
update stock.materials set base_unit='helai A4 setara',updated_at=now() where auto_eligible and on_hand is null;
update stock.materials set base_unit=null,updated_at=now() where not auto_eligible and on_hand is null and base_unit ~ '^[0-9]+([.][0-9]+)?$';
alter table stock.materials add constraint stock_auto_material_unit check (not auto_eligible or base_unit='helai A4 setara');
insert into stock.audit(action,actor,target,details) values('material_unit_setup','system','seed',jsonb_build_object('auto_unit','helai A4 setara','physical_balance_changed',false));
