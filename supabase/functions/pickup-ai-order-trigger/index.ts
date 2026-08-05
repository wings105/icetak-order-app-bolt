// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient(
  Deno.env.get('SUPABASE_URL') || '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  { auth: { persistSession: false } },
);

const BRIDGE = 'https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/qrpay-ai-order-bridge';
const headers = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization,x-pickup-ai-key',
  'cache-control': 'no-store',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
const text = (value: unknown) => value == null ? '' : String(value).trim();
const messageText = (message: any) => text(message.text_content || message.caption);
const messageTime = (message: any) => Date.parse(message.sent_at || message.created_at || '') || 0;
const money = (value: unknown) => Number(Number(value || 0).toFixed(2));

function normalizePhone(value: unknown) {
  let digits = text(value).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) digits = `60${digits.slice(1)}`;
  else if (digits.startsWith('1')) digits = `60${digits}`;
  else if (!digits.startsWith('60')) digits = `60${digits}`;
  return digits;
}

const whatsappLink = (value: unknown) => {
  const phone = normalizePhone(value);
  return phone ? `https://wa.me/${phone}` : '';
};

function fileName(message: any) {
  return text(
    message.raw_payload?.data?.raw?.message?.document?.filename
      || message.media_metadata?.file_name
      || message.media_metadata?.filename,
  );
}

const isAutomatedGreeting = (value: string) =>
  /Terima kasih hubungi DecoCake|save for order:|Menerima order:|linktr\.ee\/decocake/i.test(value);
const isMedia = (message: any) =>
  ['image', 'document'].includes(text(message.message_type).toLowerCase());

const messageColumns = [
  'id', 'conversation_id', 'direction', 'message_type', 'text_content', 'caption',
  'sent_at', 'created_at', 'sender_phone', 'provider_message_id', 'media_url',
  'media_metadata', 'raw_payload',
].join(',');

async function setting(key: string) {
  const { data, error } = await db
    .from('private_runtime_settings')
    .select('setting_value')
    .eq('setting_key', key)
    .maybeSingle();
  if (error) throw error;
  return text(data?.setting_value);
}

async function authorized(req: Request) {
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const supplied = req.headers.get('x-pickup-ai-key') || bearer;
  return Boolean(supplied) && supplied === await setting('pickup_ai_public_token');
}

async function callBridge(requestKey: string, payload: Record<string, unknown>) {
  const token = await setting('qrpay_ai_worker_token');
  if (!token) throw new Error('Internal pickup bridge token is not configured');

  const response = await fetch(BRIDGE, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-qrpay-ai-token': token,
    },
    body: JSON.stringify({
      action: 'create_pickup_order',
      request_key: requestKey,
      payload,
    }),
  });

  const result = await response.json().catch(() => ({ error: 'Invalid bridge response' }));
  if (!response.ok || result.ok === false) {
    throw new Error(result.error || `Bridge HTTP ${response.status}`);
  }
  return result.result;
}

