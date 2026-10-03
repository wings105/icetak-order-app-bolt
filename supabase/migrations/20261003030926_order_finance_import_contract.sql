create or replace function public.finance_import_order_finance(p_orders jsonb,p_shop_id bigint,p_currency text,p_actor text,p_commit boolean default false,p_expected_hash text default null) returns jsonb language plpgsql set search_path='' as $$
declare item jsonb;o public.marketplace_orders%rowtype;fs jsonb;m jsonb;result jsonb:='[]';batchkey text;current_ids jsonb;valid boolean:=true;state text;cnt integer:=0;refs integer:=0;dups integer:=0;
begin
 if p_actor is distinct from 'admin1' then raise exception 'Forbidden';end if;
 if jsonb_typeof(p_orders) is distinct from 'array' or jsonb_array_length(p_orders) not between 1 and 500 or octet_length(p_orders::text)>2000000 then raise exception 'Maksimum 500 order / 2MB satu import';end if;
 if p_shop_id is null or p_currency!~'^[A-Z]{3}$' then raise exception 'Pilih shop dan currency';end if;
 if exists(select 1 from jsonb_array_elements(p_orders)i group by i->>'order_sn' having count(*)>1) then raise exception 'Order ID berulang selepas grouping';end if;
 perform 1 from public.marketplace_orders where provider='shopee' and shop_id=p_shop_id::text and order_sn in(select i->>'order_sn'from jsonb_array_elements(p_orders)i) order by id for update;
 select coalesce(jsonb_agg(jsonb_build_array(o.id,(select max(id)from finance.order_finance_snapshots where order_id=o.id)) order by o.id),'[]') into current_ids from public.marketplace_orders o where provider='shopee' and shop_id=p_shop_id::text and order_sn in(select i->>'order_sn'from jsonb_array_elements(p_orders)i);
 batchkey:=md5(p_orders::text||p_shop_id::text||p_currency||current_ids::text);
 if p_commit and batchkey is distinct from p_expected_hash then raise exception 'Data berubah. Preview semula sebelum import';end if;
 for item in select value from jsonb_array_elements(p_orders) loop
  select * into o from public.marketplace_orders where provider='shopee' and shop_id=p_shop_id::text and order_sn=item->>'order_sn' and coalesce(metadata->>'dashboard_excluded','false')<>'true';
  fs:=finance.order_finance_fields(jsonb_build_object('excel_finance',item->'financials'));m:=finance.order_finance_metrics(fs);
  state:='import';
  if o.id is null then state:='unmatched';valid:=false;
  elsif o.currency is distinct from p_currency then state:='currency_mismatch';valid:=false;
  elsif jsonb_typeof(item->'financials') is distinct from 'object' or fs='{}' or exists(select 1 from jsonb_each(fs)e where e.value->>'role'<>'unmapped' and e.value->'value'<>'null'::jsonb and e.value->>'amount' is null) then state:='invalid';valid:=false;
  elsif exists(select 1 from finance.order_finance_snapshots where order_id=o.id and source='excel' and source_key=md5(item::text||p_currency)) then state:='duplicate';dups:=dups+1;
  elsif exists(select 1 from public.marketplace_order_financials where order_id=o.id and last_enriched_at is not null) then state:='reference_only';refs:=refs+1;
  elsif m->>'provider_nett' is null then
   if m->>'reconstructed_nett' is null or jsonb_array_length(m->'issues')>0 then state:='incomplete_finance';
   else m:=m||jsonb_build_object('provider_nett',m->'reconstructed_nett','reconciliation','report_estimate');end if;
  end if;
  result:=result||jsonb_build_array(jsonb_build_object('order_sn',item->>'order_sn','order_id',o.id,'state',state,'nett',m->'provider_nett','metrics',m));
 end loop;
 if p_commit then
  if not valid then raise exception 'Selesaikan semua baris tidak sah / tidak sepadan';end if;
  for item in select value from jsonb_array_elements(p_orders)loop
   select * into o from public.marketplace_orders where provider='shopee' and shop_id=p_shop_id::text and order_sn=item->>'order_sn';
   fs:=finance.order_finance_fields(jsonb_build_object('excel_finance',item->'financials'));m:=finance.order_finance_metrics(fs);
   if m->>'provider_nett' is null and m->>'reconstructed_nett' is not null and jsonb_array_length(m->'issues')=0 then m:=m||jsonb_build_object('provider_nett',m->'reconstructed_nett','reconciliation','report_estimate');end if;
   insert into finance.order_finance_snapshots(order_id,source,source_key,fields,metrics,actor)values(o.id,'excel',md5(item::text||p_currency),fs,m,p_actor)on conflict do nothing;
   if found then cnt:=cnt+1;end if;
  end loop;
  insert into finance.audit_log(actor,action,entity_type,entity_id,after_data)values(p_actor,'import_order_finance','finance_import',batchkey,jsonb_build_object('rows',jsonb_array_length(p_orders),'inserted',cnt,'reference_only',refs));
 end if;
 return jsonb_build_object('hash',batchkey,'valid',valid,'rows',result,'inserted',cnt,'reference_only',refs,'duplicates',dups,'committed',p_commit);
end $$;

notify pgrst,'reload schema';
