begin;

do $$
declare
  p jsonb;
  r jsonb;
begin
  -- Zue: auto reply must not turn an image print into Acrylic.
  p := jsonb_build_object(
    'source_type','chat_trigger','items',jsonb_build_array(jsonb_build_object('k','edible','price',12,'size','A5','style','Round / Bulat','review','Need Review')),
    'evidence',jsonb_build_object('messages',jsonb_build_array(
      jsonb_build_object('id','z1','direction','outbound','at','2026-08-17T07:43:17+08:00','text','Terima kasih hubungi DecoCake. Menerima order: Edible Image, Acrylic cake topper'),
      jsonb_build_object('id','z2','direction','inbound','at','2026-08-17T07:43:56+08:00','text','Morning..if nak print ni berapa? Size dalam 5 inch lebar, tinggi 4 inch'),
      jsonb_build_object('id','z3','direction','outbound','at','2026-08-17T08:13:43+08:00','text','rm12 +pos'),
      jsonb_build_object('id','z4','direction','outbound','at','2026-08-17T08:13:52+08:00','text','1 SPX rm4.50 2 JNT rm5.90 Prefer courier apa?'),
      jsonb_build_object('id','z5','direction','inbound','at','2026-08-17T08:24:32+08:00','text','SPX')
    ))
  );
  r := public.icetak_enrich_draft_quick_order_v15(p);
  if r#>>'{items,0,k}' <> 'edible' or r->>'delivery' <> 'spx' or (r#>>'{items,0,price}')::numeric <> 12 then
    raise exception 'Zue regression failed: %', r;
  end if;

  -- Ruba: RM35 + 6 inch uniquely identifies Acrylic when text is ambiguous.
  p := jsonb_build_object(
    'source_type','chat_trigger','items',jsonb_build_array(jsonb_build_object('k','edible','price',35,'size','6 inch','style','','review','Need Review')),
    'evidence',jsonb_build_object('messages',jsonb_build_array(
      jsonb_build_object('id','r1','direction','inbound','at','2026-08-17T08:21:27+08:00','text','You boleh buat paper?'),
      jsonb_build_object('id','r2','direction','outbound','at','2026-08-17T08:23:23+08:00','text','6inch rm35'),
      jsonb_build_object('id','r3','direction','outbound','at','2026-08-17T08:23:47+08:00','text','in A5 range.ok?')
    ))
  );
  r := public.icetak_enrich_draft_quick_order_v15(p);
  if r#>>'{items,0,k}' <> 'acrylic' or (r#>>'{items,0,price}')::numeric <> 35 then
    raise exception 'Ruba regression failed: %', r;
  end if;

  -- Aishah: explicit Edible wins, latest need correction is 20hb, generic Pos is not invented as SPX.
  p := jsonb_build_object(
    'source_type','chat_trigger','items',jsonb_build_array(jsonb_build_object('k','acrylic','price',24,'size','A4','style','Full Landscape','review','Need Review')),
    'delivery','pickup','evidence',jsonb_build_object('messages',jsonb_build_array(
      jsonb_build_object('id','a1','direction','inbound','at','2026-08-17T01:18:04+08:00','text','Salam. Nk edible print ni size A4 boleh. Nk 19hb'),
      jsonb_build_object('id','a2','direction','outbound','at','2026-08-17T01:18:08+08:00','text','Terima kasih hubungi DecoCake. Menerima order: Edible Image, Acrylic cake topper'),
      jsonb_build_object('id','a3','direction','inbound','at','2026-08-17T01:43:45+08:00','text','Pos'),
      jsonb_build_object('id','a4','direction','inbound','at','2026-08-17T01:43:53+08:00','text','20hb pun xpe')
    ))
  );
  r := public.icetak_enrich_draft_quick_order_v15(p);
  if r#>>'{items,0,k}' <> 'edible' or r->>'date_need' <> '2026-08-20' or r->>'delivery' <> 'unknown' then
    raise exception 'Aishah regression failed: %', r;
  end if;

  -- Wahida: wording date must not beat explicit pickup weekday.
  p := jsonb_build_object(
    'source_type','pickup_trigger','items',jsonb_build_array(jsonb_build_object('k','edible','price',6,'size','4 inch','style','Round / Bulat','review','Need Review')),
    'evidence',jsonb_build_object('messages',jsonb_build_array(
      jsonb_build_object('id','w1','direction','outbound','at','2026-08-16T23:53:34+08:00','text','Terima kasih hubungi DecoCake. Menerima order: Edible Image, Acrylic cake topper'),
      jsonb_build_object('id','w2','direction','inbound','at','2026-08-16T23:57:32+08:00','text','Kak nok amik sabtu ni'),
      jsonb_build_object('id','w3','direction','inbound','at','2026-08-16T23:59:49+08:00','text','The engagement of SYAZA & AFIZZI 2 Sept 2026'),
      jsonb_build_object('id','w4','direction','inbound','at','2026-08-17T00:00:07+08:00','text','Saiz 4 inci bulat')
    ))
  );
  r := public.icetak_enrich_draft_quick_order_v15(p);
  if r->>'date_need' <> '2026-08-22' or r->>'delivery' <> 'pickup' then
    raise exception 'Wahida regression failed: %', r;
  end if;

  -- Dinnabake: explicit Edible survives two auto replies; courier menu alone is not a selection.
  p := jsonb_build_object(
    'source_type','chat_trigger','items',jsonb_build_array(jsonb_build_object('k','edible','price',24,'size','A4','style','Full Landscape','review','Need Review')),
    'evidence',jsonb_build_object('messages',jsonb_build_array(
      jsonb_build_object('id','d1','direction','outbound','at','2026-08-16T21:35:17+08:00','text','save for order: Menerima order: Edible Image, Acrylic cake topper'),
      jsonb_build_object('id','d2','direction','inbound','at','2026-08-16T21:35:45+08:00','text','Saya nak order edible imej'),
      jsonb_build_object('id','d3','direction','outbound','at','2026-08-16T22:04:12+08:00','text','rm24'),
      jsonb_build_object('id','d4','direction','outbound','at','2026-08-16T22:34:53+08:00','text','1 SPX rm4.50 2 JNT rm5.90 Prefer courier apa?')
    ))
  );
  r := public.icetak_enrich_draft_quick_order_v15(p);
  if r#>>'{items,0,k}' <> 'edible' or r->>'delivery' <> 'unknown' or r->>'date_need' is not null then
    raise exception 'Dinnabake regression failed: %', r;
  end if;
end $$;

rollback;
