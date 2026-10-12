type JsonMap = Record<string, any>;

export type LearningExample = {
  field_path?: string;
  ai_value?: unknown;
  human_value?: unknown;
};

export type LearningRule = {
  id: string;
  strategy_key: string;
  title: string;
  lesson: string;
  status?: string;
  occurrence_count?: number;
  examples?: LearningExample[];
};

type LearningOptions = {
  flow: string;
  referenceTime?: string;
  promptInjected?: boolean;
  customerIdentity?: { name?: string; phone?: string; bsuid?: string };
};

type ChatLine = {
  direction: string;
  text: string;
  id: string;
  mediaUrl: string;
  index: number;
  offerOnly: boolean;
};

export type SellerSnippet = {
  id?: string;
  shortcut?: string;
  title?: string;
  message?: string;
};

export type FilteredOrderMessages = {
  messages: JsonMap[];
  excluded: Array<{ id: string; reason: string }>;
};

type Change = {
  field: string;
  before: unknown;
  after: unknown;
  reason: string;
  message_id?: string;
};

const PRODUCT_CONFIG: Record<string, { title: string; defaultSize: string; defaultStyle: string }> = {
  edible: { title: "Edible Image", defaultSize: "3 inch", defaultStyle: "Round / Bulat" },
  burnaway: { title: "Burn Away Combo", defaultSize: "5 inch", defaultStyle: "Round / Bulat" },
  wafer: { title: "Wafer Paper Only", defaultSize: "3 inch", defaultStyle: "Round / Bulat" },
  printed: { title: "Cake Topper", defaultSize: "1 pc", defaultStyle: "Happy Birthday" },
  mirror: { title: "Mirror Gold Artpaper", defaultSize: "A7 Mini", defaultStyle: "Gold" },
  acrylic: { title: "Acrylic Cake Topper", defaultSize: "A7 Mini", defaultStyle: "Gold" },
};

const PRODUCT_MATCHERS: Array<[string, RegExp]> = [
  ["burnaway", /\bburn\s*away\b|\bburnaway\b/i],
  ["mirror", /\bmirror\s+gold\b|\bartpaper\b/i],
  ["acrylic", /\bacrylic\b|\bakrilik\b|\bayrlic\b|\barylic\b|\barcylic\b/i],
  ["edible", /\bedible\b|\bicing\s+sheet\b|\bprint\s+gambar\b|\bei\b/i],
  ["wafer", /\bwafer\b/i],
  ["printed", /\btopper\b|\bglossy\b/i],
];

const DELIVERY_FEES: Record<string, number> = {
  pickup: 0,
  spx: 4.5,
  jnt: 5.9,
  ninja: 6.9,
};

