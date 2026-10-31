# Shopee Chat direct settings and external token rotation

## Automatic reply state, 2026-10-10

Successful seller sends through the shared sender now call private `complete_shopee_reply`. Both the local message and send audit must be sent with matching provider ID before reply state changes. It locks the conversation, clears `needs_reply` and unread count only for inbound messages present at the durable outbound claim time, and preserves new customer messages received while waiting for Shopee. Failed, pending and unknown sends never resolve the conversation. Replaying an existing sent request repairs reply state without another provider send, and does not move latest activity backwards or reopen/archive order sessions.

Inbox already reloads the conversation list after sends, so the successful backend state removes the chat from Perlu Balas automatically. The manual action remains useful for work done outside iCetak.

Inbox migration `20261010084500`, shopee-chat-send v8 and ai-dashboard-bridge v9 are deployed with unchanged authentication and exact bundle readback. Thirty controlled sender checks and real service-role rollback cases cover success/duplicate/failure/unknown, audit proof, private grants, incoming-during-send and later-message preservation. The screenshot's existing successful reply was reconciled through the same RPC: needs_reply=false, unread=0, original two outbound messages unchanged. No customer resend or broad historical reset. Hosted browser verification is blocked by an absent staff session; backend persistence is verified. SQL checks: `backend/inbox/shopee-reply-state.test.sql` inside a rolled-back service-role transaction.

## Ownership and entry point

Admin V2 Settings (`/?admin=v2&view=settings`) contains **Shopee Chat — Direct API**. The existing settings-management UI mounts the panel; the backend independently requires an active owner. General staff/admin permissions do not grant credential access.

Order System `shopee-chat-settings` validates the owner JWT and forwards to fixed Inbox `shopee-chat-config` using the existing private bridge token. Unified Inbox owns the credential configuration, token rotation and chat sender. Nothing is written to canonical orders/payments or ClickUp by this setup.

The first version configures one App/Shop/environment. Changing that identity clears the previous Partner Key, Access Token, token timestamps and rotation key. Other shops fail closed. Multi-shop configuration is future work.

## Owner setup

1. Open Admin V2 → Settings → Shopee Chat — Direct API.
2. Fill Partner/App ID, Shop ID, environment and Partner Key. Enable direct sending if desired.
3. Either enter the initial Access Token (expiry is optional), or leave these blank and push the current token using the rotation endpoint.
4. Save. Saved Partner Key/Access Token are never returned to the browser.
5. Generate the dedicated rotation key and copy it immediately to the existing automation's secret/header field. Regenerating revokes the old key.
6. Add one HTTP POST after the existing refresh-token automation updates the ClickUp task. No new refresh loop is created inside iCetak.
7. Refresh status or use **Semak sambungan tanpa hantar chat**. This performs a read-only Chat API call using an existing conversation for the configured shop.
8. Perform an intentional manual reply when ready. A successful read check does not prove the app has send permission or guarantee provider delivery.

No OpenAI credential is used by this integration. GPT generation is a separate phase.

## Rotation contract

Destination: `https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/shopee-token-rotate`

Method: `POST`

Headers:

```text
Content-Type: application/json
x-icetak-shopee-key: <dedicated rotation key copied from Settings>
```

Payload:

```json
{
  "partner_id": "<APP_ID>",
  "shop_id": "<SHOP_ID>",
  "access_token": "<NEW_ACCESS_TOKEN>"
}
```

Only App ID, Shop ID and Access Token are required. `rotated_at` and `expires_at` may be omitted or blank; the default Settings JSON no longer includes them. The database records receipt time under the row lock and stores unknown expiry as null. It never invents a fresh token lifetime. Identical token retries preserve receipt time, expiry, credential version and audit events.

Optional original timestamps remain accepted for existing integrations, with explicit timezone (`Z` or `+08:00`) and actual provider expiry. Expired/invalid supplied dates still return 400; explicit older/conflicting issue times return 409. Without an issue time the endpoint cannot order previously unseen tokens: keep the single producer serialized and push its latest refreshed token. A private bounded set of the last 64 replaced token fingerprints rejects known old-token replays; fingerprints are not authentication credentials and are never returned to clients.

