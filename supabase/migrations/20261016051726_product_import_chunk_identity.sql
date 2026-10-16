do $patch$
declare d text:=pg_get_functiondef('public.icetak_product_admin(text,jsonb,text)'::regprocedure);
begin
 d:=replace(d,'n int:=0; profile uuid;','n int:=0; row_start int:=0; profile uuid;');
 d:=replace(d,'for v in select value from jsonb_array_elements(p_body->''products'') loop','select row_count into row_start from product_import_batches where id=bid for update; for v in select value from jsonb_array_elements(p_body->''products'') loop');
 d:=replace(d,'values(bid,n+1,v->>''item_id''','values(bid,row_start+n+1,v->>''item_id''');
 d:=replace(d,'m#>>''{}'',m#>>''{}'',n,v->>''name''','m#>>''{}'',m#>>''{}'',(select count(*) from product_images where product_id=pid),v->>''name''');
 execute d;
end $patch$;
