-- Run against a database with the SPX suffix migration applied.
-- These assertions only read tracking helpers; they never enqueue or send messages.
do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('MY06108672761B', 'https://spx.com.my/track?MY06108672761B', 'spx'),
      ('MY06108672761C', 'https://spx.com.my/track?MY06108672761C', 'spx'),
      (' my06108672761z ', 'https://spx.com.my/track?MY06108672761Z', 'spx'),
      ('MY06504484563A', 'https://spx.com.my/track?MY06504484563A', 'spx'),
      ('MY068121614929', 'https://spx.com.my/track?MY068121614929', 'spx'),
      (' my06504484563a ', 'https://spx.com.my/track?MY06504484563A', 'spx'),
      ('NVMY123ABC', 'https://www.ninjavan.co/en-my/tracking?id=NVMY123ABC', 'ninja'),
      ('123456789', 'https://jtexpress.my/tracking/123456789', 'jnt'),
      ('MY', null, null),
      ('MYA', null, null),
      ('MY123AA', null, null),
      ('MY123A/evil', null, null),
      ('', null, null),
      (null, null, null)
    ) as cases(tracking_no, expected_link, expected_courier)
  loop
    if public.icetak_tracking_link(c.tracking_no) is distinct from c.expected_link then
      raise exception 'Unexpected tracking link for %', c.tracking_no;
    end if;
    if public.icetak_tracking_courier(c.tracking_no, null) is distinct from c.expected_courier then
      raise exception 'Unexpected tracking courier for %', c.tracking_no;
    end if;
  end loop;
end;
$$;


-- All future single-letter suffixes, including lowercase, retain exact number bytes.
do $$
declare suffix text; tracking text;
begin
 for suffix in select chr(n) from generate_series(65,90) n loop
  tracking:='MY12345678901'||suffix;
  if public.icetak_tracking_link(lower(tracking)) is distinct from 'https://spx.com.my/track?'||tracking
    or public.icetak_tracking_courier(tracking,null) is distinct from 'spx'
  then raise exception 'Unsupported SPX suffix %',suffix;end if;
 end loop;
end $$;
