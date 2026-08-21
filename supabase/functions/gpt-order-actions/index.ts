import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TOKEN_SETTING = "gpt_actions_token_sha256";
const ACTOR = "chatgpt-gpt";
const SCOPE = "waba:939302461880264";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,x-icetak-gpt-token",
};

type JsonObject = Record<string, unknown>;
type ProductKind = "edible" | "burnaway" | "wafer" | "printed" | "mirror" | "acrylic";

const PRODUCTS: Record<ProductKind, { title: string; sizes: string[]; styles: string[] }> = {
  edible: {
    title: "Edible Image",
    sizes: ["3 inch", "3.5 inch", "4 inch", "4.5 inch", "5 inch", "5.5 inch", "6 inch", "6.5 inch", "7 inch", "7.5 inch", "A6", "A5", "A4", "Cupcake"],
    styles: ["Round / Bulat", "Square / Petak", "Love Shape / Hati", "Full Landscape", "Full Portrait", "Custom"],
  },
  burnaway: {
    title: "Burn Away Combo",
    sizes: ["3 inch", "4 inch", "5 inch", "5.5 inch", "6 inch", "6.5 inch", "7 inch", "7.5 inch", "Custom A5", "Custom A4"],
    styles: ["Round / Bulat", "Square / Petak", "Love Shape / Hati"],
  },
  wafer: {
    title: "Wafer Paper Only",
    sizes: ["3 inch", "3.5 inch", "4 inch", "4.5 inch", "5 inch", "5.5 inch", "6 inch", "6.5 inch", "7 inch", "7.5 inch", "8 inch"],
    styles: ["Round / Bulat", "Square / Petak", "Love Shape / Hati"],
  },
  printed: {
    title: "Cake Topper",
    sizes: ["1 pc"],
    styles: ["Custom Name", "Happy Birthday"],
  },
  mirror: {
    title: "Mirror Gold Artpaper",
    sizes: ["A7 Mini", "A6 Standard", "A5 Large"],
    styles: ["Gold"],
  },
  acrylic: {
    title: "Acrylic Cake Topper",
    sizes: ["A7 Mini", "A6 Standard", "A5 Large"],
    styles: ["Gold", "Silver", "Black", "Rose Gold", "Clear / Transparent", "Dark Blue", "Light Blue", "Red", "Yellow", "Pink", "Gold Glitter", "Silver Glitter", "Lilac / Light Purple", "Mirror Blue", "Bronze", "Green", "Orange", "White"],
  },
};

const DELIVERY = {
  pickup: { label: "Pickup", fee: 0 },
  spx: { label: "SPX", fee: 4.5 },
  jnt: { label: "J&T", fee: 5.9 },
  ninja: { label: "Ninja Van", fee: 6.9 },
} as const;

class ActionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" },
  });
}

function str(value: unknown, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown, field: string, max = 100000, min = 0) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < min || number > max) throw new ActionError(`${field} is invalid`);
  return Math.round(number * 100) / 100;
}

function normalizePhone(value: unknown) {
  let digits = str(value, 40).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0")) digits = `6${digits}`;
  else if (digits.startsWith("1")) digits = `60${digits}`;
  return /^601\d{8,9}$/.test(digits) ? digits : "";
}

