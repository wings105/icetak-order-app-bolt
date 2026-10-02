import test from "node:test";
import assert from "node:assert/strict";
import { normalize, extractRows, scrub, stable } from "./normalize.ts";

test("flat order finance preserves zero fees and signed escrow", () => {
  const row = normalize({ order_sn: "261002ABCDEF12", commission_fee: 0, service_fee: "RM 1.50", escrow_amount: "(2.10)" });
  assert.deepEqual(row.mapping_errors, []);
  assert.equal(row.normalized_data.commission_fee, "0");
  assert.equal(row.normalized_data.service_fee, "1.50");
  assert.equal(row.normalized_data.escrow_amount, "-2.10");
  assert.equal(row.normalized_data.settlement_status, "pending_release");
});
test("nested Shopee response maps transaction fee and release timestamp", () => {
  const row = normalize({ response: { order_sn: "261002ABCDEF12", order_income: { escrow_amount: 20, commission_fee: 1, seller_transaction_fee: 0.6 }, escrow_release_time: 1790940000 } });
  assert.deepEqual(row.mapping_errors, []);
  assert.equal(row.normalized_data.transaction_fee, "0.6");
  assert.equal(row.normalized_data.released_amount, "20");
  assert.equal(row.normalized_data.settlement_status, "released");
});
test("seller income alone remains escrow until release is evidenced", () => {
  const row = normalize({ order_sn: "261002ABCDEF12", seller_income: 20 });
  assert.equal(row.normalized_data.escrow_amount, "20");
  assert.equal(row.normalized_data.released_amount, undefined);
  assert.equal(row.normalized_data.settlement_status, "pending_release");
});
test("explicit released stage can use escrow as released amount", () => {
  const row = normalize({ order_sn: "261002ABCDEF12", escrow_amount: 20, settlement_status: "Released" });
  assert.equal(row.normalized_data.released_amount, "20");
});
test("batch context is retained without mixing orders", () => {
  const rows = extractRows({ shop_id: 99, response: { order_list: [{ order_sn: "261002ABCDEF12", escrow_amount: 5 }, { order_sn: "261002ABCDEF13", escrow_amount: 8 }] } });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].shop_id, 99);
  assert.equal(normalize(rows[1]).normalized_data.escrow_amount, "8");
});
test("invalid amounts and missing identifiers require mapping", () => {
  assert.deepEqual(normalize({ amount: 12 }).mapping_errors, ["missing_or_invalid_order_sn", "no_supported_finance_fields"]);
  assert.ok(normalize({ order_sn: "261002ABCDEF12", commission_fee: "unknown" }).mapping_errors.includes("invalid_commission_fee"));
  assert.throws(() => extractRows([null]));
});
test("items cannot accidentally supply order-level income", () => {
  const row = normalize({ order_sn: "261002ABCDEF12", items: [{ escrow_amount: 99 }] });
  assert.ok(row.mapping_errors.includes("no_supported_finance_fields"));
});
test("all provider fee breakdowns remain in payload", () => {
  const row = normalize({ order_sn: "261002ABCDEF12", escrow_amount: 20, seller_order_processing_fee: 0.54, tax: 0.12, access_token: "private", nested: { authorization: "private", commission_fee: 1 } });
  assert.deepEqual(row.payload, { order_sn: "261002ABCDEF12", escrow_amount: 20, seller_order_processing_fee: 0.54, tax: 0.12, nested: { commission_fee: 1 } });
  assert.deepEqual(scrub({ token: "private", amount: 1 }), { amount: 1 });
});
test("fingerprint is stable across object key ordering", () => {
  assert.equal(stable({ a: 1, b: { c: 2, d: 3 } }), stable({ b: { d: 3, c: 2 }, a: 1 }));
});
test("conflicting release stage is retained for review", () => {
  const row = normalize({ order_sn: "261002ABCDEF12", escrow_amount: 20, released_at: "2026-10-02", settlement_status: "pending" });
  assert.ok(row.mapping_errors.includes("conflicting_release_status"));
});
