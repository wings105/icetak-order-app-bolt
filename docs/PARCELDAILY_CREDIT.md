# ParcelDaily credit statement

Order System owns a private `shipping_credit` ledger, account snapshot and sync log.
Admin V2 Shipping mounts ShippingCredit and invokes the authenticated `shipping-credit`
Edge gateway. The gateway checks the existing active shipping permission. Browser roles
have no direct schema/RPC grants. Provider credentials stay in Edge secrets.

Confirmed booked shipment charge changes create one delta under an account lock. Replays
are no-ops, revised charges are deltas, and confirmed Refunded status reverses the charge.
Existing shipments establish a baseline only. Unknown costs are not replaced with quotes.
Every movement kicks a serialized provider read; independent Supabase Cron runs every
five minutes. Reads racing shipment writes are deferred. API balance is authoritative;
reconciliation differences stay unclassified until a staff receipt/statement reference
classifies them as topup, refund or adjustment. Classification changes no wallet balance.

The public documented API has no historical topup-amount statement. This implementation
starts from an evidenced opening balance and cannot claim earlier monthly topup totals.
Monthly MYT totals distinguish confirmed topups, usage, refunds and unknown differences.
The UI shows the latest 200 rows for a selected month; totals include all that month's rows.

The configured admin notification recipient is read at dispatch time. Below-threshold
provider snapshots create one episode; recovery rearms the next episode. The sender
uses the existing WhatsApp master/rule/window/template and outbox controls. The new utility
template is submitted separately and refreshed until approved. Blocked sends retry on
future polls; ambiguous outcomes stay unknown for operator review, preventing blind resend.
No test low-balance message should be sent by altering the real provider balance.

Backend verification: live provider read and persisted opening, native rollback tests
for charge/replay/refund, exact threshold, one claim per episode, recovery/rearm, topup
classification and schema/RPC privacy passed. Full Admin, root and Inbox builds passed.
Hosted UI and utility-template acceptance are tracked in release evidence.

## Browser CORS correction

The first deployment omitted the SDK x-client-info request header from allowed CORS
headers. Browser preflight failed even while server-to-server reads passed. Function
v4 permits that header and explicitly lists POST/OPTIONS. The deployed preflight and
actual signed-in hosted balance, statement expansion and API refresh were verified.
The regression exercises OPTIONS anonymously with the real SDK header set.