const text = (value: unknown) => String(value ?? "").trim();
const amount = (value: unknown) => Number(Number(value || 0).toFixed(2));
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function normalizedSnippet(value: unknown) {
  return text(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " url ")
    .replace(/[^\p{L}\p{N}\s.&]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sellerMessageFilterReason(message: JsonMap, snippets: SellerSnippet[] = []): string {
  if (text(message?.direction).toLowerCase() !== "outbound") return "";

  const value = text(message.text_content || message.caption || message.text);
  if (!value) return "";
  const normalized = normalizedSnippet(value);

  for (const snippet of snippets || []) {
    const known = normalizedSnippet(snippet?.message);
    if (known.length < 18) continue;
    if (normalized === known) return "saved_seller_snippet";
    const shorter = Math.min(normalized.length, known.length);
    const longer = Math.max(normalized.length, known.length);
    if (shorter >= 55 && shorter / longer >= 0.86 && (normalized.includes(known) || known.includes(normalized))) {
      return "saved_seller_snippet";
    }
  }

  const courierCount = [
    /\b(?:spx|shopee\s*express)\b/i,
    /\b(?:j\s*&?\s*t|jnt)\b/i,
    /\bninja(?:\s*van)?\b/i,
  ].filter((matcher) => matcher.test(value)).length;
  if (courierCount >= 2) return "seller_courier_menu";

  const prices = [...value.matchAll(/\brm\s*\d+(?:\.\d{1,2})?/gi)].length;
  const sizes = [...new Set((value.match(/\bA[4-7]\b/gi) || []).map((size) => size.toUpperCase()))].length;
  if (/\b(?:price\s*list|senarai\s*harga|harga\s*panduan|rujukan\s+saiz)\b/i.test(value)) {
    return "seller_price_list";
  }
  if (/^\s*harga\s+(?:acrylic|akrilik|edible|wafer|cake\s+topper)\b/im.test(value) && prices >= 2) {
    return "seller_price_list";
  }
  if (prices >= 3 && (sizes >= 2 || /\b(?:pre[- ]?order|urgent|same\s+day|pilihan|options?)\b/i.test(value))) {
    return "seller_price_list";
  }
  if (/\b(?:cara\s+guna|how\s+to\s+use|panduan\s+penyimpanan|pickup\s+location|waktu\s+operasi|menerima\s+order|save\s+for\s+order)\b/i.test(value) && value.length >= 55) {
    return "seller_information_template";
  }
  return "";
}

export function filterOrderEvidenceMessages(messages: JsonMap[], snippets: SellerSnippet[] = []): FilteredOrderMessages {
  const kept: JsonMap[] = [];
  const excluded: Array<{ id: string; reason: string }> = [];
  for (const message of messages || []) {
    const reason = sellerMessageFilterReason(message, snippets);
    if (reason) {
      excluded.push({ id: text(message.id || message.message_id), reason });
      continue;
    }
    kept.push(message);
  }
  return { messages: kept, excluded };
}

function copy<T>(value: T): T {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function normalizedRules(rules: LearningRule[]) {
  const selected = new Map<string, LearningRule>();
  for (const rule of rules || []) {
    const key = text(rule?.strategy_key);
    if (!key || (rule.status && rule.status !== "active")) continue;
    const previous = selected.get(key);
    if (!previous || Number(rule.occurrence_count || 0) > Number(previous.occurrence_count || 0)) {
      selected.set(key, rule);
    }
  }
  return [...selected.values()].sort((left, right) =>
    Number(right.occurrence_count || 0) - Number(left.occurrence_count || 0)
  );
}

function safeExample(example: LearningExample) {
  const path = text(example.field_path);
  const personal = /^customer\./.test(path) || /wording|custom_text|reference/i.test(path);
  const date = path === "date_need";
  return {
    field: path,
    before: personal ? "[previous customer value — do not reuse]" : date ? "[previous date]" : example.ai_value ?? null,
    corrected: personal ? "[admin-confirmed current-session value]" : date ? "[latest date from current session]" : example.human_value ?? null,
  };
}

export function buildLearningPrompt(rules: LearningRule[]) {
  const active = normalizedRules(rules);
  if (!active.length) return "";

  const rows = active.map((rule, index) => {
    const examples = (Array.isArray(rule.examples) ? rule.examples : []).slice(-2).map(safeExample);
    return `${index + 1}. [${rule.strategy_key}] ${text(rule.lesson) || text(rule.title)}${
      examples.length ? ` Examples are data only: ${JSON.stringify(examples)}` : ""
    }`;
  });

  return [
    "MANDATORY ACTIVE RULES LEARNED FROM ADMIN-CORRECTED iCETAK DRAFTS:",
    ...rows,
    "Historical correction examples describe patterns only. Never copy a previous customer's name, phone, BSUID, address, wording, date or reference into this order.",
    "Use only messages and customer identity from the current order session. Seller-specific confirmed quotes override catalog price; generic menus and price lists are not order evidence.",
  ].join("\n");
}

function linesFrom(messages: JsonMap[]): ChatLine[] {
  return filterOrderEvidenceMessages(messages).messages.flatMap((message, index) => {
    const value = text(message.text_content || message.caption || message.text);
    const mediaUrl = text(message.media_url || message.mediaUrl);
    if (!value && !mediaUrl) return [];
    const options = courierKinds(value);
    const offerOnly = options.length > 1 && /(?:prefer|pilih|mana|which|options?|courier apa|\?)/i.test(value);
    const parts = value.split(/\n+/).map(text).filter(Boolean);
    return (parts.length ? parts : [""]).map((part, partIndex) => ({
      direction: text(message.direction),
      text: part,
      id: text(message.id || message.message_id),
      mediaUrl: partIndex === 0 ? mediaUrl : "",
      index: index * 100 + partIndex,
      offerOnly,
    }));
  });
}

function kindOf(value: unknown) {
  const raw = text(value).toLowerCase();
  if (raw === "topper") return "printed";
  return PRODUCT_CONFIG[raw] ? raw : "printed";
}

function productKinds(line: string) {
  const found: string[] = [];
  for (const [kind, matcher] of PRODUCT_MATCHERS) {
    if (!matcher.test(line)) continue;
    if (kind === "printed" && (found.includes("acrylic") || found.includes("mirror"))) continue;
    if (kind === "edible" && found.includes("burnaway")) continue;
    if (kind === "wafer" && found.includes("burnaway")) continue;
    found.push(kind);
  }
  return found;
}

function isMenu(line: string) {
  return /\b(?:price\s*list|senarai\s*harga|harga\s*panduan|menerima\s+order|rujukan\s+saiz|save\s+for\s+order)\b/i.test(line)
    || (line.length > 340 && productKinds(line).length >= 3);
}

function sellerPrice(line: string) {
  const multiplied = line.match(/(?:rm\s*)?(\d+(?:\.\d{1,2})?)\s*[x×]\s*(\d{1,2})\s*(?:pcs?|keping|set|unit)?/i);
  if (multiplied) {
    return { price: amount(multiplied[1]), qty: Number(multiplied[2]) };
  }
  const explicit = [...line.matchAll(/\brm\s*(\d+(?:\.\d{1,2})?)/gi)].at(-1);
  return explicit ? { price: amount(explicit[1]), qty: 0 } : null;
}

function quoteMap(lines: ChatLine[], existingKinds: string[]) {
  const found = new Map<string, { price: number; qty: number; message_id: string; index: number }>();
  for (const message of lines) {
    if (message.direction !== "outbound" || isMenu(message.text)) continue;
    for (const raw of message.text.split(/\n+/)) {
      const line = text(raw);
      if (!line || /^\s*(?:total|jumlah)\b/i.test(line)) continue;
      if (/\b(?:spx|j\s*&?\s*t|jnt|ninja(?:van)?|courier|shipping|postage|delivery|pos)\b/i.test(line)) continue;
      const quote = sellerPrice(line);
      if (!quote || quote.price <= 0 || quote.price > 500) continue;
      let kinds = productKinds(line);
      if (!kinds.length && existingKinds.length === 1) kinds = existingKinds;
      if (kinds.length !== 1) continue;
      found.set(kinds[0], { ...quote, message_id: message.id, index: message.index });
    }
  }
  return found;
}

function strongProducts(lines: ChatLine[], quotes: Map<string, unknown>) {
  const inbound = new Set<string>();
  const outbound = new Set<string>();
  for (const line of lines) {
    if (!line.text || isMenu(line.text)) continue;
    const kinds = productKinds(line.text);
    if (kinds.length > 2 && !/(?:nak|mahu|order|tempah|ambil|rm\s*\d)/i.test(line.text)) continue;
    for (const kind of kinds) (line.direction === "inbound" ? inbound : outbound).add(kind);
  }
  const result = new Set<string>();
  for (const kind of inbound) if (outbound.has(kind) || quotes.has(kind)) result.add(kind);
  for (const kind of quotes.keys()) result.add(kind);
  return [...result];
}

function normalSize(kind: string, value: unknown) {
  const raw = text(value);
  if (kind === "printed") return "1 pc";
  if (kind === "acrylic" || kind === "mirror") {
    const paper = raw.match(/\b(A[567])\b/i)?.[1]?.toUpperCase();
    return paper === "A5" ? "A5 Large" : paper === "A6" ? "A6 Standard" : paper === "A7" ? "A7 Mini" : raw || "A7 Mini";
  }
  if (/^A[456]$/i.test(raw)) return raw.toUpperCase();
  const size = raw.match(/(\d+(?:\.\d+)?)\s*(?:inch|inches|inci|in|\")/i);
  return size ? `${Number(size[1])} inch` : raw || PRODUCT_CONFIG[kind]?.defaultSize || "";
}

function nearbySize(kind: string, lines: ChatLine[], current: string, multiple: boolean) {
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index];
    if (!line.text || isMenu(line.text)) continue;
    const mentioned = productKinds(line.text);
    if (mentioned.length && !mentioned.includes(kind)) continue;
    if (!mentioned.length && multiple) continue;
    const match = line.text.match(/\b(A[4-7])\b/i)
      || line.text.match(/(\d+(?:\.\d+)?)\s*(?:inch|inches|inci|in|\")/i);
    if (match) return { size: normalSize(kind, match[0]), message_id: line.id };
  }
  return { size: normalSize(kind, current), message_id: "" };
}

function nearbyStyle(kind: string, lines: ChatLine[], current: string, multiple: boolean) {
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index];
    if (isMenu(line.text)) continue;
    const mentioned = productKinds(line.text);
    if ((mentioned.length && !mentioned.includes(kind)) || (!mentioned.length && multiple)) continue;
    if (/(?:rose\s*gold)/i.test(line.text)) return { style: "Rose Gold", message_id: line.id };
    if (/\b(?:gold|emas)\b/i.test(line.text)) return { style: "Gold", message_id: line.id };
    if (/\b(?:silver|perak)\b/i.test(line.text)) return { style: "Silver", message_id: line.id };
    if (/\b(?:black|hitam)\b/i.test(line.text)) return { style: "Black", message_id: line.id };
    if (/\b(?:petak|square)\b/i.test(line.text)) return { style: "Square / Petak", message_id: line.id };
    if (/\b(?:bulat|round)\b/i.test(line.text)) return { style: "Round / Bulat", message_id: line.id };
  }
  return { style: text(current) || PRODUCT_CONFIG[kind]?.defaultStyle || "", message_id: "" };
}

function itemQuantity(kind: string, lines: ChatLine[], quoteQty: number, multiple: boolean) {
  if (quoteQty > 0) return { qty: quoteQty, message_id: "" };
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index];
    if (isMenu(line.text)) continue;
    const mentioned = productKinds(line.text);
    if ((mentioned.length && !mentioned.includes(kind)) || (!mentioned.length && multiple)) continue;
    const match = line.text.match(/\b(\d{1,2})\s*(?:pcs?|pc|keping|set|unit|design)\b/i);
    if (match) return { qty: Math.max(1, Number(match[1])), message_id: line.id };
  }
  return { qty: 0, message_id: "" };
}

function latestWording(lines: ChatLine[]) {
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index];
    if (line.direction !== "inbound") continue;
    const match = line.text.match(/(?:wording|tulisan|custom\s*name|nama|name|huruf)\s*[:=-]\s*([^\n]{2,120})/i);
    if (match && !/(?:payment|alamat|address|total|postcode|poskod)/i.test(match[1])) {
      return { wording: text(match[1]), message_id: line.id };
    }
  }
  return { wording: "", message_id: "" };
}

