# Unified Inbox hosting

Status: PRODUCTION for hosting and the staff login entry, verified 2026-10-02 MYT.

## Source and deployment

- Canonical frontend: `apps/inbox/` in `wings105/icetak-order-app-bolt`, branch `production`.
- URL: `https://shop.decocake.my/inbox/`; `/inbox` redirects to this entry.
- Existing Cloudflare Worker: `icetak-order-app-bolt`. Git pushes to `production` publish the custom domain. The diverged `main` branch produces preview builds and must not be used as the current storefront baseline.
- Imported frontend snapshot: `wings105/icetak-unified-inbox` main `fdbcaa291e51fc69634287b9acd4a0a2d95b7f7f`. Future frontend changes belong here; there is no automatic sync from that repository.
- Backend remains Inbox Supabase `uujcqcsfghqkukaydruc`. Its deployed functions, webhook targets, auth users and storage were not migrated. Order System Supabase `buivecgahhmrhlmfujgt` continues to own canonical shop data.

## Build and isolation

The root Vite `closeBundle` hook installs the Inbox lockfile with dev dependencies and builds it into `dist/inbox`. It runs even when hosting invokes Vite directly. Root dependencies, mockup build input and renderer Worker configuration are preserved.

Inbox Vite base is `/inbox/`. It uses separate `VITE_INBOX_SUPABASE_URL` and `VITE_INBOX_SUPABASE_ANON_KEY` overrides with browser-safe Inbox defaults; root shop `VITE_SUPABASE_*` variables cannot accidentally select the shop database. Never put service/secret keys in client config.

The Inbox PWA starts at `/inbox/` and registers `/inbox/sw.js` with `/inbox/` scope. Its cache prefix is `icetak-inbox-`. The root shop worker excludes `/inbox` and `/inbox/*` and cleans only `decocake-shell-` caches. Each worker preserves the other's caches.

Inbox navigation uses hash routes, for example `/inbox/#inbox`. Staff use their existing Inbox accounts; browser sessions on the old Bolt origin are not transferred. The current login uses `signInWithPassword` without an email/OAuth redirect flow.

## Checks and release evidence

    npm ci --include=dev
    npm run build
    npm --prefix apps/inbox run typecheck

Release `9b35249efe2c03a01994a2a9c8b2b5939b56cd82` produced Cloudflare version `69ce3c0d-3f25-4fad-98b5-e7af354fface`; Workers Builds and GitHub guard succeeded.

Observed on production: Inbox title and staff login gate at the intended URL, `/inbox` redirect, storefront catalogue and Edible Image product navigation. No relevant Inbox console errors were observed. Storefront retains its pre-existing Multiple GoTrueClient warning.

Local build comparison preserved all 79 existing storefront files byte for byte except the intentional service-worker update. Inbox compiled assets reference the Inbox project and contain no shop Supabase URL. Cache cleanup/request interception checks and Inbox typecheck passed. Both Supabase projects were healthy, and conversations/messages/customers RLS was active.

Authenticated Inbox operations, customer sends, orders and payments were not exercised during hosting verification. No database/function/auth configuration was changed.

## Admin V2 Channel / Inbox panel

Status: ATTEMPTED for UI verification. The implementation is deployed; successful build/deployment does not establish authenticated production behavior.

Release `8a1a8d89e6d6fef40d63744e63314c51e02f85d9` adds the Channel / Inbox sidebar item in `icetak-admin/`, embeds the existing same-origin `/inbox/` behind its own staff login, keeps the iframe mounted after its first opening when navigating other admin menus, and provides Fullscreen/Kecilkan and Buka tab baharu controls. The direct admin entry is `/?admin=v2&view=channel-inbox`.

Only `icetak-admin/src/App.tsx`, `components/Sidebar.tsx`, and the new `pages/ChannelInbox.tsx` / `pages/ChannelInbox.css` were changed. The patch was based on the latest production commit and published with a fast-forward-only update. Storefront behavior, other admin page implementations, Supabase configuration, permissions, records and webhooks were not changed.

Root/Inbox builds, the focused ChannelInbox TypeScript check, whitespace checks and the source-of-truth guard passed. Workers Builds succeeded with Cloudflare version `190708c5-1391-4bbc-9316-e87dc6a3c390`. Production Admin login in the cloud test browser returned `Failed to fetch`, so the authenticated panel and its controls were not smoke-checked. A separate synthetic-admin QA preview (`agent/channel-inbox-qa-20261002`, commit `dc45d5e`) has backend calls disabled and does not change production; browser credential-observation restrictions also prevented completion of that UI test. No completed changelog entry is recorded until observable UI verification is available.

Remaining verification: sign in normally, open Channel / Inbox, confirm the existing Inbox staff gate/workspace, switch to another menu and back without reloading the iframe, check Fullscreen/Kecilkan and the new-tab link. Do not send messages or change business records merely to validate this embedding.
