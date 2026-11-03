import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
async function rpc(name: string, args: Record<string, unknown> = {}) {
  const result = await db.rpc(name, args);
  if (result.error) throw result.error;
  return result.data;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply({ error: 'POST_REQUIRED' }, 405);
  let lease = '';
  try {
    const incoming = req.headers.get('x-pickup-reconcile-token') || '';
    const secret = await db.from('private_runtime_settings').select('setting_value').eq('setting_key', 'qrpay_ai_worker_token').maybeSingle();
    if (!incoming || secret.error || incoming !== secret.data?.setting_value) return reply({ error: 'UNAUTHORIZED' }, 401);
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const token = Deno.env.get('PARCELDAILY_TOKEN');
    const base = (Deno.env.get('PARCELDAILY_BASE_URL') || 'https://api.parceldaily.com').replace(/\/$/, '');
    if (!token) throw Error('PROVIDER_NOT_CONFIGURED');
    if (!dryRun) {
      lease = crypto.randomUUID();
      if (!await rpc('icetak_pending_pickup_poll_claim', { p_run: lease })) return reply({ status: 'busy' });
    }
    const candidates = await rpc('icetak_pending_pickup_poll_candidates');
    const results = [];
    async function check(shipment: { id: string; tracking_no: string }) {
      let observation: Record<string, unknown>;
      try {
        // Read-only tracking endpoint: never calls checkout, cancellation or booking APIs.
        const response = await fetch(`${base}/v2/partner/track/`, {
          method: 'POST', headers: { 'content-type': 'application/json', token, merchantid: Deno.env.get('PARCELDAILY_MERCHANT_ID') || '' },
          body: JSON.stringify({ connote: shipment.tracking_no }), signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw Error(`PROVIDER_HTTP_${response.status}`);
        const raw = await response.json();
        const data = raw?.data && !Array.isArray(raw.data) ? raw.data : raw;
        if (String(data?.consign_no || '').trim().toUpperCase() !== shipment.tracking_no.trim().toUpperCase()) throw Error('PROVIDER_IDENTITY_MISMATCH');
        if (typeof data.status !== 'string' || !data.status.trim()) throw Error('PROVIDER_STATUS_MISSING');
        // Persist only status/identity evidence, never recipient addresses or unrelated provider fields.
        observation = { consign_no: data.consign_no, status: data.status, statusGroup: data.statusGroup || '', date: data.date || null };
      } catch (error) {
        observation = { error: error instanceof Error ? error.message : 'PROVIDER_READ_FAILED' };
      }
      const outcome = dryRun ? { status: 'preview' } : await rpc('icetak_apply_pending_pickup_check', { p_shipment_id: shipment.id, p_observation: observation });
      return { shipment_id: shipment.id, tracking_no: shipment.tracking_no, ...observation, outcome };
    }
    // At most four provider requests at once, keeping the twenty-row batch within its lease.
    for (let i = 0; i < (candidates || []).length; i += 4) {
      results.push(...await Promise.all(candidates.slice(i, i + 4).map(check)));
    }
    return reply({ status: dryRun ? 'preview' : 'checked', dry_run: dryRun, checked: results.length, results });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : 'RECONCILE_FAILED' }, 500);
  } finally {
    if (lease) await rpc('icetak_pending_pickup_poll_release', { p_run: lease }).catch(() => null);
  }
});