function courierKinds(line: string) {
  const values: string[] = [];
  if (/\bspx\b/i.test(line)) values.push("spx");
  if (/\bj\s*&?\s*t\b|\bjnt\b/i.test(line)) values.push("jnt");
  if (/\bninja(?:\s*van)?\b/i.test(line)) values.push("ninja");
  if (/\b(?:pickup|self\s*collect|ambil|ambik)\b/i.test(line)) values.push("pickup");
  return values;
}

function deliveryDecision(lines: ChatLine[], fallbackPickup: boolean) {
  for (const direction of ["inbound", "outbound"]) {
    for (let index = lines.length - 1; index >= 0; index--) {
      const message = lines[index];
      if (message.direction !== direction || isMenu(message.text)) continue;
      if (direction === "outbound" && message.offerOnly) continue;
      const choices = courierKinds(message.text);
      if (choices.length !== 1) continue;
      if (direction === "outbound" && /(?:prefer|pilih|mana|which|options?|courier apa|\?)/i.test(message.text)) continue;
      const method = choices[0];
      let fee = DELIVERY_FEES[method] || 0;
      if (method !== "pickup") {
        for (let quoteIndex = lines.length - 1; quoteIndex >= 0; quoteIndex--) {
          const quote = lines[quoteIndex];
          if (quote.direction !== "outbound" || !courierKinds(quote.text).includes(method)) continue;
          const choicesInQuote = courierKinds(quote.text);
          const matchingLine = quote.text.split(/\n+/).find((part) => courierKinds(part).includes(method));
          const candidate = matchingLine || (choicesInQuote.length === 1 ? quote.text : "");
          const explicit = candidate.match(/\brm\s*(\d+(?:\.\d{1,2})?)/i);
          if (explicit) fee = amount(explicit[1]);
          break;
        }
      }
      return { method, fee, message_id: message.id };
    }
  }
  return fallbackPickup ? { method: "pickup", fee: 0, message_id: "" } : null;
}

