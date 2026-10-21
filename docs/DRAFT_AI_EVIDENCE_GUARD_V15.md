# Draft AI Evidence Guard V15

## Root cause

The V14 database normalizer classified a generic chat draft by searching a combined conversation string with a fixed product priority. Automated WhatsApp replies contain every product name, including `Acrylic`, so automation text could override the product actually discussed by the customer and seller.

V14 also treated the courier menu as a courier selection and allowed dates printed in artwork wording to become `date_need`.

## V15 behavior

- Excludes known auto-replies, price-list banners, and courier-choice menus from extraction decisions.
- Limits generic chat and pickup drafts to the latest segment after an eight-hour conversation gap.
- Uses the latest explicit product message rather than a transcript-wide product priority.
- When product text is ambiguous, permits product inference only when size and seller price uniquely match the canonical Quick Order matrix.
- Requires a need/fulfillment cue such as `nak pakai`, `ambil`, `sebelum`, or `20hb pun xpe` before accepting a date as `date_need`.
- Preserves the upstream `Need Review`/`No Review` decision instead of changing every non-printed item to `No Review`.
- Records ignored message IDs, scoped message IDs, product evidence, date evidence, and applied rule keys in the draft evidence.

## Admin correction audit

`draft_admin_correction_diff_v15.sql` fills an empty `qrpay_order_draft_events.diff` for future admin save, approve, and confirm events. It records leaf-level changes to `customer`, `items`, `date_need`, and `delivery`, while excluding derived totals, transaction IDs, timestamps, and workflow state.

These rows form a reviewable feedback dataset. They are not automatic model training and are not promoted to active rules merely because one admin edited one draft. Rule promotion should require repeated confirmed corrections and an explicit approval threshold.

## Safe rollout

The migration creates `draft_ai_normalizer_version` in `private_runtime_settings` with the default value `v14`. Deploying the migration therefore does not alter live draft behavior.

1. Apply the migration with the flag left at `v14`.
2. Run `supabase/tests/draft_ai_v15_regression_ci.sql`.
3. Compare V14 and V15 against recent draft fixtures.
4. Activate with:

   ```sql
   update public.private_runtime_settings
   set setting_value='v15', updated_at=now()
   where setting_key='draft_ai_normalizer_version';
   ```

5. Roll back immediately, without another deployment, by changing the value back to `v14`.

Already confirmed or converted orders must not be reprocessed. Pending-admin drafts may be regenerated only through a separate, explicit admin action that preserves the original draft snapshot.

## Regression fixtures

- Zue: automation text cannot turn Edible A5 into Acrylic.
- Ruba: `6 inch` plus seller price `RM35` uniquely resolves to Acrylic.
- Aishah: explicit Edible wins; `20hb pun xpe` is the latest need date; generic `Pos` does not invent SPX.
- Wahida: artwork wording date does not beat `nak ambil Sabtu`.
- Dinnabake: two auto-replies do not override explicit Edible; a courier menu alone is not a courier selection.
