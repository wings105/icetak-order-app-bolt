# Shopee order identity synchronization

`shopee-order-identity-sync` recovers missing buyer IDs and usernames independently of order-finance enrichment. It authenticates using the existing service credential or admin bridge token; no credentials are sent to clients.

The service-only claim RPC leases at most 50 real Shopee order references per run, prioritizes active orders, and also checks orders created in the last 30 days. The provider read is grouped by selling shop. The finish RPC rejects stale leases, unsafe buyer IDs, invalid usernames and conflicts with a stored buyer ID. It updates identity fields and an auditable `identity_read` fragment; it does not mark incomplete order details as complete.

Apply `docs/sql/shopee-order-identity-sync.sql` to the Order project and deploy the function. The internal cron runs every minute and uses the existing bridge credential from protected runtime settings. Its source Inbox reader must support `action: order_identity`.

Existing Order-to-Inbox synchronization propagates updates to the Inbox project, where exact buyer ID plus shop ID matching connects each order to the correct chat. Placeholder/test references are excluded from provider batches. Failed reads back off; missing buyer identity is retried after six hours.

Verified: live Shopee read, canonical identity write, downstream Inbox synchronization, exact Order ID search, stale-lease and invalid-ID rejection. Existing order financial fields are unchanged.
