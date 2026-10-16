-- Cache and membership SELECT already use their existing authenticated RLS.
alter function public.icetak_inbox_catalog_lookup(jsonb) security invoker;
