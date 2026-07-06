# iCetak / DecoCake.my AI Project Context

Last updated: 2026-07-06 Malaysia time
Repo: `wings105/icetak-order-app-bolt`
Supabase project: `buivecgahhmrhlmfujgt`
Original AppDeploy app id: `8ab71fa9c33743fd70`

This file is a handover/context document for any AI or developer continuing the project. It summarizes the important decisions, current status, known bugs, and safe next steps from the chat history.

---

## 1. Project Goal

Migrate / rebuild the original AppDeploy order app into a GitHub + Bolt + Supabase workflow.

Target system:

```txt
Customer web app / Bolt frontend
→ Supabase database
→ Supabase payment matching
→ integration_outbox
→ Activepieces / Make
→ ClickUp tasks
→ optional WhatsApp notifications
```

Important rule:

```txt
GitHub = source of truth
Bolt = pull from GitHub, preview, publish
Supabase = backend/database/payment logic
```

Do not let Bolt overwrite GitHub unless intentionally making code changes in Bolt.

---

## 2. Current Repository

GitHub repo:

```txt
https://github.com/wings105/icetak-order-app-bolt
```

Important frontend files:

```txt
src/main.ts
src/appdeploy-client.ts
src/order-detail-enhancer.ts
src/category-text-tabs.ts
src/product-details.ts
src/styles.css
public/icon.svg
public/manifest.webmanifest
```

Notes:

- `src/main.ts` is large/compressed and difficult to patch safely.
- Directly overwriting `src/main.ts` is risky because many Supabase fixes have been added.
- Safer approach: add small side-effect modules and import them from `src/appdeploy-client.ts`.
- A previous MutationObserver-heavy enhancer caused the app to hang. Avoid aggressive DOM observers.

Current `src/appdeploy-client.ts` should include Supabase client and dynamic imports if enabled:

```ts
void import('./order-detail-enhancer').catch(() => undefined);
void import('./category-text-tabs').catch(() => undefined);
```

If app loading breaks, temporarily make these enhancer modules no-op:

```ts
export {};
```

---

## 3. Supabase Project

Project id:

```txt
buivecgahhmrhlmfujgt
```

Base Supabase URL:

```txt
https://buivecgahhmrhlmfujgt.supabase.co
```

Frontend keys in Bolt:

```txt
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_PUBLISHABLE_KEYS
SUPABASE_SECRET_KEYS
SUPABASE_DB_URL
SUPABASE_JWKS
```

Important security note:

```txt
Service role key must never be committed to GitHub or exposed in frontend/browser code.
Use it only inside Make/Activepieces/backend/server-side contexts.
```

---

## 4. Core Supabase Tables

Important tables currently present:

```txt
customers
orders
order_items
production_components
payment_sessions
payment_transactions
unmatched_payment_transactions
notification_queue
integration_outbox
clickup_tasks
clickup_sync_logs
shipments
shipment_events
artwork_reviews
order_history
admin_users
admin_permissions
admin_sessions
```

Key order fields:

```txt
orders.id uuid
orders.order_no text
orders.public_token text
orders.customer_id uuid
orders.payment_status text
orders.status text
orders.tab text
orders.admin_status text
orders.total numeric
orders.date_need date
orders.delivery_method text
orders.delivery_name text
orders.delivery_phone text
orders.delivery_address text
orders.delivery_city text
orders.delivery_postcode text
orders.delivery_state text
```

Key payment session fields:

```txt
payment_sessions.id uuid
payment_sessions.order_id uuid
payment_sessions.base_amount numeric
payment_sessions.expected_amount numeric
payment_sessions.discount numeric
payment_sessions.status text
payment_sessions.expires_at timestamptz
payment_sessions.transaction_id text
payment_sessions.matched_at timestamptz
payment_sessions.receipt_bucket text
payment_sessions.receipt_path text
payment_sessions.receipt_name text
payment_sessions.submitted_at timestamptz
```

Payment status convention desired:

```txt
payment_sessions.status:
- pending
- receipt_submitted / pending_review
- matched

orders.payment_status:
- pending
- pending_review
- paid

orders.status:
- waiting_payment
- payment_received
- in_production / similar

orders.tab:
- to_pay
- progress
- receive
- completed
```

Avoid string checks like `includes('paid')` because `unpaid` contains `paid`.

Correct paid check:

```ts
const isPaid = ['paid', 'matched', 'confirmed'].includes(String(paymentStatus).toLowerCase())
  || String(status).toLowerCase() === 'payment_received';
```

---

## 5. Payment Flow

The desired payment flow follows the original AppDeploy plan:

```txt
1. Customer places order.
2. Supabase creates orders/order_items/production_components.
3. Customer opens payment page.
4. `icetak_prepare_payment(order_token, force_new)` creates or reuses a 10-minute payment session.
5. Page shows static DuitNow QR but a dynamic exact amount.
6. External system / Make / Activepieces detects DuitNow payment.
7. External system sends webhook with amount and transaction_id.
8. Supabase matches webhook amount to active payment_sessions.expected_amount.
9. If matched:
   - payment_sessions.status = matched
   - payment_sessions.transaction_id = transaction id
   - orders.payment_status = paid
   - orders.status = payment_received
   - orders.tab = progress
   - payment_transactions inserted
10. Customer page should show Payment Received.
```

---

## 6. Reverse / Unique Amount Logic

Requirement:

```txt
If multiple orders have the same amount within the active 10-minute window,
auto-discount by a few sen to create a unique match amount.
```

Example tested:

```txt
Order 1 total RM6.00 → expectedAmount RM6.00
Order 2 total RM6.00 within 10 minutes → expectedAmount RM5.99
```

The function responsible:

```txt
public.icetak_prepare_payment(p_order_token text, p_force_new boolean default false)
```

Expected behavior:

```txt
- If an active pending session exists for same order and force_new=false: reuse it.
- If force_new=true or no active session: create new 10-minute session.
- If same expected_amount already active for another order: try amount - RM0.01, - RM0.02, etc.
- If order is already paid/matched: return matched and do not reset it to pending.
```

Known test result from chat:

```txt
RM6.00 duplicate test passed:
first session expectedAmount = 6.00
second session expectedAmount = 5.99
```

---

## 7. Payment Webhook

Current working REST RPC endpoint:

```txt
POST https://buivecgahhmrhlmfujgt.supabase.co/rest/v1/rpc/icetak_payment_webhook
```

Headers for Make/Activepieces:

```txt
apikey: <SUPABASE_SERVICE_ROLE_KEY>
Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
Content-Type: application/json
```

Payload format:

```json
{
  "p_payload": {
    "provider": "duitnow",
    "transaction_id": "TXN-UNIQUE-001",
    "amount": 28.50,
    "paid_at": "2026-07-06T12:00:00+08:00",
    "sender_name": "CUSTOMER NAME"
  }
}
```

Response when matched:

```json
{
  "success": true,
  "matched": true,
  "order_id": "ICT-...",
  "order_token": "o_...",
  "amount": 28.5,
  "transaction_id": "TXN-UNIQUE-001"
}
```

Response when webhook reaches Supabase but no active session amount matches:

```json
{
  "success": true,
  "matched": false,
  "reason": "no_pending_session",
  "amount": 26.9,
  "transaction_id": "90hujhi"
}
```

This means:

```txt
Webhook is reaching Supabase ✅
Key/header is accepted ✅
But no active payment_sessions.expected_amount equals that amount ❌
```

Important: transaction_id should be unique. Do not use amount as transaction_id.

---

## 8. Edge Function Plan

Desired production endpoint:

```txt
POST https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/payment-match
```

Desired auth:

```txt
x-webhook-key: <custom webhook secret>
Content-Type: application/json
```

Payload without `p_payload` wrapper:

```json
{
  "provider": "duitnow",
  "transaction_id": "TXN-UNIQUE-001",
  "amount": 28.50,
  "paid_at": "2026-07-06T12:00:00+08:00",
  "sender_name": "CUSTOMER NAME"
}
```

Why desired:

```txt
Make/Activepieces would not need Supabase service_role key.
The Edge Function can validate x-webhook-key and call the RPC server-side.
```

Status:

```txt
Not deployed successfully yet.
Attempts were blocked by tooling safety checks.
Continue using REST RPC endpoint until Edge Function is deployed manually or with a safer path.
```

---

## 9. Important Payment Bugs Already Found

### Bug: unpaid read as paid

Bad logic:

```ts
o.payment.toLowerCase().includes('paid')
```

Problem:

```txt
unpaid contains paid
```

Fix:

```ts
['paid', 'matched', 'confirmed'].includes(paymentStatus)
```

### Bug: paid order reset to pending

Cause:

```txt
icetak_prepare_payment / payment page generated a new pending payment session for an already paid order.
```

