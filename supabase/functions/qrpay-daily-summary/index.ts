import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ADMIN_PAGE = "https://icetak.bolt.host/?admin=v2&view=qrpay-summary";
const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };

type JsonObject = Record<string, unknown>;
type Run = { id: number; summary_date: string; slot: "10am" | "10pm"; attempts: number };
type SummaryRow = { transaction_id: string; amount: number | string; workflow_status: string; phone?: string | null; order_no?: string | null };
type Summary = { date: string; totals: Record<string, number | string>; rows: SummaryRow[] };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

async function rest(path: string) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const data = await response.json().catch(() => []);
  if (!response.ok) throw new Error(data?.message || data?.error || `REST ${response.status}`);
  return data;
}

async function rpc(name: string, body: JsonObject = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || `RPC ${name} ${response.status}`);
  return data;
}

async function setting(table: "private_runtime_settings" | "whatsapp_settings", key: string) {
  if (table === "private_runtime_settings") {
    const rows = await rest(`private_runtime_settings?setting_key=eq.${encodeURIComponent(key)}&select=setting_value&limit=1`);
    return String(rows?.[0]?.setting_value || "");
  }
  const rows = await rest(`whatsapp_settings?key=eq.${encodeURIComponent(key)}&select=text_value,secret_value&limit=1`);
  return String(rows?.[0]?.secret_value || rows?.[0]?.text_value || "");
}

async function secretMatches(received: string, expected: string) {
  if (!received || !expected) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(received)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let different = a.length ^ b.length;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) different |= a[index] ^ b[index];
  return different === 0;
}

function digits(value: string) {
  let phone = String(value || "").replace(/\D/g, "");
  if (phone.startsWith("0")) phone = `6${phone}`;
  else if (phone.startsWith("1")) phone = `60${phone}`;
  else if (phone && !phone.startsWith("60")) phone = `60${phone}`;
  return phone;
}

const money = (value: unknown) => `RM${Number(value || 0).toFixed(2)}`;
const formatDate = (value: string) => { const [year, month, day] = value.split("-"); return `${day}/${month}/${year}`; };

function buildMessage(summary: Summary, slot: string) {
  const totals = summary.totals || {};
  const attention = (summary.rows || []).filter((row) => !["matched_order", "ignored"].includes(row.workflow_status)).slice(0, 8);
  const lines = [
    `📊 QRPay Summary — ${formatDate(summary.date)} (${slot === "10am" ? "10:00 AM" : "10:00 PM"})`, "",
    `Jumlah masuk: ${money(totals.total_amount)} · ${Number(totals.total_count || 0)} transaksi`,
    `✅ Sudah masuk order: ${Number(totals.matched_count || 0)} · ${money(totals.matched_amount)}`,
    `🟡 Perlu semakan: ${Number(totals.review_count || 0)} · ${money(totals.review_amount)}`,
    `⏳ Sedang diproses: ${Number(totals.processing_count || 0)} · ${money(totals.processing_amount)}`,
    `🔴 Terlepas / failed: ${Number(totals.missed_count || 0)} · ${money(totals.missed_amount)}`,
    `⚪ Ignored for order: ${Number(totals.ignored_count || 0)} · ${money(totals.ignored_amount)}`,
  ];
  if (attention.length) {
    lines.push("", "Belum masuk order:");
    attention.forEach((row, index) => {
      const state = row.workflow_status === "needs_review" ? "REVIEW" : row.workflow_status === "missed" ? "MISSED" : "PROCESSING";
      lines.push(`${index + 1}. ${money(row.amount)} · ${row.transaction_id} · ${row.phone || "phone belum jumpa"} · ${state}`);
    });
    if (Number(totals.unresolved_count || 0) > attention.length) lines.push(`…dan ${Number(totals.unresolved_count) - attention.length} lagi dalam dashboard.`);
  }
  lines.push("", `Semak penuh: ${ADMIN_PAGE}&date=${summary.date}`);
  return lines.join("\n");
}

async function sendText(phone: string, text: string) {
  const [base, partnerKey, wabaId] = await Promise.all([
    setting("whatsapp_settings", "base_url"), setting("whatsapp_settings", "partner_key"), setting("whatsapp_settings", "waba_id"),
  ]);
  if (!partnerKey || !wabaId) throw new Error("WasapFlow credentials incomplete");
  const response = await fetch(`${base || "https://officialapi.wasapflow.com/bridge/v1"}/messages/send`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-partner-key": partnerKey, "x-waba-id": wabaId },
    body: JSON.stringify({ to: digits(phone), text, preview_url: true }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) throw new Error(data?.error?.message || data?.message || `WasapFlow ${response.status}`);
  return data;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ success: false, error: "POST required" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ success: false, error: "Runtime not configured" }, 500);
  try {
    const expected = await setting("private_runtime_settings", "qrpay_daily_summary_token");
    if (!await secretMatches(req.headers.get("x-qrpay-summary-token") || "", expected)) return json({ success: false, error: "Unauthorized" }, 401);
    const body = await req.json().catch(() => ({})) as JsonObject;
    if (body.dry_run === true) {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.date || "")) ? String(body.date) : null;
      const summary = await rpc("finance_admin_qrpay_daily", { p_date: date }) as Summary;
      return json({ success: true, dry_run: true, summary, message: buildMessage(summary, String(body.slot || "10pm")) });
    }

    const runs = await rpc("finance_claim_qrpay_daily_summaries", { p_limit: 2 }) as Run[];
    const recipient = digits(await setting("whatsapp_settings", "admin_order_notify_phone") || "60129554732");
    const results: JsonObject[] = [];
    for (const run of Array.isArray(runs) ? runs : []) {
      let summary: Summary | null = null;
      let message = "";
      try {
        summary = await rpc("finance_admin_qrpay_daily", { p_date: run.summary_date }) as Summary;
        message = buildMessage(summary, run.slot);
        const sent = await sendText(recipient, message);
        const messageId = String(sent?.message_id || sent?.id || sent?.data?.message_id || "");
        await rpc("finance_complete_qrpay_daily_summary", { p_run_id: run.id, p_success: true, p_recipient_phone: recipient, p_provider_message_id: messageId || null, p_error: null, p_snapshot: summary, p_message_preview: message });
        results.push({ id: run.id, success: true, message_id: messageId || null });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await rpc("finance_complete_qrpay_daily_summary", { p_run_id: run.id, p_success: false, p_recipient_phone: recipient, p_provider_message_id: null, p_error: detail, p_snapshot: summary || {}, p_message_preview: message || null }).catch(() => null);
        results.push({ id: run.id, success: false, error: detail });
      }
    }
    return json({ success: true, processed: results.length, results });
  } catch (error) {
    console.error("qrpay-daily-summary", error instanceof Error ? error.message : String(error));
    return json({ success: false, error: error instanceof Error ? error.message : "Summary dispatch failed" }, 500);
  }
});
