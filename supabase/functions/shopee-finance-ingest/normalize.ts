export type RecordValue = Record<string, unknown>;
export function object(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const AMOUNTS: Record<string, string[]> = {
  product_subtotal: ["product_subtotal", "merchandise_subtotal"],
  buyer_paid: ["buyer_paid", "buyer_total_amount", "total_buyer_payment"],
  shipping_fee: ["shipping_fee", "buyer_paid_shipping_fee"],
  escrow_amount: ["escrow_amount", "order_income_amount", "seller_income", "seller_income_amount"],
  released_amount: ["released_amount", "payout_amount"],
  commission_fee: ["commission_fee", "shopee_commission_fee"],
  service_fee: ["service_fee", "shopee_service_fee"],
  transaction_fee: ["transaction_fee", "seller_transaction_fee"],
  other_fees: ["other_fees"],
};
const FINANCIAL_FIELDS = ["escrow_amount", "released_amount", "commission_fee", "service_fee", "transaction_fee", "other_fees"];

function containers(row: RecordValue) {
  const result: RecordValue[] = [row];
  for (let i = 0; i < result.length && i < 20; i++) {
    for (const key of ["data", "response", "order", "order_income", "income_details", "financials", "finance", "payment_info"]) {
      const value = result[i][key];
      if (object(value) && !result.includes(value)) result.push(value);
    }
  }
  return result;
}
function pick(rows: RecordValue[], keys: string[]) {
  for (const row of rows) for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}
function amount(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") throw new Error("invalid amount");
  let raw = String(value).trim().replace(/^RM\s*/i, "").replace(/,/g, "");
  if (/^\([\d.]+\)$/.test(raw)) raw = "-" + raw.slice(1, -1);
  if (!/^-?\d+(\.\d{1,8})?$/.test(raw) || !Number.isFinite(Number(raw)) || Math.abs(Number(raw)) > 1e9) throw new Error("invalid amount");
  return raw;
}
function date(value: unknown) {
  if (typeof value !== "number" && typeof value !== "string") throw new Error("invalid date");
  let raw = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (n <= 0) return undefined;
    const d = new Date(n >= 1e12 ? n : n * 1000);
    if (Number.isNaN(d.getTime())) throw new Error("invalid date");
    return d.toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) raw += "T00:00:00+08:00";
  else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(raw)) raw = raw.replace(" ", "T") + "+08:00";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new Error("invalid date");
  return d.toISOString();
}

export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 20) return "[MAX_DEPTH]";
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (!object(value)) return value;
  const result: RecordValue = {};
  for (const [key, v] of Object.entries(value)) {
    if (/secret|password|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|signature|^token$/i.test(key)) continue;
    result[key] = scrub(v, depth + 1);
  }
  return result;
}
export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function extractRows(payload: unknown): RecordValue[] {
  if (Array.isArray(payload)) {
    if (payload.some((row) => !object(row))) throw new Error("Every finance row must be a JSON object");
    return payload as RecordValue[];
  }
  if (!object(payload)) throw new Error("Send a JSON object or array");
  for (const container of containers(payload)) {
    for (const key of ["orders", "order_list", "income_list", "transactions", "records", "data"]) {
      const list = container[key];
      if (Array.isArray(list)) {
        if (list.some((row) => !object(row))) throw new Error("Every finance row must be a JSON object");
        const context: RecordValue = {};
        for (const contextKey of ["shop_id", "currency", "region"]) {
          const value = pick(containers(payload), [contextKey]);
          if (value !== undefined) context[contextKey] = value;
        }
        return list.map((row) => ({ ...context, ...row }));
      }
    }
  }
  return [payload];
}

export function normalize(row: RecordValue) {
  const source = containers(row);
  const normalized: RecordValue = {};
  const errors: string[] = [];
  const sn = pick(source, ["order_sn", "ordersn", "order_no", "orderno", "order_id", "Order ID"]);
  const orderSn = sn === undefined ? null : String(sn).trim().toUpperCase();
  if (!orderSn || !/^[A-Z0-9-]{6,64}$/.test(orderSn)) errors.push("missing_or_invalid_order_sn");
  const shop = pick(source, ["shop_id"]);
  const shopId = shop === undefined ? null : String(shop).trim();
  for (const [field, keys] of Object.entries(AMOUNTS)) {
    const value = pick(source, keys);
    if (value === undefined) continue;
    try { normalized[field] = amount(value); } catch { errors.push(`invalid_${field}`); }
  }
  const currency = pick(source, ["currency", "currency_code"]);
  if (currency !== undefined) {
    const code = String(currency).trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(code)) normalized.currency = code;
    else errors.push("invalid_currency");
  }
  for (const [field, aliases] of Object.entries({
    released_at: ["released_at", "escrow_release_time", "release_time", "released_time", "release_date"],
    provider_updated_at: ["finance_updated_at", "update_time", "updated_at"],
  })) {
    const value = pick(source, aliases);
    if (value === undefined) continue;
    try { const parsed = date(value); if (parsed) normalized[field] = parsed; } catch { errors.push(`invalid_${field}`); }
  }
  const stage = pick(source, ["settlement_status", "income_status", "payout_status"]);
  if (stage !== undefined) {
    const status = String(stage).trim().toLowerCase().replace(/[\s-]+/g, "_");
    const mapped: Record<string, string> = {
      released: "released", paid: "released", paid_out: "released", settled: "released",
      to_release: "pending_release", pending: "pending_release", pending_release: "pending_release",
      unreleased: "pending_release", awaiting_release: "pending_release", refunded: "refunded",
    };
    if (mapped[status]) normalized.settlement_status = mapped[status];
    else errors.push("unrecognized_settlement_status");
  }
  // Escrow is a balance estimate until release is explicitly evidenced.
  if (normalized.released_at && normalized.settlement_status === "pending_release") errors.push("conflicting_release_status");
  if ((normalized.released_at || normalized.settlement_status === "released") && normalized.escrow_amount !== undefined && normalized.released_amount === undefined) normalized.released_amount = normalized.escrow_amount;
  if (normalized.released_amount !== undefined || normalized.released_at) normalized.settlement_status ??= "released";
  if (normalized.escrow_amount !== undefined) normalized.settlement_status ??= "pending_release";
  const financial = FINANCIAL_FIELDS.some((key) => normalized[key] !== undefined);
  if (!financial) errors.push("no_supported_finance_fields");
  return { order_sn: orderSn, shop_id: shopId, normalized_data: normalized, mapping_errors: errors, payload: scrub(row) };
}
