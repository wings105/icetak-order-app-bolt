import { supabase } from './appdeploy-client';

const env = (import.meta as any).env || {};
const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
let running = false;
let lastRun = 0;

function accessToken() {
  return sessionStorage.getItem('admin_access_token') || sessionStorage.getItem('admin_session') || '';
}

async function finish(id: string, success: boolean, result: Record<string, unknown> = {}, error = '') {
  await supabase.rpc('icetak_admin_finish_notification_job', {
    p_id: id,
    p_success: success,
    p_result: result,
    p_error: error || null,
  });
}

export async function processWhatsAppQueue(force = false) {
  const token = accessToken();
  if (!token || running) return;
  if (!force && Date.now() - lastRun < 10_000) return;
  running = true;
  lastRun = Date.now();
  try {
    const { data: jobs, error } = await supabase.rpc('icetak_admin_claim_notification_jobs', { p_limit: 8 });
    if (error) throw error;
    for (const job of jobs || []) {
      try {
        const response = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({
            ...(job.payload || {}),
            queue_id: job.id,
            idempotency_key: job.idempotency_key,
            source: 'admin_queue_worker',
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.ok === false) throw new Error(result.error || `WhatsApp send ${response.status}`);
        await finish(job.id, true, result);
      } catch (sendError) {
        await finish(job.id, false, {}, sendError instanceof Error ? sendError.message : String(sendError));
      }
    }
    if ((jobs || []).length) window.dispatchEvent(new CustomEvent('wf:queue-updated', { detail: { processed: jobs.length } }));
  } catch (error) {
    console.warn('[WhatsApp queue]', error);
  } finally {
    running = false;
  }
}

setInterval(() => void processWhatsAppQueue(), 15_000);
window.addEventListener('load', () => void processWhatsAppQueue(true));
window.addEventListener('focus', () => void processWhatsAppQueue());
window.addEventListener('wf:process-queue', () => void processWhatsAppQueue(true));
void processWhatsAppQueue(true);