The endpoint only accepts the configured App/Shop. Missing/invalid/revoked key returns 401; different identity or a known retired token returns 409. The RPC revalidates the hash under the row lock, including regeneration races. Never put secrets in the webhook URL/query string.

A successful token write returns `ok: true`, `applied` and `duplicate`, plus sanitized config status. A read check follows the update; failed API verification is shown in config and prevents sending. A stored token does not automatically mean the connection is usable. A retry can repeat an unfinished/failed check without rewriting the token. Inspect readiness and alert on non-READY states when sending is intended.

## Private storage and sending

Inbox's existing RLS/service-only `private_runtime_settings.shopee_chat_direct_config` stores credentials, hashed rotation key, token times, credential version, check status and the last 20 metadata-only events. The service-only `icetak_shopee_chat_config` invoker RPC serializes changes. Anon/authenticated cannot execute it or read the private table. Browser responses contain presence flags and operational status, never stored credentials/hashes. The raw rotation key is returned once on generation and not stored in plaintext.

The direct sender implements v2 shop-level HMAC-SHA256 signing against fixed production/test-stable Shopee hosts. Text sends use `/api/v2/sellerchat/send_message` with `to_id`, `message_type: text`, `content.text`. Read diagnostics use `/api/v2/sellerchat/get_one_conversation` and require a matching returned conversation ID. Shopee documentation is permission-gated; actual app/token compatibility must be verified after the owner configures the existing AP-tested connection.

The existing shared sending ledger is retained for Inbox and AI Dashboard. Direct mode requires enabled credentials, no known expired token, a current successful read check and matching shop; it creates no pending message when these conditions fail. When expiry is unknown, the sender repeats the read-only provider check immediately before claiming an outbound message. A failed check creates no outbound attempt. Once a direct identity is configured, it does not silently fall back to the old adapter when disabled/expired. Without a direct identity, the existing private adapter configuration remains supported.

Provider errors inside HTTP 200 remain failures. Missing message ID, timeout or server error remain uncertain where applicable, and the same request UUID is never blindly sent twice. No real customer message is sent by Save, token rotation or the read check. Incoming webhook ingestion is unchanged. Official Shopee Web outbound-history reconciliation and media/first-contact sending are separate work.

## Deployment and verification, 10 October 2026

- Inbox migration: `backend/inbox/migrations/20261010050746_shopee_direct_chat_settings.sql`, applied as `shopee_direct_chat_settings` to Inbox only. Do not apply it to Order System.
- Inbox: `shopee-chat-config` v1 and `shopee-token-rotate` v1 have custom authentication and platform JWT off; `shopee-chat-send` v6 retains JWT on and requires an active workspace membership; `ai-dashboard-bridge` v7 retains its existing custom bridge authentication.
- Order System: `shopee-chat-settings` v1 retains JWT on and independently checks active owner.
- Exact deployed source/auth-mode readback matched all five functions.
- Controlled SQL rollback tests proved initial save, private grants, token update, identical retry, stale/conflicting rotation, wrong-shop rejection, credential/check-version isolation, revoked-key rejection and credential reset on identity change. Fixture credentials were rolled back; no config remains staged in production.
- `node scripts/check-shopee-direct.mjs`: 20 checks pass for signing, redaction, readiness, diagnostics, shared outbox behavior, gateway role checks and rotation boundary. Existing six provider-result tests pass.
- Targeted Settings component TypeScript check and the actual root production build pass. Standalone Admin build has existing unrelated OrderProfitDetail DOM iterable and missing plugin-react errors; no new Settings type error was found.
- Security advisor categories/counts match baseline; no new advisory finding introduced by the migration.
- Live custom-auth config get through the real Order→Inbox bridge returns sanitized NOT_CONFIGURED, enabled=false. Anonymous calls to all new endpoints are rejected. Direct credential config is still empty; no messages/ClickUp updates sent.
- Rendered owner Settings verification is pending: the cloud session reaches Admin Login. Local Playwright could not launch the existing browser and its vendor download was truncated. Build success is not visual verification. Actual AP token push and Shopee send/read permission remain pending owner credential entry.

## Rollback

