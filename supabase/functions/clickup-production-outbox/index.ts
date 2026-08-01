import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const headers = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'content-type,x-ap-secret',
  'cache-control': 'no-store',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const text = (value: unknown) => value == null ? '' : String(value).trim();
const trimSlash = (value: string) => value.replace(/\/+$/, '');

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function integrationSettings() {
  const [{ data: clickup, error }, { data: app }] = await Promise.all([
    db.from('clickup_integration_settings').select('value').eq('setting_key', 'black_box').single(),
    db.from('system_settings').select('value').eq('key', 'order_app').maybeSingle(),
  ]);
  if (error) throw error;
  const configuredBase = text(Deno.env.get('ORDER_APP_BASE_URL')) || text(app?.value?.base_url);
  return {
    clickup: clickup?.value || {},
    baseUrl: configuredBase ? trimSlash(configuredBase) : '',
  };
}

async function authorized(req: Request, expectedHash: string) {
  return Boolean(expectedHash) && await sha256(req.headers.get('x-ap-secret') || '') === expectedHash;
}

function initialStatus(component: any, item: any) {
  const combined = `${text(component.component_type)} ${text(component.label)} ${text(item.product_type)} ${text(item.title)}`.toLowerCase();
  const review = Boolean(component.review_required ?? item.review_required);
  if (combined.includes('mirror gold') || combined.includes('artpaper') || combined.includes('acrylic')) return 'acrylic';
  if (combined.includes('wafer')) return 'wafer paper';
  if (combined.includes('edible')) return review ? 'design edible image' : 'edible print ready stock';
  if (combined.includes('topper') || combined.includes('printed')) return review ? 'design editing -topper' : 'ready stock';
  return review ? 'design editing -topper' : 'ready stock';
}

function links(baseUrl: string, order: any, componentId?: string) {
  const orderToken = encodeURIComponent(text(order.public_token));
  const component = componentId ? `&component=${encodeURIComponent(componentId)}` : '';
  const hash = componentId ? `#component-${encodeURIComponent(componentId)}` : '';
  const customerOrderPath = `/?order=${orderToken}${hash}`;
  const adminOrderPath = `/?admin=1&order=${orderToken}${component}`;
  const customerHistoryPath = `/?c=${encodeURIComponent(text(order.customer_token))}`;
  return {
    customer_order_path: customerOrderPath,
    admin_order_path: adminOrderPath,
    customer_history_path: customerHistoryPath,
    customer_order_link: baseUrl ? `${baseUrl}${customerOrderPath}` : null,
    admin_order_link: baseUrl ? `${baseUrl}${adminOrderPath}` : null,
    customer_history_link: baseUrl ? `${baseUrl}${customerHistoryPath}` : null,
  };
}

