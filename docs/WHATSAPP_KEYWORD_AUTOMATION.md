# WhatsApp keyword automation in Admin V2

Status: backend ACTIVE and controlled backend checks VERIFIED; frontend implemented, publication and browser verification pending. External automation takeover has **not** occurred.

## Ownership and entrypoint

- Admin V2 source: `icetak-admin/src/pages/Automation.tsx` and `Automation.css`.
- Intended route: `/?admin=v2&view=automation`, with an Automation sidebar entry.
- Order System `admin-automation` validates the actual user JWT, active admin and read/manage permissions. Only owner/manage-admins can change rules or request retries.
- Unified Inbox owns the private `wa_automation` schema, message trigger, rule/run/event/receipt records and the token-authenticated `automation-engine`.
- Existing draft extraction/session boundaries and the canonical Order draft lifecycle remain authoritative. The Order generic-draft function serializes and reconciles provider-message identity across internal and external callers.

## Behaviour

Three owner-specified rules are seeded in record-only mode. The configured actions are prepaid draft, cash pickup draft and QR image delivery. Runtime keyword/image/caption settings are private and must not be copied into public documentation.

Only newly persisted WhatsApp human seller output can match: outbound, seller, a permitted manual/business-app source, sent/delivered/read, a provider message identity, and no historical-import flag. Buyer messages and automated messages cannot trigger actions. Matching retains contains/case-sensitivity behaviour. Conflicting draft actions on one message are held for review.

One run per rule/provider-message pair preserves its message and rule snapshots. Events record matching, attempts, outcomes and explicit retry/config changes. A database insert/status-update trigger enqueues and kicks work after transaction commit. A minute cron recovers due jobs; an idle worker heartbeat runs at most every five minutes.

Workers claim at most five rows using `FOR UPDATE SKIP LOCKED`, keep three-minute leases and retry draft failures with a stable request identity. The existing draft bridge still handles admin notification and required review. No real production order is created by a keyword trigger.

QR uses the existing outbound request receipt/identity resolver, a current 24-hour gate and Inbox mirroring. The Order policy bridge also checks the existing WhatsApp master setting and recent draft/order exclusions. Provider acceptance requires a message ID. A lost/ambiguous send result becomes uncertain and is not resent automatically. The internal sender credential remains server-only.

## Admin page

- Per-rule mode, keyword, case sensitivity, hourly cap and QR image/caption settings.
- Last 24-hour counts, queue/attention totals and actual last worker activity.
- Server-paged run history, rule/status/text filters, message/customer evidence and per-run event details.
- Safe draft retry and links to the corresponding draft/chat. Exact draft review links are resolved on demand for managers only; capabilities are never stored in run history or returned in list snapshots.
- Match preview has no draft, payment or send side effect.
- Switching an external rule to native requires confirmation that the corresponding external branch is disabled. Pause also stops queued work not yet claimed.

## Verified evidence and limits

- `scripts/check-whatsapp-automation.mjs`: actual worker success/failure/replay/uncertain paths and authenticated admin gateway denials.
- `supabase/tests/whatsapp_keyword_automation.sql`: rolled-back seller-only matching, case handling, repeated status update, history/system rejection, conflicting commands, leases, stale completion denial, history reads and private grants.
- Live canonical replay of an existing draft with another runner request key returns the same draft and leaves counts unchanged; transaction rolled back.
- Actual deployed process/preview HTTP calls succeed and the worker heartbeat persists. A real service request exposed the safeupdate singleton-write requirement; the recovery migration fixes it and the deployed process was retested.
- `scripts/check-whatsapp-automation-dom.cjs`: actual React component DOM checks pass for three rules, settings/takeover guard/save, buyer/seller previews, history, event detail and retry, using synthetic transport with no visual-browser claim. Install the QA-only dependency outside the repo (`npm install --prefix /tmp/icetak-automation-qa --no-audit --no-fund jsdom@30.1.3`), then run with `ICETAK_QA_DIR=/tmp/icetak-automation-qa node scripts/check-whatsapp-automation-dom.cjs`.
- Admin typecheck and full storefront/Inbox build pass; existing session isolation and AI-learning regressions pass.
- All four deployed function sources match the local reviewed sources. No native customer send was used as a test.
- Rules remain record-only, QR configuration is not activated, and no TaskMagic branch has been changed. Hosted UI, responsive visual checks and actual native trigger/provider acceptance are still pending.

## Deployment continuation

Repository production is authoritative; fetch and reconcile it before publishing. Preserve unrelated commits. The current source was prepared on an isolated branch; publication was blocked by automatic approval review because the destination repository is public and explicit publication authorization is required.

After publication is authorized:

1. Fetch latest production; merge/rebase any new commits without force-pushing production. Publish a reviewed PR and wait for its required checks/build.
2. Open the signed-in hosted Automation page. Verify rule/history/test/settings controls and desktop/mobile layout, with actual API responses and browser logs.
3. Re-read the actual live external flow and its current published/draft versions; preserve other branches and any unrelated edits.
4. Disable only the three confirmed keyword branches, publish and verify that state. Copy the QR image/caption into private native configuration.
5. Activate the matching native rules; verify persisted rule audit, then observe a fresh authorized seller event end-to-end without duplicate drafts/sends.
6. Record exact release/provider evidence, update this contract/changelog and finish the owner roadmap check with evidence-based progress.

Order migrations: `whatsapp_automation_draft_replay`.
Inbox migrations: `whatsapp_keyword_automation`, `whatsapp_automation_recovery`.

## Recovery

If the native path fails, pause only its affected rule and inspect the run reason/events. Re-enable the corresponding external branch only after the native rule is paused. Never replay an uncertain QR send without checking the existing sender/provider record. Never create a second draft solely because a caller timed out.