async function resolveConversation(body: Record<string, any>) {
  let conversation: any = null;
  let phone = normalizePhone(body.phone);

  if (text(body.conversation_id)) {
    const { data, error } = await db
      .from('conversations')
      .select('id,customer_id')
      .eq('id', text(body.conversation_id))
      .eq('channel', 'whatsapp')
      .maybeSingle();
    if (error) throw error;
    conversation = data;
  }

  if (!conversation && phone) {
    const { data: identities, error } = await db
      .from('customer_identities')
      .select('customer_id')
      .eq('channel', 'whatsapp')
      .or(`normalized_phone.eq.${phone},external_id.eq.${phone},external_id.eq.+${phone}`);
    if (error) throw error;

    const customerIds = [...new Set((identities || []).map((row: any) => row.customer_id).filter(Boolean))];
    if (customerIds.length) {
      const { data, error: conversationError } = await db
        .from('conversations')
        .select('id,customer_id')
        .eq('channel', 'whatsapp')
        .in('customer_id', customerIds)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (conversationError) throw conversationError;
      conversation = data;
    }
  }

  if (!conversation && phone) {
    const localPhone = `0${phone.slice(2)}`;
    const { data, error } = await db
      .from('messages')
      .select('conversation_id')
      .eq('channel', 'whatsapp')
      .in('sender_phone', [phone, `+${phone}`, localPhone])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    if (data?.conversation_id) {
      const { data: found, error: conversationError } = await db
        .from('conversations')
        .select('id,customer_id')
        .eq('id', data.conversation_id)
        .maybeSingle();
      if (conversationError) throw conversationError;
      conversation = found;
    }
  }

  if (!conversation) throw new Error('WhatsApp conversation not found');

  let name = 'WhatsApp Customer';
  if (conversation.customer_id) {
    const [customerResult, identityResult] = await Promise.all([
      db.from('customers').select('display_name').eq('id', conversation.customer_id).maybeSingle(),
      db.from('customer_identities')
        .select('normalized_phone,external_id')
        .eq('customer_id', conversation.customer_id)
        .eq('channel', 'whatsapp'),
    ]);
    if (customerResult.error) throw customerResult.error;
    if (identityResult.error) throw identityResult.error;

    name = text(customerResult.data?.display_name) || name;
    phone = normalizePhone(
      identityResult.data?.find((row: any) => row.normalized_phone)?.normalized_phone
        || identityResult.data?.[0]?.external_id
        || phone,
    );
  }

  return { id: conversation.id, name, phone };
}

async function loadMessages(conversationId: string, body: Record<string, any>) {
  const lookbackHours = Math.max(6, Math.min(168, Number(body.lookback_hours || 72)));
  const since = new Date(Date.now() - lookbackHours * 3_600_000).toISOString();

  let query = db
    .from('messages')
    .select(messageColumns)
    .eq('conversation_id', conversationId)
    .gte('created_at', since)
    .order('created_at')
    .limit(240);

  if (text(body.cutoff_at)) {
    query = query.lte('created_at', new Date(text(body.cutoff_at)).toISOString());
  }

  const { data, error } = await query;
  if (error) throw error;

  let rows = (data || []).sort((a: any, b: any) => messageTime(a) - messageTime(b));
  if (text(body.until_message_id)) {
    const position = rows.findIndex((row: any) => row.id === text(body.until_message_id));
    if (position < 0) throw new Error('until_message_id not found');
    rows = rows.slice(0, position + 1);
  }
  if (!rows.length) throw new Error('No messages found');

  let start = Math.max(0, rows.length - 80);
  for (let index = rows.length - 1; index > start; index -= 1) {
    if (messageTime(rows[index]) - messageTime(rows[index - 1]) > 3 * 3_600_000
      && rows.length - index >= 2) {
      start = index;
      break;
    }
  }
  return rows.slice(start);
}

function extractDateNeeded(messages: any[], body: Record<string, any>) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(text(body.date_need))) return text(body.date_need);

  const inbound = messages.filter((row) => row.direction === 'inbound').map(messageText).filter(Boolean);
  const referenceTime = messageTime(messages.at(-1)) || Date.now();

  for (let index = inbound.length - 1; index >= 0; index -= 1) {
    const value = inbound[index];
    if (/\brm\s*\d/i.test(value)) continue;
    const match = value.match(/\b(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?\b/);
    if (!match) continue;
    if (!match[3] && !/(pickup|ambil|ambik|guna|need|tarikh|hari|isnin|selasa|rabu|khamis|jumaat|sabtu|ahad)/i.test(value)) {
      continue;
    }
    let year = match[3] ? Number(match[3]) : new Date(referenceTime).getFullYear();
    if (year < 100) year += 2000;
    return `${year}-${String(match[2]).padStart(2, '0')}-${String(match[1]).padStart(2, '0')}`;
  }

  const allInbound = inbound.join('\n');
  const local = new Date(referenceTime + 8 * 3_600_000);
  const date = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  if (/esok|tomorrow/i.test(allInbound)) {
    date.setUTCDate(date.getUTCDate() + 1);
  } else {
    const days: Record<string, number> = {
      ahad: 0, isnin: 1, selasa: 2, rabu: 3, khamis: 4, jumaat: 5, sabtu: 6,
    };
    const day = Object.keys(days).find((key) => new RegExp(`\\b${key}\\b`, 'i').test(allInbound));
    if (!day) return null;
    let difference = (days[day] - date.getUTCDay() + 7) % 7;
    if (!difference) difference = 7;
    date.setUTCDate(date.getUTCDate() + difference);
  }
  return date.toISOString().slice(0, 10);
}

