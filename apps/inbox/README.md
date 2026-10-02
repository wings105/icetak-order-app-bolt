# Unified Inbox at /inbox/

This isolated React/Vite app is served at https://shop.decocake.my/inbox/.
Its source was imported from wings105/icetak-unified-inbox main at
fdbcaa291e51fc69634287b9acd4a0a2d95b7f7f. Make future frontend changes here.

The shop Vite build hook builds this app into dist/inbox, including when the
hosting build runs vite directly. It keeps its own dependencies, styles,
service worker and cache.
The shop service worker excludes /inbox; the inbox worker is scoped to /inbox/.

Database, authentication, media, and Edge Functions remain in the existing
Supabase inbox project uujcqcsfghqkukaydruc. No backend migrations are run.
The Vite config contains the browser-safe legacy anon key for compatibility.
Optional build overrides are VITE_INBOX_SUPABASE_URL and
VITE_INBOX_SUPABASE_ANON_KEY; shop VITE_SUPABASE_* values are never reused.

The inbox uses hash routes, such as /inbox/#inbox, inside its own entry page.
Staff log in with their existing inbox account on the new origin.

To check and build only the inbox:

    npm --prefix apps/inbox ci
    npm --prefix apps/inbox run typecheck
    npm --prefix apps/inbox run build

The deployed Supabase functions continue to be managed separately; this folder
contains frontend source only.