function latestDate(lines: ChatLine[], referenceTime?: string) {
  const stamp = Date.parse(referenceTime || "") || Date.now();
  const reference = new Date(stamp + 8 * 60 * 60 * 1000);
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index];
    if (line.direction !== "inbound") continue;
    const iso = [...line.text.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)].at(-1);
    if (iso) return { value: `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`, message_id: line.id };
    const numeric = [...line.text.matchAll(/\b(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?\b/g)].at(-1);
    if (numeric) {
      let year = numeric[3] ? Number(numeric[3]) : reference.getUTCFullYear();
      if (year < 100) year += 2000;
      return { value: `${year}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`, message_id: line.id };
    }
    const day = [...line.text.matchAll(/\b(\d{1,2})\s*(?:hb|haribulan)\b/gi)].at(-1);
    if (day) {
      let month = reference.getUTCMonth() + 1;
      let year = reference.getUTCFullYear();
      if (Number(day[1]) < reference.getUTCDate() - 3) month++;
      if (month > 12) { month = 1; year++; }
      return { value: `${year}-${String(month).padStart(2, "0")}-${day[1].padStart(2, "0")}`, message_id: line.id };
    }
    if (/\b(?:esok|tomorrow)\b/i.test(line.text)) {
      const date = new Date(reference);
      date.setUTCDate(date.getUTCDate() + 1);
      return { value: date.toISOString().slice(0, 10), message_id: line.id };
    }
    if (/\b(?:hari\s*ni|hari\s*ini|today)\b/i.test(line.text)) {
      return { value: reference.toISOString().slice(0, 10), message_id: line.id };
    }
  }
  return null;
}

