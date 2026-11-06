# iCetak MCP and ChatGPT Events

Backend deployed; ChatGPT linking and a real closed-browser ClickUp result remain pending.

## Connect the personal plugin

- ChatGPT web → Plugins → plus → Add custom MCP server.
- Name: **iCetak**.
- Server URL: `https://icetak-mcp.msg-ebye.workers.dev/mcp`
- Authentication: **OAuth**, dynamic client registration (DCR). Leave static client ID
  and client secret empty. Discovery advertises DCR and PKCE S256.
- Create/install, then sign in using the existing iCetak owner account at the consent page.
  MCP does not store passwords; sign-in is verified by existing Order System Supabase Auth.
- Rescan/refresh and confirm three tools and `autobrief.confirmed` are listed.

Read test: “Use iCetak to read the current AutoBrief for order [exact order].”

Event test: “Monitor autobrief.confirmed for order [exact order]. When it arrives,
read the current brief, check wording/image availability/source proof, and add one
review comment to its ClickUp task. Do not change status or contact the customer.”

Subscribe **before a new confirmation**. Initial subscriptions intentionally skip history;
do not reset a confirmed operational order merely to produce a test event. Select a future
or explicit test order with the owner. Close ChatGPT after saving the task and observe the
exact ClickUp comment. This is the final acceptance test, separate from backend deployment.

## Runtime and ownership

The credential-free Cloudflare `icetak-mcp` gateway provides stable root OAuth discovery
and forwards to the Order System `icetak-mcp` Edge Function. Canonical data/credentials stay
in `buivecgahhmrhlmfujgt`. The gateway restores HTML/CSP only for the generated successful
GET consent page because Supabase's default domain rewrites HTML as text/plain/sandbox.
It strips the internal dispatch header and never forwards to arbitrary origins.

OAuth code + S256 PKCE, exact registered HTTPS ChatGPT redirects, opaque hashed tokens,
one-hour access and rotating 30-day refresh. Codes are single-use and expire after three
minutes. Every protected request rechecks active owner membership. Explicit revocation
also deactivates the matching owner/client subscriptions. Existing owner JWTs support
bounded diagnostics. Publishable/anon keys grant no access. The one-shot login session
is disposed after consent; passwords and Supabase sessions are not stored in MCP.

Scopes: `orders:read briefs:read comments:write events:subscribe`.

| Tool | Contract |
| --- | --- |
| `get_order_brief` | Exact order reference, optional task ID; up to 25 current AutoBriefs including wording/instruction/source proof. |
| `get_mcp_status` | Caller's subscriptions only; no callback/token/signing secrets. |
| `post_review_comment` | Delivered event, exact task, active owner/client subscription and live ClickUp ORDER LIST membership; one marked comment per event with receipt reconciliation. |

Buyer content is untrusted data. No customer-send, payment/order mutation, task status/CF
write, arbitrary SQL/search or destructive tools are exposed. Existing designer credentials
remain server-only. ClickUp comments use `notify_all:false`. Unknown provider results are
held as uncertain instead of blindly sending another POST.

## Event delivery

A forward-only AFTER trigger observes completed+confirmed transitions in
`clickup_order_brief_jobs`. Lightweight payload: task ID, order reference, revision,
confirmation timestamp. Actual brief content comes from the read tool. No backfill or
subscription is created by deployment. Subscriptions require one exact order.

Persistent subscriptions, callback verification challenges, Standard Webhooks HMAC SHA-256,
24-hour maximum subscription TTL and renewal; previous signing keys are retained for five
minutes during rotation. HTTPS callback hosts are restricted to OpenAI/ChatGPT domains.
DNS is checked and pinned at connection time, private/reserved destinations are rejected,
TLS hostname validation is retained, redirects are not followed, request/response sizes bounded.

`icetak-mcp-delivery` minute cron leases batches of five from a separate queue, with bounded
exponential retries (eight attempts). Stable event IDs and safe cursors prevent skipping
pending earlier deliveries. Initial subscription skips history; explicit cursors replay retained
events. Expiry, unsubscribe, owner removal and OAuth revocation stop delivery. 410 deactivates
the subscription; 413 stops that delivery. Native AutoBrief/render crons are unchanged.

All seven MCP tables have RLS and browser-role privileges revoked. No browser policies are
intentional: service-only access. The `RLS Enabled No Policy` INFO notices are expected.
Public helper RPCs are SECURITY INVOKER with explicit service-only grants. Internal capture
trigger code is in a non-exposed schema. Never expose raw callback/token rows in public logs.

## Verification and remaining acceptance

- `node --test tests/mcp/*.test.mjs`: actual handler/gateway tests covering auth/scopes,
  discovery, references, OAuth consent escaping, signatures, SSRF, callback verification,
  signed dispatch, unsubscribe/revoke, comments/replay/concurrency and gateway HTML/CSP.
- `tests/mcp/native.sql`, inside BEGIN/ROLLBACK against the deployed schema: ACL,
  single-use code/refresh, exact-order capture/filter, lease/dedupe, initial history skip,
  cursor replay/watermark and signing-key rotation. Fixtures are rolled back; no sends.
- Strict Deno check passed in the implementation session. Normal command:
  `deno check supabase/functions/icetak-mcp/index.ts` (Node type package network/cache needed).
- Hosted backend smoke proved discovery/401, controlled short-lived owner code exchange,
  code replay rejection, initialize/tools/events, an actual exact-order brief read, invalid
  callback rejection, token refresh/revocation. QA grants were revoked. Successful consent
  HTML/form CSP is also verified over the deployed gateway.
- Owner credential entry/consent, ChatGPT plugin linking, genuine callback delivery,
  ChatGPT task execution and a real ClickUp review remain unverified. Controlled provider
  mocks and HTTP success do not establish those final outcomes.

ChatGPT Plugins navigation was blocked by the browser host's security policy during setup.
Do not bypass that block. The owner must complete the plugin connection through the normal
ChatGPT UI, then run the exact-order event acceptance test.

## Operations and rollback

Inspect service-only `icetak_mcp_subscriptions`, `icetak_mcp_events`,
`icetak_mcp_deliveries` and `icetak_mcp_comments`. Inspect provider markers before any
manual retry of uncertain comments; do not reset a send ledger without reconciliation.
To pause delivery, unschedule only `icetak-mcp-delivery`, or deactivate the exact
subscription. Revocation/unsubscribe does not alter orders or AutoBrief. Removing the
MCP capture trigger does not change existing native AutoBrief/render behavior. Revoke
access and deactivate subscriptions before removing gateway/function infrastructure.