function extractPickupTime(messages: any[], body: Record<string, any>) {
  if (text(body.pickup_time)) return text(body.pickup_time);

  const inbound = messages
    .filter((row) => row.direction === 'inbound')
    .map(messageText)
    .reverse();

  for (const value of inbound) {
    const match = value.match(/(?:kul|pukul|jam)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(pagi|tengahari|petang|malam|am|pm)?/i)
      || value.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
    if (!match) continue;

    let hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    const dayPart = text(match[3]).toLowerCase();
    if ((/pm|petang|malam/.test(dayPart) || (!dayPart && /ptg|petang/i.test(value))) && hour < 12) hour += 12;
    if (dayPart === 'pagi' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }
  return null;
}

function validWording(value: string) {
  const cleaned = text(value);
  return Boolean(cleaned)
    && !isAutomatedGreeting(cleaned)
    && !/payment|alamat|address|total|spx|jnt|postcode|poskod|pickup|ambil|ambik|bagi total|nak ni|macam ni|contoh/i.test(cleaned)
    && (
      /^(happy|selamat|the wedding|mubarak|congrat|welcome|one year|birthday)/i.test(cleaned)
      || /^[A-Za-z]{1,20}\s*&\s*[A-Za-z]{1,20}$/.test(cleaned)
      || (/^[A-Z0-9&❤️❤' .\-]{3,}$/.test(cleaned) && /[A-Z]/.test(cleaned))
    );
}

function mediaReferences(messages: any[]) {
  return messages
    .filter(isMedia)
    .filter((message) => !/m2u|cimb|receipt|resit|duitnow|payment|transfer/i.test(`${fileName(message)} ${messageText(message)}`))
    .map((message) => ({
      message_id: message.id,
      provider_message_id: message.provider_message_id,
      type: message.message_type,
      media_url: message.media_url || null,
      caption: messageText(message) || null,
      file_name: fileName(message) || null,
    }));
}

function category(value: string) {
  const lowered = value.toLowerCase();
  if (/burn\s*away|burnaway/.test(lowered)) return 'burnaway';
  if (/\bwafer\b/.test(lowered)) return 'wafer';
  if (/\bedible\b|\bei\b|print gambar/.test(lowered)) return 'edible';
  if (/acrylic|akrilik|ayrlic|arylic|arcylic/.test(lowered)) return 'acrylic';
  return 'printed';
}

function extractSize(values: string[]) {
  for (const value of [...values].reverse()) {
    const match = value.match(/\b(\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?\s*(?:inch|inci|in)?)\b/i)
      || value.match(/\b(A[4-7])\b/i);
    if (match) return match[1];
  }
  return '';
}

function extractStyle(values: string[]) {
  const combined = values.join(' ').toLowerCase();
  const color = ['rose gold', 'silver', 'gold', 'black', 'white', 'clear', 'pink', 'blue', 'red', 'green', 'orange', 'yellow', 'purple', 'lilac']
    .find((candidate) => combined.includes(candidate));
  const shape = /bulat|circle|round/.test(combined)
    ? 'Round / Bulat'
    : /petak|square/.test(combined) ? 'Square / Petak' : '';
  return [color && color.replace(/\b\w/g, (letter) => letter.toUpperCase()), shape].filter(Boolean).join(' — ');
}

function itemTitle(kind: string, theme: string) {
  const cleanTheme = text(theme).replace(/\s+/g, ' ');
  const labels: Record<string, string> = {
    edible: 'Edible Image',
    acrylic: 'Acrylic Cake Topper',
    wafer: 'Wafer Paper',
    burnaway: 'Burn Away Combo',
    printed: 'Cake Topper',
  };
  return cleanTheme ? `${cleanTheme} — ${labels[kind]}` : labels[kind];
}

function buildItem(
  kind: string,
  name: string,
  quantity: number,
  price: number,
  wording: string,
  references: any[],
  context: any,
  index: number,
) {
  const aiType = kind === 'printed' ? 'topper_editing_glossy' : kind;
  const style = extractStyle(context.texts);
  return {
    k: kind,
    title: itemTitle(kind, name),
    qty: quantity,
    price: money(price),
    size: extractSize(context.texts),
    style: kind === 'printed'
      ? `Editing / Existing Design — Glossy${style ? ` — ${style}` : ''}`
      : style,
    wording,
    review: 'Need Review',
    review_required: true,
    customization: {
      ai_generated: true,
      ai_job_type: aiType,
      ai_pending_confirmation: true,
      source: 'whatsapp_pickup_ai',
      conversation_id: context.conversation.id,
      whatsapp_phone: context.conversation.phone,
      whatsapp_link: whatsappLink(context.conversation.phone),
      pickup_time: context.pickupTime,
      request_key: context.requestKey,
      set_hint: index + 1,
      reference_message_ids: references.map((reference) => reference.message_id),
      reference_media: references,
    },
    product_snapshot: {
      source: 'whatsapp_pickup_ai',
      image_url: references.find((reference) => reference.type === 'image')?.media_url || null,
      ai_job_type: aiType,
      reference_message_ids: references.map((reference) => reference.message_id),
    },
  };
}

function parseItems(messages: any[], context: any) {
  const pricedRows: Array<{ index: number; line: string; price: number }> = [];

  for (let index = 0; index < messages.length; index += 1) {
    const value = messageText(messages[index]);
    if (!value || isAutomatedGreeting(value) || (value.match(/\brm\s*\d/ig) || []).length > 3) continue;

    for (const line of value.split(/\n+/)) {
      if (/total|spx|j\s*&?\s*t|jnt|ninja|shipping|delivery|courier|harga acrylic|harga edible/i.test(line)) continue;
      if (/\bke\b/i.test(line) && (line.match(/\d+(?:\.\d+)?/g) || []).length > 1) continue;
      const priceMatch = line.match(/\brm\s*(\d+(?:\.\d{1,2})?)\b/i);
      if (priceMatch) pricedRows.push({ index, line, price: Number(priceMatch[1]) });
    }
  }

  const wordingByRow = new Map<number, string[]>();
  for (let index = 0; index < messages.length; index += 1) {
    const wording = messageText(messages[index]);
    if (messages[index].direction !== 'inbound' || !validWording(wording) || !pricedRows.length) continue;

    let best = 0;
    let distance = Number.POSITIVE_INFINITY;
    pricedRows.forEach((row, rowIndex) => {
      const candidateDistance = Math.abs(index - row.index);
      if (candidateDistance < distance) {
        distance = candidateDistance;
        best = rowIndex;
      }
    });
    wordingByRow.set(best, [...(wordingByRow.get(best) || []), wording]);
  }

  const items: any[] = [];
  for (let rowIndex = 0; rowIndex < pricedRows.length; rowIndex += 1) {
    const row = pricedRows[rowIndex];
    const previousIndex = pricedRows[rowIndex - 1]?.index ?? -1;
    const nextIndex = pricedRows[rowIndex + 1]?.index ?? messages.length;
    const nearbyMessages = messages.slice(previousIndex + 1, nextIndex).filter((message) => !isAutomatedGreeting(messageText(message)));
    const references = mediaReferences(messages.slice(previousIndex + 1, row.index + 1));
    const categoryContext = [row.line, ...nearbyMessages.map(messageText)].join(' ');
    const kind = category(categoryContext);
    const quantityMatch = categoryContext.match(/\b(\d{1,3})\s*(?:pcs?|set|keping|unit)\b/i);
    const quantity = quantityMatch ? Math.max(1, Math.min(100, Number(quantityMatch[1]))) : 1;
    const theme = row.line
      .replace(/\brm\s*\d+(?:\.\d+)?/ig, ' ')
      .replace(/\b\d+\s*(?:pcs?|set|keping|unit)\b/ig, ' ')
      .replace(/\b(?:nak|nk|ni|ini|satu|harga|je|sahaja|edible|image|acrylic|akrilik|cake topper|topper|wafer|burn away|glossy)\b/ig, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const wording = [...new Set(wordingByRow.get(rowIndex) || [])].join('\n');

    if (references.length > 1 && quantity === 1) {
      references.forEach((reference, referenceIndex) => {
        items.push(buildItem(
          kind,
          theme ? `${theme} ${referenceIndex + 1}` : `Reference ${referenceIndex + 1}`,
          1,
          row.price,
          wording,
          [reference],
          context,
          items.length,
        ));
      });
    } else {
      items.push(buildItem(
        kind,
        theme,
        quantity,
        row.price,
        wording,
        references.slice(-4),
        context,
        items.length,
      ));
    }
  }

  if (items.length) return items;

  const combined = messages
    .filter((message) => !isAutomatedGreeting(messageText(message)))
    .map(messageText)
    .join(' ')
    .toLowerCase();
  const kinds: string[] = [];
  if (/burn\s*away|burnaway/.test(combined)) kinds.push('burnaway');
  else if (/\bwafer\b/.test(combined)) kinds.push('wafer');
  if (/\bedible\b|print gambar/.test(combined)) kinds.push('edible');
  if (/acrylic|akrilik|ayrlic|arylic/.test(combined)) kinds.push('acrylic');
  if (/topper|glossy|didi|spiderman|barbie|tema/.test(combined) && !kinds.includes('acrylic')) kinds.push('printed');
  if (!kinds.length) kinds.push('printed');

  const defaultPrices: Record<string, number> = {
    edible: 12,
    acrylic: 20,
    wafer: 12,
    burnaway: 36,
    printed: 10,
  };
  const references = mediaReferences(messages);
  const wording = messages
    .filter((message) => message.direction === 'inbound')
    .map(messageText)
    .findLast(validWording) || '';

  return [...new Set(kinds)].map((kind, index) =>
    buildItem(kind, '', 1, defaultPrices[kind], wording, references.slice(-6), context, index)
  );
}

function latestQuotedTotal(messages: any[]) {
  for (const value of messages.map(messageText).reverse()) {
    const match = value.match(/(?:total|jumlah|semua)[^0-9]{0,12}(?:rm\s*)?(\d+(?:\.\d{1,2})?)/i);
    if (match) return Number(match[1]);
  }
  return null;
}

function makePayload(
  messages: any[],
  conversation: { id: string; name: string; phone: string },
  body: Record<string, any>,
  requestKey: string,
) {
  const pickupTime = extractPickupTime(messages, body);
  const dateNeed = extractDateNeeded(messages, body);
  const context = {
    conversation,
    requestKey,
    pickupTime,
    texts: messages.filter((message) => !isAutomatedGreeting(messageText(message))).map(messageText),
  };
  const items = parseItems(messages, context);
  const calculatedTotal = money(items.reduce((sum, item) => sum + item.price * item.qty, 0));
  const suppliedTotal = body.total == null ? null : Number(body.total);
  const total = money(Number.isFinite(suppliedTotal) && suppliedTotal >= 0
    ? suppliedTotal
    : latestQuotedTotal(messages) ?? calculatedTotal);

  const missingFields: string[] = [];
  if (!dateNeed) missingFields.push('date_need');
  if (!pickupTime) missingFields.push('pickup_time');
  if (items.some((item) => !item.product_snapshot.image_url)) missingFields.push('reference_check');

  const itemSummary = items.map((item, index) =>
    `${index + 1}. ${item.title} x${item.qty} | RM${item.price.toFixed(2)}${item.wording ? ` | ${item.wording.replace(/\n/g, ' / ')}` : ''}`
  ).join('\n');

  return {
    customer: {
      name: text(body.customer_name) || conversation.name,
      phone: conversation.phone,
      address_line1: '',
      postcode: '',
      city: '',
      state: '',
    },
    items,
    total,
    delivery: 'pickup',
    delivery_fee: 0,
    date_need: dateNeed,
    pickup_time: pickupTime,
    conversation_id: conversation.id,
    request_key: requestKey,
    match_score: 1,
    match_reason: 'explicit_pickup_trigger',
    admin_remark: [
      'AI PENDING CONFIRMATION — PICKUP / BAYAR DI KAUNTER.',
      `WhatsApp: ${whatsappLink(conversation.phone)}`,
      `Conversation: ${conversation.id}`,
      `Request: ${requestKey}`,
      dateNeed ? `Date need: ${dateNeed}` : 'Date need: Not provided',
      pickupTime ? `Pickup time: ${pickupTime}` : 'Pickup time: Not provided',
      missingFields.length ? `Belum lengkap: ${missingFields.join(', ')}` : 'Detail utama berjaya diextract.',
      itemSummary,
    ].join('\n'),
    evidence: {
      worker_version: 'pickup-ai-v2',
      missing_fields: missingFields,
      calculated_total: calculatedTotal,
      provided_total: suppliedTotal,
      messages: messages.map((message) => ({
        id: message.id,
        direction: message.direction,
        type: message.message_type,
        at: message.sent_at || message.created_at,
        text: messageText(message).slice(0, 500),
        media_url: message.media_url || null,
        file_name: fileName(message) || null,
      })),
    },
  };
}

async function linkConversation(conversation: any, result: any, payload: any) {
  if (!result?.order_db_id) return;
  const { error } = await db.from('conversation_order_links').insert({
    conversation_id: conversation.id,
    source_project: 'icetak-order-system',
    external_order_id: result.order_db_id,
    order_system_order_id: result.order_db_id,
    order_no: result.order_id,
    is_primary: true,
    match_method: 'pickup_ai',
    match_confidence: 1,
    linked_by_label: 'pickup-ai-trigger',
    metadata: {
      request_key: payload.request_key,
      payment_status: 'cash_counter',
      whatsapp_link: whatsappLink(conversation.phone),
      worker_version: 'pickup-ai-v2',
    },
  });
  if (error && !/duplicate/i.test(error.message)) console.error(error.message);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);
  if (!await authorized(req)) return json({ ok: false, error: 'Unauthorized' }, 401);

  let body: Record<string, any> = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Valid JSON required' }, 400);
  }

  try {
    if (!text(body.phone) && !text(body.conversation_id)) {
      return json({ ok: false, error: 'phone or conversation_id required' }, 400);
    }

    const conversation = await resolveConversation(body);
    if (!conversation.phone) throw new Error('Conversation has no WhatsApp phone');

    const messages = await loadMessages(conversation.id, body);
    const lastMessage = messages.at(-1);
    const requestKey = text(body.request_id)
      || `pickup:${conversation.id}:${lastMessage?.id || crypto.randomUUID()}`;
    const payload = makePayload(messages, conversation, body, requestKey);

    if (body.dry_run === true) {
      return json({
        ok: true,
        dry_run: true,
        endpoint_version: 'pickup-ai-v2',
        request_key: requestKey,
        conversation: { ...conversation, whatsapp_link: whatsappLink(conversation.phone) },
        extraction: payload,
      });
    }

    const result = await callBridge(requestKey, payload);
    await linkConversation(conversation, result, payload);

    return json({
      ok: true,
      dry_run: false,
      endpoint_version: 'pickup-ai-v2',
      request_key: requestKey,
      conversation: { ...conversation, whatsapp_link: whatsappLink(conversation.phone) },
      extraction: {
        total: payload.total,
        date_need: payload.date_need,
        pickup_time: payload.pickup_time,
        item_count: payload.items.length,
        items: payload.items,
      },
      result,
    });
  } catch (error) {
    console.error('pickup-ai-order-trigger', error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
