/*
# Storage bucket + payment status auto-sync trigger

## Changes

### 1. Supabase Storage
- Creates `receipts` bucket (public: false) for storing payment receipt files.
- Bucket-level RLS policies allow anon + authenticated users to upload and read.

### 2. Payment status auto-sync trigger
- Adds PostgreSQL function `sync_order_payment_status()` that recalculates
  `orders.payment_status` whenever a row in `payment_sessions` is inserted or updated.
- Logic: if ALL sessions for an order are `matched` → `paid`;
  if ANY session is `matched` → `partial`; otherwise `unpaid`.
- Adds trigger `trg_sync_payment_status` that fires AFTER INSERT OR UPDATE on
  `payment_sessions`, calling the function with the affected `order_id`.

### Notes
- No table structure changes — this migration is additive only.
- The trigger runs inside the DB so no backend process is required for payment
  status roll-up.
- Uses IF NOT EXISTS / OR REPLACE patterns for idempotency.
*/

-- ─── Storage bucket ───────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS
DROP POLICY IF EXISTS "receipts_select_anon" ON storage.objects;
CREATE POLICY "receipts_select_anon" ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'receipts');

DROP POLICY IF EXISTS "receipts_insert_anon" ON storage.objects;
CREATE POLICY "receipts_insert_anon" ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'receipts');

DROP POLICY IF EXISTS "receipts_update_anon" ON storage.objects;
CREATE POLICY "receipts_update_anon" ON storage.objects FOR UPDATE
  TO anon, authenticated
  USING (bucket_id = 'receipts');

DROP POLICY IF EXISTS "receipts_delete_anon" ON storage.objects;
CREATE POLICY "receipts_delete_anon" ON storage.objects FOR DELETE
  TO anon, authenticated
  USING (bucket_id = 'receipts');

-- ─── Payment status trigger ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION sync_order_payment_status()
RETURNS TRIGGER AS $$
DECLARE
  v_order_id uuid;
  v_total     integer;
  v_matched   integer;
  v_new_status text;
BEGIN
  v_order_id := NEW.order_id;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'matched')
  INTO v_total, v_matched
  FROM payment_sessions
  WHERE order_id = v_order_id;

  IF v_total = 0 THEN
    v_new_status := 'unpaid';
  ELSIF v_matched = v_total THEN
    v_new_status := 'paid';
  ELSIF v_matched > 0 THEN
    v_new_status := 'partial';
  ELSE
    v_new_status := 'unpaid';
  END IF;

  UPDATE orders
  SET payment_status = v_new_status, updated_at = now()
  WHERE id = v_order_id
    AND payment_status IS DISTINCT FROM v_new_status;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_payment_status ON payment_sessions;
CREATE TRIGGER trg_sync_payment_status
  AFTER INSERT OR UPDATE ON payment_sessions
  FOR EACH ROW EXECUTE FUNCTION sync_order_payment_status();