function componentDescription(baseUrl: string, order: any, component: any, item: any) {
  const snapshot = item.product_snapshot && typeof item.product_snapshot === 'object' ? item.product_snapshot : {};
  const componentLinks = links(baseUrl, order, text(component.id));
  const lines = [
    `Order: ${text(order.order_no || order.order_id)}`,
    `Customer: ${text(order.delivery_name)}`,
    `Phone: ${text(order.delivery_phone)}`,
    `Date Need: ${text(order.date_need)}`,
    `Delivery: ${text(order.delivery_method || order.delivery)}`,
    `Product: ${text(item.title || component.label)}`,
    text(snapshot.parent_sku) ? `Parent SKU: ${text(snapshot.parent_sku)}` : '',
    text(item.catalog_slug) ? `Catalog slug: ${text(item.catalog_slug)}` : '',
    text(item.catalog_clickup_task_id) ? `Source design task: ${text(item.catalog_clickup_task_id)}` : '',
    text(item.size) ? `Size: ${text(item.size)}` : '',
    text(item.style) ? `Style: ${text(item.style)}` : '',
    text(item.wording || item.custom_text) ? `Wording: ${text(item.wording || item.custom_text)}` : '',
    text(snapshot.image_url) ? `Design image: ${text(snapshot.image_url)}` : '',
    `Quantity: ${Number(item.qty || 1)}`,
    `Order item ID: ${text(component.order_item_id)}`,
    `Component ID: ${text(component.id)}`,
    componentLinks.admin_order_link ? `System Link: ${componentLinks.admin_order_link}` : `System Path: ${componentLinks.admin_order_path}`,
    componentLinks.customer_order_link ? `Customer Link: ${componentLinks.customer_order_link}` : `Customer Path: ${componentLinks.customer_order_path}`,
  ];
  return lines.filter(Boolean).join('\n');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  try {
    const settings = await integrationSettings();
    if (!await authorized(req, text(settings.clickup?.secret_sha256))) return json({ error: 'invalid_ap_secret' }, 401);
    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') || 1), 10));
    const { data: events, error: eventError } = await db.rpc('claim_clickup_production_outbox', { p_limit: limit });
    if (eventError) throw eventError;
    const results: unknown[] = [];

    for (const event of events || []) {
      const { data: order, error: orderError } = await db.from('orders').select('*').eq('id', event.order_id).single();
      if (orderError) {
        await db.from('integration_outbox').update({
          status: 'retry',
          last_error: orderError.message,
          next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
          locked_at: null,
        }).eq('id', event.id);
        continue;
      }

      const { data: components, error: componentError } = await db
        .from('production_components')
        .select('*,order_items(*)')
        .eq('order_id', event.order_id)
        .is('clickup_task_id', null)
        .order('created_at');
      if (componentError) throw componentError;

      if (!(components || []).length) {
        await db.from('integration_outbox').update({
          status: 'processed',
          processed_at: new Date().toISOString(),
          sent_at: new Date().toISOString(),
          locked_at: null,
          last_error: null,
          error: null,
        }).eq('id', event.id);
        continue;
      }

      const totalOrderComponents = await db
        .from('production_components')
        .select('id', { count: 'exact', head: true })
        .eq('order_id', event.order_id);
      const orderLinks = links(settings.baseUrl, order);

      results.push({
        event_id: event.id,
        event_type: event.event_type,
        order: {
          id: order.id,
          order_no: order.order_no || order.order_id,
          public_token: order.public_token,
          customer_token: order.customer_token,
          date_needed: order.date_need,
          payment_status: order.payment_status,
          customer_confirmed: order.customer_confirmed,
          customer_name: order.delivery_name,
          customer_phone: order.delivery_phone,
          delivery_method: order.delivery_method || order.delivery,
          delivery_address: order.delivery_address,
          delivery_city: order.delivery_city,
          delivery_postcode: order.delivery_postcode,
          delivery_state: order.delivery_state,
          total_components: totalOrderComponents.count || (components || []).length,
          ...orderLinks,
        },
        components: (components || []).map((component: any, index: number) => {
          const item = component.order_items || {};
          const wording = text(item.wording || item.custom_text);
          const orderNo = text(order.order_no || order.order_id);
          const taskTitle = `${orderNo} — ${Number(item.qty || 1)}x ${text(item.title || component.label || `Component ${index + 1}`)}${wording ? ` — ${wording}` : ''}`;
          const componentLinks = links(settings.baseUrl, order, text(component.id));
          return {
            id: component.id,
            order_item_id: component.order_item_id,
            title: component.label || item.title || `Component ${index + 1}`,
            task_name: taskTitle,
            task_description: componentDescription(settings.baseUrl, order, component, item),
            task_external_key: `icetak-component:${component.id}`,
            component_type: component.component_type,
            quantity: item.qty || 1,
            size: item.size || '',
            style: item.style || '',
            wording,
            wording_mode: item.wording_mode || '',
            catalog_slug: item.catalog_slug || '',
            catalog_clickup_task_id: item.catalog_clickup_task_id || '',
            product_id: item.product_id || null,
            product_snapshot: item.product_snapshot || {},
            customization: item.customization || {},
            review_required: Boolean(component.review_required ?? item.review_required),
            initial_clickup_status: initialStatus(component, item),
            awb_primary: index === 0,
            webapp_order_id: order.id,
            webapp_component_id: component.id,
            ...componentLinks,
          };
        }),
      });
    }

    return json({
      ok: true,
      mode: settings.clickup?.mode || 'observe',
      order_app_configured: Boolean(settings.baseUrl),
      count: results.length,
      events: results,
    });
  } catch (error) {
    console.error('clickup-production-outbox', error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
