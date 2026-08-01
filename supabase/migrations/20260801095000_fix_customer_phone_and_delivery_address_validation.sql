do $$
declare
  v_oid oid;
  v_def text;
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'icetak_create_order'
  order by p.oid desc
  limit 1;

  if v_oid is null then
    raise exception 'icetak_create_order function not found';
  end if;

  select pg_get_functiondef(v_oid) into v_def;
  v_def := regexp_replace(
    v_def,
    'if v_phone !~ [^;]+;',
    'if left(v_phone,4) <> ''+601'' or length(v_phone) not in (12,13) or regexp_replace(v_phone,''[+0-9]'','''',''g'') <> '''' then raise exception ''Valid Malaysia phone required'';'
  );
  execute v_def;
end
$$;

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
    v_word_count := coalesce(array_length(regexp_split_to_array(v_address, '\s+'), 1), 0);

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

drop trigger if exists icetak_validate_customer_order_address_trg on public.orders;
create trigger icetak_validate_customer_order_address_trg
before insert or update of delivery_name, delivery_phone, delivery_address, delivery_city, delivery_postcode, delivery_state, delivery_method, delivery, source
on public.orders
for each row
execute function public.icetak_validate_customer_order_address();
