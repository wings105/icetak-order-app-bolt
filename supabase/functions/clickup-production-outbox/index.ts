import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const baseHeaders = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'content-type,x-ap-secret',
  'access-control-expose-headers': 'x-request-id',
  'cache-control': 'no-store',
};

const text = (value: unknown) => value == null ? '' : String(value).trim();
const trimSlash = (value: string) => value.replace(/\/+$/, '');
const BSUID_RE = /^[A-Z]{2}\.\d+$/i;
const digits = (value: unknown) => {
  const raw = text(value);
  if (!raw || BSUID_RE.test(raw)) return '';
  return raw.replace(/\D/g, '');
};
const whatsapp = (phone: unknown, username: unknown = '') => {
  const user = text(username).replace(/^@+/, '');
  if (user) return `https://wa.me/@${user}`;
  const number = digits(phone);
  return number ? `https://wa.me/${number}` : '';
};
const nowMs = () => Date.now();

function json(body: unknown, status = 200, requestId = '') {
  return new Response(JSON.stringify(body), {
    status,
    headers: requestId
      ? { ...baseHeaders, 'x-request-id': requestId }
      : baseHeaders,
  });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

type AuditInput = {
  function_name?: string;
  request_id: string;
  stage: string;
  event_id?: string | null;
  order_id?: string | null;
  status_code?: number | null;
  duration_ms?: number | null;
  has_ap_secret?: boolean | null;
  raw_secret_length?: number | null;
  trimmed_secret_length?: number | null;
  provided_secret_fingerprint?: string | null;
  cf_ray?: string | null;
  user_agent?: string | null;
  detail?: Record<string, unknown>;
};

async function audit(input: AuditInput) {
  try {
    const { error } = await db.from('clickup_outbox_http_events').insert({
      function_name: input.function_name || 'clickup-production-outbox',
      request_id: input.request_id,
      stage: input.stage,
      event_id: input.event_id || null,
      order_id: input.order_id || null,
      status_code: input.status_code ?? null,
      duration_ms: input.duration_ms ?? null,
      has_ap_secret: input.has_ap_secret ?? null,
      raw_secret_length: input.raw_secret_length ?? null,
      trimmed_secret_length: input.trimmed_secret_length ?? null,
      provided_secret_fingerprint: input.provided_secret_fingerprint || null,
      cf_ray: input.cf_ray || null,
      user_agent: input.user_agent || null,
      detail: input.detail || {},
    });
    if (error) console.error('clickup-production-outbox audit', error.message);
  } catch (error) {
    console.error('clickup-production-outbox audit', error);
  }
}

async function settings() {
  const [
    { data: clickup, error },
    { data: app },
    { data: manifest },
  ] = await Promise.all([
    db.from('clickup_integration_settings')
      .select('value')
      .eq('setting_key', 'black_box')
      .single(),
    db.from('system_settings')
      .select('value')
      .eq('key', 'order_app')
      .maybeSingle(),
    db.from('system_settings')
      .select('value')
      .eq('key', 'clickup_component_set_manifest')
      .maybeSingle(),
  ]);
  if (error) throw error;
  const rawBaseUrl = text(Deno.env.get('ORDER_APP_BASE_URL')) ||
    text(app?.value?.base_url);
  return {
    clickup: clickup?.value || {},
    baseUrl: rawBaseUrl ? trimSlash(rawBaseUrl) : '',
    manifest: manifest?.value || {},
  };
}

async function authState(req: Request, expectedHash: string) {
  const raw = req.headers.get('x-ap-secret') || '';
  const provided = raw.trim();
  const providedHash = provided ? await sha256(provided) : '';
  return {
    ok: Boolean(expectedHash) && Boolean(provided) &&
      providedHash === expectedHash,
    hasHeader: Boolean(raw),
    rawLength: raw.length,
    trimmedLength: provided.length,
    fingerprint: providedHash ? providedHash.slice(0, 12) : null,
  };
}

// Critical-path rule: ClickUp task creation must never wait on the external
// Unified Inbox resolver. We use only DB-cached identity here. Phone is enough
// for the task; BSUID/username can be enriched elsewhere.
async function cachedWhatsappIdentity(order: any) {
  let masterId = '';
  if (order?.customer_id) {
    const { data } = await db.from('customers')
      .select('customer_master_id,phone')
      .eq('id', order.customer_id)
      .maybeSingle();
    masterId = text(data?.customer_master_id);
    if (!order.delivery_phone && data?.phone) order.delivery_phone = data.phone;
  }

  let bsuid = '';
  let username = '';
  let lastPhone = '';
  if (masterId) {
    const { data } = await db.from('customer_identifiers_master')
      .select('identifier_value,metadata,last_seen_at')
      .eq('customer_master_id', masterId)
      .eq('identifier_type', 'whatsapp_bsuid')
      .eq('channel', 'whatsapp')
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    bsuid = BSUID_RE.test(text(data?.identifier_value))
      ? text(data?.identifier_value).toUpperCase()
      : '';
    username = text(data?.metadata?.current_username);
    lastPhone = text(data?.metadata?.last_phone_seen);
  }

  const phone = digits(order.delivery_phone) || digits(lastPhone);
  return {
    master_id: masterId || null,
    bsuid: bsuid || null,
    username: username || null,
    phone: phone || null,
    link: whatsapp(phone, username) || null,
  };
}

async function canonicalInitialStatus(component: any, item: any) {
  const customization = item?.customization &&
      typeof item.customization === 'object'
    ? item.customization
    : {};
  const { data, error } = await db.rpc('icetak_clickup_initial_status_v2', {
    p_component_type: text(component?.component_type) || null,
    p_label: text(component?.label) || null,
    p_product_type: text(item?.product_type || item?.k) || null,
    p_title: text(item?.title) || null,
    p_process: text(customization?.admin_process || item?.process) || null,
    p_review_required: Boolean(
      component?.review_required ?? item?.review_required,
    ),
    p_ai_job_type: text(customization?.ai_job_type) || null,
    p_style: text(item?.style) || null,
  });
  if (error) throw new Error(`canonical_clickup_status:${error.message}`);
  const status = text(data);
  if (!status) throw new Error('canonical_clickup_status_empty');
  return status;
}

function links(base: string, order: any, componentId?: string) {
  const token = encodeURIComponent(text(order.public_token));
  const component = componentId
    ? `&component=${encodeURIComponent(componentId)}`
    : '';
  const hash = componentId
    ? `#component-${encodeURIComponent(componentId)}`
    : '';
  const customer = `/?order=${token}${hash}`;
  const admin = `/?admin=v2&order=${token}${component}`;
  const history = `/?c=${encodeURIComponent(text(order.customer_token))}`;
  return {
    customer_order_path: customer,
    admin_order_path: admin,
    customer_history_path: history,
    customer_order_link: base ? `${base}${customer}` : null,
    admin_order_link: base ? `${base}${admin}` : null,
    customer_history_link: base ? `${base}${history}` : null,
  };
}

function aiMeta(item: any) {
  const customization = item.customization &&
      typeof item.customization === 'object'
    ? item.customization
    : {};
  return {
    job_type: text(customization.ai_job_type),
    pending: Boolean(customization.ai_pending_confirmation),
    conversation_id: text(customization.conversation_id),
    whatsapp_link: text(customization.whatsapp_link),
    match_score: customization.match_score ?? null,
    match_reason: customization.match_reason ?? [],
    reference_message_ids: Array.isArray(customization.reference_message_ids)
      ? customization.reference_message_ids
      : [],
    reference_media: Array.isArray(customization.reference_media)
      ? customization.reference_media
      : [],
  };
}

function itemProcess(item: any) {
  return text(item?.customization?.admin_process || item?.process) ||
    'Pre-order';
}

function itemReview(component: any, item: any) {
  return Boolean(component?.review_required ?? item?.review_required)
    ? 'Need Review'
    : 'No Review';
}

function itemReference(item: any) {
  return text(
    item?.customization?.reference_url ||
      item?.product_snapshot?.image_url ||
      item?.design_preview_url,
  );
}

function description(
  base: string,
  order: any,
  component: any,
  item: any,
  total: number,
  payment: any,
) {
  const snapshot = item.product_snapshot &&
      typeof item.product_snapshot === 'object'
    ? item.product_snapshot
    : {};
  const ai = aiMeta(item);
  const orderLinks = links(base, order, text(component.id));
  const set = Number(component.set_index || 0);
  const wa = ai.whatsapp_link || text(order.__whatsapp_link) ||
    whatsapp(order.delivery_phone);
  const process = itemProcess(item);
  const review = itemReview(component, item);
  const reference = itemReference(item);
  const lines = [
    `Order: ${text(order.order_no || order.order_id)}`,
    `Customer: ${text(order.delivery_name)}`,
    `Phone: ${text(order.delivery_phone)}`,
    wa ? `WhatsApp: ${wa}` : '',
    text(order.__whatsapp_username)
      ? `WhatsApp Username: @${text(order.__whatsapp_username)}`
      : '',
    text(order.__whatsapp_bsuid)
      ? `WhatsApp BSUID: ${text(order.__whatsapp_bsuid)}`
      : '',
    `Payment: RM${
      Number(payment?.amount ?? order.total ?? 0).toFixed(2)
    } | ${text(payment?.transaction_id || order.payment_transaction_id)} | ${
      text(payment?.paid_at || order.payment_verified_at)
    }`,
    `Payment Method: ${text(order.payment_method || payment?.provider)}`,
    `AI Review: ${
      ai.pending
        ? 'PENDING CONFIRMATION — confirm atau delete task'
        : 'Normal order'
    }`,
    ai.job_type ? `AI Job Type: ${ai.job_type}` : '',
    ai.match_score != null
      ? `AI Match: ${Math.round(Number(ai.match_score) * 100)}%`
      : '',
    ai.conversation_id ? `Conversation ID: ${ai.conversation_id}` : '',
    `Date Need: ${text(order.date_need) || 'Not provided'}`,
    `Delivery: ${text(order.delivery_method || order.delivery)}`,
    set
      ? `Order Component: set${set} of ${total}`
      : `Order Components: ${total}`,
    `Product: ${text(item.title || component.label)}`,
    `Process: ${process}`,
    `Review: ${review}`,
    text(snapshot.parent_sku)
      ? `Parent SKU: ${text(snapshot.parent_sku)}`
      : '',
    text(item.catalog_slug)
      ? `Catalog slug: ${text(item.catalog_slug)}`
      : '',
    text(item.catalog_clickup_task_id)
      ? `Source design task: ${text(item.catalog_clickup_task_id)}`
      : '',
    text(item.size) ? `Size: ${text(item.size)}` : '',
    text(item.style) ? `Style: ${text(item.style)}` : '',
    text(item.wording || item.custom_text)
      ? `Wording: ${text(item.wording || item.custom_text)}`
      : '',
    reference ? `Reference: ${reference}` : '',
    ai.reference_message_ids.length
      ? `Reference Message IDs: ${ai.reference_message_ids.join(', ')}`
      : '',
    `Quantity: ${Number(item.qty || 1)}`,
    `Order item ID: ${text(component.order_item_id)}`,
    `Component ID: ${text(component.id)}`,
    text(order.admin_remark)
      ? `Admin Remark:\n${text(order.admin_remark)}`
      : '',
    orderLinks.admin_order_link
      ? `System Link: ${orderLinks.admin_order_link}`
      : `System Path: ${orderLinks.admin_order_path}`,
    orderLinks.customer_order_link
      ? `Customer Link: ${orderLinks.customer_order_link}`
      : `Customer Path: ${orderLinks.customer_order_path}`,
  ];
  return lines.filter(Boolean).join('\n');
}

async function prepareEvent(candidate: any, settingsValue: any) {
  const started = nowMs();

  const [
    { data: order, error: orderError },
    { data: payment, error: paymentError },
  ] = await Promise.all([
    db.from('orders').select('*').eq('id', candidate.order_id).single(),
    db.from('payment_transactions')
      .select(
        'provider,transaction_id,amount,paid_at,sender_name,raw_payload',
      )
      .eq('order_id', candidate.order_id)
      .order('paid_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (orderError) throw new Error(`order_lookup:${orderError.message}`);
  if (paymentError) {
    console.error('clickup-production-outbox payment lookup', paymentError.message);
  }

  const identity = await cachedWhatsappIdentity(order);
  order.__whatsapp_link = identity.link;
  order.__whatsapp_username = identity.username;
  order.__whatsapp_bsuid = identity.bsuid;

  const { data: all, error: componentsError } = await db
    .from('production_components')
    .select('*,order_items(*)')
    .eq('order_id', candidate.order_id)
    .order('set_index', { ascending: true, nullsFirst: false })
    .order('created_at');

  if (componentsError) {
    throw new Error(`component_lookup:${componentsError.message}`);
  }

  const components = (all || []).filter((component: any) =>
    !text(component.clickup_task_id)
  );

  if (!components.length) {
    return {
      kind: 'already_processed' as const,
      prep_ms: nowMs() - started,
    };
  }

  const total = (all || []).length;
  const orderLinks = links(settingsValue.baseUrl, order);
  const wa = text(identity.link);
  const setField = text(settingsValue.manifest?.field_id);
  const mapped: any[] = [];

  for (
    let pendingIndex = 0;
    pendingIndex < components.length;
    pendingIndex++
  ) {
    const component = components[pendingIndex];
    const item = component.order_items || {};
    const word = text(item.wording || item.custom_text);
    const orderNo = text(order.order_no || order.order_id);
    const setIndex = Number(
      component.set_index ||
        ((all || []).findIndex((row: any) => row.id === component.id) + 1),
    );
    const setLabel = text(component.set_label) || `set${setIndex}`;
    const setOption = text(component.clickup_set_option_id) ||
      text(settingsValue.manifest?.options?.[String(setIndex)]);
    const componentLinks = links(
      settingsValue.baseUrl,
      order,
      text(component.id),
    );
    const ai = aiMeta(item);
    const customFields = setField && setOption
      ? [{ id: setField, value: [setOption] }]
      : [];
    const reviewRequired = Boolean(
      component.review_required ?? item.review_required,
    );
    const process = itemProcess(item);
    const reference = itemReference(item);
    const initialStatus = await canonicalInitialStatus(component, item);

    mapped.push({
      id: component.id,
      order_item_id: component.order_item_id,
      title: component.label || item.title || `Component ${pendingIndex + 1}`,
      task_name:
        `${orderNo} — ${setLabel}/${total} — ${Number(item.qty || 1)}x ${
          text(item.title || component.label || `Component ${pendingIndex + 1}`)
        }${word ? ` — ${word}` : ''}`,
      task_description: description(
        settingsValue.baseUrl,
        order,
        component,
        item,
        total,
        payment,
      ),
      task_external_key: `icetak-component:${component.id}`,
      component_type: component.component_type,
      quantity: item.qty || 1,
      size: item.size || '',
      style: item.style || '',
      wording: word,
      wording_mode: item.wording_mode || '',
      process,
      review: reviewRequired ? 'Need Review' : 'No Review',
      reference_url: reference || null,
      due_date: order.date_need || null,
      catalog_slug: item.catalog_slug || '',
      catalog_clickup_task_id: item.catalog_clickup_task_id || '',
      product_id: item.product_id || null,
      product_snapshot: item.product_snapshot || {},
      customization: item.customization || {},
      review_required: reviewRequired,
      ai_pending_confirmation: ai.pending,
      ai_job_type: ai.job_type,
      ai_match_score: ai.match_score,
      conversation_id: ai.conversation_id,
      whatsapp_link: ai.whatsapp_link || wa,
      whatsapplink: ai.whatsapp_link || wa,
      whatsapp_username: identity.username,
      whatsapp_bsuid: identity.bsuid,
      payment_transaction_id: payment?.transaction_id ||
        order.payment_transaction_id,
      payment_amount: payment?.amount ?? order.total,
      payment_paid_at: payment?.paid_at || order.payment_verified_at,
      reference_message_ids: ai.reference_message_ids,
      reference_media: ai.reference_media,
      initial_clickup_status: initialStatus,
      status_source: 'icetak_clickup_initial_status_v2',
      set_index: setIndex,
      set_label: setLabel,
      set_option_id: setOption || null,
      set_custom_field_id: setField || null,
      set_manifest_complete: Boolean(setField && setOption),
      custom_fields: customFields,
      awb_primary: setIndex === 1,
      webapp_order_id: order.id,
      webapp_component_id: component.id,
      ...componentLinks,
    });
  }

  return {
    kind: 'ready' as const,
    prep_ms: nowMs() - started,
    missing_count: components.length,
    result: {
      event_id: candidate.id,
      event_type: candidate.event_type,
      order: {
        id: order.id,
        order_no: order.order_no || order.order_id,
        public_token: order.public_token,
        customer_token: order.customer_token,
        date_needed: order.date_need,
        payment_status: order.payment_status,
        payment_method: order.payment_method,
        payment_transaction_id: payment?.transaction_id ||
          order.payment_transaction_id,
        payment_amount: payment?.amount ?? order.total,
        payment_paid_at: payment?.paid_at || order.payment_verified_at,
        customer_confirmed: order.customer_confirmed,
        customer_name: order.delivery_name,
        customer_phone: order.delivery_phone,
        whatsapp_link: wa,
        whatsapplink: wa,
        whatsapp_username: identity.username,
        whatsapp_bsuid: identity.bsuid,
        customer_master_id: identity.master_id,
        delivery_method: order.delivery_method || order.delivery,
        delivery_address: order.delivery_address,
        delivery_city: order.delivery_city,
        delivery_postcode: order.delivery_postcode,
        delivery_state: order.delivery_state,
        admin_status: order.admin_status,
        admin_remark: order.admin_remark,
        total_components: total,
        shipping_guard: {
          required_components: total,
          block_until_all_components_ready: total > 1,
          minimum_progress_stage: 6,
        },
        ...orderLinks,
      },
      components: mapped,
    },
  };
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const requestStarted = nowMs();

  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: { ...baseHeaders, 'x-request-id': requestId },
    });
  }
  if (req.method !== 'GET') {
    return json({ error: 'method_not_allowed', request_id: requestId }, 405, requestId);
  }

  try {
    const settingsValue = await settings();
    const auth = await authState(
      req,
      text(settingsValue.clickup?.secret_sha256),
    );

    if (!auth.ok) {
      await audit({
        request_id: requestId,
        stage: 'auth_failed',
        status_code: 401,
        duration_ms: nowMs() - requestStarted,
        has_ap_secret: auth.hasHeader,
        raw_secret_length: auth.rawLength,
        trimmed_secret_length: auth.trimmedLength,
        provided_secret_fingerprint: auth.fingerprint,
        cf_ray: text(req.headers.get('cf-ray')) || null,
        user_agent: text(req.headers.get('user-agent')) || null,
        detail: {
          verify_jwt: false,
          auth_contract: 'x-ap-secret-sha256',
        },
      });
      console.warn('clickup-production-outbox invalid_ap_secret', {
        request_id: requestId,
        has_header: auth.hasHeader,
        raw_length: auth.rawLength,
        trimmed_length: auth.trimmedLength,
        fingerprint: auth.fingerprint,
      });
      return json(
        { error: 'invalid_ap_secret', request_id: requestId },
        401,
        requestId,
      );
    }

    const url = new URL(req.url);
    const limit = Math.max(
      1,
      Math.min(Number(url.searchParams.get('limit') || 1), 10),
    );
    const scanLimit = Math.min(30, Math.max(limit, limit * 3));

    const { data: candidates, error: peekError } = await db.rpc(
      'peek_clickup_production_outbox',
      { p_limit: scanLimit },
    );
    if (peekError) throw new Error(`peek_outbox:${peekError.message}`);

    const results: any[] = [];

    for (const candidate of candidates || []) {
      if (results.length >= limit) break;

      try {
        const prepared = await prepareEvent(candidate, settingsValue);

        if (prepared.kind === 'already_processed') {
          await db.from('integration_outbox')
            .update({
              status: 'processed',
              processed_at: new Date().toISOString(),
              sent_at: new Date().toISOString(),
              locked_at: null,
              next_attempt_at: null,
              last_error: null,
              error: null,
            })
            .eq('id', candidate.id)
            .in('status', ['pending', 'retry']);
          continue;
        }

        await audit({
          request_id: requestId,
          stage: 'prepared_for_claim',
          event_id: candidate.id,
          order_id: candidate.order_id,
          status_code: 200,
          duration_ms: prepared.prep_ms,
          has_ap_secret: true,
          cf_ray: text(req.headers.get('cf-ray')) || null,
          user_agent: text(req.headers.get('user-agent')) || null,
          detail: {
            missing_components: prepared.missing_count,
            claim_strategy: 'prepare_then_claim_v3',
            whatsapp_identity_mode: 'cached_only',
          },
        });

        const { data: claimedRows, error: claimError } = await db.rpc(
          'claim_clickup_production_outbox_event',
          {
            p_event_id: candidate.id,
            p_expected_missing_count: prepared.missing_count,
            p_request_id: requestId,
          },
        );
        if (claimError) {
          throw new Error(`claim_outbox:${claimError.message}`);
        }

        const claimed = Array.isArray(claimedRows)
          ? claimedRows[0]
          : claimedRows;

        if (!claimed) {
          await audit({
            request_id: requestId,
            stage: 'claim_conflict',
            event_id: candidate.id,
            order_id: candidate.order_id,
            status_code: 200,
            duration_ms: nowMs() - requestStarted,
            has_ap_secret: true,
            cf_ray: text(req.headers.get('cf-ray')) || null,
            user_agent: text(req.headers.get('user-agent')) || null,
            detail: {
              expected_missing_components: prepared.missing_count,
            },
          });
          continue;
        }

        results.push(prepared.result);
      } catch (candidateError) {
        const message = candidateError instanceof Error
          ? candidateError.message
          : String(candidateError);

        // Preparation failed before claim, so leave the job unclaimed and
        // postpone it briefly rather than manufacturing a stale processing row.
        await db.from('integration_outbox')
          .update({
            status: 'retry',
            locked_at: null,
            next_attempt_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            last_error: `prepare_before_claim:${message}`.slice(0, 1000),
            error: null,
          })
          .eq('id', candidate.id)
          .in('status', ['pending', 'retry']);

        await audit({
          request_id: requestId,
          stage: 'prepare_failed',
          event_id: candidate.id,
          order_id: candidate.order_id,
          status_code: 500,
          duration_ms: nowMs() - requestStarted,
          has_ap_secret: true,
          cf_ray: text(req.headers.get('cf-ray')) || null,
          user_agent: text(req.headers.get('user-agent')) || null,
          detail: { error: message },
        });

        console.error('clickup-production-outbox candidate', {
          request_id: requestId,
          event_id: candidate.id,
          order_id: candidate.order_id,
          error: message,
        });
      }
    }

    return json({
      ok: true,
      mode: settingsValue.clickup?.mode || 'observe',
      order_app_configured: Boolean(settingsValue.baseUrl),
      status_contract: 'canonical-db-v2',
      count: results.length,
      events: results,
      request_id: requestId,
      claim_strategy: 'prepare_then_claim_v3',
      whatsapp_identity_mode: 'cached_only',
    }, 200, requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await audit({
      request_id: requestId,
      stage: 'request_failed',
      status_code: 500,
      duration_ms: nowMs() - requestStarted,
      cf_ray: text(req.headers.get('cf-ray')) || null,
      user_agent: text(req.headers.get('user-agent')) || null,
      detail: { error: message },
    });
    console.error('clickup-production-outbox', {
      request_id: requestId,
      error: message,
    });
    return json({ error: message, request_id: requestId }, 500, requestId);
  }
});
