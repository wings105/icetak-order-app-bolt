# Admin read performance — 2026-10-04

## Implemented and verified

Customer Focus failed because the Inbox full-chat RPC exceeded its inherited 8-second statement budget. Gateway logs showed 500s and successful requests taking 8–18 seconds. The Inbox bridge now freezes the eligible conversation IDs, loads pages of at most 500 with at most three overlapping requests, and restores the original ordering. Missing rows fail the report rather than claiming complete coverage. The cap and truncation metadata remain explicit. New indexes support latest-message and session-boundary reads. Original full-chat RPC remains compatible.

Order details use a service-only snapshot reader restricted to 1–50 exact kind:UUID keys instead of loading all 4,095 orders per batch. Full chat coverage remains available for existing identity/session evaluation. The gateway shares only currently overlapping read promises; it stores no completed responses and saves always read fresh source facts. MYT formatters are reused rather than reconstructed per row.

Marketplace detail filters retain one completed scan for 30 seconds when only the detail classification changes. Every source page is evaluated before result pagination. Source search/status/provider/shipping changes, explicit Refresh, save and visible-tab polling read fresh data. Hidden tabs do not poll. Customer Focus prevents overlapping refreshes and surfaces the backend error reason. Same-scope Finance refresh keeps the prior report visible; failures label it as an old reading. Changing report scope clears prior data. Initial dashboard snapshot arrival no longer duplicates the contribution request; later snapshots and manual refresh still update it.

## Evidence and limits

Live rollback comparisons proved unchanged snapshot/message/state/revision contracts, scoped order equivalence and preserved private grants. Live service-role chat pages completed around 278 ms; a 50-order snapshot around 599 ms. Deployed bridge returned all 3,464 conversations with no timeout. An actual authenticated gateway focus request completed in 4,649 ms versus earlier 8–18 seconds. These are observations, not a latency guarantee; the panel still evaluates full eligible context and large historical scans cost more.

The deployed admin-ai-dashboard v16 source matches the repository with JWT enabled. Inbox ai-dashboard-bridge v4 source matches and retains its existing custom-token authentication. No statement timeout was raised and no customer/task/provider data was mutated.

Actual Admin App controlled browser checks passed desktop 1440×1000 and mobile 390×844: real focus rows, explicit backend error/recovery with old data and paused saves, all 123 source orders before filtering, late-page matches, complete-scan reuse, explicit refresh, target settings/direct costs, Finance error warnings and dashboard initial/later reads. No runtime/console errors or horizontal page overflow. Hosted authenticated-owner interaction remains unverified; deployed backend requests and hosted served assets are checked separately. Regression scripts and Admin/storefront/Inbox production builds pass.
