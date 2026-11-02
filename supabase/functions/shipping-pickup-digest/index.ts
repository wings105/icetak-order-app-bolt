import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const TEMPLATE = 'icetak_pending_pickup_digest_ms';
const TIME_ZONE = 'Asia/Kuala_Lumpur';
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

async function setting(key: string) {
  const result = await db.from('whatsapp_settings').select('text_value,secret_value').eq('key', key).maybeSingle();
  if (result.error) throw result.error;
  return String(result.data?.secret_value || result.data?.text_value || '');
}

async function rpc(name: string, args: Record<string, unknown> = {}) {
  const result = await db.rpc(name, args);
  if (result.error) throw result.error;
  return result.data;
}

async function syncTemplate() {
  const waba = await setting('waba_id');
  const cached = await db.from('whatsapp_templates').select('status')
    .eq('waba_id', waba).eq('name', TEMPLATE).eq('language', 'ms').eq('status', 'APPROVED').maybeSingle();
  if (cached.data) return;
  const partner = await setting('partner_key');
  if (!partner || !waba) throw Error('WABA_CREDENTIALS_MISSING');
  const response = await fetch('https://officialapi.wasapflow.com/bridge/v1/templates', {
    headers: { 'x-partner-key': partner, 'x-waba-id': waba }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error('TEMPLATE_SYNC_FAILED');
  const data = await response.json();
  const template = data.templates?.find((item: { name: string; language: string }) => item.name === TEMPLATE && item.language === 'ms');
  if (!template) throw Error('TEMPLATE_NOT_FOUND');
  const result = await db.from('whatsapp_templates').upsert({
    waba_id: waba, name: TEMPLATE, language: 'ms', category: template.category, status: template.status,
    components: template.components || [], raw_payload: template,
    synced_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: 'waba_id,name,language' });
  if (result.error) throw result.error;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply({ error: 'POST_REQUIRED' }, 405);
  try {
    const incoming = req.headers.get('x-pickup-digest-token') || '';
    const token = await db.from('private_runtime_settings').select('setting_value')
      .eq('setting_key', 'qrpay_ai_worker_token').maybeSingle();
    if (!incoming || token.error || !token.data?.setting_value || incoming !== token.data.setting_value) {
      return reply({ error: 'UNAUTHORIZED' }, 401);
    }
    const body = await req.json().catch(() => ({}));
    if (body.dry_run === true) return reply({ dry_run: true, snapshot: await rpc('icetak_pending_pickup_snapshot') });
    const now = new Date();
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', hourCycle: 'h23' }).format(now));
    if (hour < 17) return reply({ status: 'not_due', schedule: `17:00 ${TIME_ZONE}` });
    const day = new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    // The native enqueue also checks the master and event rule atomically, before any queue insertion.
    if (await setting('enabled') !== 'true') return reply(await rpc('icetak_pending_pickup_enqueue', { p_day: day }));
    // A cache refresh failure must not prevent a valid in-window freeform notification.
    let templateWarning: string | null = null;
    try { await syncTemplate(); } catch { templateWarning = 'Template sync unavailable; sender window/approval guards apply'; }
    return reply({ ...await rpc('icetak_pending_pickup_enqueue', { p_day: day }), template_warning: templateWarning });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : 'DIGEST_FAILED' }, 500);
  }
});
