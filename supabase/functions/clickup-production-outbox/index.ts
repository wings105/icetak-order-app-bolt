import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const headers = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-ap-secret',
  'cache-control': 'no-store',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const text = (value: unknown) => value == null ? '' : String(value).trim();
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
async function authorized(req: Request) {
  const { data, error } = await db.from('clickup_integration_settings').select('value').eq('setting_key', 'black_box').single();
  if (error) throw error;
  const expected = text(data?.value?.secret_sha256);
  return Boolean(expected) && await sha256(req.headers.get('x-ap-secret') || '') === expected;
}
function initialStatus(component: any, item: any) {
  const type = text(component.component_type || item.product_type).toLowerCase();
  const label = text(component.label || item.title).toLowerCase();
  const review = Boolean(component.review_required ?? item.review_required);
  if (label.includes('ready stock') && type.includes('edible')) return 'edible print ready stock';
  if (label.includes('ready stock')) return 'ready stock';
  if (type.includes('acrylic')) return 'acrylic';
  if (type.includes('wafer')) return 'wafer paper';
  if (type.includes('edible')) return review ? 'design edible image' : 'edible print ready stock';
  if (type.includes('print') || type.includes('topper')) return review ? 'design editing -topper' : 'ready stock';
  return 'lain2';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  try {
    if (!await authorized(req)) return json({ error: 'invalid_ap_secret' }, 401);
    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') || 1), 10));
    const { data: events, error: eventError } = await db.rpc('claim_clickup_production_outbox', { p_limit: limit });
    if (eventError) throw eventError;
    const results: unknown[] = [];
    for (const event of events || []) {
      const { data: order, error: orderError } = await db.from('orders').select('*').eq('id', event.order_id).single();
      if (orderError) {
        await db.from('integration_outbox').update({ status: 'retry', last_error: orderError.message, next_attempt_at: new Date(Date.now() + 60000).toISOString(), locked_at: null }).eq('id', event.id);
        continue;
      }
      const { data: components, error: componentError } = await db.from('production_components').select('*,order_items(*)').eq('order_id', event.order_id).is('clickup_task_id', null).order('created_at');
      if (componentError) throw componentError;
      const total = (components || []).length;
      results.push({
        event_id: event.id,
        event_type: event.event_type,
        order: { id: order.id, order_no: order.order_no || order.order_id, public_token: order.public_token, date_needed: order.date_need, payment_status: order.payment_status, customer_confirmed: order.customer_confirmed, customer_name: order.delivery_name, customer_phone: order.delivery_phone, delivery_method: order.delivery_method || order.delivery },
        components: (components || []).map((component: any, index: number) => {
          const item = component.order_items || {};
          return { id: component.id, order_item_id: component.order_item_id, title: component.label || item.title || `Component ${index + 1}`, component_type: component.component_type, quantity: item.qty || 1, size: item.size || '', style: item.style || '', wording: item.wording || item.custom_text || '', review_required: Boolean(component.review_required ?? item.review_required), initial_clickup_status: initialStatus(component, item), awb_primary: total === 1 || index === 0, webapp_order_id: order.id, webapp_component_id: component.id };
        }),
      });
    }
    return json({ ok: true, count: results.length, events: results });
  } catch (error) {
    console.error('clickup-production-outbox', error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
