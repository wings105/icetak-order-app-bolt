# QRPay AI Order Worker

This worker automates the path:

`QRPay webhook -> 15-minute wait -> WhatsApp conversation match -> Bolt order/components -> ClickUp outbox -> Activepieces -> ClickUp tasks`

## Runtime split

- **Order System project** owns QRPay transactions, the job queue, Bolt orders, production components and ClickUp outbox.
- **Unified Inbox project** owns WhatsApp conversations and runs `qrpay-ai-order-worker` locally against those messages.
- `qrpay-ai-order-bridge` is the token-protected cross-project boundary.

## Supported production categories

- `edible`
- `wafer`
- `burnaway`
- `topper_editing_glossy`
- `topper_new_design_glossy`
- `acrylic`

## Safety and idempotency

- New unmatched QRPay rows create a queue job with `process_after = received_at + 15 minutes`.
- The cron dispatcher runs every minute, but a job cannot be claimed early.
- Transaction ID and external order ID prevent duplicate orders/payments.
- Component IDs prevent duplicate ClickUp tasks.
- Failed jobs retry up to five times; stale worker locks are recovered.
- Every AI-created component is marked `review_required` and ClickUp shows `AI PENDING CONFIRMATION`.
- Admin can confirm the ClickUp task or delete it when the extraction is wrong.

## ClickUp data

The outbox provides, both as structured payload fields and in task description:

- customer name and phone
- clickable `https://wa.me/<phone>` link
- QRPay amount, reference and paid time
- job category, quantity, size, style and wording
- due date when found, otherwise `Not provided`
- conversation ID
- source message IDs and media references
- Bolt admin/customer order links
- AI match score and pending confirmation flag

Status mapping:

| AI job type | Initial ClickUp status |
|---|---|
| edible | `design edible image` |
| wafer / burnaway wafer component | `wafer paper` |
| topper editing glossy | `design editing -topper` |
| topper new design glossy | `new custom` |
| acrylic | `acrylic` |

## Deployment secrets

The same private `qrpay_ai_worker_token` must exist in both Supabase projects under `public.private_runtime_settings`. Set it through a secure migration/deployment command. Never commit the live token.

The Edge Functions use `verify_jwt = false` because they are machine-to-machine endpoints, but every call requires the private token header.

## Validation

Use historical transactions only in `dry_run` mode. Dry-run performs matching and extraction but does not create an order or ClickUp task.
