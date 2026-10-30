begin;
do $$
declare r jsonb;
begin
r:=finance.margin_breakdown('[{"channel":"deco","sales":10,"fee":0,"courier":0,"nett":10,"material":2,"packing":0,"extras":0,"contribution":8},{"channel":"deco","sales":null,"fee":null,"courier":0,"nett":4,"material":null,"packing":0,"extras":0,"contribution":null}]');
if r->>'sales'<>'10' or r#>>'{known,sales}'<>'1' or r->>'fee'<>'0' or r->>'partial'<>'true' or r->>'contribution'<>'8' then raise exception 'Partial coverage incorrect';end if;
r:=finance.margin_breakdown('[{}]');
if r->>'sales' is not null or r#>>'{known,sales}'<>'0' then raise exception 'Unknown was invented as zero';end if;
r:=finance.margin_breakdown('[]');
if r->>'sales'<>'0' or r->>'partial'<>'false' then raise exception 'Empty cohort incorrect';end if;
end $$;
rollback;
