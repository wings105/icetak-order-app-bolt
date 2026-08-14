-- Production patch retained for migration-history parity.
-- The full current definition is in 20260814051535_draft_ai_quick_order_normalizer_v13.sql.
do $do$
declare fn oid; def text; old text; new text;
begin
  select p.oid into fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='icetak_enrich_draft_quick_order_v13' limit 1;
  def:=pg_get_functiondef(fn);
  old:=$x$review:=coalesce(nullif(item->>'review',''),case when coalesce(nullif(item->>'review_required','')::boolean,false) then 'Need Review' else null end,case when k='printed' then 'Need Review' else 'No Review' end);
    if review not in ('No Review','Need Review') then review:=case when k='printed' then 'Need Review' else 'No Review' end; end if;$x$;
  new:=$x$review:=case when k='printed' then 'Need Review' else 'No Review' end;$x$;
  if position(old in def)>0 then def:=replace(def,old,new); execute def; end if;
end $do$;