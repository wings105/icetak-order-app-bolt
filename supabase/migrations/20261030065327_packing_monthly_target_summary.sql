do $$ declare def text; begin
select pg_get_functiondef('public.finance_contribution_report(jsonb)'::regprocedure) into def;
def:=replace(def,'count(*) filter(where r->>''included''=''true'') included_orders,',
'coalesce(sum((r->>''packing'')::numeric)filter(where r->>''included''=''true''),0) packing_total,coalesce(sum((r->>''packing'')::numeric)filter(where r->>''included''=''true'' and r->>''channel''=''shopee''),0) packing_shopee,coalesce(sum((r->>''packing'')::numeric)filter(where r->>''included''=''true'' and r->>''channel''=''deco''),0) packing_direct,count(*)filter(where r->>''included''=''true'' and r->>''packing'' is null) packing_missing,count(*) filter(where r->>''included''=''true'') included_orders,');
def:=replace(def,'''summary'',jsonb_build_object(''goal'',goal,','''summary'',jsonb_build_object(''packing_total'',packing_total,''packing_shopee'',packing_shopee,''packing_direct'',packing_direct,''packing_missing'',packing_missing,''goal'',goal,');
execute def;
end $$;