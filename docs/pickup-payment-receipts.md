# Pickup payment receipts

`payment_received` previously used the same processing message for prepaid orders,
orders already ready for pickup, and bulk counter payments. The approved
`order_paid_notice` template also said the order would be processed.

`supabase/functions/whatsapp-send/pickup-payment-message.ts` builds pickup receipts
from current fulfillment status. A collected timestamp or completed handover
takes precedence over a retained ready timestamp. Ready orders get pickup
instructions; pending orders get an update promise; collected orders get a receipt
without another pickup instruction. Mixed bundles show counts for each status.

Bulk payments are resolved through the existing checkout number or idempotency
key. Every included order is inspected and receipt-level notification exclusions
are retained. Both cash and QRPay use this path. Delivery orders retain their
existing payment notification behavior.

The sender refreshes status again just before dispatch. It preserves the deployed
BSUID, automation safety, duplicate prevention, audit, and inbox mirroring logic.

Outside the 24-hour chat window, pickup payments use the WasapFlow utility
template `pickup_payment_received_ms` (`ms`) with five body parameters:

1. Customer name
2. Order ID list
3. Payment total
4. Current pickup status
5. Order link

The template is checked against the approved template cache and refreshed from
WasapFlow when absent. A pending approval is checked again after 15 minutes without
consuming provider delivery retries; normal delivery failures retain their limits.
The sender never substitutes the old processing template for a pickup receipt.

Validation (Node.js 24):

```sh
node scripts/test-pickup-payment-notification.mjs
```

The regression harness executes the actual sender with mocked services. It does
not send customer messages or alter payment records. The change requires no
schema or payment accounting changes.
