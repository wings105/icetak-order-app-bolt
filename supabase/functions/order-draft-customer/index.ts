// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const RECEIPT_BUCKET = 'icetak-receipts';
const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
const headers = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store',
};
const deliveryOptions = [
  { code: 'pickup', label: 'Pickup', fee: 0, note: 'Bandar Baru Pasir Puteh', requires_address: false },
  { code: 'spx', label: 'SPX', fee: 4.5, note: '1–3 hari', requires_address: true },
  { code: 'jnt', label: 'J&T', fee: 5.9, note: '1–3 hari', requires_address: true },
  { code: 'ninja', label: 'Ninja Van', fee: 6.9, note: '1–3 hari', requires_address: true },
];

const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const text = (value: unknown) => String(value ?? '').trim();
const digits = (value: unknown) => text(value).replace(/\D/g, '');
const meaningful = (value: unknown, min = 2) => text(value).replace(/[^\p{L}\p{N}]/gu, '').length >= min;
const normalizePhone = (value: unknown) => {
  let valueDigits = digits(value);
  if (valueDigits.startsWith('0')) valueDigits = `60${valueDigits.slice(1)}`;
  else if (valueDigits.startsWith('1')) valueDigits = `60${valueDigits}`;
  return valueDigits;
};
const validAddress = (customer: any) => meaningful(customer?.address_line1, 3)
  && /^\d{5}$/.test(digits(customer?.postcode))
  && meaningful(customer?.city, 2)
  && meaningful(customer?.state, 2);

function sanitizeDraftAddress(work: any) {
  const sanitized = structuredClone(work || {});
  const customer = { ...(sanitized.customer || {}) };
  if (String(sanitized.delivery || '').toLowerCase() !== 'pickup' && !validAddress(customer)) {
    if (!meaningful(customer.address_line1, 3)) customer.address_line1 = '';
    if (!/^\d{5}$/.test(digits(customer.postcode))) customer.postcode = '';
    if (!meaningful(customer.city, 2)) customer.city = '';
    if (!meaningful(customer.state, 2)) customer.state = '';
    customer.address_id = null;
    sanitized.customer = customer;
    delete sanitized.address_id;
  }
  return sanitized;
}

function allowedCustomer(value: any) {
  const customer: Record<string, string | null> = {
    name: text(value?.name) || null,
    phone: text(value?.phone) || null,
    address_line1: text(value?.address_line1) || null,
    address_line2: text(value?.address_line2) || null,
    postcode: digits(value?.postcode) || null,
    city: text(value?.city) || null,
    state: text(value?.state) || null,
  };
  if (Object.prototype.hasOwnProperty.call(value || {}, 'address_id')) {
    customer.address_id = text(value.address_id) || null;
  }
  return Object.fromEntries(Object.entries(customer).filter(([, item]) => item !== null));
}

async function paymentQrUrl() {
  const query = await db.from('private_runtime_settings')
    .select('setting_value')
    .eq('setting_key', 'draft_payment_qr_image_url')
    .maybeSingle();
  return text(query.data?.setting_value) || null;
}

async function whatsappSetting(key: string) {
  const query = await db.from('whatsapp_settings')
    .select('text_value,secret_value')
    .eq('key', key)
    .maybeSingle();
  return text(query.data?.secret_value || query.data?.text_value);
}

async function publicBase() {
  return (await whatsappSetting('customer_app_base_url') || 'https://shop.decocake.my').replace(/\/$/, '');
}