function validBsuid(value: unknown) {
  const valueText = str(value, 140);
  return /^[A-Z]{2}\.(?:ENT\.)?[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/i.test(valueText) ? valueText : "";
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let different = 0;
  for (let index = 0; index < left.length; index += 1) different |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return different === 0;
}

function queryString(values: Record<string, string>) {
  return new URLSearchParams(values).toString();
}

async function rest(table: string, query: Record<string, string>) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${queryString(query)}`, {
    headers: { apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ActionError(str(body?.message || body?.error || "Database request failed"), 502);
  return Array.isArray(body) ? body : [];
}

async function rpc(name: string, body: JsonObject) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: SERVICE_ROLE_KEY, authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new ActionError(str(result?.message || result?.error || `Order operation ${name} failed`), 400);
  return result;
}

async function isAuthorized(req: Request) {
  const token = str(req.headers.get("x-icetak-gpt-token"), 220);
  if (!/^icetak_gpt_[A-Za-z0-9_-]{32,120}$/.test(token)) return false;
  const rows = await rest("private_runtime_settings", {
    select: "setting_value",
    setting_key: `eq.${TOKEN_SETTING}`,
    limit: "1",
  });
  const expected = str(rows[0]?.setting_value, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) return false;
  return constantTimeEqual(await sha256(token), expected);
}

function normalizeKind(value: unknown): ProductKind {
  const text = str(value, 100).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["edible", "edibleimage", "icingsheet"].includes(text)) return "edible";
  if (["burnaway", "burnawaycombo"].includes(text)) return "burnaway";
  if (["wafer", "waferpaper", "waferpaperonly"].includes(text)) return "wafer";
  if (["printed", "topper", "caketopper", "printedtopper", "printedcaketopper"].includes(text)) return "printed";
  if (["mirror", "mirrorgold", "mirrorgoldartpaper"].includes(text)) return "mirror";
  if (["acrylic", "acrylictopper", "acryliccaketopper", "akrilik"].includes(text)) return "acrylic";
  throw new ActionError("Product must be edible, burnaway, wafer, printed, mirror or acrylic");
}

function normalizeSize(kind: ProductKind, value: unknown) {
  let size = str(value, 60);
  if (!size && kind === "printed") return "1 pc";
  if (!size) throw new ActionError(`Size is required for ${PRODUCTS[kind].title}`);
  size = size.replace(/\s*(?:inch|inci|\")$/i, " inch").replace(/\s+/g, " ").trim();
  if (["mirror", "acrylic"].includes(kind)) {
    if (/^a7(?:\s+mini)?$/i.test(size)) return "A7 Mini";
    if (/^a6(?:\s+standard)?$/i.test(size)) return "A6 Standard";
    if (/^a5(?:\s+large)?$/i.test(size)) return "A5 Large";
  }
  const exact = PRODUCTS[kind].sizes.find((candidate) => candidate.toLowerCase() === size.toLowerCase());
  if (!exact) throw new ActionError(`Unsupported ${PRODUCTS[kind].title} size: ${size}`);
  return exact;
}

function normalizeStyle(kind: ProductKind, value: unknown) {
  const provided = str(value, 100);
  if (!provided) return PRODUCTS[kind].styles[0];
  const lower = provided.toLowerCase();
  if (["round", "bulat", "circle"].includes(lower)) return "Round / Bulat";
  if (["square", "petak"].includes(lower)) return "Square / Petak";
  if (["love", "hati", "heart"].includes(lower)) return "Love Shape / Hati";
  const exact = PRODUCTS[kind].styles.find((style) => style.toLowerCase() === lower);
  return exact || provided;
}

async function price(kind: ProductKind, process: string, size: string, style: string, review: string) {
  const amount = Number(await rpc("icetak_quick_order_price", {
    p_kind: kind,
    p_process: process,
    p_size: size,
    p_style: style,
    p_review: review,
  }));
  if (!Number.isFinite(amount) || amount <= 0) throw new ActionError(`No production catalog price found for ${PRODUCTS[kind].title} ${size}`);
  return amount;
}

function deliveryValue(input: unknown) {
  const text = str(input, 60).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["pickup", "selfpickup", "ambil", "counter"].includes(text)) return "pickup";
  if (["spx", "posspx", "shopeexpress"].includes(text)) return "spx";
  if (["jnt", "jt", "jtexpress"].includes(text)) return "jnt";
  if (["ninja", "ninjavan"].includes(text)) return "ninja";
  throw new ActionError("Delivery must be pickup, spx, jnt or ninja");
}

function paymentFlow(input: unknown) {
  const text = str(input, 50).toLowerCase().replace(/[\s-]+/g, "_");
  if (["prepaid", "unpaid"].includes(text)) return "prepaid";
  if (["cash_counter", "cash", "counter", "pickup_cash"].includes(text)) return "cash_counter";
  if (["paid", "already_paid", "sudah_bayar"].includes(text)) return "paid";
  if (["qrpay", "qr_pay", "duitnow"].includes(text)) return "qrpay";
  throw new ActionError("Payment flow must be prepaid, cash_counter, paid or qrpay");
}

async function catalog(url: URL) {
  const chosen = str(url.searchParams.get("product"), 80);
  const sizeRequested = str(url.searchParams.get("size"), 60);
  const process = /^urgent$/i.test(str(url.searchParams.get("process"), 20)) ? "Urgent" : "Pre-order";
  const profiles = await rest("product_order_profiles", {
    select: "code,name,product_type,config",
    active: "eq.true",
    limit: "30",
  });
  const kinds = chosen ? [normalizeKind(chosen)] : Object.keys(PRODUCTS) as ProductKind[];
  const products = await Promise.all(kinds.map(async (kind) => {
    const definition = PRODUCTS[kind];
    const sizes = sizeRequested ? [normalizeSize(kind, sizeRequested)] : chosen ? definition.sizes : [definition.sizes[0]];
    const variations = await Promise.all(sizes.map(async (size) => ({
      size,
      catalog_price: await price(kind, process, size, definition.styles[0], kind === "printed" ? "Need Review" : "No Review"),
    })));
    const profile = profiles.find((entry) => entry.product_type === kind);
    return {
      product: kind,
      title: definition.title,
      process,
      available_sizes: definition.sizes,
      styles: definition.styles,
      variations,
      order_profile: profile ? { code: profile.code, name: profile.name } : null,
    };
  }));
  return json({ success: true, products, delivery: DELIVERY, currency: "MYR" });
}

async function customer(url: URL) {
  const input = str(url.searchParams.get("identifier"), 140);
  if (input.length < 3 || !/^[A-Za-z0-9._@+\s-]+$/.test(input)) {
    throw new ActionError("A valid phone, WhatsApp BSUID or exact username is required");
  }
  const phone = normalizePhone(input);
  const bsuid = validBsuid(input);
  const username = input.replace(/^@+/, "");
  const filters: Record<string, string> = {
    select: "customer_master_id,identifier_type,identifier_value,normalized_value,scope,is_verified,last_seen_at",
    order: "is_verified.desc,last_seen_at.desc",
    limit: "8",
  };
  if (phone) {
    filters.identifier_type = "eq.phone";
    filters.normalized_value = `eq.${phone}`;
  } else if (bsuid) {
    filters.normalized_value = `eq.${bsuid}`;
  } else {
    filters.identifier_type = "eq.marketplace_username";
    filters.normalized_value = `ilike.${username}`;
  }
  const matches = await rest("customer_identifiers_master", filters);
  const ids = Array.from(new Set(matches.map((match) => str(match.customer_master_id, 40)))).filter((id) => /^[a-f0-9-]{36}$/i.test(id)).slice(0, 4);
  const results = await Promise.all(ids.map(async (id) => {
    const masters = await rest("customer_master", {
      select: "id,display_name,admin_name_override,primary_phone_normalized,status",
      id: `eq.${id}`,
      status: "eq.active",
      merged_into_id: "is.null",
      limit: "1",
    });
    const master = masters[0];
    if (!master) return null;
    const [addresses, identities] = await Promise.all([
      rest("customer_addresses", {
        select: "recipient_name,phone,address_line1,address_line2,city,postcode,state,is_default,is_verified,source_provider",
        customer_master_id: `eq.${id}`,
        archived_at: "is.null",
        order: "is_default.desc,is_verified.desc,last_used_at.desc.nullslast",
        limit: "2",
      }),
      rest("customer_identifiers_master", {
        select: "identifier_type,identifier_value,scope,is_verified",
        customer_master_id: `eq.${id}`,
        limit: "8",
      }),
    ]);
    return {
      customer_master_id: id,
      name: str(master.admin_name_override || master.display_name),
      phone: str(master.primary_phone_normalized, 30) || null,
      identifiers: identities,
      addresses,
    };
  }));
  const found = results.filter(Boolean);
  if (found.length) return json({ success: true, found: true, customers: found });

  const fallback: Record<string, string> = {
    select: "name,phone,normalized_phone,bsuid,username",
    limit: "3",
  };
  if (phone) fallback.normalized_phone = `eq.${phone}`;
  else if (bsuid) fallback.bsuid = `eq.${bsuid}`;
  else fallback.username = `ilike.${username}`;
  const contacts = await rest("whatsapp_contacts", fallback);
  return json({ success: true, found: contacts.length > 0, customers: contacts.map((entry) => ({
    name: str(entry.name),
    phone: str(entry.normalized_phone || entry.phone, 30) || null,
    bsuid: str(entry.bsuid, 140) || null,
    username: str(entry.username, 120) || null,
    addresses: [],
  })) });
}

async function payment(url: URL) {
  const transactionId = str(url.searchParams.get("transaction_id"), 160);
  if (transactionId.length < 4 || !/^[A-Za-z0-9._:-]+$/.test(transactionId)) {
    throw new ActionError("An exact QRPay transaction ID is required");
  }
  const unmatched = await rest("unmatched_payment_transactions", {
    select: "transaction_id,amount,paid_at,sender_name,provider",
    transaction_id: `eq.${transactionId}`,
    limit: "1",
  });
  if (unmatched[0]) return json({ success: true, found: true, available: true, payment: unmatched[0] });
  const existing = await rest("payment_transactions", {
    select: "transaction_id,amount,paid_at,sender_name,provider,order_id",
    transaction_id: `eq.${transactionId}`,
    limit: "1",
  });
  return json({ success: true, found: Boolean(existing[0]), available: Boolean(existing[0] && !existing[0].order_id), payment: existing[0] || null });
}

async function prepare(input: JsonObject, strict: boolean) {
  const customerInput = isObject(input.customer) ? input.customer : {};
  const identityInput = isObject(input.whatsapp_identity) ? input.whatsapp_identity : {};
  const rawPhone = str(customerInput.phone || identityInput.phone || input.phone, 40);
  const phone = normalizePhone(rawPhone);
  if (rawPhone && !phone) throw new ActionError("Customer phone must be a valid Malaysia mobile number");
  const rawBsuid = str(customerInput.bsuid || identityInput.bsuid || input.bsuid, 140);
  const bsuid = validBsuid(rawBsuid);
  if (rawBsuid && !bsuid) throw new ActionError("WhatsApp BSUID is invalid");
  const username = str(customerInput.username || identityInput.username || input.username, 120).replace(/^@+/, "");
  const customerName = str(customerInput.name || input.customer_name);
  const dateNeed = str(input.date_need, 20);
  if (dateNeed && !/^\d{4}-\d{2}-\d{2}$/.test(dateNeed)) throw new ActionError("Date need must use YYYY-MM-DD");
  const delivery = deliveryValue(input.delivery || "pickup");
  const flow = paymentFlow(input.payment_flow || input.payment_mode || "prepaid");
  if (flow === "cash_counter" && delivery !== "pickup") throw new ActionError("Cash counter is available only for pickup");
  const paymentMode = flow === "cash_counter" ? "cash_counter" : "prepaid";
  const rows = Array.isArray(input.items) ? input.items : [];
  if (rows.length < 1 || rows.length > 30) throw new ActionError("Provide between 1 and 30 order items");
  if (strict && (!customerName || (!phone && !bsuid) || !dateNeed)) {
    throw new ActionError("Customer name, phone or BSUID, and date needed are required before creating an order");
  }

  const items = await Promise.all(rows.map(async (raw, index) => {
    if (!isObject(raw)) throw new ActionError(`Item ${index + 1} is invalid`);
    const custom = raw.is_custom_item === true;
    const kind = normalizeKind(raw.product || raw.kind || raw.k || raw.product_type || (custom ? "printed" : ""));
    const size = normalizeSize(kind, raw.size || (custom ? PRODUCTS[kind].sizes[0] : ""));
    const process = /^urgent$/i.test(str(raw.process, 30)) ? "Urgent" : "Pre-order";
    const review = /need|yes|true/i.test(str(raw.review, 40)) ? "Need Review" : kind === "printed" ? "Need Review" : "No Review";
    const style = normalizeStyle(kind, raw.style);
    const quantity = Number(raw.quantity ?? raw.qty ?? 1);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 500) throw new ActionError(`Item ${index + 1} quantity must be 1 to 500`);
    const title = custom ? str(raw.title, 160) : PRODUCTS[kind].title;
    if (!title) throw new ActionError(`Custom item ${index + 1} needs a title`);
    const suppliedDeal = raw.seller_deal_price ?? raw.unit_price ?? null;
    if (custom && suppliedDeal === null) throw new ActionError(`Custom item ${index + 1} needs an explicit unit price`);
    const catalogPrice = custom
      ? finiteNumber(suppliedDeal, `Item ${index + 1} unit price`, 100000, 0.01)
      : await price(kind, process, size, style, review);
    const deal = !custom && suppliedDeal !== null ? finiteNumber(suppliedDeal, `Item ${index + 1} seller deal`, 100000, 0.01) : null;
    const wording = str(raw.wording || raw.custom_text, 1200);
    return {
      k: kind,
      kind,
      product_type: kind,
      title,
      process,
      review,
      review_required: review === "Need Review",
      size,
      style,
      qty: quantity,
      price: catalogPrice,
      catalog_price: catalogPrice,
      seller_deal_price: deal,
      price_reason: str(raw.price_reason, 180),
      wording,
      custom_text: wording,
      is_custom_item: custom,
      customization: custom ? { manual_custom_item: true } : {},
      reference_url: str(raw.reference_url, 1200),
    };
  }));

  const adjust = isObject(input.price_adjustments) ? input.price_adjustments : isObject(input.adjustments) ? input.adjustments : {};
  const discountTypeRaw = str(adjust.discount_type || "amount", 20).toLowerCase();
  const discountType = ["percent", "percentage", "%"].includes(discountTypeRaw) ? "percent" : "amount";
  const discountValue = finiteNumber(adjust.discount_value, "Discount", discountType === "percent" ? 100 : 100000);
  const deliveryFee = input.delivery_fee === null || input.delivery_fee === undefined
    ? DELIVERY[delivery].fee
    : finiteNumber(input.delivery_fee, "Delivery fee", 10000);
  if (delivery === "pickup" && deliveryFee !== 0) throw new ActionError("Pickup delivery fee must be RM0");

  const payload: JsonObject = {
    customer: {
      name: customerName,
      phone,
      address_line1: str(customerInput.address_line1 || customerInput.address, 500),
      address_line2: str(customerInput.address_line2, 300),
      city: str(customerInput.city, 120),
      postcode: str(customerInput.postcode, 12),
      state: str(customerInput.state, 100),
    },
    whatsapp_identity: { phone: phone || null, bsuid: bsuid || null, username: username || null, customer_master_id: null, scope: SCOPE },
    items,
    price_adjustments: {
      custom_addon: finiteNumber(adjust.custom_addon ?? adjust.addon, "Add-on"),
      custom_addon_reason: str(adjust.custom_addon_reason || adjust.addon_reason),
      discount_type: discountType,
      discount_value: discountValue,
      discount_reason: str(adjust.discount_reason),
      rounding: finiteNumber(adjust.rounding, "Rounding", 1000, -1000),
      rounding_reason: str(adjust.rounding_reason),
    },
    delivery,
    delivery_fee: deliveryFee,
    date_need: dateNeed || null,
    payment_mode: paymentMode,
    source_type: "admin_manual",
    evidence: { source: "chatgpt-gpt-actions", manual_order: true, actor: ACTOR, whatsapp_identity: { phone: phone || null, bsuid: bsuid || null, username: username || null, scope: SCOPE } },
  };
  const priced = await rpc("icetak_apply_draft_price_overrides_v15", { p_payload: payload });
  const totals = await rpc("icetak_qrpay_draft_totals", { p_payload: priced });
  return { payload: priced as JsonObject, totals: totals as JsonObject, flow, phone, bsuid, username, customerName, dateNeed };
}

async function reviewAction(action: string, token: string, payload: JsonObject) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/qrpay-draft-review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, token, payload }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok === false) throw new ActionError(str(result?.error || "Draft review action failed"), 400);
  return result;
}

async function preview(body: JsonObject) {
  const prepared = await prepare(body, false);
  const supplied = str(body.request_id, 40);
  if (supplied && !/^[a-f0-9-]{36}$/i.test(supplied)) throw new ActionError("Request ID must be a UUID");
  const missingFields = [];
  if (!prepared.customerName) missingFields.push("customer.name");
  if (!prepared.phone && !prepared.bsuid) missingFields.push("customer.phone or customer.bsuid");
  if (!prepared.dateNeed) missingFields.push("date_need");
  return json({
    success: true,
    request_id: supplied || crypto.randomUUID(),
    payment_flow: prepared.flow,
    ready_to_create: missingFields.length === 0,
    missing_fields: missingFields,
    payload: prepared.payload,
    totals: prepared.totals,
    currency: "MYR",
  });
}

async function automaticRequestId(payload: JsonObject, flow: string) {
  // Keep retries for the same normalized order idempotent without requiring GPT
  // to preserve a preview UUID across separate conversational turns.
  const tenMinuteWindow = Math.floor(Date.now() / 600_000);
  const digest = await sha256(JSON.stringify({ version: 1, window: tenMinuteWindow, flow, payload }));
  const compact = `${digest.slice(0, 12)}4${digest.slice(13, 16)}a${digest.slice(17, 32)}`;
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20, 32)}`;
}