export function quickOrderPrice(kind: string, process: string, size: string, style = "", review = "No Review") {
  if (kind === "printed") return 10;
  if (kind === "mirror") return process === "Urgent" ? 18 : 15;
  if (kind === "acrylic") {
    if (process === "Urgent") return size === "A7 Mini" ? 15 : size === "A6 Standard" ? 25 : 40;
    return size === "A7 Mini" ? 12 : size === "A6 Standard" ? 20 : 35;
  }
  if (kind === "burnaway") {
    if (size.includes("A4")) return 36;
    if (size.includes("A5")) return 18;
    const inches = Number.parseFloat(size) || 0;
    return inches >= 6 ? 30 : inches >= 5 ? 18 : 12;
  }
  if (kind === "wafer") {
    const base = (Number.parseFloat(size) || 0) <= 6 ? 6 : 12;
    return base + (process === "Urgent" && review === "Need Review" ? 2 : 0);
  }
  let base: number;
  if (size === "A4" || size === "Cupcake") base = 24;
  else if (size === "A5") base = 12;
  else if (size === "A6") base = 6;
  else {
    const inches = Number.parseFloat(size) || 0;
    base = style === "Square / Petak" && size === "4 inch" ? 12 : inches >= 6 ? 24 : inches >= 4.5 ? 12 : 6;
  }
  if (process === "Urgent" && review === "Need Review") return base === 6 ? 7 : base === 12 ? 14 : base === 24 ? 28 : base;
  return base;
}

