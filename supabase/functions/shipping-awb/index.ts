import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});
const cfg = (key: string) => Deno.env.get(key) || '';

async function findShipment(body: any) {
  for (const [column, input] of [
    ['id', body.shipment_id],
    ['tracking_no', body.tracking_no],
    ['provider_order_id', body.provider_order_id],
  ]) {
    if (!input) continue;
    const { data, error } = await sb.from('shipments').select('*')
      .eq(column, String(input)).limit(1).maybeSingle();
    if (error && error.code !== '22P02') throw error;
    if (data) return data;
  }
  return null;
}

async function signedUrl(path: string) {
  const expiresIn = 7 * 24 * 60 * 60;
  const { data, error } = await sb.storage.from('shipping-labels')
    .createSignedUrl(path, expiresIn);
  if (error) throw error;
  return {
    pdf_url: data.signedUrl,
    expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
}

async function downloadPdf(connote: string) {
  const base = (cfg('PARCELDAILY_BASE_URL') || 'https://api.sandbox.parceldaily.com')
    .replace(/\/$/, '');
  const response = await fetch(`${base}/v1/partner/consign-pdf/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      token: cfg('PARCELDAILY_TOKEN'),
      merchantid: cfg('PARCELDAILY_MERCHANT_ID'),
    },
    body: JSON.stringify({ connote }),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || '';
  const isPdf = contentType.toLowerCase().includes('pdf') ||
    (bytes.length >= 4 && String.fromCharCode(...bytes.slice(0, 4)) === '%PDF');
  if (!response.ok || !isPdf) {
    throw new Error(`AWB PDF not ready: HTTP ${response.status}`);
  }
  return bytes;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ success: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  let body: any;
  try { body = await req.json(); }
  catch { return json({ success: false, error: 'INVALID_JSON' }, 400); }

  try {
    const shipment = await findShipment(body);
    if (!shipment) return json({ success: false, error: 'SHIPMENT_NOT_FOUND' }, 404);

    if (shipment.awb_pdf_path && body.force !== true) {
      const link = await signedUrl(shipment.awb_pdf_path);
      await sb.from('shipments').update({
        awb_pdf_url: link.pdf_url,
        awb_signed_url_expires_at: link.expires_at,
      }).eq('id', shipment.id);
      return json({ success: true, status: 'ready', shipment_id: shipment.id, ...link });
    }

    if (!shipment.tracking_no) {
      await sb.from('shipments').update({
        awb_status: 'pending',
        awb_error: 'Tracking number not available yet',
        awb_last_attempt_at: new Date().toISOString(),
      }).eq('id', shipment.id);
      return json({ success: true, status: 'pending', reason: 'TRACKING_NOT_READY' }, 202);
    }

    let lastError: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const bytes = await downloadPdf(shipment.tracking_no);
        const tracking = String(shipment.tracking_no).replace(/[^a-zA-Z0-9_-]/g, '_');
        const path = `${shipment.id}/${tracking}.pdf`;
        const { error: uploadError } = await sb.storage.from('shipping-labels').upload(
          path,
          bytes,
          { contentType: 'application/pdf', upsert: true },
        );
        if (uploadError) throw uploadError;
        const link = await signedUrl(path);
        await sb.from('shipments').update({
          awb_pdf_path: path,
          awb_pdf_url: link.pdf_url,
          awb_pdf_generated_at: new Date().toISOString(),
          awb_signed_url_expires_at: link.expires_at,
          awb_status: 'ready',
          awb_attempts: Number(shipment.awb_attempts || 0) + attempt,
          awb_error: null,
          awb_last_attempt_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', shipment.id);
        return json({
          success: true,
          status: 'ready',
          shipment_id: shipment.id,
          tracking_no: shipment.tracking_no,
          storage_path: path,
          ...link,
        });
      } catch (error) {
        lastError = error;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1200));
      }
    }

    await sb.from('shipments').update({
      awb_status: 'failed',
      awb_attempts: Number(shipment.awb_attempts || 0) + 3,
      awb_error: lastError?.message || String(lastError),
      awb_last_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', shipment.id);
    return json({ success: false, status: 'failed', error: lastError?.message }, 502);
  } catch (error: any) {
    return json({ success: false, error: error?.message || String(error) }, 500);
  }
});