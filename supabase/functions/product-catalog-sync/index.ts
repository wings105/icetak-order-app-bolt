import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-ap-secret',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'content-type': 'application/json; charset=utf-8' },
});
const text = (value: unknown) => value == null ? '' : String(value).trim();
const normalize = (value: string) => value
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();
const slugify = (value: string) => normalize(value).replace(/\s+/g, '-').replace(/^-+|-+$/g, '').slice(0, 150);
const aliasText = (value: string) => value.replace(/spider[-\s]?man/gi, 'spiderman spider man spider-man');

function field(task: Record<string, unknown>, name: string) {
  const fields = Array.isArray(task.custom_fields) ? task.custom_fields as Array<Record<string, unknown>> : [];
  return fields.find((item) => text(item.name).toLowerCase() === name.toLowerCase());
}
function fieldValue(item?: Record<string, unknown>) {
  if (!item || item.value == null) return '';
  const config = item.type_config && typeof item.type_config === 'object' ? item.type_config as Record<string, unknown> : {};
  const options = Array.isArray(config.options) ? config.options as Array<Record<string, unknown>> : [];
  const match = options.find((option) => text(option.id) === text(item.value) || Number(option.orderindex) === Number(item.value));
  return text(match?.name || item.value);
}
function shortTitle(title: string, category: string) {
  let value = title
    .replace(/\[(?:CUSTOM NAME|CUSTOM GAMBAR|CUSTOM NAME\]\[CUSTOM GAMBAR)[^\]]*\]/gi, ' ')
    .replace(/\bREADY STOCK\b/gi, ' ')
    .replace(/\bHappy Birthday Cake Topper\b/gi, ' ')
    .replace(/\bDecoration Set Party Accessories(?: Banner)? Hiasan Kek(?: Design)?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value) value = title;
  if (/custom name/i.test(category) && !/custom name/i.test(value)) value += ' Custom Name';
  if (!/topper|edible|wafer|acrylic/i.test(value)) value += ' Cake Topper';
  return value.slice(0, 100);
}
function isoDate(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const date = /^\d+$/.test(raw) ? new Date(Number(raw)) : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  try {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const url = Deno.env.get('SUPABASE_URL') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!url || !serviceKey) return json({ error: 'Supabase environment is missing' }, 500);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const providedSecret = request.headers.get('x-ap-secret') || '';
    const { data: settings, error: settingsError } = await admin
      .from('clickup_integration_settings')
      .select('value')
      .eq('setting_key', 'black_box')
      .maybeSingle();
    if (settingsError) throw settingsError;
    const config = (settings?.value || {}) as Record<string, unknown>;
    const expectedHash = text(config.secret_sha256);
    if (!providedSecret || !expectedHash || await sha256(providedSecret) !== expectedHash) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
    const tasks = Array.isArray(payload.tasks) ? payload.tasks as Array<Record<string, unknown>> : [];
    if (!tasks.length) return json({ error: 'tasks array is required' }, 400);
    if (tasks.length > 200) return json({ error: 'Maximum 200 tasks per batch' }, 413);

    const allowedIds = Array.isArray(config.allowed_list_ids) ? config.allowed_list_ids.map(text) : [];
    const targetListId = text(payload.list_id || '901604488980');
    if (allowedIds.length && !allowedIds.includes(targetListId) && targetListId !== '901604488980') {
      return json({ error: 'List is not allowed' }, 403);
    }

    const categoryNames = new Set<string>();
    for (const task of tasks) {
      const category = fieldValue(field(task, 'categories ')) || fieldValue(field(task, 'categories')) || 'Other';
      categoryNames.add(category);
    }
    const categoryRows = Array.from(categoryNames).map((name) => ({ name, slug: slugify(name) || 'other', active: true, updated_at: new Date().toISOString() }));
    const { data: categories, error: categoryError } = await admin
      .from('product_categories')
      .upsert(categoryRows, { onConflict: 'slug' })
      .select('id,slug');
    if (categoryError) throw categoryError;
    const categoryMap = new Map((categories || []).map((item) => [item.slug, item.id]));

    const now = new Date().toISOString();
    const rows = tasks.map((task) => {
      const taskId = text(task.id);
      if (!taskId) throw new Error('ClickUp task id is required');
      const taskList = task.list && typeof task.list === 'object' ? task.list as Record<string, unknown> : {};
      const taskListId = text(taskList.id || targetListId);
      if (taskListId && taskListId !== targetListId) throw new Error(`Task ${taskId} belongs to another list`);

      const sourceTitle = text(field(task, 'title product')?.value || task.name);
      const category = fieldValue(field(task, 'categories ')) || fieldValue(field(task, 'categories')) || 'Other';
      const productStatus = fieldValue(field(task, 'status product'));
      const active = !Boolean(task.archived) && (!productStatus || /normal|active|open/i.test(productStatus));
      const parentSku = text(field(task, 'Parent SKU')?.value);
      const shopeeProductId = text(field(task, 'Product ID')?.value);
      const coverImage = text(field(task, 'Cover image')?.value);
      const productLink = text(field(task, 'link product')?.value) || (shopeeProductId ? `https://shopee.com.my/product/188218638/${shopeeProductId}/` : '');
      const attachments = Array.isArray(task.attachments) ? task.attachments as Array<Record<string, unknown>> : [];
      const attachment = attachments.find((item) => text(item.mimetype).startsWith('image/'));
      const imageUrl = text(attachment?.url || attachment?.thumbnail_large || coverImage);
      const displayName = shortTitle(sourceTitle, category);
      const categorySlug = slugify(category) || 'other';
      const searchText = normalize(aliasText([sourceTitle, displayName, parentSku, shopeeProductId, category].join(' ')));

      return {
        slug: slugify(`${displayName}-${parentSku || taskId}`),
        product_kind: /ready stock/i.test(category) ? 'ready_stock' : 'catalog_design',
        source: 'clickup',
        source_record_id: taskId,
        clickup_task_id: taskId,
        shopee_product_id: shopeeProductId || null,
        parent_sku: parentSku || null,
        name: sourceTitle,
        display_name: displayName,
        source_title: sourceTitle,
        description: text(task.description || task.text_content) || null,
        category_id: categoryMap.get(categorySlug) || null,
        status: active ? 'active' : 'inactive',
        main_image_url: imageUrl || null,
        shopee_url: productLink || null,
        has_dimension: Boolean(field(task, 'ada demention')?.value),
        is_basic: false,
        is_published: active,
        is_indexable: active,
        search_text: searchText,
        metadata: {
          clickup_url: text(task.url),
          clickup_list_id: taskListId,
          clickup_status: text((task.status as Record<string, unknown> | undefined)?.status || task.status),
          product_status: productStatus,
          imported_by: 'activepieces',
        },
        source_updated_at: isoDate(task.date_updated),
        updated_at: now,
      };
    });

    const { data: batch, error: batchError } = await admin
      .from('product_import_batches')
      .insert({ source: 'clickup', status: 'processing', row_count: rows.length, summary: { list_id: targetListId } })
      .select('id')
      .single();
    if (batchError) throw batchError;

    const { data: products, error: productError } = await admin
      .from('products')
      .upsert(rows, { onConflict: 'clickup_task_id' })
      .select('id,clickup_task_id,slug');
    if (productError) {
      await admin.from('product_import_batches').update({ status: 'failed', error_count: rows.length, summary: { error: productError.message } }).eq('id', batch.id);
      throw productError;
    }

    await admin.from('product_import_batches').update({
      status: 'completed',
      inserted_count: products?.length || 0,
      completed_at: new Date().toISOString(),
      summary: { list_id: targetListId, upserted: products?.length || 0 },
    }).eq('id', batch.id);

    return json({ ok: true, source: 'clickup', list_id: targetListId, received: tasks.length, upserted: products?.length || 0, batch_id: batch.id });
  } catch (error) {
    console.error('product-catalog-sync error', error);
    return json({ error: error instanceof Error ? error.message : 'Server error' }, 500);
  }
});
