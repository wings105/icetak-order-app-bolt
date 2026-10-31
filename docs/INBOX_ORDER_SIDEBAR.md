# Inbox order sidebar

Status: PRODUCTION for the requested sidebar presentation and hosted filter behavior; customer/provider send acceptance remains separate.

The right sidebar uses one shared `SidebarOrderCard` in both the linked-chat Order tab and direct/search order view. It follows the requested marketplace reading order: status and copyable Order ID, product thumbnails/title/SKU, right-aligned unit price and quantity, buyer payment, logistics, Malaysia ship-by/paid time and the checkout note. Existing send-preview, tracking, primary-order, external-order and unlink callbacks are retained.

Additional text stays inside the bottom of the same order card: address, customer identity, payment breakdown, requested date, shipment/package facts, wording, customer confirmation, match information and sync time. Unknown dates/amounts remain unknown; a stock-recovery placeholder zero is not presented as a confirmed item price. A genuine complete zero is retained. No new backend mutation or provider action is introduced.

The Order tab has client-side All/Unpaid/To Ship/Shipping/Completed/Cancelled filters for this customer's linked orders. The same status policy keeps unpaid separate from paid. Empty-filter feedback and chat-change reset are explicit.

Missing Shopee images reuse the existing authenticated `lookupProduct` batch/cache contract. Lookup uses exact selling shop and provider item identity; matching model artwork takes precedence over the item cover. A missing/failed image keeps a placeholder. Prices never come from the current product catalog.

Validation on 31 October 2026: Inbox TypeScript, full shop+Inbox build, existing 22 Shopee card checks and catalog guards. The actual changed React component runs with isolated synthetic transport at 1280×960 light/dark and 390×844 light; 16 outcome assertions per surface cover reading order, lower extra fields, exact model image, MYT dates, unknown versus real zero, status filtering, empty results, copy, tracking composer, exact-order preview/cancel, fit and no customer send. No application page errors occurred. Browser extension lacked the originating context; the hosted cloud browser reached staff login. Local Chrome for Testing was used; no project fixture was uploaded to an external renderer.

Release `4502b760e7ab89b33830807c2c3c1c527afe27e6` passed Workers build `f26f88fd-1575-4d79-bdb0-1c2487017ae3`. The hosted Inbox serves `index-BOq9XPnd.js` and `index-BdBhURY3.css`. In an active staff session, exact order search opened the corresponding customer chat and new sidebar, both product thumbnails loaded, the lower additional-fields section was observed, and Unpaid → empty → To Ship restored the correct card. The rendered card fits the actual 320 CSS-pixel sidebar. Browser logs contain extension metadata errors, without relevant app failures. No customer send or order/payment/status action was exercised. Hosted mobile and live send-preview/provider acceptance are not implied.
