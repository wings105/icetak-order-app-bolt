# Direct checkout WhatsApp consent

2026-10-07 — backend queue generation PRODUCTION.

The storefront calls `icetak_create_order`; authenticated customer checkout calls it through `icetak_customer_checkout`. Both pass `notify_whatsapp` from the customer's checkbox. The creation RPC previously omitted `orders.whatsapp_opt_in`, leaving the default false. The existing notification-outbox trigger then recorded `order_whatsapp_disabled`, and subsequent payment transitions also failed the per-order guard. Later admin opt-in changes did not replay either event.

Migration `20261007052454_direct_checkout_whatsapp_consent.sql` saves `v_notify` in the initial order INSERT for sources `customer` and `customer_portal`. Other sources retain their prior initial false state and existing wrappers/draft sync. The table default, sender/window/template controls, master guard, per-order opt-out and event idempotency are preserved. No new order INSERT notification trigger is needed: the RPC already emits `order_created` after creating items/components.

Verification: the actual production RPC and existing triggers passed controlled transaction tests before and after deployment. Explicit ON/OFF, omitted choice with the existing true RPC default, QR/cash, both direct sources, recipient identity, duplicate order requests, unpaid-to-paid transition, repeated payment enqueue and non-customer isolation passed. All fixture orders, customers, payment sessions and queue/outbox/audit rows were rolled back; no provider message was sent by tests. Live function source matches the migration, live migration history matches its filename, and the table default remains false.

Run `supabase/tests/direct_checkout_whatsapp.sql` against the production-equivalent database with existing master and relevant rules ON. It uses BEGIN/ROLLBACK and must never be modified to commit fixtures. Unusual fixture amounts avoid reserving an amount used by a real customer. The helper used by authenticated portal checkout is covered; an authenticated browser checkout and provider delivery for a future real order are not exercised by this test.

Previously skipped customer notifications are not replayed by this migration. Any recovery must choose the intended real order, respect current opt-in/payment state and reuse the existing queue/idempotency contract; do not replay all historical events or both copies of a potentially duplicated customer order.
