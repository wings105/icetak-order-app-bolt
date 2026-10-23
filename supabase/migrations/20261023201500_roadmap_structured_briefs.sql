alter table public.icetak_roadmap_items
 add column if not exists highlights jsonb not null default '[]'::jsonb,
 add column if not exists acceptance_criteria jsonb not null default '[]'::jsonb;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.icetak_roadmap_items'::regclass and conname='icetak_roadmap_highlights_array_check') then
  alter table public.icetak_roadmap_items add constraint icetak_roadmap_highlights_array_check check(jsonb_typeof(highlights)='array' and jsonb_array_length(highlights)<=12);
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.icetak_roadmap_items'::regclass and conname='icetak_roadmap_acceptance_array_check') then
  alter table public.icetak_roadmap_items add constraint icetak_roadmap_acceptance_array_check check(jsonb_typeof(acceptance_criteria)='array' and jsonb_array_length(acceptance_criteria)<=15);
 end if;
end $$;
notify pgrst,'reload schema';