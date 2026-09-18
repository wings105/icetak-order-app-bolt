import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Only the hash is committed. The private token is carried in the Make URL.
const TOKEN_HASH = "502810e87a366b90ae4f3b35d8b14411a910116a7156e59d9d3c60fa8bdc3d3a";
const BASE = Deno.env.get("SUPABASE_URL") ?? "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
type Row = Record<string, unknown>;

function reply(body: unknown, status = 200, type = "application/json") {
  return new Response(type === "application/json" ? JSON.stringify(body) : String(body), {
    status, headers: { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" },
  });
}
async function hash(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function db(table: string, params = "", method = "GET", body?: Row) {
  const res = await fetch(`${BASE}/rest/v1/${table}${params}`, {
    method,
    headers: { apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "application/json", prefer: params.includes("on_conflict=") ? "resolution=merge-duplicates,return=representation" : "return=representation" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Database ${res.status}: ${JSON.stringify(value).slice(0, 300)}`);
  return value as Row[];
}
function field(row: Row, ...keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}
function normalizePhone(raw: string) {
  const digits = raw.replace(/\D/g, "");
  const local = digits.startsWith("60") ? `0${digits.slice(2)}` : digits;
  if (!/^01\d{8,9}$/.test(local)) throw new Error("invalid_malaysian_phone");
  return `60${local.slice(1)}`;
}
function query(value: string) { return encodeURIComponent(value); }

async function ingest(input: Row, source: "make" | "clickup_csv") {
  const orderSn = field(input, "order_sn", "order_id", "shopee_order_id");
  const userId = field(input, "shopee_user_id", "user_id", "provider_user_id");
  const username = field(input, "shopee_username", "username", "buyer_username");
  const sourceId = field(input, "clickup_id", "clickup_task_id", "source_id");
  const phone = normalizePhone(field(input, "phone", "phone_number", "whatsapp"));
  if (!orderSn && !userId && !username) throw new Error("order_sn_or_user_id_or_username_required");
  if (source === "clickup_csv" && !sourceId) throw new Error("clickup_id_required_for_import");

  let order: Row | undefined;
  if (orderSn) {
    const rows = await db("marketplace_orders", `?provider=eq.shopee&order_sn=eq.${query(orderSn)}&select=id,order_sn,buyer_customer_id,buyer_user_id,buyer_username&limit=1`);
    order = rows[0];
    if (!order && source === "make") return { status: "unmatched_order", order_sn: orderSn };
    if (order?.buyer_username && username && String(order.buyer_username).toLowerCase() !== username.toLowerCase())
      return { status: "identity_conflict", reason: "order_username_mismatch", order_sn: orderSn };
  }
  let candidates: Row[] = [];
  if (order?.buyer_customer_id) candidates = await db("marketplace_customers", `?id=eq.${query(String(order.buyer_customer_id))}&select=id,customer_master_id,provider_user_id,username&limit=1`);
  const resolvedUserId = userId || (order?.buyer_user_id ? String(order.buyer_user_id) : "");
  if (userId && order?.buyer_user_id && String(order.buyer_user_id) !== userId)
    return { status: "identity_conflict", reason: "order_user_id_mismatch", order_sn: orderSn };
  if (!candidates.length && resolvedUserId) candidates = await db("marketplace_customers", `?provider=eq.shopee&provider_user_id=eq.${query(resolvedUserId)}&select=id,customer_master_id,provider_user_id,username&limit=2`);
  const resolvedUsername = username || (order?.buyer_username ? String(order.buyer_username) : "");
  if (!candidates.length && resolvedUsername) candidates = await db("marketplace_customers", `?provider=eq.shopee&username_normalized=eq.${query(resolvedUsername.toLowerCase())}&select=id,customer_master_id,provider_user_id,username&limit=2`);
  if (candidates.length > 1) return { status: "ambiguous_username", order_sn: orderSn, username: resolvedUsername };
  let mc = candidates[0];
  if (mc && userId && mc.provider_user_id && String(mc.provider_user_id) !== userId) return { status: "identity_conflict", reason: "user_id_mismatch", order_sn: orderSn };

  let staged: Row | undefined;
  if (sourceId) staged = (await db("crm_clickup_import_rows", `?clickup_id=eq.${query(sourceId)}&select=clickup_id,customer_master_id,phone,shopee_user_id,shopee_username&limit=1`))[0];
  if (!staged && resolvedUserId) {
    const matching = await db("crm_clickup_import_rows", `?shopee_user_id=eq.${query(resolvedUserId)}&select=clickup_id,customer_master_id,phone,shopee_user_id,shopee_username&limit=2`);
    if (matching.length === 1 && matching[0].phone === phone) staged = matching[0];
  }
  if (!staged && resolvedUsername) {
    const matching = await db("crm_clickup_import_rows", `?shopee_username=eq.${query(resolvedUsername.toLowerCase())}&phone=eq.${query(phone)}&select=clickup_id,customer_master_id,phone,shopee_user_id,shopee_username&limit=2`);
    if (matching.length === 1) staged = matching[0];
  }
  if (!staged && resolvedUsername && !mc) {
    const previous = await db("crm_clickup_import_rows", `?shopee_username=eq.${query(resolvedUsername.toLowerCase())}&select=clickup_id,phone&limit=2`);
    if (previous.length) return { status: "manual_review", reason: "username_exists_with_another_phone_or_multiple_records", username: resolvedUsername };
  }
  let masterId = String(mc?.customer_master_id ?? staged?.customer_master_id ?? "");
  if (mc?.customer_master_id && staged?.customer_master_id && mc.customer_master_id !== staged.customer_master_id)
    return { status: "identity_conflict", reason: "clickup_and_shopee_different_profiles", order_sn: orderSn };
  if (staged?.phone && staged.phone !== phone) return { status: "identity_conflict", reason: "clickup_source_phone_changed", order_sn: orderSn };

  const owner = await db("customer_master", `?primary_phone_normalized=eq.${query(phone)}&status=eq.active&select=id&limit=2`);
  if (owner.length > 1 || (masterId && owner.length && owner[0].id !== masterId))
    return { status: "identity_conflict", reason: "phone_belongs_to_another_customer", order_sn: orderSn };
  if (!masterId && owner.length) {
    // A phone alone does not prove the marketplace account belongs to this person.
    return { status: "manual_review", reason: "existing_phone_without_verified_shopee_link", order_sn: orderSn };
  }
  if (source === "make" && !mc && !staged) return { status: "unmatched_customer", order_sn: orderSn, username: resolvedUsername };
  let result = "unchanged";
  if (!masterId) {
    const created = await db("customer_master", "", "POST", { display_name: resolvedUsername || phone, primary_phone_normalized: phone, metadata: { source: "clickup_identity_ingest" } });
    masterId = String(created[0].id);
    result = "created";
  } else {
    const current = (await db("customer_master", `?id=eq.${query(masterId)}&select=id,primary_phone_normalized&limit=1`))[0];
    if (!current) throw new Error("customer_master_not_found");
    if (current.primary_phone_normalized && current.primary_phone_normalized !== phone)
      return { status: "identity_conflict", reason: "customer_has_different_phone", order_sn: orderSn };
    if (!current.primary_phone_normalized) {
      await db("customer_master", `?id=eq.${query(masterId)}`, "PATCH", { primary_phone_normalized: phone });
      result = "updated";
    }
  }
  if (mc && !mc.customer_master_id) await db("marketplace_customers", `?id=eq.${query(String(mc.id))}`, "PATCH", { customer_master_id: masterId });
  if (!mc && resolvedUserId && resolvedUsername) {
    const created = await db("marketplace_customers", "", "POST", {
      provider: "shopee", region: "MY", provider_user_id: resolvedUserId,
      username: resolvedUsername, username_normalized: resolvedUsername.toLowerCase(), customer_master_id: masterId,
    });
    mc = created[0];
  }
  if (order && mc && !order.buyer_customer_id) await db("marketplace_orders", `?id=eq.${query(String(order.id))}`, "PATCH", {
    buyer_customer_id: mc.id, buyer_user_id: resolvedUserId || null, buyer_match_method: "clickup_order_sn", buyer_match_confidence: 1, buyer_matched_at: new Date().toISOString(),
  });
  if (sourceId) {
    const data = { clickup_id: sourceId, customer_master_id: masterId, order_sn: orderSn || null, shopee_user_id: resolvedUserId || null, shopee_username: resolvedUsername.toLowerCase() || null, phone, raw_record: input, updated_at: new Date().toISOString() };
    await db("crm_clickup_import_rows", `?on_conflict=clickup_id`, "POST", data);
    const address = field(input, "address", "full_address", "address_line1");
    if (address) {
      const addrKey = `clickup:${sourceId}`;
      const existingAddress = await db("customer_addresses", `?source_address_key=eq.${query(addrKey)}&select=id&limit=1`);
      const addressRow = {
        customer_master_id: masterId,
        source_address_key: addrKey,
        source_provider: "clickup",
        raw_address: address,
        address_line1: field(input, "address_line1") || address,
        recipient_name: field(input, "name", "customer_name") || null,
        city: field(input, "city", "bandar") || null,
        postcode: field(input, "postcode", "poskod") || null,
        state: field(input, "state", "negeri") || null,
        phone,
        is_default: false,
        metadata: { source: "clickup_identity_import" },
      };
      if (existingAddress[0]) await db("customer_addresses", `?id=eq.${query(String(existingAddress[0].id))}`, "PATCH", addressRow);
      else await db("customer_addresses", "", "POST", addressRow);
    }
  }
  return { status: result, customer_master_id: masterId, order_sn: orderSn || null, matched_shopee: Boolean(mc), staged_for_future_match: !mc };
}

const IMPORT_PAGE = `<!doctype html><html lang="ms"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Import CRM ClickUp</title><style>body{font:16px system-ui;max-width:850px;margin:40px auto;padding:16px}button{padding:12px}pre{white-space:pre-wrap;background:#f5f5f5;padding:12px}</style><h1>Import CRM ClickUp</h1><p>CSV mesti ada clickup_id, phone, dan sekurang-kurangnya order_sn, shopee_user_id atau shopee_username. Kolum alamat boleh disertakan; ia disimpan dalam rekod import untuk semakan dan tidak menggantikan alamat order.</p><input id="file" type="file" accept=".csv,text/csv"><button id="upload">Import CSV</button><pre id="out">Pilih fail CSV.</pre><script>
function parseCSV(s){let rows=[],r=[],v='',q=false;for(let i=0;i<s.length;i++){let c=s[i];if(c==='"'){if(q&&s[i+1]==='"'){v+='"';i++}else q=!q}else if(c===','&&!q){r.push(v);v=''}else if((c==='\\n'||c==='\\r')&&!q){if(c==='\\r'&&s[i+1]==='\\n')i++;r.push(v);v='';if(r.some(x=>x.trim()))rows.push(r);r=[]}else v+=c}r.push(v);if(r.some(x=>x.trim()))rows.push(r);let h=rows.shift().map(x=>x.replace(/^\\uFEFF/,'').trim().toLowerCase());return rows.map(a=>Object.fromEntries(h.map((k,i)=>[k,(a[i]||'').trim()])))}
document.getElementById('upload').onclick=async()=>{let f=document.getElementById('file').files[0],o=document.getElementById('out');if(!f)return;o.textContent='Membaca CSV...';let rows=parseCSV(await f.text()),summary={rows:rows.length,created:0,updated:0,unchanged:0,conflicts:0,errors:0,other:0},issues=[];for(let i=0;i<rows.length;i+=50){let res=await fetch(location.href,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({records:rows.slice(i,i+50),mode:'import'})});let data=await res.json();if(!res.ok){o.textContent='Import dihentikan pada rekod '+(i+1)+': '+JSON.stringify(data);return}for(let x of data.results){let st=x.result?.status;if(st in summary)summary[st]++;else if(st==='identity_conflict'||st==='ambiguous_username'||st==='manual_review')summary.conflicts++;else if(x.error)summary.errors++;else summary.other++;if(x.error||st==='identity_conflict'||st==='ambiguous_username'||st==='manual_review'||st==='unmatched_order')issues.push({row:i+x.row,error:x.error,result:x.result})}o.textContent=JSON.stringify({progress:Math.min(i+50,rows.length),summary,issues:issues.slice(0,100)},null,2)}o.textContent+='\\nSelesai. Simpan laporan ini untuk semakan.'};</script></html>`;

Deno.serve(async (request) => {
  try {
    const url = new URL(request.url);
    const supplied = url.searchParams.get("token") ?? "";
    const digest = await hash(supplied);
    let diff = 0;
    for (let i = 0; i < TOKEN_HASH.length; i++) diff |= TOKEN_HASH.charCodeAt(i) ^ digest.charCodeAt(i);
    if (diff || !supplied) return reply({ ok: false, error: "unauthorized" }, 401);
    if (!BASE || !KEY) return reply({ ok: false, error: "server_not_configured" }, 500);
    if (request.method === "GET" && url.pathname.endsWith("/import")) return reply(IMPORT_PAGE, 200, "text/html");
    if (request.method !== "POST") return reply({ ok: false, error: "method_not_allowed" }, 405);
    if (Number(request.headers.get("content-length") ?? 0) > 512000) return reply({ ok: false, error: "batch_too_large" }, 413);
    const raw = await request.text();
    if (raw.length > 512000) return reply({ ok: false, error: "batch_too_large" }, 413);
    const data = JSON.parse(raw);
    const records = Array.isArray(data.records) ? data.records : [data];
    if (records.length > 50 || !records.length) return reply({ ok: false, error: "batch_limit_50" }, 400);
    const source = data.mode === "import" || url.pathname.endsWith("/import") ? "clickup_csv" : "make";
    const results = [];
    for (let i = 0; i < records.length; i++) {
      try { results.push({ row: i + 1, result: await ingest(records[i], source) }); }
      catch (e) { results.push({ row: i + 1, error: e instanceof Error ? e.message : String(e) }); }
    }
    return reply({ ok: results.every((r) => !r.error), results }, results.some((r) => r.error) ? 207 : 200);
  } catch (e) {
    console.error("crm identity ingest failed", e);
    return reply({ ok: false, error: "request_failed" }, 500);
  }
});