Fix required:

```txt
If order is paid or has matched payment_session, return status matched and never update order back to pending/to_pay.
```

### Bug: integration_outbox insert broke webhook

Errors seen:

```txt
column "order_token" of relation "integration_outbox" does not exist
column "created_at" is of type timestamp with time zone but expression is of type numeric
```

Emergency restore performed:

```txt
Added integration_outbox.order_token
Added integration_outbox.source
Changed integration_outbox.created_at to numeric epoch-compatible format
Restored icetak_payment_webhook minimum function
```

Recommended future cleanup:

```txt
Standardize integration_outbox.created_at back to timestamptz OR update all functions to insert now() correctly.
Do not mix numeric epoch and timestamptz.
```

---

## 10. Customer Payment Page UI Requirement

Payment page must show eye-catching instruction:

```txt
⚠️ Bayar jumlah TEPAT seperti di bawah
Jangan round up / jangan tambah sen
Sistem match bayaran berdasarkan jumlah ini
```

Existing page should show:

```txt
Scan DuitNow QR
Amount reserved for 10:00
Exact Amount RMxx.xx
Live payment detection active
Upload receipt option
Generate New 10-Minute Amount if expired
```

If webhook matches while customer is on the page:

```txt
Page should poll every 3 seconds or use realtime.
When orders.payment_status = paid or status = payment_received:
show Payment Received screen immediately.
```

Current issue:

```txt
Backend match can succeed but frontend may still show expired QR until refresh.
```

---

## 11. Customer Order Detail UI Requirement

Original AppDeploy-style order detail should include:

```txt
Order summary card
Order ID
Date Need
Customer name / phone / address or pickup
Overall Progress
Item & Production Tracking
Payment box
Payment ID / transaction_id
Payment Session ID
Tanya Order Ini button
Refresh button
```

Paid order UI:

```txt
Payment: Paid ✅
Bayaran telah diterima.
Payment ID: <transaction_id>
Payment Session: <payment_sessions.id>
No Pay / Upload Receipt button
Status pill: In Production
```

Unpaid order UI:

```txt
Payment: Unpaid
Pay Now button
Cancel Order button optional
Status pill: Waiting Payment
```

A lightweight enhancer file was created:

```txt
src/order-detail-enhancer.ts
```

Status:

```txt
A previous full enhancer broke loading.
A later lightweight enhancer was added.
If app hangs again, make this file a no-op.
```

No-op fallback:

```ts
export {};
```

---

## 12. Category Top Navigation UI Requirement

Requested change:

```txt
Remove small category images/icons at the top.
Use text-only buttons.
```

Labels:

```txt
Edible Image
Cake Topper
Acrylic Topper
Artcard Topper
Burn Away
Wafer Paper
```

Mapping:

```txt
Artcard Topper = Mirror Gold
```

A file was created earlier:

```txt
src/category-text-tabs.ts
```

Status:

```txt
The first version with DOM observer contributed to app loading issue.
It was temporarily disabled/no-op.
Re-enable carefully with minimal non-looping logic.
```

---

## 13. ClickUp / Workload Plan

Requirement:

```txt
A paid order should create workload tasks in ClickUp.
Workload is based on production_components, not just orders.
```

Important rule:

```txt
1 production component = 1 ClickUp task
```

Reason:

A single order can include multiple components:

```txt
Edible Image
Acrylic Topper
Wafer Paper
Burn Away edible layer
Burn Away wafer layer
Artcard / Mirror Gold topper
```

ClickUp custom fields seen in uploaded example include:

```txt
Webapp Order ID
Webapp Component ID
SKU
date needed
Design Workload
paid
ORDER ID / customer name
Customize Name
Review customer
phone
RM
Courier
order_link
AWB link
```

Minimum required ClickUp fields:

```txt
Webapp Order ID = orders.id or orders.order_no
Webapp Component ID = production_components.id
Order Token = orders.public_token
Product Type = production_components.component_type
Date Need = orders.date_need
Review Required = production_components.review_required
Customer Phone = orders.delivery_phone
Payment Status = orders.payment_status
```

Desired event in `integration_outbox`:

```txt
order.ready_for_production
```

Suggested payload:

