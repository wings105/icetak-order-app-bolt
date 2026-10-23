-- Reference documents for roadmap features. Docs must contain no secrets or personal data.
alter table public.icetak_roadmap_items
  add column if not exists reference_url text;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.icetak_roadmap_items'::regclass
      and conname = 'icetak_roadmap_reference_url_check'
  ) then
    alter table public.icetak_roadmap_items add constraint icetak_roadmap_reference_url_check
      check(reference_url is null or (char_length(reference_url) <= 1024 and reference_url ~ '^https://'));
  end if;
end $$;
notify pgrst, 'reload schema';
