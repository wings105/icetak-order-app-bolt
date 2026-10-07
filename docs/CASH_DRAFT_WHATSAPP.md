# Cash at Counter draft notification choice

2026-10-07: backend PRODUCTION; review-page interaction VERIFIED on desktop/mobile.

The admin action owns the per-order notification choice for `cash_counter` and
`cash_at_counter` drafts:

| Action | Initial customer link | Future automatic notifications |
| --- | --- | --- |
| Confirm Pickup & Send Link, checkbox checked (default) | Existing idempotent pickup confirmation queue | ON, including payment and ready for pickup |
| Confirm Pickup Order | None | OFF |
| Confirm Pickup & Send Link, checkbox unchecked | None | OFF |

Previously send-link updated only `orders.whatsapp_opt_in`, while silent confirm
could inherit `working_draft.notify_whatsapp=true`. The UI could also inherit an
OFF draft flag despite the send-link action. The action now overrides the cash
approval payload, and the service-only `icetak_set_cash_draft_whatsapp_choice`
RPC keeps working/confirmed draft flags and the linked order consistent, including
retries against already converted drafts. Its token and exact draft/order linkage
are checked under row locks; changes receive an audit event. OFF also cancels
pending/processing manual pickup-link jobs in addition to existing automatic
queue cancellation. Delivered links retain the existing duplicate-send guard.

Existing master switches, activation dates, recipient/session rules and dispatcher
guards still apply; ON is consent, not a guarantee of provider delivery. No global
settings or historical orders were changed and no notifications were replayed.
Prepaid/QRPay actions keep their existing contracts.

## Verification

- Migration `20261007064840_cash_draft_whatsapp_choice.sql` applied on Order System.
- `qrpay-draft-review` v25 ACTIVE; deployed source matches repository and existing
  token authentication remains enabled (`verify_jwt=false` preserved).
- `supabase/tests/cash_draft_whatsapp.sql` passes on the installed production RPCs
  inside a rollback transaction: inherited flags overridden, draft/order consistency,
  payment and ready queues ON only, retry idempotency, OFF cancellation, restored
  ON, invalid-token rejection and service-only grants. Zero QA drafts remain.
- `scripts/check-pickup-confirm-send-link.mjs` runs the real Edge handler with
  projected database responses and mocked provider dispatch: both inherited-flag
  cases, opt-out, already-confirmed retries, no duplicate link sends, BSUID and
  prepaid/invalid-token guards pass.
- `scripts/check-whatsapp-order-optout-guards.mjs` passes. Safe live invalid-token
  request returns HTTP 401.
- Rendered standalone review page passes at 1280px and 390px: both buttons,
  default checked despite inherited OFF, explicit opt-out request/toast, silent
  confirmation OFF note, no duplicate requests or page runtime errors. Regular
  Playwright was used because the Browser plugin was unavailable; outbound app
  actions were intercepted, so no customer message was sent by QA.

Hosting of `public/qrpay-draft.html` follows the existing production-branch build.
Backend behavior is already deployed independently; actual provider receipt is
not part of these controlled tests.
