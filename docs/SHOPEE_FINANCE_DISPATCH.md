# Shopee order finance dispatch to Make / Boost.space

The existing authenticated `shopee-webhook` receiver continues capturing direct Shopee events. When the database finishes processing an order event, a private trigger queues an HTTP POST to the configured Make / Boost.space webhook. No new incoming webhook URL is required.

## When requests are sent

| Stage | Trigger | Frequency |
| --- | --- | --- |
| `initial` | First received nonterminal order status, including `UNPAID` / `READY_TO_SHIP`, or the existing order-detail ingestion | Once per order |
| `completed` | Order status event `COMPLETED`, confirmed against the system's latest Shopee status | Once per order |

Other status changes and duplicate webhooks do not add requests for the same stage. A first sighting already marked `COMPLETED` sends only `completed`. Cancelled orders and unrelated chat/shipping events do not trigger a new finance request. Events captured before activation are not automatically replayed. An existing active order can receive its first `initial` request on its next qualifying event after activation.

An initial `UNPAID` order may not have usable finance data yet. The same order is requested again at `COMPLETED`; the Make flow may handle unavailable initial finance data according to its Shopee API response.

## JSON received by Make

```json
{
  "schema_version": 1,
  "dispatch_id": "a-stable-uuid",
  "idempotency_key": "shopee:ORDER_SN:initial",
  "provider": "shopee",
  "stage": "initial",
  "event": "order_received",
  "order_sn": "ORDER_SN",
  "ordersn": "ORDER_SN",
  "shop_id": "SHOP_ID",
  "status": "READY_TO_SHIP",
  "region": "MY",
  "currency": "MYR",
  "source_event_id": "the-captured-shopee-event-uuid",
  "occurred_at": "2026-10-02T17:08:59+00:00"
}
```

For completion, `stage` is `completed`, `event` is `order_completed`, and `status` is `COMPLETED`. `order_sn` and `ordersn` are identical aliases. Map `order_sn` to the order identifier used by `v2.payment.get_escrow_detail`, and use `shop_id` to select the Shopee shop. Only order-routing metadata is forwarded; customer messages, addresses, inbound authentication headers, and API credentials are not included.

Make should return HTTP 2xx promptly to acknowledge receipt, then query Shopee and POST finance data to the existing authenticated `shopee-finance-ingest` URL. See [SHOPEE_FINANCE_INGEST.md](SHOPEE_FINANCE_INGEST.md) for finance mapping. Neither the destination bearer URL nor the ingest token belongs in this public repository.

`COMPLETED` requests another finance lookup; it does not itself confirm escrow release. For a confirmed release, combine detail data with `payout_amount` and `escrow_release_time` from `v2.payment.get_escrow_list` (map to `released_amount` and `released_at` if building a normalized callback). If release is not yet available, the existing receiver retains a pending state. This implementation sends two lifecycle requests and does not poll Shopee for later release; any further release polling belongs in the Make flow.

## Delivery and retries

`finance.shopee_finance_dispatches` durably records each `(order_id, stage)` once. The asynchronous `pg_net` request starts after the order transaction commits. A network failure does not prevent order capture.

The private `finance.run_shopee_finance_dispatches(50)` worker runs every minute via Supabase Cron. HTTP 2xx marks the request delivered. Network errors, timeouts, HTTP 408/425/429, and HTTP 5xx retry with 1/2/4/8/16/32/60-minute backoff, up to eight total attempts. Other HTTP failures are retained as `failed` for investigation. If a database restart loses an unlogged `pg_net` request or response, the durable queue recovers it after five minutes.

Delivery is at least once: a timeout after Make accepts a request can cause a retry. The JSON `dispatch_id` / `idempotency_key` and the `Idempotency-Key` / `X-ICetak-Dispatch-Id` HTTP headers remain identical on every attempt. Deduplicate `dispatch_id` in Make if downstream work must run exactly once. Successful deliveries are not repeatedly dispatched.

Configuration is in `finance.shopee_finance_dispatch_config`, accessible only to the database owner. Enable it by setting `target_url`, `enabled_at = now()`, and `enabled = true` privately after applying the migration. Its URL constraint allows only HTTPS on `hook.integrator.boost.space`. The migration defaults to disabled, and public clients cannot read the bearer destination or invoke the dispatch functions.

To pause new requests, set `enabled = false`. Existing in-flight responses continue to be recorded; retries resume once dispatch is enabled again. Historical replay is an explicit administrative operation using `finance.enqueue_shopee_finance_dispatch(event_uuid, true)` on a verified processed Shopee event. Existing delivered stages remain deduplicated.

## Verification

Run `supabase/tests/shopee_finance_dispatch.test.sql` as the database owner. It covers lifecycle dispatch, duplicate captures, unrelated events, stale completions, success, retry identity/backoff/limits, crash recovery, pause, activation, and private access. Every test row and `pg_net` request is rolled back before an HTTP request can start.
