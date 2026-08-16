-- Convert admin/customer phone deep-links from wa.me to tel: without changing WhatsApp API delivery.
-- Existing DB field names are retained for backward compatibility; their values now contain tel: links.

DO $migration$
DECLARE
  r record;
  ddl text;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname <> 'icetak_whatsapp_deep_link'
      AND pg_get_functiondef(p.oid) LIKE '%https://wa.me/%'
  LOOP
    ddl := pg_get_functiondef(r.oid);
    ddl := replace(ddl, 'https://wa.me/', 'tel:');
    EXECUTE ddl;
  END LOOP;
END
$migration$;

CREATE OR REPLACE FUNCTION public.icetak_whatsapp_deep_link(p_phone text, p_username text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '') IS NOT NULL
      THEN 'tel:' || regexp_replace(p_phone, '\D', '', 'g')
    ELSE NULL
  END;
$function$;
