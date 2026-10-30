# WhatsApp keyword automation in Admin V2

Status: Admin V2 and backend PRODUCTION. The three confirmed external actions were skipped and published, then the corresponding native rules were activated. Hosted owner settings/history/preview and desktop/mobile checks pass. A fresh real native customer/provider outcome has not yet been observed.

## Ownership and entrypoint

- Admin V2 source: `icetak-admin/src/pages/Automation.tsx` and `Automation.css`.
- Live route: `https://shop.decocake.my/?admin=v2&view=automation`, with an Automation sidebar entry.
- Order System `admin-automation` validates the actual user JWT, active admin and read/manage permissions. Only owner/manage-admins can change rules or request retries.
- Unified Inbox owns the private `wa_automation` schema, message trigger, rule/run/event/receipt records and the token-authenticated `automation-engine`.
- Existing draft extraction/session boundaries and the canonical Order draft lifecycle remain authoritative. The Order generic-draft function serializes and reconciles provider-message identity across internal and external callers.

## Behaviour

Three owner-specified rules were seeded in record-only mode and are now native. The configured actions are prepaid draft, cash pickup draft and QR image delivery. Runtime keyword/image/caption settings are private and must not be copied into public documentation.

Only newly persisted WhatsApp human seller output can match: outbound, seller, a permitted manual/business-app source, sent/delivered/read, a provider message identity, and no historical-import flag. Buyer messages and automated messages cannot trigger actions. Matching retains contains/case-sensitivity behaviour. Conflicting draft actions on one message are held for review.

One run per rule/provider-message pair preserves its message and rule snapshots. Events record matching, attempts, outcomes and explicit retry/config changes. A database insert/status-update trigger enqueues and kicks work after transaction commit. A minute cron recovers due jobs; an idle worker heartbeat runs at most every five minutes. Every transition into native advances the activation timestamp; a delayed status echo whose message predates that transition cannot enqueue a native action. Editing an already active rule preserves its activation boundary.

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
- PR #147 release `e06db334` passed all guards and Workers build `97b46381-731b-4244-b1cc-d51b21b74ae0`. The signed-in hosted page loads all three rules and three actual record-only matches. Settings save, event detail, mixed-case seller preview, buyer filtering and conflicting-draft warning pass against real authenticated APIs. Desktop/mobile screenshots were inspected; browser warning/error logs are empty.
- The enabled external flow was published with only the three confirmed advanced HTTP action steps newly skipped. After reload all three action menus show Unskip and Publish is disabled. Earlier legacy equivalents were already skipped; ingestion/media/other branches were preserved.
- Native owner saves persisted pickup/prepaid revision 2 and QR revision 3 at 17:09:52–17:10:14 UTC on 30 October. The image/caption were copied into private QR configuration through the hosted owner UI. Cron remains enabled, worker heartbeat is clean and no native customer test message was sent.
- `supabase/tests/whatsapp_automation_cutover.sql` passes against deployed Inbox inside a rolled-back transaction: native transition advances the boundary, a delayed older message/status produces no run, a fresh seller message queues exactly once and an active settings edit leaves the boundary stable. No QA message/run rows remain. Existing native boundaries were reconciled to actual activation audit timestamps.
- New genuine seller commands will produce native run evidence. Real provider acceptance/delivery after takeover remains unobserved; controlled worker tests and preview are not represented as customer delivery proof.

## Operation and acceptance

Use Automation for current modes/settings, Rekod run for the persisted outcome and Butiran for its event trail. Uji padanan is a preview with no send/draft side effects. Do not replay the earlier record-only matches as takeover tests. For the next genuine seller command, inspect the run result, exact draft link or provider message identity and matching Inbox delivery state. A provider-accepted QR is distinct from delivered/read.

Future releases must start from current `production`, preserve unrelated commits and keep private configuration out of public source. If migrating another rule, disable and verify only its external action before native activation. The external ingestion flow must remain enabled.

Order migrations: `whatsapp_automation_draft_replay`.
Inbox migrations: `whatsapp_keyword_automation`, `whatsapp_automation_recovery`, `whatsapp_automation_cutover_boundary`.

## Recovery

If the native path fails, pause only its affected rule and inspect the run reason/events. Re-enable the corresponding external branch only after the native rule is paused. Never replay an uncertain QR send without checking the existing sender/provider record. Never create a second draft solely because a caller timed out.