async function sendAdmin(message: string) {
  try {
    const base = await whatsappSetting('base_url') || 'https://officialapi.wasapflow.com/bridge/v1';
    const partner = await whatsappSetting('partner_key');
    const waba = await whatsappSetting('waba_id');
    const destination = await whatsappSetting('admin_order_notify_phone');
    if (!partner || !waba || !destination) return { sent: false };
    const response = await fetch(`${base}/messages/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-partner-key': partner, 'x-waba-id': waba },
      body: JSON.stringify({ to: digits(destination), text: message, preview_url: false }),
    });
    const result = await response.json().catch(() => ({}));
    return { sent: response.ok && result.success !== false, message_id: result?.message_id || result?.id || null };
  } catch {
    return { sent: false };
  }
}

async function savedAddresses(draft: any) {
  try {
    const phone = normalizePhone(draft?.working_draft?.customer?.phone || draft?.customer_phone);
    if (!/^601\d{8,9}$/.test(phone)) return [];
    const variants = [`+${phone}`, phone, `0${phone.slice(2)}`];
    const customerQuery = await db.from('customers')
      .select('id,customer_master_id,name,phone')
      .in('phone', variants)
      .limit(1);
    const customer = customerQuery.data?.[0] || null;
    let masterId = customer?.customer_master_id || null;
    if (!masterId) {
      const identifierQuery = await db.from('customer_identifiers_master')
        .select('customer_master_id')
        .eq('identifier_type', 'phone')
        .eq('normalized_value', phone)
        .eq('scope', 'global')
        .limit(1);
      masterId = identifierQuery.data?.[0]?.customer_master_id || null;
    }
    if (!customer && !masterId) return [];
    let query: any = db.from('customer_addresses')
      .select('id,label,recipient_name,phone,address_line1,address_line2,city,postcode,state,country,is_default,is_verified,last_used_at,source_provider')
      .is('archived_at', null);
    if (customer && masterId) query = query.or(`customer_id.eq.${customer.id},customer_master_id.eq.${masterId}`);
    else if (masterId) query = query.eq('customer_master_id', masterId);
    else query = query.eq('customer_id', customer.id);
    const addressQuery = await query
      .order('is_default', { ascending: false })
      .order('last_used_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(8);
    return addressQuery.error ? [] : (addressQuery.data || []).filter(validAddress);
  } catch {
    return [];
  }
}

async function signedStorageUrl(path: string, bucket = RECEIPT_BUCKET) {
  if (!path) return '';
  const { data, error } = await db.storage.from(bucket).createSignedUrl(path, 3600);
  return error ? '' : data.signedUrl;
}

function decodeBase64(value: string) {
  const encoded = value.includes(',') ? value.split(',').pop() || '' : value;
  const binary = atob(encoded.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function load(token: string) {
  const draftQuery = await db.from('qrpay_order_drafts')
    .select('id,review_token,customer_review_token,request_key,source_type,status,customer_status,customer_name,customer_phone,working_draft,draft_total,item_subtotal,shipping_fee,payment_required,payment_status,payment_mode,payment_session_id,admin_approved_at,customer_confirmed_at,order_id,order_no,version,created_at,updated_at')
    .eq('customer_review_token', token)
    .maybeSingle();
  if (draftQuery.error) throw draftQuery.error;
  if (!draftQuery.data) throw new Error('draft_not_found');

  const draft = { ...draftQuery.data, working_draft: sanitizeDraftAddress(draftQuery.data.working_draft) };
  let paymentSession: any = null;
  let order: any = null;
  if (draft.payment_session_id) {
    const sessionQuery = await db.from('payment_sessions')
      .select('id,base_amount,expected_amount,discount,status,expires_at,transaction_id,matched_at,receipt_bucket,receipt_path,receipt_name,receipt_mime,submitted_at,draft_version,delivery_code,shipping_fee_snapshot')
      .eq('id', draft.payment_session_id)
      .maybeSingle();
    paymentSession = sessionQuery.data || null;
    if (paymentSession) {
      paymentSession.receipt_url = await signedStorageUrl(paymentSession.receipt_path, paymentSession.receipt_bucket || RECEIPT_BUCKET);
    }
  }
  if (draft.order_id) {
    const orderQuery = await db.from('orders')
      .select('id,order_no,public_token,status,payment_status,total,date_need,delivery_method,tracking,tracking_link')
      .eq('id', draft.order_id)
      .maybeSingle();
    order = orderQuery.data || null;
  }
  const [paymentQr, addresses] = await Promise.all([paymentQrUrl(), savedAddresses(draft)]);
  return {
    ...draft,
    payment_session: paymentSession,
    order,
    payment_qr_url: paymentQr,
    saved_addresses: addresses,
    delivery_options: deliveryOptions,
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  try {
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : null;
    const token = text(request.method === 'GET' ? url.searchParams.get('token') : body?.token);
    if (!/^qrc_[a-f0-9]{32}$/i.test(token)) return out({ ok: false, error: 'Invalid customer link' }, 401);
    if (request.method === 'GET') return out({ ok: true, draft: await load(token) });
    if (request.method !== 'POST') return out({ ok: false, error: 'Method not allowed' }, 405);

    const draft = await load(token);
    if (body.action === 'confirm') {
      if (!draft.admin_approved_at) return out({ ok: false, error: 'Draft belum diluluskan admin' }, 409);
      const delivery = text(body.delivery || draft.working_draft?.delivery).toLowerCase();
      const option = deliveryOptions.find((item) => item.code === delivery);
      if (!option) return out({ ok: false, error: 'Pilihan courier tidak sah' }, 400);
      const customer = allowedCustomer(body.customer || {});
      if (option.requires_address && !validAddress(customer)) {
        return out({ ok: false, error: 'Sila lengkapkan alamat, poskod, bandar dan negeri sebelum bayar' }, 400);
      }
      const confirmation = await db.rpc('icetak_customer_confirm_checkout', {
        p_customer_token: token,
        p_customer: customer,
        p_delivery: option.code,
        p_expected_version: Number.isInteger(Number(body.expected_version)) ? Number(body.expected_version) : null,
        p_actor: 'customer-link',
      });
      if (confirmation.error) throw confirmation.error;
      let payment = null;
      if (confirmation.data?.payment_required) {
        const paymentQuery = await db.rpc('icetak_prepare_draft_payment', { p_customer_token: token, p_force_new: false });
        if (paymentQuery.error) throw paymentQuery.error;
        payment = paymentQuery.data;
      }
      return out({ ok: true, result: confirmation.data, payment, draft: await load(token) });
    }

    if (body.action === 'prepare_payment') {
      const paymentQuery = await db.rpc('icetak_prepare_draft_payment', {
        p_customer_token: token,
        p_force_new: Boolean(body.force_new),
      });
      if (paymentQuery.error) throw paymentQuery.error;
      return out({ ok: true, payment: paymentQuery.data, draft: await load(token) });
    }

    if (body.action === 'reopen_checkout') {
      const reopened = await db.rpc('icetak_reopen_draft_checkout', { p_customer_token: token, p_actor: 'customer-link' });
      if (reopened.error) throw reopened.error;
      return out({ ok: true, result: reopened.data, draft: await load(token) });
    }

    if (body.action === 'upload_receipt') {
      if (!draft.payment_session_id) return out({ ok: false, error: 'Payment session belum tersedia' }, 409);
      const mime = text(body.mime_type);
      if (!['image/jpeg', 'image/png', 'application/pdf'].includes(mime)) {
        return out({ ok: false, error: 'Receipt mesti dalam format JPG, PNG atau PDF' }, 400);
      }
      const raw = text(body.data);
      if (!raw) return out({ ok: false, error: 'Fail receipt tidak dijumpai' }, 400);
      const bytes = decodeBase64(raw);
      if (bytes.byteLength > 5 * 1024 * 1024) return out({ ok: false, error: 'Receipt maksimum 5MB' }, 413);
      const extension = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg';
      const safeName = text(body.file_name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-90) || `receipt.${extension}`;
      const storagePath = `draft-${draft.id}/${Date.now()}-${safeName}`;
      const upload = await db.storage.from(RECEIPT_BUCKET).upload(storagePath, bytes, { contentType: mime, upsert: false });
      if (upload.error) throw upload.error;
      const sessionQuery = await db.from('payment_sessions')
        .select('status')
        .eq('id', draft.payment_session_id)
        .eq('draft_id', draft.id)
        .maybeSingle();
      if (!sessionQuery.data) throw new Error('Payment session tidak sah');
      const now = new Date().toISOString();
      const sessionUpdate = await db.from('payment_sessions')
        .update({
          receipt_bucket: RECEIPT_BUCKET,
          receipt_path: storagePath,
          receipt_name: safeName,
          receipt_mime: mime,
          submitted_at: now,
          status: sessionQuery.data.status === 'matched' ? 'matched' : 'receipt_submitted',
        })
        .eq('id', draft.payment_session_id)
        .eq('draft_id', draft.id);
      if (sessionUpdate.error) throw sessionUpdate.error;
      if (sessionQuery.data.status !== 'matched') {
        await db.from('qrpay_order_drafts')
          .update({ payment_status: 'pending_review', updated_at: now })
          .eq('id', draft.id)
          .neq('payment_status', 'paid');
      }
      return out({ ok: true, draft: await load(token) });
    }

    if (body.action === 'request_change') {
      const note = text(body.note);
      const requestQuery = await db.rpc('icetak_customer_request_draft_change', {
        p_customer_token: token,
        p_note: note,
        p_actor: 'customer-link',
      });
      if (requestQuery.error) throw requestQuery.error;
      const adminLink = `${await publicBase()}/qrpay-draft.html?token=${encodeURIComponent(draft.review_token)}`;
      const notice = await sendAdmin([
        '🔴 CUSTOMER REQUEST CORRECTION',
        `Customer: ${draft.customer_name || '-'}`,
        `Draft total: RM${Number(draft.draft_total || 0).toFixed(2)}`,
        `Note: ${note || '-'}`,
        '',
        'Buka draft:',
        adminLink,
      ].join('\n'));
      await db.from('qrpay_order_draft_events').insert({
        draft_id: draft.id,
        event_type: 'admin_notified_customer_change',
        actor: 'system',
        metadata: notice,
      });
      return out({ ok: true, result: requestQuery.data, admin_notified: notice.sent });
    }

    if (body.action === 'refresh') return out({ ok: true, draft: await load(token) });
    return out({ ok: false, error: 'Unsupported action' }, 400);
  } catch (error) {
    console.error('order-draft-customer', error);
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('quote_changed') ? 409 : 500;
    return out({ ok: false, error: message }, status);
  }
});
