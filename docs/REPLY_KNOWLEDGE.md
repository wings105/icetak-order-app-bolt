# Reply Knowledge and automatic style learning

2026-10-11 MYT. Backend PRODUCTION; frontend behavior VERIFIED in controlled Chromium. Frontend delivery evidence is added after the production asset check below.

## Location and ownership

Admin V2 → AI Dashboard → Knowledge. Deep link: `https://shop.decocake.my/?admin=v2&view=ai-dashboard&ai_tab=knowledge`.

Order System `buivecgahhmrhlmfujgt` owns articles, immutable version history, per-channel style profiles, generated draft proof and fact-equivalent wording. Inbox `uujcqcsfghqkukaydruc` owns confirmed messages and a private learning queue. The Order Knowledge endpoint uses actual JWT/user/active-admin/CRM checks; owner/manage_admins may mutate. Browser table/RPC grants are revoked, RLS and explicit deny policies remain enabled. All browser writes go through the authenticated service endpoint with server-owned actor and optimistic version checks.

Saving only changes the draft. Publish atomically takes a versioned snapshot. Draft edits do not alter the active answer. Unpublish removes retrieval immediately on the next calculation. An already visible Inbox suggestion retains its existing 60-second freshness limit; Semak semula fetches current Knowledge subject to the existing cooldown. Source title/version is exposed with the suggestion and in Dashboard detail. History shows the last ten versions. Article listing is paginated at 50; active retrieval is bounded at 200 published articles, enforced during publication.

## Imported information

Only FAQ content was reused from the owner-provided reference file, not its 7 October architecture/automation plan. Import is idempotent by `import_key`: 80 articles, **19 published / 61 drafts**. Generic product records were checked against the current catalogue. Articles with context-dependent sizes, unverified stock/materials, rate/lead-time conflicts or certifications remain drafts with review notes. Storage wording omits the historical quality-duration claim. Raw customer transcripts, contact identifiers, message inventories, price snapshot tables and old architecture are not imported.

The repository seed contains sanitised FAQ content/provenance only. Old numerical amounts in draft answers are visibly held for review and never enter suggestions. Publication rejects unresolved review notes and unfilled `{{placeholders}}`. Editing them requires the owner to supply current facts and source.

## Suggestion calculation

`inbox-reply-context` v4 and `admin-ai-dashboard` v22 share `_shared/reply-knowledge.ts`. The existing canonical identity/session/order/payment/production/shipping analyzer runs first. Published FAQ selection uses bounded token/alias matching, product context and channel checks; tied/weak matches fall back to the SOP. Up to five inbound texts from the current bounded recent window supply product context. Media is not interpreted. Canonical order/payment/shipping/complaint/follow-up responses take precedence. Price questions are left to quotation/canonical verification; this release does not introduce a price calculator or translate historical rates into live Shopee prices.

Replies default to formal Malay, with safe learned stylistic preferences. No new OpenAI calls, embeddings, vectors or model fine-tuning are used. The existing admin semantic classifier is preserved; its output is not used to invent product facts. Admin review text is retained when explicitly saved for the current inbound revision. Inbox uses the same editable suggestion above the composer; no automatic customer sends are added.

The existing Inbox v2 shared 120/hour, 1000/MYT-day and 30-second/chat calculation budgets, debounce/cache/backoff and no-polling behavior remain. Knowledge unmounts the Dashboard work view, so its existing refresh timer stops while the tab is open. The Knowledge tab itself loads on navigation/filter/manual action, with no idle polling.

## Automatic learning

A private Inbox trigger captures new successful outbound seller text from `icetak-panel`, `admin-ai-dashboard`, authenticated WhatsApp `api`, and recognised `business_app` replies. History, failed/unknown sends, system messages and `icetak_api` automation are excluded. This is forward-only from the migration activation; no historical conversation backfill occurs. Each saved message ID queues once despite delivery/read echoes.

Every five minutes a cron claims at most 20 pending IDs and sends actual saved message text/status/channel/source to the fixed private Order endpoint using the existing server-only bridge secret. It does not send anything to a customer. Empty queues make no Edge request. Private replies are acknowledged, failures back off exponentially and stop after five attempts, and queue rows expire after seven days. Thus learning happens shortly after a successful saved send, not on each suggestion attempt.

Learning records only whitelisted greeting/closing, saya/kami and hantar/berikan preferences. Three consistent examples activate a preference. Counters are separated for WhatsApp and Shopee; they reflect shop/admin style rather than an individual staff identity. Owner can disable learning or reset style without deleting article content. Reset archives learned wording by making it inactive.

One bounded row per conversation retains at most five generated drafts. Unchanged calculations do not rewrite the snapshot. Exact copies of any retained generated draft never train the profile, including a delayed learning job after a newer calculation. Actual reply wording can become a reusable FAQ variant after three matching examples only if it is exactly fact-equivalent under the limited stylistic normalizer and the published article version is still current. Different prices, guarantees, negations, URLs/contact identifiers or additional facts cannot become a wording variant. General free-form rewrites can influence whitelisted style but are not automatically promoted into business knowledge. This is automatic conservative style learning, not unrestricted knowledge rewriting or neural model training.

Message receipts are deduplicated and retained 30 days. Generated snapshots expire after seven days. Obsolete wording versions are purged daily. Raw customer replies are not copied into a training dataset; actual text remains in its existing Inbox message record. Version history contains owner-authored article snapshots, not customer conversations. These bounds reduce this feature's usage; they do not cap unrelated Supabase subsystems or total billing.

## Verification

- `check-reply-knowledge.mjs`: real shared module, seeded question/alias/channel/product/ambiguity tests, unpublished prices/certifications, formal wording, fact preservation and canonical-order precedence.
- `check-reply-knowledge-admin.mjs`: real handler, JWT/active admin/CRM/owner guards, server actor, limits and optimistic 409.
- Existing `check-inbox-reply-suggestion.mjs` and `check-ai-dashboard.mjs`: auth, budget rejection before expensive reads, freshness, exact order/tracking, ambiguity and runtime regressions. Context now writes only its bounded generated-draft snapshot; no provider sends.
- Live Order SQL rollback: create/save/publish/unpublish/history/version conflicts, RLS/grants, three-correction activation, wording accumulation, dedup/copy/disabled/reset behavior. Fixture changes were rolled back.
- Live Inbox SQL rollback: confirmed-human capture, automation/failed/history exclusion, status echo dedup and private batch dispatch. Transaction rollback also discarded the queued HTTP request.
- Live private endpoint returns the Edible FAQ answer with current source/version for both formal and colloquial Malay queries. A 204 snapshot-write response was explicitly covered to avoid returning a false 503 after a successful write.
- Exact source/auth readbacks match Knowledge v2, context v4 and Dashboard v22; no customer provider sends were used in QA.
- Actual KnowledgeTab rendered at desktop 1440 and mobile 390: select/edit/save/publish/unpublish/create/history/style toggle/source-labelled FAQ test/search, no overflow or page errors. The actual AiDashboard wrapper deep link and tab switch stop work polling. Ten idle minutes produce zero additional Knowledge calls.
- Browser plugin was not available; Playwright with local Chromium and controlled staff responses tested the actual components. Root multi-app build and standalone admin TypeScript/build pass. Hosted signed-in staff interaction remains unexercised.

Frontend production asset/deployment evidence: pending final release check.