For a configured integration, the owner can disable direct sending; this does not delete messages or the outbox. Regenerate the rotation key to revoke automation access, then update the automation header. Revert the scoped frontend/sender/bridge changes if necessary, retaining the private setting and migration for audit. Restoring the previous sender version re-enables only previously configured legacy adapters, so inspect that configuration before rollback. No canonical order backfill or webhook replay is part of this release.

## 10 October 2026 — Optional token times follow-up

Backend PRODUCTION: migration `20261010063050_shopee_token_optional_times.sql` / live name `shopee_token_optional_times`, Inbox rotation/config v2, sender v7 and AI bridge v8. Exact deployed sources and existing auth modes match. Twenty-eight integration checks and six provider-result tests pass. Both SQL rollback suites execute against the production RPC as service_role, proving three-field storage, blank fields, receipt time, unchanged retries, replay/identity/expiry rejection, bounded fingerprints and private grants. The user's configured shop and rotation key survive rollback; no real token/customer send or ClickUp write occurs. Deployed anonymous rotation is still 401. Root production build passes. Settings JSON/source is updated; rendered owner interaction and the user's actual automation retry remain pending.

## 2026-10-12 — Shop-isolated Settings and history guards

Settings now selects MY 188218638 or SG 1635364464. MY retains the existing primary private slot; other shops use shopee_chat_direct_config:<shop_id>. Get/save/check, rotation key generation and token rotate use body.shop_id. The sender chooses the exact conversation shop and fails closed on missing/mismatched credentials. Rotation payloads and dedicated keys must match their shop; tokens are never inherited between shops. Existing external refresh remains the single producer. SG credential import was explicitly authorized and provider-verified on 13 October; see the follow-up below.

SHIPPED and other terminal statuses close the matching order session while preserving chat needs_reply/unread (updated 15 October 2026). Historical ingestion retains original time, cannot create a new active provisional order or primary old link, and cannot replace a current customer name/identity. Auto/offwork replies do not count as human replies. Successful-send proof and concurrent-inbound guards remain unchanged.

Latest deployed: config/rotation v3, sender v9, AI bridge v10, chat ingest v8, read-only finance fetch v5. Exact source/dependency readback, 30 sender checks, 59 operations checks, actual rollback suites and rendered desktop/mobile Settings/cards pass. Hosted signed-in owner interaction remains unexercised. See SHOPEE_WEBHOOK_OPERATIONS.md.

## 2026-10-13 — SG ready and scoped read checks

SG slot 1635364464 is enabled with explicitly authorized credentials. CHAT_READ_VERIFIED, signed escrow and refund API reads pass; primary MY credential version and token timestamp are unchanged. checkConnection filters metadata->>shop_id before sorting/limiting, fixing older SG conversations being omitted by the global newest 200. Deployed config/rotation v4, sender v10, AI bridge v11 and finance fetch v6 match source/auth exactly. 31 sender checks, 59 operations checks and actual source/provider validation pass. No customer message was sent. That initial verification preceded the owner wiring the HTTP module. Actual SG delivery is now receiver-verified at 10:59 MYT with version 2 / CHAT_READ_VERIFIED and a dedicated key; MY independently refreshed to version 20 at 10:53 MYT. The next external scheduled refresh has not been observed. See SHOPEE_SG_TOKEN_PUSH.md for the newer evidence; retain the sole existing refresh producer.


## 2026-10-15 — Official orangutan sticker picker

Status: VERIFIED in controlled real ChatArea desktop/mobile; production hosting published and publicly smoke-checked. Hosted signed-in picker/send remains unexercised.

