-- Accept normal Malaysian address punctuation as token separators.
-- Previously, only whitespace separated words, so values such as
-- "No.85,Taman Irama" were incorrectly rejected after payment.

create or replace function public.icetak_validate_customer_order_address()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_state text;
  v_address text;
  v_city text;
  v_name text;
  v_word_count integer;
begin
  if lower(coalesce(new.source, 'customer')) <> 'customer' then
    return new;
  end if;

  v_name := trim(coalesce(new.delivery_name, ''));
  if length(regexp_replace(v_name, '[^A-Za-z]', '', 'g')) < 3 then
    raise exception 'Nama mesti ada sekurang-kurangnya 3 huruf';
  end if;

  if coalesce(new.delivery_phone, '') !~ '^\+601[0-9]{8,9}$' then
    raise exception 'Masukkan nombor WhatsApp Malaysia yang sah';
  end if;

  if lower(coalesce(new.delivery_method, '')) <> 'pickup'
     and lower(coalesce(new.delivery, '')) <> 'pickup' then
    v_address := trim(regexp_replace(coalesce(new.delivery_address, ''), '\s+', ' ', 'g'));
    v_city := trim(regexp_replace(coalesce(new.delivery_city, ''), '\s+', ' ', 'g'));
    v_state := lower(trim(regexp_replace(coalesce(new.delivery_state, ''), '\s+', ' ', 'g')));
    select count(*) into v_word_count
    from regexp_split_to_table(v_address, '[^[:alnum:]]+') as word
    where word <> '';

    if length(v_address) < 10 or v_word_count < 3 then
      raise exception 'Alamat terlalu ringkas. Isi alamat penuh minimum 3 perkataan';
    end if;
    if length(v_address) > 130 then
      raise exception 'Alamat Line 1 maksimum 130 aksara untuk AWB';
    end if;
    if length(regexp_replace(v_city, '[^A-Za-z]', '', 'g')) < 2 then
      raise exception 'Bandar mesti nama sebenar, bukan 1 huruf';
    end if;
    if coalesce(new.delivery_postcode, '') !~ '^[0-9]{5}$'
       or new.delivery_postcode = '00000' then
      raise exception 'Poskod mesti tepat 5 digit yang sah';
    end if;
    if v_state <> all(array[
      'johor','kedah','kelantan','melaka','malacca','negeri sembilan','pahang','perak','perlis',
      'pulau pinang','penang','sabah','sarawak','selangor','terengganu',
      'kuala lumpur','wilayah persekutuan kuala lumpur','labuan','wilayah persekutuan labuan',
      'putrajaya','wilayah persekutuan putrajaya'
    ]) then
      raise exception 'Pilih negeri Malaysia yang sah';
    end if;
  end if;

  return new;
end
$$;

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
  from regexp_split_to_table(new.address_line1, '[^[:alnum:]]+') as word
  where word <> '';
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
