# Shopee Chat direct settings and external token rotation

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
