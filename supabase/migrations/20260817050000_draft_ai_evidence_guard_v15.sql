-- Evidence-first guard for generic WhatsApp order drafts.
-- Keeps the existing V14 normalizer as the canonical variation/price engine,
-- but removes automation noise and prevents it from overriding product type.

create or replace function public.icetak_draft_message_is_noise_v15(p_message jsonb)
returns boolean
language sql
immutable
set search_path = 'public', 'pg_temp'
as $$
  select lower(coalesce(p_message->>'direction','')) = 'outbound'
    and coalesce(p_message->>'text','') ~* (
      'Terima kasih hubungi DecoCake|save for order:|Menerima order:|'
      'HARGA ACRYLIC|RUJUKAN SAIZ MAKSIMUM|Prefer courier apa\?|'
      'Semenanjung shj|_WM:[[:space:]]*sent address'
    );
$$;

create or replace function public.icetak_date_need_from_messages_v15(p_messages jsonb)
returns date
language plpgsql
immutable
set search_path = 'public', 'pg_temp'
as $$
declare
  msg jsonb;
  txt text;
  msg_at timestamptz;
  base_date date;
  mm text[];
  d integer;
  mo integer;
  y integer;
  target_dow integer;
  current_dow integer;
  day_delta integer;
begin
  for msg in
    select value
    from jsonb_array_elements(coalesce(p_messages,'[]'::jsonb))
    where lower(coalesce(value->>'direction','')) = 'inbound'
    order by coalesce(value->>'at','') desc
  loop
    txt := lower(btrim(coalesce(msg->>'text','')));
    if txt = '' then continue; end if;

    -- A date printed in the design wording is not automatically Date Need.
    if txt !~ '(nak|nk|nok|guna|pakai|need|before|sebelum|pickup|pick[[:space:]]*up|ambil|ambik|amik|siap|dapat|sampai|hantar|pos|pun[[:space:]]+(xpe|takpe)|tak[[:space:]]*apa)' then
      continue;
    end if;

    begin
      msg_at := nullif(msg->>'at','')::timestamptz;
    exception when others then
      msg_at := null;
    end;
    base_date := coalesce((msg_at at time zone 'Asia/Kuala_Lumpur')::date, current_date);

    mm := regexp_match(txt,'([0-9]{1,2})[./-]([0-9]{1,2})(?:[./-]([0-9]{2,4}))?','i');
    if mm is not null then
      d := mm[1]::integer;
      mo := mm[2]::integer;
      y := coalesce(nullif(mm[3],''),extract(year from base_date)::integer::text)::integer;
      if y < 100 then y := y + 2000; end if;
      begin return make_date(y,mo,d); exception when others then null; end;
    end if;

    mm := regexp_match(txt,'([0-9]{1,2})[[:space:]]*(hb|haribulan)','i');
    if mm is not null then
      d := mm[1]::integer;
      mo := extract(month from base_date)::integer;
      y := extract(year from base_date)::integer;
      if d < extract(day from base_date)::integer - 3 then
        mo := mo + 1;
        if mo > 12 then mo := 1; y := y + 1; end if;
      end if;
      begin return make_date(y,mo,d); exception when others then null; end;
    end if;

    if txt ~ '\mlusa\M' then return base_date + 2; end if;
    if txt ~ '\m(esok|tomorrow)\M' then return base_date + 1; end if;

    target_dow := case
      when txt ~ 'isnin|monday' then 1
      when txt ~ 'selasa|tuesday' then 2
      when txt ~ 'rabu|wednesday' then 3
      when txt ~ 'khamis|thursday' then 4
      when txt ~ 'jumaat|jumat|friday' then 5
      when txt ~ 'sabtu|saturday' then 6
      when txt ~ 'ahad|sunday' then 7
      else null
    end;
    if target_dow is not null then
      current_dow := extract(isodow from base_date)::integer;
      day_delta := (target_dow - current_dow + 7) % 7;
      if day_delta = 0 and txt ~ 'depan|next' then day_delta := 7; end if;
      return base_date + day_delta;
    end if;
  end loop;
  return null;
end;
$$;

