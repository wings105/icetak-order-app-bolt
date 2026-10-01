# Renderer automation: PNG output and Activepieces

Scope: the existing SKU renderer only. No order, queue, mockup or customer-message integration is added.

## Endpoints

- `GET /render-test/automation`: health/capability JSON; does not launch a browser.
- `POST /render-test/output.png`: `Authorization: Bearer <renderer API key>`, JSON `{sku, fields}`. Returns native PNG bytes, not HTML or base64 JSON.
- `POST /render-test/automation`: same authorization, JSON `{action:"link", sku, fields}`. Returns a signed PNG URL valid for 30 minutes.
- `GET /render-test/output.png?sku=...&name=...&age=...&version=...&expires=...&sig=...`: opens the signed output directly. Altering fields/SKU/version/expiry invalidates its signature. A template edit invalidates previously issued links.
- An unsigned GET can also use the Authorization header. A browser address-bar request without a signature or header returns 401.

Example AP request:

```json
{"sku":"YS0184","fields":{"name":"Haziq","age":"6"}}
```

For other SKUs, use their saved input keys. Unknown/missing fields, malformed input and combined text over 200 characters fail before launching Chromium. Errors return JSON with non-2xx status; they never masquerade as PNG.

Response headers include `X-Render-Id`, `X-Render-Version`, `X-Render-Width`, `X-Render-Height` and `X-Render-Cache`. Output is the original template dimensions, without guides or editor controls. Inline Content-Disposition lets browsers display the image; AP receives the same bytes.

## Setup in Admin V2

Open Settings → Render Templates. For a layer, optional **Pola wording** can combine inputs: `{{name}} turns {{age}}`. Each placeholder becomes a form/API input; its label is editable. Curve/font/stroke/position apply to the combined string. Clearing the pattern restores the original single-field behavior. Duplicate layers can share inputs.

Save the template first. **Jana link PNG terus** generates a signed output link for the current test fields. **Jana / tukar API key AP** returns one render-only key; copy it into AP secret/connection inputs. Only its SHA-256 hash is stored. Generating another key revokes this admin's previous key. **Batalkan key** revokes this admin's API access. Keys expire after one year; each key is limited to 20 authenticated requests per minute. Already issued signed URLs remain valid until their 30-minute expiry or template-version change.

YS0184 uses one curved layer with `{{name}} turns {{age}}`, labels Nama and Umur, and opt-in compatibility for previous `name=Haziq turns 6` links. Its original image and style settings are preserved. API clients should send separate name/age fields.

## Activepieces flow

Use a Code step with `integrations/activepieces/render-to-clickup.ts`; map these five inputs:

| Input | Value |
|---|---|
| `sku` | Template SKU, e.g. YS0184 |
| `fields` | Object/JSON matching the template inputs |
| `renderer_key` | Render-only key from Admin V2, stored as a secret |
| `clickup_token` | Existing ClickUp connection/token, stored as a secret |
| `task_id` | Actual ClickUp task ID for the intended set/component |

Run one execution at a time for this flow. The code fetches PNG, uploads it as a task attachment using multipart/form-data, then adds a comment containing the attachment URL and a render marker. It uses native fetch rather than depending on the previously problematic HTTP 1.1.1 piece. Verify the Code step's Node/fetch/FormData support in the owner's AP installation before enabling the live trigger.

Retries search for the deterministic attachment filename and comment marker before writing again. A failed comment step can reuse the completed upload. This is reconciliation, not a guarantee of exactly-once writes under concurrent executions; keep concurrency at 1. A ClickUp task attachment plus a linked comment is the supported output. Attaching the image inline to the comment itself is not implemented. Do not pass a URL string as the upload file.

## Hosting and security

The same Cloudflare Worker now serves only the two automation paths; all other routes pass through the existing static ASSETS binding. Browser Run uses a BROWSER binding and pinned `@cloudflare/puppeteer`. It loads the shared renderer/field code from its deployed assets, runs Canvas in managed Chromium and exports PNG. Network interception allows only this template's exact image/font URLs. Template text is passed as data, never executed as code.

The existing render-template Edge Function owns template lookup, input validation, owner/admin authorization, API-key rotation/revocation and HMAC-signed links. API keys cannot save templates. The new render_automation_keys table and its three SECURITY INVOKER RPCs are service-only with RLS and explicit anon/authenticated revocations. No Cloudflare secret provisioning or browser service-role key is needed.

Cache keys include engine version, SKU, saved template version and canonical field values; validation/authorization runs before cache access. Cached PNGs last an hour; responses to clients use no-store. Browser sessions close on success/failure. Uploaded font files are the most reliable way to match staff browsers and server output exactly; system fonts depend on each browser's font installation.

Public Canvas and the Edge Function use byte-identical fields.js/render-fields.js helpers. Keep them in sync when changing the input contract.

## Verification

Backend controlled checks pass for pattern/multifield validation, legacy full-wording compatibility, signature tampering/expiry/version rejection, revoked keys, owner/staff boundaries and key issuance. Live SQL rollback checks pass for key rotation/revocation, 20-request rate limiting and service-only/RLS grants. Live Edge Function v4 issued a valid signed link with separate name/age fields.

Worker dry-run bundles with BROWSER + ASSETS bindings. Admin boundary guard and targeted Admin bundle pass. Controlled AP code verifies multipart upload, comment creation and retry reuse/recovery. The scratch checkout's complete storefront build uses stale unrelated source/config and is not production build evidence; use current GitHub/Cloudflare pipeline checks.

Production verification (2026-10-01): release 3bb9fad passed both GitHub guard and Cloudflare Workers Builds. Live signed GET generated a visually checked, decoded PNG at 2480 × 3508, 5,092,393 bytes, with HAZIQ TURNS 6 and no guides. Live Bearer POST returned the same PNG dimensions/bytes/render ID; retry hit cache. Missing age returned 400, missing authorization 401, and a tampered signed field 401. The SQL HTTP client's default five-second timeout was too short for a cold render; a bounded 60-second test succeeded. AP code uses a 90-second render timeout.

Hosted public form shows Nama/Umur; changing age 6→7 invalidates the old download and regenerates a nonblank HAZIQ TURNS 7 preview at original dimensions. No app console errors or framework overlay were observed; extension metadata errors are unrelated. Only desktop public UI was verified. Authenticated Admin pattern/key/link buttons and mobile UI remain unverified.

The temporary QA API key was removed after testing. API key creation/rotation remains an explicit admin action; no permanent automation credential was provisioned for the owner. AP code has not been installed/executed in the owner's Activepieces instance and no real ClickUp attachment/comment has been sent. Controlled ClickUp adapter tests are not live ClickUp evidence.
