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

## 7 November — OAuth consent form origin handling

Consent GET now issues a ten-minute HMAC-signed double-submit token in a Secure,
HttpOnly host-only cookie and hidden form field (initially SameSite=Lax; see the
popup correction below). The signature binds
client, exact redirect, PKCE challenge/method, response type, state, scope and resource.
POST verifies this binding before contacting Supabase Auth. Canonical, absent or opaque
`Origin` is supported only with the valid browser-bound token; explicit untrusted origins,
missing/mismatched cookies, tampering and expired or changed requests are rejected.
Old forms must be restarted using Connect in ChatGPT; refreshing the failed POST does
not acquire a new token. No owner credentials are used in live negative-path probes.

## Independent consent cookies for parallel attempts

MCP v5 gives each signed consent form a host-only cookie name derived from its
random signed nonce. Opening another consent page no longer overwrites the first
page's cookie. Validation and successful submission read/clear only that form's
cookie; request/signature/expiry/Origin protections remain unchanged.

Regression evidence: in connected Chrome, open form A, then form B, then submit A
with deliberately invalid QA credentials. Before v5 it returned consent_expired;
after v5 both A and B independently reach OWNER_LOGIN_FAILED as expected. No owner
credentials were read or submitted. Restart pre-v5 forms once to obtain the new cookie.


## Opaque-origin popup cookie handling — 7 November

A normal-tab test did not establish that the real owner Connect popup worked.
The repeated owner failure remained unresolved after v5. A temporary QA launcher
with CSP `sandbox allow-forms allow-popups` reproduces an opaque-origin popup
against the actual deployed consent endpoint. Using only deliberately invalid QA
credentials, v5 reproduces `consent_expired`; v6 diagnostics identify `cookie_missing`.
This establishes a controlled reproduction, not proof of ChatGPT's internal popup implementation.

Edge Function v7 sets each short-lived host-only consent cookie to
`Secure; HttpOnly; SameSite=None`. An opaque-origin form POST is cross-site for
cookie purposes; Lax does not accompany it. The signed hidden field, exact per-form
cookie equality, HMAC, request binding, expiry and explicit foreign-Origin rejection
remain mandatory. No cookie-free fallback, password storage or auth bypass is added.

The same connected-Chrome sandbox popup now reaches `OWNER_LOGIN_FAILED` using
invalid QA credentials; a normal Chrome tab also reaches that expected credential
rejection. This proves the reproduced consent gate passes, not successful owner
authentication. Fifteen actual-handler/consent/gateway regressions pass. Error JSON
now returns only a safe reason (`cookie_missing`, `expired`, `request_changed`, etc.)
and revision `popup-cookie-1`, never credentials, cookies or signed form tokens.

The owner must start one fresh Connect attempt to receive the new cookie attributes.
Do not reuse or refresh an old failed POST. If it still fails, retain its new reason
and revision; browser cookie blocking can still prevent storage/sending. Owner login,
ChatGPT linking and closed-browser ClickUp delivery remain pending acceptance.
The temporary QA launcher is removed after verification.


## Post-login database timeout recovery — 7 November

The next owner attempt passed password authentication but failed saving its OAuth
code. Scoped production Auth/PostgREST evidence records a successful login followed
by `POST /icetak_mcp_codes` HTTP 500 with SQLSTATE `57014` (statement timeout);
several unrelated database operations timed out in that same interval. This is a
provider/database availability failure after consent, not another cookie rejection.

Edge Function v8 saves the same random code hash using
`on_conflict=code_hash` and `resolution=ignore-duplicates,return=minimal`. A transient
failure permits one bounded retry with the identical row/hash. A lost reply cannot
produce another grant or overwrite the first. Permanent failures are not retried;
token exchange, rotating refresh consumption, comments and arbitrary writes are
never automatically retried by this change. Authorization client/owner reads are
bounded at five seconds each, login/code writes at ten seconds each; session cleanup
remains a best-effort ten-second call in `finally`, including when owner lookup or
code persistence fails. The normal request budget fits the gateway timeout.

Unhandled failures now log/return only a random request ID, safe stage/reason,
upstream status and a bounded provider code. No URL/query/form, password, session,
OAuth code, raw provider message/detail or SQL is logged. Transient service failures
return 503 and Retry-After; Auth 5xx/429 is not reported as a wrong password.

Twenty actual-handler/consent/gateway regressions verify successful redirect/state,
57014 recovery, lost-response idempotency, bounded persistent/permanent failure,
negative owner/CSRF gates, cleanup and redaction. `tests/mcp/code-retry.sql` passes
inside a live BEGIN/ROLLBACK, proving conflict-ignore preserves one original grant,
wrong PKCE rejection and one-use consumption. No test client/grant is retained.
The owner connection and genuine ChatGPT callback/token exchange remain acceptance
work. A bounded retry improves transient recovery; it does not repair a sustained
Supabase outage or prove final ChatGPT linking.