- Shopee chat composer has an orangutan sticker button beside image upload. It offers the 30 official `orangutan_my_new` stickers (`01`–`30`), selected preview, recipient label and explicit Hantar sticker. Text/image drafts are preserved. Selection resets on conversation change; WhatsApp does not expose this picker.
- Shared catalog is `supabase/inbox-functions/_shared/shopee-stickers.ts`, imported by Inbox frontend and sender validation. Asset URLs are fixed to Shopee's official MY CDN; all 30 returned PNG/HTTP 200. Sticker OK is `02`.
- Authenticated `shopee-chat-send` accepts `message_type: sticker` and `sticker: {sticker_id, sticker_package_id}` with existing conversation/order/request UUID fields. Only that catalog is accepted; mixed file/text or other packages fail before an outbox claim. Existing staff/auth, buyer/shop checks, direct readiness and serialization are retained.
- Existing claim RPC records the precise pack/ID in the audit preview. The pending message is changed to sticker with official URL/metadata before provider transmission. Persistence failure stops the send; provider failure/uncertainty is recorded and never resolves reply state. Success uses the existing provider-ID/audit/complete-reply and read-sync paths. Same UUID does not send again; no automatic retry on unknown status.
- Inbox function v13 ACTIVE, JWT=true, all seven deployed files match source. Unauthenticated request returns 401. Actual service-role claim/sticker/audit/complete-reply persistence was tested in a rolled-back transaction; no QA message remains. Controlled sender suite: 40 checks, including sticker payload, audit, duplicate, invalid pack/ID, mixed text, failure, timeout and record failure.
- Actual ChatArea + real frontend send function verified in Playwright at 1280×850 and 390×844 with original official PNG assets, controlled staff session/provider responses: selection makes no send, explicit send uses exact conversation and ID, double click produces one request, sticker bubble appears, text draft remains, failures stay visible without retry, switching chats resets selection, no WhatsApp control, no horizontal overflow/runtime errors. Browser plugin absent; fresh local Chromium used after replacing a truncated older test binary.
- TypeScript, full shop + Inbox production build, source ownership guard and diff whitespace checks passed. Earlier owner-authorized real Shopee API tests of sticker 02 to maryamnurjannah and sitinorshakirahjusoh were provider/receiver verified. No additional customer messages were sent while building this feature. Hosted signed-in picker/send remains unexercised until a staff user opens it.
- No schema, RLS, canonical order/payment, webhook ingestion, automation or credential configuration change. AI Dashboard bridge retains its prior deployed sender until intentionally redeployed; this release adds the Inbox feature only.

Release evidence: production `2ce1f4e34d37512682563c1297e159cc44186b69`; Workers Builds and guard both succeeded, Cloudflare version `d36884a1-b71f-468b-a5b0-c501bcdce532`. Live `/inbox/` serves `index-DVk11YAt.js` with SHA-256 identical to the locally rendered/tested build and all picker/send/catalog markers. Actual production browser at 390×844 renders the staff login without runtime errors and loads that exact asset. No staff session was present, so live authenticated picker/send is not claimed as verified. Controlled mobile scrolling/selecting sticker 30 and sending to a changed conversation also passed.

## 2026-10-15 — Verified Shopee read receipts

Status: VERIFIED in controlled sender/frontend flows; backend deployed. Hosted authenticated next-reply verification remains unexercised.

- Fix `conversation_activity_logs` inserts to use `actor_user_id` and supported `user` / `integration` actor types. The previous `actor_id` / `staff` inserts were rejected silently. Inspect returned audit errors and expose `read_audit_recorded` instead of assuming persistence.
- After a successful send, POST read_conversation for the pre-send inbound snapshot, then GET get_one_conversation. Only the matching provider conversation with unread_count=0 or the snapshot's last_read_message_id confirms the read; newer inbound messages remain eligible/unread. Missing snapshot, rejected API, unconfirmed readback and transport errors are audited separately. Successful delivery remains successful when the read sync fails; no resend or automatic retries.
- Text, image/caption and sticker replies propagate returned warnings to an amber, dismissible composer notice. Sending clears the composer normally, successful-read replies do not show a warning, and notices reset on conversation changes. Late responses cannot put a read warning on a different chat.
- Inbox shopee-chat-send v14 (JWT on) and ai-dashboard-bridge v12 (existing custom token authentication/JWT off) have exact deployed bundle readback. The bridge entrypoint is unchanged and deliberately receives the current shared sender/dependencies so both API send paths use the same read verification. Unauthenticated POSTs remain rejected with 401.
- Controlled helper tests cover exact int64 serialization, provider readback, concurrent inbound, missing/wrong identity/evidence, provider/transport failures, missing-snapshot audit and audit failures. Existing 40 direct and 59 operations checks pass. Image integration verifies that failed read sync preserves HTTP 200 / sent state and returns a no-resend warning. Typecheck and full shop/Inbox builds pass.
- Actual ChatArea and frontend send functions were exercised in Playwright at 1280x850 and 390x844: text/sticker warning, sent bubble, cleared composer, dismiss, confirmed-read case, chat reset and no overflow/runtime errors. Browser plugin not available. Controlled provider responses only; no customer messages were sent.
- A signed, read-only provider GET for the latest replied conversation returned matching identity, numeric unread_count=0 and a last_read_message_id. Live service_role audit insertion with the corrected schema passed inside a rolled-back transaction. This proves provider readability and database compatibility, not a new end-to-end customer send. A subsequent idempotent signed read_conversation POST used the provider-confirmed already-read message ID, returned HTTP 200 with no provider error, and a follow-up provider GET retained unread_count=0 and the same last_read_message_id. This did not acknowledge any newer message or reset historical reply state. Next normal staff reply is the remaining production end-to-end receipt check.


