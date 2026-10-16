do $patch$
declare d text:=pg_get_functiondef('public.icetak_product_admin(text,jsonb,text)'::regprocedure);
begin
 d:=replace(d,'jsonb_object_agg(status,n)','jsonb_object_agg(counts.status,counts.n)');
 d:=replace(d,'coalesce(sum(n),0)','coalesce(sum(counts.n),0)');
 execute d;
end $patch$;
