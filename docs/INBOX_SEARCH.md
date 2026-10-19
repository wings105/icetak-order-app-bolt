# Unified Inbox search

2026-10-19 MYT. Backend PRODUCTION; controlled frontend VERIFIED, hosting release pending.

Canonical frontend remains `apps/inbox/` on `production`, served at `/inbox/`. Inbox Supabase `uujcqcsfghqkukaydruc` owns `search_unified_inbox(text,integer)`. No canonical orders, messages, customer records, provider sends or automation settings were changed.

The screenshot order `2610180JM6FM25` exists as a paid READY_TO_SHIP summary. The original RPC combined every conversation, identity and matching message before aggregation; its database execution measured 969 ms. The UI silently ignored RPC errors, displayed an empty state during debounce, did not abort obsolete requests, and discarded conversation results outside the initial conversation response. The Order tab additionally discarded search results outside its first 300 summaries.

Inbox migrations `20261019032538_inbox_search_candidates` and `20261019032930_inbox_search_exact_message_matches` add two small exact-ID indexes and a candidate-first search. Exact order IDs take the order fast path; message and customer matching remain available even when an exact order exists, including unlinked message-only chats. Existing substring matching, channels, latest matching message and bounded limit are retained. Malaysian local/international phone forms normalize consistently; `%`, `_` and backslash are literal search characters. Function execution uses SECURITY INVOKER with authenticated/service-role grants and no anonymous execute privilege; existing table RLS remains unchanged.

The shared React hook cancels stale requests, bounds search time at 12 seconds, clears results by query and exposes retry/error state. Chat results outside the loaded list render directly from RPC metadata and hydrate the selected conversation by ID; ensured chats survive list refresh. The Order tab fetches matched summaries by ID in one bounded request instead of intersecting the result with 300 preloaded rows. Channel filters also apply to order search cards.

Verification:

- Root production build, Inbox typecheck, focused ESLint and whitespace checks passed. Existing bundle-size/Browserslist warnings remain.
- `backend/inbox/search.test.sql` is an authenticated read-only rollback suite covering the reported order, lowercase/trimmed and partial IDs, exact ID message-only chat matches, historical phone/message matches, local/international phone formatting, true empty searches, limit and anonymous privilege rejection.
- Final exact-order database execution measured 35 ms; earlier warm/controlled reads varied. These are database timings, not browser end-to-end latency.
- Browser plugin unavailable; regular Playwright exercised the actual changed components and hooks with isolated API fixtures at 1360×900 and 390×844. Exact results, historical chat hydration/opening, list refresh, orders outside the initial 300, loading, error/retry, rapid query changes/aborted old request, channel filtering and empty states passed without page errors. Fixtures did not write production records.
- Hosted delivery still requires matching the served Inbox asset and checking the login entry after the production pipeline. Authenticated hosted staff interaction is not established by controlled fixtures or bundle equality.

Search remains capped at 60 results in the UI (RPC maximum 100); narrow a broad query for more relevant results. The default conversation/order list limits and counts are unchanged.
