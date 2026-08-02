create or replace function public.icetak_validate_confirmed_customer_address()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_word_count integer;
  v_state text;
begin
  if new.archived_at is not null then
    return new;
  end if;

  -- Imported marketplace/ClickUp addresses may remain unconfirmed until the customer checks them.
  if coalesce(new.source_provider,'') <> 'customer_portal' and new.customer_confirmed_at is null then
    return new;
  end if;

  new.recipient_name := left(regexp_replace(trim(coalesce(new.recipient_name,'')), '\s+', ' ', 'g'), 120);
  new.phone := public.icetak_normalize_phone(coalesce(new.phone,''));
  new.address_line1 := left(regexp_replace(trim(coalesce(new.address_line1,'')), '\s+', ' ', 'g'), 130);
  new.address_line2 := left(regexp_replace(trim(coalesce(new.address_line2,'')), '\s+', ' ', 'g'), 130);
  new.city := left(regexp_replace(trim(coalesce(new.city,'')), '\s+', ' ', 'g'), 100);
  new.postcode := left(regexp_replace(coalesce(new.postcode,''), '[^0-9]', '', 'g'), 5);

  v_state := case lower(regexp_replace(trim(coalesce(new.state,'')), '\s+', ' ', 'g'))
    when 'johor' then 'Johor'
    when 'kedah' then 'Kedah'
    when 'kelantan' then 'Kelantan'
    when 'melaka' then 'Melaka'
    when 'malacca' then 'Melaka'
    when 'negeri sembilan' then 'Negeri Sembilan'
    when 'pahang' then 'Pahang'
    when 'perak' then 'Perak'
    when 'perlis' then 'Perlis'
    when 'pulau pinang' then 'Pulau Pinang'
    when 'penang' then 'Pulau Pinang'
    when 'sabah' then 'Sabah'
    when 'sarawak' then 'Sarawak'
    when 'selangor' then 'Selangor'
    when 'terengganu' then 'Terengganu'
    when 'kuala lumpur' then 'Kuala Lumpur'
    when 'wilayah persekutuan kuala lumpur' then 'Kuala Lumpur'
    when 'labuan' then 'Labuan'
    when 'wilayah persekutuan labuan' then 'Labuan'
    when 'putrajaya' then 'Putrajaya'
    when 'wilayah persekutuan putrajaya' then 'Putrajaya'
    else ''
  end;
  new.state := v_state;
  new.country := 'Malaysia';

  if length(regexp_replace(new.recipient_name, '[^[:alpha:]]', '', 'g')) < 3 then
    raise exception 'Nama penerima mesti ada sekurang-kurangnya 3 huruf';
  end if;
  if new.phone !~ '^601[0-9]{8,9}$' then
    raise exception 'Nombor telefon Malaysia tidak sah';
  end if;
  select count(*) into v_word_count
  from regexp_split_to_table(new.address_line1, '\s+') as word
  where word ~ '[[:alnum:]]';
  if length(new.address_line1) < 10 or v_word_count < 3 then
    raise exception 'Alamat terlalu ringkas. Isi alamat penuh minimum 3 perkataan';
  end if;
  if length(new.address_line1) > 130 then
    raise exception 'Alamat maksimum 130 aksara untuk AWB';
  end if;
  if length(regexp_replace(new.city, '[^[:alpha:]]', '', 'g')) < 2 then
    raise exception 'Bandar mesti nama sebenar, bukan 1 huruf';
  end if;
  if new.postcode !~ '^[0-9]{5}$' or new.postcode = '00000' then
    raise exception 'Poskod mesti tepat 5 digit yang sah';
  end if;
  if new.state = '' then
    raise exception 'Pilih negeri Malaysia yang sah';
  end if;

  new.raw_address := concat_ws(', ', new.address_line1, nullif(new.address_line2,''), new.postcode, new.city, new.state);
  new.parse_status := 'confirmed';
  new.parse_confidence := 1;
  new.is_verified := true;
  new.verified_at := coalesce(new.verified_at, now());
  return new;
end;
$$;

drop trigger if exists trg_validate_confirmed_customer_address on public.customer_addresses;
create trigger trg_validate_confirmed_customer_address
before insert or update of recipient_name, phone, address_line1, address_line2, city, postcode, state, source_provider, customer_confirmed_at, archived_at
on public.customer_addresses
for each row execute function public.icetak_validate_confirmed_customer_address();

update public.customer_addresses
set customer_confirmed_at = null,
    is_verified = false,
    verified_at = null,
    parse_status = 'needs_review',
    parse_confidence = least(coalesce(parse_confidence,0),0.49),
    is_default = false,
    updated_at = now()
where archived_at is null
  and customer_confirmed_at is not null
  and (
    length(trim(address_line1)) < 10
    or array_length(regexp_split_to_array(trim(address_line1), '\s+'),1) < 3
    or city !~* '[A-Za-z].*[A-Za-z]'
    or postcode !~ '^[0-9]{5}$'
    or postcode = '00000'
    or lower(trim(state)) not in ('johor','kedah','kelantan','melaka','malacca','negeri sembilan','pahang','perak','perlis','pulau pinang','penang','sabah','sarawak','selangor','terengganu','kuala lumpur','wilayah persekutuan kuala lumpur','labuan','wilayah persekutuan labuan','putrajaya','wilayah persekutuan putrajaya')
  );