```json
{
  "event": "order.ready_for_production",
  "order": {
    "order_id": "ICT-20260706-XXXX",
    "order_token": "o_xxxxx",
    "date_need": "2026-07-10",
    "total": 24.50,
    "payment_status": "Paid",
    "delivery": "pickup"
  },
  "customer": {
    "name": "Customer Name",
    "phone": "+6012...",
    "address": "..."
  },
  "products": [
    {
      "component_id": "uuid",
      "order_item_id": "uuid",
      "product": "Acrylic Cake Topper",
      "component_type": "acrylic",
      "quantity": 1,
      "size": "A6",
      "style": "Gold",
      "wording": "Happy Birthday",
      "review_required": true
    }
  ]
}
```

Current status:

```txt
integration_outbox exists.
Attempted automatic queue insert broke webhook due schema mismatch.
Trigger was disabled / function simplified during restore.
Rebuild this carefully after payment webhook is stable.
```

---

## 14. Current Safe Testing Checklist

After pulling latest GitHub into Bolt:

```txt
1. App loads without hanging.
2. Product catalog loads.
3. Create a new order.
4. Payment page shows exact amount.
5. Create another order with same total within 10 minutes.
6. Second order should get amount reduced by RM0.01 or more.
7. Send webhook with exact active amount.
8. Response should be matched=true.
9. Order should change to:
   payment_status = paid
   status = payment_received
   tab = progress
10. Order detail should show Payment ID.
```

Webhook test via Make/Activepieces:

```json
{
  "p_payload": {
    "provider": "duitnow",
    "transaction_id": "TEST-UNIQUE-001",
    "amount": 5.99,
    "paid_at": "2026-07-06T16:04:32+08:00",
    "sender_name": "TEST CUSTOMER"
  }
}
```

---

## 15. Known Current Limitations

```txt
1. Edge Function /payment-match with x-webhook-key not fully deployed yet.
2. REST RPC webhook works, but uses Supabase service_role key in Make/AP.
3. integration_outbox schema/function needs cleanup before ClickUp automation goes production.
4. Order detail enhancer is lightweight; full AppDeploy production timeline still needs careful implementation.
5. Category text-only UI file was disabled earlier; re-enable carefully.
6. Payment page may require frontend polling to auto-show Payment Received without refresh.
```

---

## 16. Recommended Next Steps

Priority order:

```txt
1. Keep payment webhook stable.
2. Test reverse amount with live orders.
3. Add payment page warning text and polling.
4. Stabilize order detail AppDeploy-style lightweight UI.
5. Clean integration_outbox schema and queue event after paid.
6. Build Activepieces flow to create ClickUp tasks from production_components.
7. Deploy safer Edge Function /payment-match with x-webhook-key.
8. Re-enable category text-only UI after app loading remains stable.
```

---

## 17. Do Not Do

```txt
Do not overwrite src/main.ts with original AppDeploy file.
Do not paste service_role key into GitHub or frontend.
Do not use includes('paid') to check payment status.
Do not let payment page reset paid orders to pending.
Do not enable aggressive MutationObserver loops.
Do not publish from Bolt before confirming it has pulled latest GitHub.
```

---

## 18. Useful GitHub Commits Mentioned

Some commits created during the chat:

```txt
e5c7702ea2f1c2d41252a19d92e2492b5d0869bd - load category text tabs enhancer
ef2481298712321a036a42b1223f9e3c7336c743 - text-only category labels
a252eb94d956f9c230c5ec1c95e7b2c68f4e6443 - disable order detail enhancer
b088386960c25c87c2e6d67a6cc00f68f7a2eb65 - disable category tabs enhancer
63858699eb61f9dc60a4771f7b2c705b7439f1c5 - safe lightweight order detail enhancer
```

Check latest commits at:

```txt
https://github.com/wings105/icetak-order-app-bolt/commits/main
```

---

## 19. Bolt Sync Check

Inside Bolt, check file:

```txt
src/appdeploy-client.ts
```

If the latest import lines are missing, Bolt has not pulled latest GitHub.

If conflict appears, usually choose:

```txt
Pull and discard local changes
```

because GitHub is treated as source of truth.

---

## 20. Short Handover Summary

```txt
Payment backend mostly works.
Reverse/unique amount has been implemented and tested.
REST RPC webhook is the current working webhook path.
Edge Function with x-webhook-key is desired but not live.
Order detail needs AppDeploy-style UI, lightweight enhancer added but must be tested carefully.
ClickUp workload should be based on production_components.
Integration outbox needs schema cleanup before production automation.
GitHub is source of truth; Bolt should pull and publish only after sync.
```