Hosted delivery PRODUCTION verification (2026-10-16 MYT): production `038d2194b917798f640743daf34a6f7bce0a7961` passed Cloudflare Workers Builds and guard. Live `/inbox/` browser serves `index-BGZVA6HX.js`, byte-identical to the controlled tested local build (SHA-256 `6025260ee2a71414bf0103a4a17c8427e59e093b31dda0680173c8219edfa1a4`), with read sync/warning/dismiss/no-resend markers. Staff login renders without runtime errors. Earlier deployment delay is resolved. Authenticated next-reply receipt remains unexercised; no new customer sends.

## 2026-10-15 — Fulfillment and chat reply state are independent

Backend PRODUCTION: Inbox migrations `20261015150818` and `20261015151049` remove fulfillment as a chat-reply suppression rule. The compatibility `shopee_reply_allowed` helper always permits reply-state tracking; it is not sender authorization. Order sessions continue closing at SHIPPED/TO_CONFIRM_RECEIVE/COMPLETED/CANCELLED/returns. Existing successful sends and Shopee mark-as-replied events resolve chat state; auto replies and historical replay keep their prior guards. There is no new polling or provider write.

The latest exact shop/buyer or explicitly linked order owns fulfillment urgency. Terminal/shipped orders clear conversation priority, AI urgency and the urgent tag (manual or AI), and guards prevent stale triage/manual writes from readding them. Newer active orders win over older terminal summaries. Lookups are bounded to matching conversations before evaluating fulfillment; a first broad SQL plan was replaced after a rollback test revealed excessive work. All functions remain invoker; no RLS or sender auth change.

Verification: actual service-role rollback suites `shopee-webhook-operations.test.sql`, `shopee-terminal-urgency.test.sql`, `shopee-reply-state.test.sql`; 40 sender and 59 operations checks. Native checks prove chat survives shipped/cancelled, order sessions stay closed, urgency is cleared and cannot reappear, a new active order can be urgent, stale old order updates preserve its urgency, failed sends do not resolve and incoming-during-send is retained. Existing fulfilled conversations now have zero Urgent flags/tags. Provider-signed GET snapshots restored intannazirazainal, jellybyn and doudoudailybake only when the provider's latest message ID matched a local live inbound and no later manual/provider completion existed; unread_count remains the provider's zero. Screenshot chats already answered later in Shopee were not reopened. No customer send/read action was used. Hosted staff rendering was not exercised; the unchanged UI consumes needs_reply and priority directly.


## 2026-10-31 — One-tap sticker picker

VERIFIED controlled desktop/mobile interaction. Selecting any available sticker now immediately calls the existing send callback with that exact sticker; the preview/recipient confirmation block and separate Hantar sticker button are removed. While pending, a synchronous busy ref plus disabled tiles prevent repeated sends. Success closes the picker; errors remain visible and allow an explicit retry. Broken images remain disabled. Existing authenticated sender, outbox/idempotency, drafts and conversation-key reset are unchanged.

The actual React picker at 1280×844 and 390×844 passed first-click callback, exact sticker selection, rapid duplicate-click suppression, pending disabled state, successful close, error and explicit retry, with no page errors. TypeScript and Inbox build pass. Synthetic callback only; no customer test message was sent. Hosted picker appearance and release delivery are checked separately; live provider delivery is not implied.