create or replace function public.icetak_enrich_draft_quick_order_v15(p_payload jsonb)
returns jsonb
language plpgsql
stable
set search_path = 'public', 'pg_temp'
as $$
declare
  original jsonb := coalesce(p_payload,'{}'::jsonb);
  work jsonb := coalesce(p_payload,'{}'::jsonb);
  result jsonb;
  original_messages jsonb := coalesce(p_payload#>'{evidence,messages}','[]'::jsonb);
  scoped_messages jsonb := '[]'::jsonb;
  ignored_ids jsonb := '[]'::jsonb;
  msg jsonb;
  msg_at timestamptz;
  latest_at timestamptz;
  previous_at timestamptz;
  latest_gap_start timestamptz;
  recent_start timestamptz;
  source_type text := lower(coalesce(p_payload->>'source_type',''));
  item jsonb;
  original_item jsonb;
  out_items jsonb := '[]'::jsonb;
  item_count integer := jsonb_array_length(coalesce(p_payload->'items','[]'::jsonb));
  detected_kind text := '';
  detection_reason text := '';
  detection_message_id text := '';
  txt text;
  raw_price numeric;
  raw_size text;
  raw_process text;
  raw_style text;
  candidate_count integer := 0;
  candidate_kind text := '';
  candidate_price numeric;
  detected_date date;
  i integer := 0;
  review_value text;
begin
  select max((value->>'at')::timestamptz)
    into latest_at
  from jsonb_array_elements(original_messages)
  where nullif(value->>'at','') is not null;
  latest_at := coalesce(latest_at,now());

  if source_type in ('chat_trigger','pickup_trigger') then
    previous_at := null;
    for msg in
      select value from jsonb_array_elements(original_messages)
      where nullif(value->>'at','') is not null
      order by (value->>'at')::timestamptz
    loop
      msg_at := (msg->>'at')::timestamptz;
      if previous_at is not null and msg_at - previous_at > interval '8 hours' then
        latest_gap_start := msg_at;
      end if;
      previous_at := msg_at;
    end loop;
    recent_start := coalesce(latest_gap_start,latest_at - interval '36 hours');
  else
    recent_start := '-infinity'::timestamptz;
  end if;

  for msg in
    select value from jsonb_array_elements(original_messages)
    order by coalesce(value->>'at','')
  loop
    begin msg_at := nullif(msg->>'at','')::timestamptz;
    exception when others then msg_at := latest_at; end;

    if msg_at < recent_start or public.icetak_draft_message_is_noise_v15(msg) then
      ignored_ids := ignored_ids || jsonb_build_array(msg->>'id');
      continue;
    end if;
    scoped_messages := scoped_messages || jsonb_build_array(msg);
  end loop;

  work := jsonb_set(work,'{evidence,messages}',scoped_messages,true);

  -- V15 owns current-session scoping and product detection. Use a neutral source
  -- while calling V14 so its transcript-wide priority cannot collapse items.
  if source_type in ('chat_trigger','pickup_trigger') then
    work := jsonb_set(work,'{source_type}',to_jsonb('v15_scoped'::text),true);
    work := jsonb_set(work,'{date_need}','null'::jsonb,true);
    work := jsonb_set(work,'{delivery}',to_jsonb('unknown'::text),true);
    work := jsonb_set(work,'{delivery_fee}',to_jsonb(0),true);
  end if;

  if item_count = 1 and source_type in ('chat_trigger','pickup_trigger') then
    for msg in
      select value from jsonb_array_elements(scoped_messages)
      order by coalesce(value->>'at','') desc
    loop
      txt := lower(btrim(coalesce(msg->>'text','')));
      if txt = '' then continue; end if;
      if txt ~ '(burn[[:space:]]*away|burnaway)' then detected_kind := 'burnaway';
      elsif txt ~ '(mirror[[:space:]]*gold|artpaper)' then detected_kind := 'mirror';
      elsif txt ~ '(acrylic|akrilik|arylic|ayrlic|arcylic)' then detected_kind := 'acrylic';
      elsif txt ~ '(^|[^a-z])(edible|icing[[:space:]]*sheet)([^a-z]|$)|print[[:space:]]+(gambar|image|imej|ni|ini)' then detected_kind := 'edible';
      elsif txt ~ '(burn[[:space:]]*away[[:space:]]*)?wafer' then detected_kind := 'wafer';
      elsif txt ~ '(printed[[:space:]]*topper|topper[[:space:]]*paper|cake[[:space:]]*topper[[:space:]]*tema|glossy[[:space:]]*topper)' then detected_kind := 'printed';
      end if;
      if detected_kind <> '' then
        detection_reason := 'latest_explicit_product_message';
        detection_message_id := coalesce(msg->>'id','');
        exit;
      end if;
    end loop;

    original_item := original->'items'->0;
    if detected_kind = '' then
      raw_price := coalesce(nullif(original_item->>'price','')::numeric,0);
      raw_size := btrim(coalesce(original_item->>'size',''));
      raw_process := coalesce(nullif(original_item->>'process',''),'Pre-order');
      raw_style := btrim(coalesce(original_item->>'style',''));
      if raw_price > 0 and raw_size <> '' then
        foreach candidate_kind in array array['edible','acrylic','printed','wafer','mirror','burnaway'] loop
          candidate_price := public.icetak_quick_order_price(
            candidate_kind,
            raw_process,
            raw_size,
            case candidate_kind
              when 'acrylic' then coalesce(nullif(raw_style,''),'Gold')
              when 'edible' then coalesce(nullif(raw_style,''),'Round / Bulat')
              when 'printed' then coalesce(nullif(raw_style,''),'Editing / Existing Design — Glossy')
              else raw_style
            end,
            'Need Review'
          );
          if candidate_price = raw_price then
            candidate_count := candidate_count + 1;
            detected_kind := candidate_kind;
          end if;
        end loop;
        if candidate_count = 1 then
          detection_reason := 'unique_quick_order_price_and_size';
        else
          detected_kind := '';
        end if;
      end if;
    end if;

    if detected_kind <> '' then
      original_item := coalesce(work->'items'->0,'{}'::jsonb)
        || jsonb_build_object('k',detected_kind,'kind',detected_kind,'product_type',detected_kind);
      work := jsonb_set(work,'{items,0}',original_item,true);
    end if;
  end if;

  result := public.icetak_enrich_draft_quick_order_v14_core(work);

  if source_type in ('chat_trigger','pickup_trigger') then
    detected_date := public.icetak_date_need_from_messages_v15(scoped_messages);
    result := jsonb_set(result,'{date_need}',coalesce(to_jsonb(detected_date::text),'null'::jsonb),true);
    result := jsonb_set(result,'{source_type}',to_jsonb(source_type),true);
    if source_type = 'pickup_trigger' then
      result := jsonb_set(result,'{delivery}',to_jsonb('pickup'::text),true);
      result := jsonb_set(result,'{delivery_fee}',to_jsonb(0),true);
    end if;
  end if;

  -- Preserve the upstream review decision. The trigger already defaults custom
  -- products to Need Review; V14 must not silently change them to No Review.
  for item in select value from jsonb_array_elements(coalesce(result->'items','[]'::jsonb)) loop
    original_item := original->'items'->i;
    review_value := coalesce(nullif(original_item->>'review',''),'Need Review');
    if review_value not in ('Need Review','No Review') then review_value := 'Need Review'; end if;
    item := item || jsonb_build_object('review',review_value,'review_required',(review_value='Need Review'));
    out_items := out_items || jsonb_build_array(item);
    i := i + 1;
  end loop;
  result := jsonb_set(result,'{items}',out_items,true);

  result := jsonb_set(result,'{evidence}',
    coalesce(result->'evidence','{}'::jsonb)
    || jsonb_build_object(
      'messages',original_messages,
      'worker_version','qrpay-ai-draft-v15-evidence-guard',
      'feedback_scope',case when source_type in ('chat_trigger','pickup_trigger') then 'noise_filtered_latest_segment' else 'frozen_payment_deal' end,
      'ignored_message_ids',ignored_ids,
      'scoped_message_ids',(select coalesce(jsonb_agg(value->>'id'),'[]'::jsonb) from jsonb_array_elements(scoped_messages)),
      'product_detection',jsonb_build_object('kind',nullif(detected_kind,''),'reason',nullif(detection_reason,''),'message_id',nullif(detection_message_id,'')),
      'date_need_detection',jsonb_build_object('value',detected_date,'requires_admin',detected_date is null),
      'applied_learning_rules',jsonb_build_array('ignore_automation_noise','latest_explicit_product','unique_quick_order_price_and_size','date_requires_need_cue','preserve_upstream_review')
    ),true);
  return result;
end;
$$;

insert into public.private_runtime_settings(setting_key,setting_value)
values('draft_ai_normalizer_version','v14')
on conflict(setting_key) do nothing;

create or replace function public.icetak_enrich_draft_quick_order_v13(p_payload jsonb)
returns jsonb
language plpgsql
stable
set search_path = 'public', 'pg_temp'
as $$
declare
  normalizer_version text;
begin
  select setting_value into normalizer_version
  from public.private_runtime_settings
  where setting_key='draft_ai_normalizer_version';

  if lower(coalesce(normalizer_version,'v14'))='v15' then
    return public.icetak_apply_draft_price_overrides_v15(
      public.icetak_clean_draft_address_v14(
        public.icetak_enrich_draft_quick_order_v15(p_payload)
      )
    );
  end if;

  return public.icetak_apply_draft_price_overrides_v15(
    public.icetak_clean_draft_address_v14(
      public.icetak_enrich_draft_quick_order_v14_core(p_payload)
    )
  );
end;
$$;

revoke all on function public.icetak_draft_message_is_noise_v15(jsonb) from public, anon, authenticated;
revoke all on function public.icetak_date_need_from_messages_v15(jsonb) from public, anon, authenticated;
revoke all on function public.icetak_enrich_draft_quick_order_v15(jsonb) from public, anon, authenticated;
grant execute on function public.icetak_draft_message_is_noise_v15(jsonb) to service_role;
grant execute on function public.icetak_date_need_from_messages_v15(jsonb) to service_role;
grant execute on function public.icetak_enrich_draft_quick_order_v15(jsonb) to service_role;
