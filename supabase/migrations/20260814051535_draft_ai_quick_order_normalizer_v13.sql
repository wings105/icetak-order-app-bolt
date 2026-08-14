create or replace function public.icetak_enrich_draft_quick_order_v13(p_payload jsonb)
returns jsonb
language plpgsql
stable
set search_path to 'public','pg_temp'
as $function$
declare
  v jsonb:=coalesce(p_payload,'{}'::jsonb); out_items jsonb:='[]'::jsonb; item jsonb; msg jsonb;
  txt text; all_text text:=''; inbound_text text:=''; addr_raw text:=''; addr_clean text:=''; line text; lines text[]; started boolean:=false;
  postcode text:=''; city text:=''; state text:=''; k text; proc text; review text; sz text; sty text; wording text; ref text; p numeric; q int; valid_date date; delivery text; delivery_fee numeric; m text; i int:=0;
begin
  for msg in select value from jsonb_array_elements(coalesce(v#>'{evidence,messages}','[]'::jsonb)) loop
    txt:=btrim(coalesce(msg->>'text',''));
    if txt<>'' then all_text:=concat_ws(E'\n',all_text,txt); if lower(coalesce(msg->>'direction',''))='inbound' then inbound_text:=concat_ws(E'\n',inbound_text,txt); end if; end if;
  end loop;

  for msg in select value from jsonb_array_elements(coalesce(v#>'{evidence,messages}','[]'::jsonb)) where lower(coalesce(value->>'direction',''))='inbound' order by coalesce(value->>'at','') desc loop
    txt:=btrim(coalesce(msg->>'text',''));
    if txt ~ '\m[0-9]{5}\M' and txt ~* '\m(alamat|address|no\.?|lot|pt|jalan|jln|lorong|taman|kampung|kg\.?|felda|bandar|persiaran|blok|block|apartment|pangsapuri|condo|residensi)\M' then addr_raw:=txt; exit; end if;
  end loop;
  if addr_raw<>'' then
    m:=substring(addr_raw from '(?is)\m(?:alamat|address)\M\s*[:\-]?\s*(.+)$'); if coalesce(m,'')<>'' then addr_raw:=btrim(m); end if;
    lines:=regexp_split_to_array(addr_raw,E'\n+'); addr_clean:=''; started:=false;
    foreach line in array lines loop
      line:=btrim(line); if line='' then continue; end if;
      if line ~* '^\s*(?:tel|telefon|phone|hp|whatsapp)\s*[:\-]' or regexp_replace(line,'[^0-9]','','g') ~ '^0?1[0-9]{8,9}$' or regexp_replace(line,'[^0-9]','','g') ~ '^601[0-9]{8,9}$' then continue; end if;
      if not started and line ~* '\m(no\.?|lot|pt|jalan|jln|lorong|taman|kampung|kg\.?|felda|bandar|persiaran|blok|block|apartment|pangsapuri|condo|residensi)\M' then started:=true; end if;
      if not started and line ~ '\m[0-9]{5}\M' then started:=true; end if;
      if started then addr_clean:=concat_ws(E'\n',addr_clean,line); end if;
    end loop;
    if addr_clean='' then addr_clean:=addr_raw; end if;
    addr_clean:=regexp_replace(addr_clean,'^[[:space:]]+|[[:space:]]+$','','g');
    postcode:=coalesce(substring(addr_clean from '\m([0-9]{5})\M'),'');
    if addr_clean ~* '\mjohor\M' then state:='Johor'; elsif addr_clean ~* '\mkedah\M' then state:='Kedah'; elsif addr_clean ~* '\mkelantan\M' then state:='Kelantan'; elsif addr_clean ~* '\mmelaka\M' then state:='Melaka'; elsif addr_clean ~* '\mnegeri\s+sembilan\M' then state:='Negeri Sembilan'; elsif addr_clean ~* '\mpahang\M' then state:='Pahang'; elsif addr_clean ~* '\mperak\M' then state:='Perak'; elsif addr_clean ~* '\mperlis\M' then state:='Perlis'; elsif addr_clean ~* '\m(pulau\s+pinang|penang)\M' then state:='Pulau Pinang'; elsif addr_clean ~* '\msabah\M' then state:='Sabah'; elsif addr_clean ~* '\msarawak\M' then state:='Sarawak'; elsif addr_clean ~* '\mselangor\M' then state:='Selangor'; elsif addr_clean ~* '\mterengganu\M' then state:='Terengganu'; elsif addr_clean ~* '\mkuala\s+lumpur\M' then state:='Kuala Lumpur'; elsif addr_clean ~* '\mputrajaya\M' then state:='Putrajaya'; elsif addr_clean ~* '\mlabuan\M' then state:='Labuan'; end if;
    if postcode<>'' then city:=btrim(coalesce(substring(addr_clean from ('\m'||postcode||'\M\s+([^,\n]{2,40})')),'')); if state<>'' then city:=btrim(regexp_replace(city,'(?i)\s*'||regexp_replace(state,'([\W])','\\\1','g')||'\s*$','','g')); end if; city:=initcap(city); end if;
    v:=jsonb_set(v,'{customer}',coalesce(v->'customer','{}'::jsonb)||jsonb_build_object('address_line1',addr_clean,'postcode',postcode,'city',city,'state',state),true);
  end if;

  begin valid_date:=nullif(v->>'date_need','')::date; exception when others then valid_date:=null; end;
  if valid_date is null then v:=jsonb_set(v,'{date_need}','null'::jsonb,true); else v:=jsonb_set(v,'{date_need}',to_jsonb(valid_date::text),true); end if;
  delivery:=lower(coalesce(v->>'delivery','unknown')); delivery_fee:=case delivery when 'pickup' then 0 when 'spx' then 4.5 when 'jnt' then 5.9 when 'ninja' then 6.9 else greatest(0,coalesce(nullif(v->>'delivery_fee','')::numeric,0)) end; v:=jsonb_set(v,'{delivery_fee}',to_jsonb(delivery_fee),true);

  for item in select value from jsonb_array_elements(coalesce(v->'items','[]'::jsonb)) loop
    i:=i+1; k:=lower(coalesce(nullif(item->>'k',''),nullif(item->>'kind',''),nullif(item->>'product_type',''),'edible')); if k in ('topper','cake_topper') then k:='printed'; end if; if k not in ('edible','burnaway','wafer','printed','mirror','acrylic') then k:='edible'; end if;
    proc:=coalesce(nullif(item->>'process',''),'Pre-order'); if proc not in ('Pre-order','Urgent') then proc:=case when all_text ~* '\m(urgent|segera|rush)\M' then 'Urgent' else 'Pre-order' end; end if; if k='printed' then proc:='Pre-order'; end if;
    review:=case when k='printed' then 'Need Review' else 'No Review' end;
    sz:=btrim(coalesce(item->>'size',''));
    if k in ('acrylic','mirror') then if upper(sz)='A7' then sz:='A7 Mini'; elsif upper(sz)='A6' then sz:='A6 Standard'; elsif upper(sz)='A5' then sz:='A5 Large'; end if; elsif k='printed' then sz:='1 pc'; elsif sz<>'' and sz ~* '^[0-9]+(?:\.[0-9]+)?\s*(?:in|inch|inci)?$' then sz:=(regexp_match(sz,'([0-9]+(?:\.[0-9]+)?)'))[1]||' inch'; end if;
    if sz='' then m:=substring(all_text from '(?i)\m([0-9]+(?:\.[0-9]+)?)\s*(?:inch|inci|in)\M'); if coalesce(m,'')<>'' and k not in ('printed','mirror','acrylic') then sz:=m||' inch'; end if; end if;
    if sz='' then sz:=case k when 'edible' then '3 inch' when 'burnaway' then '5 inch' when 'wafer' then '3 inch' when 'printed' then '1 pc' else 'A7 Mini' end; end if;
    sty:=btrim(coalesce(item->>'style',''));
    if k in ('edible','burnaway','wafer') then if sty='' or sty ~* 'Editing|Existing Design|Glossy' then if all_text ~* '\m(round|bulat)\M' then sty:='Round / Bulat'; elsif all_text ~* '\m(square|petak)\M' then sty:='Square / Petak'; elsif all_text ~* '\m(love|heart|hati)\M' then sty:='Love Shape / Hati'; elsif k='edible' and all_text ~* '\mlandscape\M' then sty:='Full Landscape'; elsif k='edible' and all_text ~* '\mportrait\M' then sty:='Full Portrait'; else sty:='Round / Bulat'; end if; end if; elsif k='printed' then if sty not in ('Custom Name','Happy Birthday') then sty:=case when all_text ~* '\mhappy\s+birthday\M' then 'Happy Birthday' else 'Custom Name' end; end if; elsif k='mirror' then sty:='Gold'; elsif k='acrylic' and sty='' then sty:='Gold'; end if;
    wording:=btrim(coalesce(nullif(item->>'customText',''),nullif(item->>'custom_text',''),item->>'wording',''));
    if wording='' then m:=substring(inbound_text from '(?is)\m(?:wording|tulisan|nama|name)\M.{0,100}?\m(?:tukar\s+kepada|kepada)\M\s*:?\s*\*([^*\n]{2,180})\*'); if coalesce(m,'')='' then m:=substring(inbound_text from '(?is)\m(?:wording|tulisan|nama|name)\M\s*[:=\-]\s*\*?([^*\n]{2,180})'); end if; if coalesce(m,'')<>'' then wording:=btrim(m); end if; end if;
    q:=greatest(1,coalesce(nullif(item->>'qty','')::int,1)); p:=public.icetak_quick_order_price(k,proc,sz,sty,review); ref:=coalesce(nullif(item->>'referenceUrl',''),nullif(item->>'reference_url',''),nullif(item#>>'{customization,reference_url}',''),nullif(item#>>'{product_snapshot,image_url}',''),'');
    item:=item||jsonb_build_object('k',k,'kind',k,'product_type',k,'title',case k when 'edible' then 'Edible Image' when 'burnaway' then 'Burn Away Combo' when 'wafer' then 'Wafer Paper Only' when 'printed' then 'Cake Topper' when 'mirror' then 'Mirror Gold Artpaper' when 'acrylic' then 'Acrylic Cake Topper' end,'process',proc,'review',review,'review_required',(review='Need Review'),'size',sz,'style',sty,'qty',q,'price',p,'wording',wording,'customText',wording,'custom_text',wording,'referenceUrl',ref,'customization',coalesce(item->'customization','{}'::jsonb)||jsonb_build_object('admin_process',proc),'product_snapshot',coalesce(item->'product_snapshot','{}'::jsonb)||jsonb_build_object('quick_arrange_kind',k));
    if ref<>'' then item:=jsonb_set(item,'{customization}',item->'customization'||jsonb_build_object('reference_url',ref),true); item:=jsonb_set(item,'{product_snapshot}',item->'product_snapshot'||jsonb_build_object('image_url',ref),true); end if; out_items:=out_items||jsonb_build_array(item);
  end loop;
  v:=jsonb_set(v,'{items}',out_items,true); v:=jsonb_set(v,'{evidence}',coalesce(v->'evidence','{}'::jsonb)||jsonb_build_object('worker_version','qrpay-ai-draft-v13-quick-order-contract','quick_order_contract','v1'),true); return v;
end
$function$;

revoke all on function public.icetak_enrich_draft_quick_order_v13(jsonb) from public,anon,authenticated;
grant execute on function public.icetak_enrich_draft_quick_order_v13(jsonb) to service_role;

do $do$
declare fn oid; def text; needle text:='if jsonb_typeof(coalesce(p_payload->''items'',''[]''::jsonb)) <> ''array'' or jsonb_array_length(coalesce(p_payload->''items'',''[]''::jsonb))=0 then raise exception ''AI extracted no order items''; end if;';
begin select p.oid into fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='icetak_create_or_update_qrpay_draft' limit 1; def:=pg_get_functiondef(fn); if position('icetak_enrich_draft_quick_order_v13' in def)=0 then if position(needle in def)=0 then raise exception 'qrpay create draft injection point not found'; end if; def:=replace(def,needle,needle||E'\n  p_payload:=public.icetak_enrich_draft_quick_order_v13(p_payload);'); execute def; end if; end $do$;

do $do$
declare fn oid; def text; needle text:='if jsonb_typeof(coalesce(p_payload->''items'',''[]''::jsonb))<>''array'' or jsonb_array_length(coalesce(p_payload->''items'',''[]''::jsonb))=0 then raise exception ''At least one draft item required''; end if;';
begin select p.oid into fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='icetak_create_generic_order_draft' limit 1; def:=pg_get_functiondef(fn); if position('icetak_enrich_draft_quick_order_v13' in def)=0 then if position(needle in def)=0 then raise exception 'generic create draft injection point not found'; end if; def:=replace(def,needle,needle||E'\n  p_payload:=public.icetak_enrich_draft_quick_order_v13(p_payload);'); execute def; end if; end $do$;