export function applyLearningRules(draft: JsonMap, messages: JsonMap[], rules: LearningRule[], options: LearningOptions) {
  const active = normalizedRules(rules);
  const result = copy(draft || {});
  const lines = linesFrom(messages);
  const strategies = new Map(active.map((rule) => [rule.strategy_key, rule]));
  const applied = new Map<string, Change[]>();

  const change = (strategy: string, target: JsonMap, key: string, value: unknown, field: string, reason: string, messageId = "") => {
    if (!strategies.has(strategy) || value === undefined || same(target[key], value)) return false;
    const row: Change = { field, before: target[key] ?? null, after: value ?? null, reason };
    if (messageId) row.message_id = messageId;
    (applied.get(strategy) || (applied.set(strategy, []), applied.get(strategy)!)).push(row);
    target[key] = value;
    return true;
  };

  result.customer = result.customer && typeof result.customer === "object" ? result.customer : {};
  result.items = Array.isArray(result.items) && result.items.length ? result.items : [];
  const existingKinds = [...new Set(result.items.map((item: JsonMap) => kindOf(item.k || item.product_type)))];
  const quotes = quoteMap(lines, existingKinds);

  if (strategies.has("customer_identity_from_strong_payment_context")) {
    const customer = options.customerIdentity || {};
    if (customer.phone) change("customer_identity_from_strong_payment_context", result.customer, "phone", text(customer.phone), "customer.phone", "current WhatsApp conversation identity");
    if (customer.name && (!text(result.customer.name) || /^(?:whatsapp customer|customer)$/i.test(text(result.customer.name)))) {
      change("customer_identity_from_strong_payment_context", result.customer, "name", text(customer.name), "customer.name", "current WhatsApp conversation name");
    }
  }

  if (strategies.has("preserve_distinct_products")) {
    const confirmed = strongProducts(lines, quotes);
    for (const kind of confirmed) {
      if (result.items.some((item: JsonMap) => kindOf(item.k || item.product_type) === kind)) continue;
      const config = PRODUCT_CONFIG[kind];
      const next = {
        k: kind,
        product_type: kind,
        title: config.title,
        qty: 1,
        price: 0,
        size: config.defaultSize,
        style: config.defaultStyle,
        wording: "",
        custom_text: "",
        process: "Pre-order",
        review: kind === "printed" ? "Need Review" : "No Review",
        review_required: kind === "printed",
        customization: { source: options.flow, set_hint: result.items.length + 1 },
      };
      (applied.get("preserve_distinct_products") || (applied.set("preserve_distinct_products", []), applied.get("preserve_distinct_products")!)).push({
        field: `items.${result.items.length}`,
        before: null,
        after: { k: kind, title: config.title },
        reason: "separate product confirmed in the current customer/seller messages",
      });
      result.items.push(next);
    }
  }

  const multiple = result.items.length > 1;
  const wording = latestWording(lines);
  for (let index = 0; index < result.items.length; index++) {
    const item = result.items[index];
    const kind = kindOf(item.k || item.product_type);
    item.k = kind;
    item.product_type = kind;
    const prefix = `items.${index}`;
    const quote = quotes.get(kind);

    if (strategies.has("variation_from_nearest_item_context")) {
      const size = nearbySize(kind, lines, text(item.size), multiple);
      if (size.size) change("variation_from_nearest_item_context", item, "size", size.size, `${prefix}.size`, "nearest product-specific size normalized to Quick Order", size.message_id);
      const style = nearbyStyle(kind, lines, text(item.style), multiple);
      if (style.style) change("variation_from_nearest_item_context", item, "style", style.style, `${prefix}.style`, "nearest product-specific style", style.message_id);
    }

    if (strategies.has("qty_from_nearest_explicit_item_count")) {
      const quantity = itemQuantity(kind, lines, Number(quote?.qty || 0), multiple);
      if (quantity.qty) change("qty_from_nearest_explicit_item_count", item, "qty", quantity.qty, `${prefix}.qty`, "latest quantity tied to this product", quantity.message_id || quote?.message_id || "");
    }

    if (wording.wording && strategies.has("wording_from_explicit_label")) {
      change("wording_from_explicit_label", item, "wording", wording.wording, `${prefix}.wording`, "explicit wording/name supplied by this customer", wording.message_id);
      if (text(item.custom_text) !== wording.wording) item.custom_text = wording.wording;
      if (item.customText !== undefined && text(item.customText) !== wording.wording) item.customText = wording.wording;
    }

    const process = /urgent/i.test(text(item.process)) ? "Urgent" : "Pre-order";
    const review = text(item.review) || (item.review_required ? "Need Review" : "No Review");
    const size = normalSize(kind, item.size);
    const style = text(item.style) || PRODUCT_CONFIG[kind]?.defaultStyle || "";
    const catalog = quickOrderPrice(kind, process, size, style, review);
    if (strategies.has("price_from_quick_order_variation")) {
      change("price_from_quick_order_variation", item, "catalog_price", catalog, `${prefix}.catalog_price`, "official Quick Order product/size/process price");
      if (!quote) change("price_from_quick_order_variation", item, "price", catalog, `${prefix}.price`, "no explicit seller deal; use official Quick Order price");
    }
    const quoteStrategy = strategies.has("price_from_latest_explicit_seller_quote")
      ? "price_from_latest_explicit_seller_quote"
      : strategies.has("price_from_quick_order_variation") ? "price_from_quick_order_variation" : "";
    if (quote && quoteStrategy) {
      change(quoteStrategy, item, "price", quote.price, `${prefix}.price`, "latest explicit seller quote for this product", quote.message_id);
      if (strategies.has("price_from_quick_order_variation") && quote.price !== catalog) {
        change("price_from_quick_order_variation", item, "seller_deal_price", quote.price, `${prefix}.seller_deal_price`, "seller-specific deal overrides catalog without changing catalog price", quote.message_id);
      }
    }

    if (strategies.has("reference_from_latest_media")) {
      const media = [...lines].reverse().find((line) => line.mediaUrl);
      if (media && !text(item.referenceUrl || item.reference_url)) {
        change("reference_from_latest_media", item, "referenceUrl", media.mediaUrl, `${prefix}.referenceUrl`, "latest current-session reference media", media.id);
      }
    }
  }

  const shippingStrategy = strategies.has("shipping_from_latest_explicit_quote")
    ? "shipping_from_latest_explicit_quote"
    : strategies.has("shipping_from_quick_order_delivery") ? "shipping_from_quick_order_delivery" : "";
  if (shippingStrategy) {
    const decision = deliveryDecision(lines, options.flow === "pickup_trigger");
    if (decision) {
      change(shippingStrategy, result, "delivery", decision.method, "delivery", "latest current-session courier/pickup decision", decision.message_id);
      const feeStrategy = strategies.has("shipping_from_quick_order_delivery") ? "shipping_from_quick_order_delivery" : shippingStrategy;
      change(feeStrategy, result, "delivery_fee", decision.fee, "delivery_fee", "official courier fee or explicit seller shipping quote", decision.message_id);
    }
  }

  if (strategies.has("date_from_latest_customer_need")) {
    const date = latestDate(lines, options.referenceTime);
    if (date) change("date_from_latest_customer_need", result, "date_need", date.value, "date_need", "latest explicit customer event/pickup date", date.message_id);
  }

  const records = active.map((rule) => ({
    id: rule.id,
    strategy_key: rule.strategy_key,
    title: rule.title,
    occurrence_count: Number(rule.occurrence_count || 0),
    application_method: options.promptInjected ? "prompt_and_rule_engine" : "rule_engine",
    changes: applied.get(rule.strategy_key) || [],
  }));
  const changes = records.flatMap((rule) => rule.changes.map((entry) => ({ ...entry, strategy_key: rule.strategy_key })));
  result.evidence = {
    ...(result.evidence || {}),
    active_learning_rules: records.map(({ changes: _changes, ...rule }) => rule),
    learning: {
      version: "effective-admin-feedback-v1",
      flow: options.flow,
      mode: options.promptInjected ? "prompt_and_rule_engine" : "rule_engine",
      prompt_injected: Boolean(options.promptInjected),
      active_rule_count: active.length,
      applied_change_count: changes.length,
      rules: records,
      changes,
    },
  };
  return result;
}
