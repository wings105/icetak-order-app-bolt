import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const BUCKET = 'icetak-receipts';
const MAX_BYTES = 5 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'authorization,x-client-info,apikey,content-type,x-retry-count',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, 'content-type': 'application/json' },
});

async function rest(path: string, init: RequestInit = {}, bearer = SERVICE_KEY) {
  const response = await fetch(`${URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${bearer}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message || body?.error || `Request failed: ${response.status}`);
  return body;
}

function decodeFile(value: unknown, mime: string) {
  const base64 = String(value || '').replace(/^data:[^;]+;base64,/, '');
  if (!base64 || base64.length > Math.ceil(MAX_BYTES * 4 / 3) + 8) {
    throw new Error('Resit mesti kurang daripada 5MB.');
  }
  let raw: string;
  try {
    raw = atob(base64);
  } catch {
    throw new Error('Fail resit tidak sah.');
  }
  if (!raw.length || raw.length > MAX_BYTES) throw new Error('Resit mesti kurang daripada 5MB.');
  const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
  const valid = mime === 'image/jpeg'
    ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : mime === 'image/png'
      ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      : bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  if (!valid) throw new Error('Kandungan fail tidak sepadan dengan format resit.');
  return bytes;
}

async function signedUrl(bucket: string, path: string) {
  if (bucket !== BUCKET || !path.startsWith('pickup/')) throw new Error('Receipt not available.');
  const response = await fetch(`${URL}/storage/v1/object/sign/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: 900 }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.signedURL) throw new Error(body?.message || 'Tidak dapat membuka resit.');
  return `${URL}/storage/v1${body.signedURL}`;
}

async function upload(body: Record<string, unknown>) {
  const token = String(body.token || '').trim();
  const checkoutId = String(body.checkout_id || '').trim();
  const mime = String(body.mime_type || '').trim().toLowerCase();
  if (!token || !UUID.test(checkoutId)) throw new Error('Checkout pickup tidak sah.');
  if (!ALLOWED_TYPES.has(mime)) throw new Error('Hanya fail JPG, PNG atau PDF dibenarkan.');

  const checkout = await rest('rpc/icetak_pickup_checkout_status', {
    method: 'POST',
    body: JSON.stringify({ p_token: token, p_checkout_id: checkoutId }),
  });
  if (checkout?.paid || checkout?.status !== 'awaiting_payment') {
    throw new Error('Checkout ini tidak lagi menunggu bayaran.');
  }

  const bytes = decodeFile(body.data, mime);
  const extension = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg';
  const fileName = String(body.file_name || `receipt.${extension}`)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(-100) || `receipt.${extension}`;
  const path = `pickup/${checkoutId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${fileName}`;

  const response = await fetch(`${URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': mime,
      'x-upsert': 'false',
    },
    body: bytes,
  });
  if (!response.ok) {
    const details = await response.json().catch(() => null);
    throw new Error(details?.message || details?.error || 'Upload resit gagal.');
  }

  const result = await rest('rpc/icetak_customer_submit_pickup_receipt', {
    method: 'POST',
    body: JSON.stringify({
      p_token: token,
      p_checkout_id: checkoutId,
      p_receipt_bucket: BUCKET,
      p_receipt_path: path,
      p_receipt_name: fileName,
      p_receipt_mime: mime,
    }),
  });
  return { ...result, receiptUrl: await signedUrl(BUCKET, path) };
}

async function adminView(req: Request, body: Record<string, unknown>) {
  const checkoutId = String(body.checkout_id || '').trim();
  if (!UUID.test(checkoutId)) throw new Error('Checkout pickup tidak sah.');
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!bearer || bearer === SERVICE_KEY) return json({ ok: false, error: 'Forbidden' }, 403);

  // Execute the existing permission-checked RPC as the caller, not as service_role.
  await rest('rpc/icetak_admin_pickup_checkout_status', {
    method: 'POST',
    body: JSON.stringify({ p_checkout_id: checkoutId }),
  }, bearer);

  const checkouts = await rest(
    `pickup_checkouts?id=eq.${encodeURIComponent(checkoutId)}&select=payment_session_id&limit=1`,
  );
  const sessionId = checkouts?.[0]?.payment_session_id;
  if (!sessionId) throw new Error('Payment session tidak dijumpai.');
  const sessions = await rest(
    `payment_sessions?id=eq.${encodeURIComponent(sessionId)}&select=receipt_bucket,receipt_path,receipt_name,receipt_mime&limit=1`,
  );
  const receipt = sessions?.[0];
  if (!receipt?.receipt_path) throw new Error('Customer belum upload bukti bayaran.');
  return json({
    ok: true,
    url: await signedUrl(receipt.receipt_bucket || BUCKET, receipt.receipt_path),
    fileName: receipt.receipt_name || 'receipt',
    mimeType: receipt.receipt_mime || '',
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') return json({ ok: false, error: 'Invalid request' }, 400);
    if (body.action === 'upload') return json(await upload(body));
    if (body.action === 'admin_view') return await adminView(req, body);
    return json({ ok: false, error: 'Unsupported action' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Receipt request failed.';
    const forbidden = message === 'Forbidden' || /JWT|permission denied/i.test(message);
    return json({ ok: false, error: message }, forbidden ? 403 : 400);
  }
});