async function createOrder(body: JsonObject) {
  if (body.confirmed === false) throw new ActionError("Order creation was explicitly declined", 409);
  const prepared = await prepare(body, true);
  const defaultOperation = prepared.flow === "cash_counter"
    ? "confirm_pickup"
    : prepared.flow === "paid"
    ? "confirm_paid"
    : prepared.flow === "qrpay"
    ? "confirm_qrpay"
    : "save_draft";
  const operation = str(body.operation, 40) || defaultOperation;
  if (!["save_draft", "send_customer", "confirm_pickup", "confirm_paid", "confirm_qrpay"].includes(operation)) {
    throw new ActionError("Invalid order operation");
  }
  if (isObject(prepared.payload.evidence)) prepared.payload.evidence.user_confirmed = true;
  const suppliedRequestId = str(body.request_id, 40);
  if (suppliedRequestId && !/^[a-f0-9-]{36}$/i.test(suppliedRequestId)) {
    throw new ActionError("Request ID must be a UUID when supplied");
  }
  const requestId = suppliedRequestId || await automaticRequestId(prepared.payload, prepared.flow);
  if (operation === "confirm_pickup" && prepared.flow !== "cash_counter") throw new ActionError("Pickup confirmation requires cash_counter payment flow");
  if (operation === "confirm_paid" && prepared.flow !== "paid") throw new ActionError("Paid confirmation requires paid payment flow");
  if (operation === "confirm_qrpay" && prepared.flow !== "qrpay") throw new ActionError("QRPay confirmation requires qrpay payment flow");
  if (operation === "send_customer" && prepared.flow !== "prepaid") throw new ActionError("Customer review is only available for prepaid drafts");
  if (operation === "confirm_paid" && !["bank_transfer", "card", "other", "qr_pay_manual"].includes(str(body.payment_method, 40))) {
    throw new ActionError("A valid payment_method is required");
  }
  if (operation === "confirm_qrpay" && !str(body.transaction_id, 160)) {
    throw new ActionError("QRPay transaction_id is required");
  }

  let masterId = "";
  if (prepared.bsuid) {
    const master = await rpc("icetak_ensure_whatsapp_customer_master", {
      p_bsuid: prepared.bsuid,
      p_username: prepared.username || null,
      p_phone: prepared.phone || null,
      p_display_name: prepared.customerName || null,
      p_scope: SCOPE,
    });
    masterId = str(master?.customer_master_id, 40);
    if (masterId && isObject(prepared.payload.whatsapp_identity)) prepared.payload.whatsapp_identity.customer_master_id = masterId;
  }

  let draft = await rpc("icetak_create_generic_order_draft", {
    p_source_type: "admin_manual",
    p_conversation_id: null,
    p_customer_phone: prepared.phone || null,
    p_customer_name: prepared.customerName,
    p_payload: prepared.payload,
    p_request_key: `gpt-action:${requestId}`,
    p_cutoff_at: new Date().toISOString(),
    p_trigger_message_id: null,
    p_payment_mode: prepared.flow === "cash_counter" ? "cash_counter" : "prepaid",
    p_actor: ACTOR,
  });
  const reviewToken = str(draft?.review_token, 40);
  if (!/^qrd_[a-f0-9]{32}$/i.test(reviewToken)) throw new ActionError("Draft creation did not return a valid review link", 502);
  const reviewLink = `https://shop.decocake.my/qrpay-draft.html?token=${encodeURIComponent(reviewToken)}`;

  if (draft.status === "confirmed" && draft.order_id) {
    return json({ success: true, duplicate: true, state: "order_created", request_id: requestId, draft_id: draft.id, order_db_id: draft.order_id, order_no: draft.order_no, review_link: reviewLink });
  }

  const expectedMode = prepared.flow === "cash_counter" ? "cash_counter" : "prepaid";
  if (str(draft.payment_mode, 30) !== expectedMode) {
    draft = await rpc("icetak_admin_set_draft_flow", {
      p_review_token: reviewToken,
      p_delivery: prepared.payload.delivery,
      p_payment_mode: expectedMode,
      p_actor: ACTOR,
    });
  }
  draft = await rpc("icetak_save_qrpay_order_draft", {
    p_review_token: reviewToken,
    p_payload: prepared.payload,
    p_actor: ACTOR,
  });

  const common = {
    success: true,
    request_id: requestId,
    draft_id: draft.id,
    draft_total: Number(draft.draft_total || 0),
    payment_flow: prepared.flow,
    review_link: reviewLink,
    preview: {
      customer: { name: prepared.customerName, phone: prepared.phone || null, bsuid: prepared.bsuid || null },
      items: prepared.payload.items,
      delivery: prepared.payload.delivery,
      date_need: prepared.dateNeed,
      totals: prepared.totals,
    },
  };
  if (operation === "save_draft") return json({ ...common, state: "draft_created" });
  if (common.draft_total <= 0) throw new ActionError("Order total must be more than RM0");

  if (operation === "send_customer") {
    const sent = await reviewAction("approve_customer", reviewToken, prepared.payload);
    if (sent?.customer?.sent !== true) {
      return json({ ...common, success: false, state: "draft_created", customer_sent: false, error: "Draft exists but customer WhatsApp delivery was not confirmed" }, 502);
    }
    return json({ ...common, state: "review_sent", customer_sent: true, customer_link: sent.customer.link || null });
  }

  let result: JsonObject;
  if (operation === "confirm_pickup") {
    const confirmed = await reviewAction("confirm", reviewToken, prepared.payload);
    result = isObject(confirmed?.result) ? confirmed.result : {};
  } else if (operation === "confirm_paid") {
    const method = str(body.payment_method, 40);
    if (!["bank_transfer", "card", "other", "qr_pay_manual"].includes(method)) throw new ActionError("A valid payment_method is required");
    result = await rpc("icetak_admin_confirm_paid_draft", {
      p_review_token: reviewToken,
      p_payment_method: method,
      p_reference: str(body.payment_reference, 180) || null,
      p_actor: ACTOR,
    });
  } else {
    const transactionId = str(body.transaction_id, 160);
    if (!transactionId) throw new ActionError("QRPay transaction_id is required");
    result = await rpc("icetak_admin_link_payment_to_draft_and_finalize", {
      p_transaction_id: transactionId,
      p_draft_id: draft.id,
      p_actor: ACTOR,
      p_confirm_mismatch: body.confirm_mismatch === true,
    });
    if (result?.success === false) {
      return json({ ...common, success: false, state: "draft_created", requires_confirmation: Boolean(result.requires_confirmation), requires_mismatch_confirmation: Boolean(result.requires_mismatch_confirmation), error: "QRPay transaction requires explicit confirmation" }, 409);
    }
  }

  const nested = isObject(result.order) ? result.order : {};
  const refreshed = await rest("qrpay_order_drafts", {
    select: "order_id,order_no,status",
    id: `eq.${str(draft.id, 40)}`,
    limit: "1",
  });
  const row = refreshed[0] || {};
  const orderDbId = str(result.order_db_id || nested.order_db_id || row.order_id, 40);
  const orderNo = str(result.order_no || nested.order_no || nested.order_id || row.order_no || result.order_id, 100);
  if (!orderNo) throw new ActionError("Draft was processed but no production order number was returned", 502);
  return json({ ...common, state: "order_created", order_no: orderNo, order_id: orderNo, order_db_id: orderDbId || null });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ success: false, error: "Runtime is not configured" }, 500);

  try {
    if (!await isAuthorized(req)) return json({ success: false, error: "Valid iCetak GPT token required" }, 401);
    const url = new URL(req.url);
    const route = url.pathname.replace(/\/+$/, "").split("/").pop() || "";

    if (req.method === "GET" && route === "catalog") return await catalog(url);
    if (req.method === "GET" && route === "customers") return await customer(url);
    if (req.method === "GET" && route === "payments") return await payment(url);
    if (req.method === "POST" && ["preview", "orders"].includes(route)) {
      const contentType = str(req.headers.get("content-type"), 120).toLowerCase();
      if (!contentType.includes("application/json")) throw new ActionError("Content-Type must be application/json", 415);
      const body = await req.json().catch(() => null);
      if (!isObject(body)) throw new ActionError("A JSON object body is required");
      return route === "preview" ? await preview(body) : await createOrder(body);
    }
    return json({ success: false, error: "Unknown GPT order action" }, 404);
  } catch (error) {
    const status = error instanceof ActionError ? error.status : 500;
    const message = error instanceof Error ? str(error.message, 260) : "Order action failed";
    return json({ success: false, error: message }, status);
  }
});
