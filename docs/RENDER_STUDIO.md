# Catalogue-linked Render Studio

## Operator flow

Admin V2 Render Templates opens a paged/searchable list with Draft, AI processing,
Needs review, Ready and Paused filters. Add New Template selects an existing
catalogue product and exact parent/variant SKU. Product list, detail and variant
links lead into the same editor. No product/price/provider write occurs.

Paste, drop, upload or select catalogue images into RAW and REFERENCE slots.
Each image is <=6 MiB and <=24 MP; paired AI setup requires identical pixel canvas
dimensions. The raw image is retained at its original dimensions. Images use the
existing template asset bucket and immutable SKU-scoped paths.

Add fonts to the reusable library with explicit name/aliases. Existing template
fonts are adopted from their binary family metadata when the library is empty.
Font use copies the registered file to the target SKU scope, preserving the
renderer asset contract. Missing/ambiguous fonts stay unresolved; no external
font download or guessed substitution is approved automatically.

AI Setup first saves a draft, then queues native vision work. The existing
OpenAI key is reused with owner authorization. The Responses request contains
the two images, bounded operator instructions, available font names and a strict
layout schema; no service credentials are put in model input. Results remain
drafts and never publish automatically. A minute cron recovers queued work even
if the browser is closed; expired uncertain jobs require manual retry.

The editor exposes per-layer font/style/curve/box controls, drag and pixel nudges,
per-input source/required/default rules, short/long/name-only/Malay test values,
side-by-side comparison and reference overlay. Preview and export share the real
Canvas renderer. Original examples are test values, not customer defaults.

Save Draft is isolated from `public.render_templates`. Confirm Template & Activate
requires a successful preview, explicit operator tick, complete mapping, available
assets/fonts and no unresolved font choice. It publishes one audited optimistic
version; repeated publication is idempotent. Editing preserves the previous
confirmed version. Pause changes only the currently published automation flag.

## Backend ownership and access

Order System owns service-only/RLS `render_studio` drafts, fonts, jobs and events.
`icetak_render_studio` is invoker/service-only; ordinary clients have no private
schema or RPC grants. Existing `render-template` authenticates the real user JWT
and Owner/Manage Admins permission before studio actions. Its legacy direct Save
action cannot publish; public/signed renderer reads still use confirmed records.

`render-template-ai` uses the existing private brief-worker token, serial claims,
five-minute leases and revision-matched results. Newer draft revisions supersede
old results. Queue identity is SKU + draft revision. No customer send, task status,
order/payment mutation, historical order backfill or change to AutoBrief rules.

## Validation

- `node --experimental-strip-types scripts/check-render-studio.mjs` exercises the
  actual worker with controlled transports: image metadata, exact font/alias
  matching, ambiguity, field validation, language preservation, authentication,
  two-image structured request, SKU-scoped font application and incomplete output.
- Native rolled-back SQL checks in `supabase/tests/render_studio_rollback.sql`
  prove draft isolation, stale edit rejection, explicit confirmation, queue and
  publication idempotency, stale AI result rejection, pause and private ACLs.
- Existing AutoBrief renderer regression, Admin TypeScript/source guard and full
  production build pass. Hosted editor and real vision acceptance are tracked in
  the release/roadmap checker; deployment alone is not UI verification.

Bulk pairing and automatic physical print calibration are outside this release.
Unsupported typography still needs operator review using the exposed controls.

## Hosted acceptance — 6 November 2026

Owner-authenticated production Browser proves list/search, exact catalogue SKU
selection, font-family adoption, full-resolution preview copying and clipboard
image paste. A real native vision job completed in one attempt with two correctly
mapped custom-font layers while the previous confirmed version stayed unchanged.
Native successful-result tests preserve raw/reference/instructions as well as
reject stale results. Remaining operator confirmation is deliberate; the generated
draft is not silently activated.

## Conditional age layout acceptance — 6 November 2026

PR #167 merged at `2bd4058`; Workers Builds, guard and Studio checks passed.
Native renderer v4, gateway v13 and vision v3 source readbacks include the new
exact-span parser and age mapping sources. Signed-in production editor tests
observed the separate number, upper-prefix and lower-suffix inputs: Turns 4
sets only the upper label, 4 tahun and 4 years old set only the lower label.
The actual rendered draft and source controls were visually inspected. The new
layout remains an unconfirmed draft: operator typography/position approval and
fresh naturally confirmed order delivery remain separate acceptance steps.
No existing customer wording or canonical AutoBrief worker was modified.
