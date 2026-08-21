-- Keep seller menus, full price lists and courier-choice menus as visible evidence,
-- but never mistake those broadcasts for the customer's accepted order details.
create or replace function public.icetak_is_automated_quote_noise_v1(p_text text)
returns boolean
language sql
immutable
as $$
  select coalesce(
    (
      length(p_text) >= 160
      and p_text ~* '(price[[:space:]]*list|harga[[:space:]]*panduan|senarai[[:space:]]*harga)'
    )
    or (
      length(p_text) >= 80
      and p_text ~* '(edible|icing[[:space:]]*sheet)'
      and p_text ~* '(acrylic|akrilik|wafer|burn[[:space:]]*away)'
      and p_text ~* '(menerima[[:space:]]*order|nak[[:space:]]*order|cake[[:space:]]*topper)'
    )
    or (
      p_text ~* '(spx|shopee[[:space:]]*express)'
      and p_text ~* '(j[[:space:]]*&?[[:space:]]*t|jnt|ninja[[:space:]]*van|ninjavan)'
    ),
    false
  );
$$;

do $patch$
declare
  v_definition text;
  v_original text;
  v_updated text;
begin
  select pg_get_functiondef('public.icetak_enrich_draft_quick_order_v14_core(jsonb)'::regprocedure)
    into v_definition;

  v_original := $before$
    txt:=btrim(coalesce(msg->>'text',''));
    if txt='' then continue; end if;
$before$;
  v_updated := $after$
    txt:=btrim(coalesce(msg->>'text',''));
    if txt='' then continue; end if;
    if source_type in ('chat_trigger','pickup_trigger')
      and lower(coalesce(msg->>'direction',''))='outbound'
      and public.icetak_is_automated_quote_noise_v1(txt)
    then continue; end if;
$after$;
  if strpos(v_definition, v_original) = 0 then
    raise exception 'Unable to locate generic draft transcript enrichment block';
  end if;
  v_definition := replace(v_definition, v_original, v_updated);

  v_original := $before$
      txt:=btrim(coalesce(msg->>'text',''));
      if txt ~* 'spx|shopee[[:space:]]*express' then delivery:='spx'; delivery_fee:=4.5; exit;
$before$;
  v_updated := $after$
      txt:=btrim(coalesce(msg->>'text',''));
      if source_type in ('chat_trigger','pickup_trigger')
        and lower(coalesce(msg->>'direction',''))='outbound'
        and public.icetak_is_automated_quote_noise_v1(txt)
      then continue; end if;
      if txt ~* 'spx|shopee[[:space:]]*express' then delivery:='spx'; delivery_fee:=4.5; exit;
$after$;
  if strpos(v_definition, v_original) = 0 then
    raise exception 'Unable to locate generic draft delivery inference block';
  end if;
  v_definition := replace(v_definition, v_original, v_updated);

  v_original := $before$
    if source_type in ('chat_trigger','pickup_trigger') and generic_override_kind<>'' then k:=generic_override_kind; end if;
$before$;
  v_updated := $after$
    if source_type in ('chat_trigger','pickup_trigger')
      and generic_override_kind<>''
      and coalesce(nullif(item->>'k',''),nullif(item->>'kind',''),nullif(item->>'product_type','')) is null
    then k:=generic_override_kind; end if;
$after$;
  if strpos(v_definition, v_original) = 0 then
    raise exception 'Unable to locate generic draft product override block';
  end if;
  v_definition := replace(v_definition, v_original, v_updated);

  v_original := $before$
    loop
      for line in select btrim(x) from regexp_split_to_table(coalesce(msg->>'text',''),E'\n+') x loop
$before$;
  v_updated := $after$
    loop
      if source_type in ('chat_trigger','pickup_trigger')
        and public.icetak_is_automated_quote_noise_v1(coalesce(msg->>'text',''))
      then continue; end if;
      for line in select btrim(x) from regexp_split_to_table(coalesce(msg->>'text',''),E'\n+') x loop
$after$;
  if strpos(v_definition, v_original) = 0 then
    raise exception 'Unable to locate generic draft seller quote parsing block';
  end if;
  v_definition := replace(v_definition, v_original, v_updated);

  execute v_definition;
end;
$patch$;
