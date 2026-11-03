// Called only after the API resolves the customer's order capability token.
export async function recoverCustomerPod(shipment: any, db: (path: string, init?: RequestInit) => Promise<any>, base: string, serviceRole: string) {
  if (!shipment || shipment.provider !== 'parceldaily' || shipment.normalized_status !== 'delivered') return;
  const claimed = await db('rpc/icetak_claim_customer_pod_recovery', { method: 'POST', body: JSON.stringify({ p_shipment_id: shipment.id }) });
  if (claimed !== true) return;
  const token = Deno.env.get('PARCELDAILY_TOKEN') || '';
  const merchantid = Deno.env.get('PARCELDAILY_MERCHANT_ID') || '';
  if (!token || !merchantid) return;
  const response = await fetch(`https://api.parceldaily.com/v1/partner/orders?consign_no=${encodeURIComponent(shipment.tracking_no)}&limit=10`, {
    headers: { token, merchantid }, signal: AbortSignal.timeout(8000), redirect: 'error',
  });
  if (!response.ok) throw Error('POD_PROVIDER_UNAVAILABLE');
  const data = await response.json();
  const order = data.data?.find((item: any) => item.consign_no === shipment.tracking_no && (!shipment.provider_order_id || (item.orderId || item.objectId) === shipment.provider_order_id));
  if (!order || String(order.statusGroup).toLowerCase() !== 'delivered') return;
  const urls = (Array.isArray(order.pod) ? order.pod : typeof order.pod === 'string' ? [order.pod] : []).slice(0, 10);
  for (let index = 0; index < urls.length; index++) {
    const source = new URL(urls[index]);
    if (source.protocol !== 'https:' || source.username || source.password || source.port || !['parceldaily-proofofdelivery.s3.ap-southeast-1.amazonaws.com', 'api.parceldaily.com'].includes(source.hostname)) continue;
    const file = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!file.ok) continue;
    const declared = Number(file.headers.get('content-length') || 0);
    if (declared > 5 * 1024 * 1024) continue;
    const reader = file.body?.getReader();
    if (!reader) continue;
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 5 * 1024 * 1024) { await reader.cancel(); throw Error('POD_TOO_LARGE'); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const type = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 ? 'image/png' : String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-' ? 'application/pdf' : '';
    if (!type) continue;
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
    const path = `${shipment.id}/pod-${index + 1}-${hash.slice(0, 16)}.${type === 'application/pdf' ? 'pdf' : type === 'image/png' ? 'png' : 'jpg'}`;
    const upload = await fetch(`${base}/storage/v1/object/shipping-pod/${path}`, { method: 'POST', headers: { authorization: `Bearer ${serviceRole}`, apikey: serviceRole, 'content-type': type, 'x-upsert': 'true' }, body: bytes });
    if (!upload.ok) throw Error('POD_ARCHIVE_UNAVAILABLE');
    await db('shipment_pod_files?on_conflict=provider,source_url', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ shipment_id: shipment.id, provider: 'parceldaily', tracking_no: shipment.tracking_no, position: index + 1, source_url: source.href, storage_bucket: 'shipping-pod', storage_path: path, content_type: type, size_bytes: size, sha256: hash, archive_status: 'archived_storage', archived_at: new Date().toISOString(), archive_error: null }) });
  }
}
