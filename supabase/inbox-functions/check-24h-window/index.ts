import { createClient } from 'npm:@supabase/supabase-js@2.110.7';

type Json = Record<string, unknown>;

const headers = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization,apikey',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const BSUID = /^[A-Z]{2}\.\d+$/i;
const text = (value: unknown) => String(value ?? '').trim();
const bsuidOf = (value: unknown) => BSUID.test(text(value)) ? text(value).toUpperCase() : '';
const phoneOf = (value: unknown) => {
  const raw = text(value);
  if (!raw || BSUID.test(raw)) return '';
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `60${digits.slice(1)}`;
  else if (digits.startsWith('1') && digits.length >= 9 && digits.length <= 10) digits = `60${digits}`;
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : '';
};
const whatsappLink = (phone: string, username: string) => username
  ? `https://wa.me/@${username.replace(/^@+/, '')}`
  : phone ? `https://wa.me/${phone}` : null;
const timestamp = (value: unknown) => {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};
const latestCustomerAt = (conversation: Json) => Math.max(
  timestamp(conversation.last_customer_message_at),
  timestamp(conversation.last_inbound_at),
);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (!['GET', 'POST'].includes(request.method)) return json({ ok: false, error: 'GET or POST required' }, 405);

  try {
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
    const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Json : {};

    let phone = phoneOf(input.phone ?? input.number ?? input.to ?? url.searchParams.get('phone') ?? url.searchParams.get('number') ?? url.searchParams.get('to'));
    let bsuid = bsuidOf(input.bsuid ?? input.recipient_bsuid ?? input.recipient ?? url.searchParams.get('bsuid') ?? url.searchParams.get('recipient'));
    const master = text(input.customer_master_id ?? input.order_system_master_customer_id ?? url.searchParams.get('customer_master_id'));
    const conversationId = text(input.conversation_id ?? url.searchParams.get('conversation_id'));
    if (!phone && !bsuid && !master && !conversationId) {
      return json({ ok: false, error: 'phone, bsuid/recipient, customer_master_id, or conversation_id required' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: 'Supabase env missing' }, 500);

    const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    let identities: Json[] = [];
    let customerIds: string[] = [];

    if (conversationId) {
      const query = await db.from('conversations')
        .select('id,customer_id,external_customer_id')
        .eq('id', conversationId)
        .eq('channel', 'whatsapp')
        .maybeSingle();
      if (query.error) throw query.error;
      if (query.data?.customer_id) customerIds = [String(query.data.customer_id)];
      if (!bsuid) bsuid = bsuidOf(query.data?.external_customer_id);
      if (!phone) phone = phoneOf(query.data?.external_customer_id);
    }

    if (!customerIds.length && bsuid) {
      const query = await db.from('customer_identities')
        .select('customer_id,external_id,normalized_phone,username,updated_at')
        .eq('channel', 'whatsapp')
        .eq('external_id', bsuid)
        .limit(10);
      if (query.error) throw query.error;
      identities = query.data || [];
    }

    if (!customerIds.length && !identities.length && phone) {
      const query = await db.from('customer_identities')
        .select('customer_id,external_id,normalized_phone,username,updated_at')
        .eq('channel', 'whatsapp')
        .eq('normalized_phone', phone)
        .order('updated_at', { ascending: false })
        .limit(10);
      if (query.error) throw query.error;
      identities = query.data || [];
    }

    if (!customerIds.length && identities.length) {
      customerIds = [...new Set(identities.map((identity) => text(identity.customer_id)).filter(Boolean))];
    }

    if (!customerIds.length && master) {
      const query = await db.from('customers')
        .select('id')
        .eq('order_system_master_customer_id', master)
        .limit(10);
      if (query.error) throw query.error;
      customerIds = (query.data || []).map((customer) => text(customer.id)).filter(Boolean);
    }

    if (customerIds.length && !identities.length) {
      const query = await db.from('customer_identities')
        .select('customer_id,external_id,normalized_phone,username,updated_at')
        .eq('channel', 'whatsapp')
        .in('customer_id', customerIds)
        .order('updated_at', { ascending: false })
        .limit(10);
      if (query.error) throw query.error;
      identities = query.data || [];
    }

    if (!customerIds.length) {
      return json({
        ok: true,
        found: false,
        conversation_id: conversationId || null,
        phone: phone || null,
        bsuid: bsuid || null,
        customer_master_id: master || null,
        has_24h_window: false,
        can_send_freeform: false,
        should_use_template: true,
        reason: 'customer_not_found',
      });
    }

    const customerQuery = await db.from('customers')
      .select('id,order_system_master_customer_id')
      .in('id', customerIds)
      .limit(10);
    if (customerQuery.error) throw customerQuery.error;
    const masterResolved = text(customerQuery.data?.find((customer) => customer.order_system_master_customer_id)?.order_system_master_customer_id) || master;
    const preferredIdentity = identities.find((identity) => BSUID.test(text(identity.external_id))) || identities[0] || {};
    bsuid = bsuidOf(preferredIdentity.external_id) || bsuid;
    phone = phoneOf(preferredIdentity.normalized_phone) || phone;
    const username = text(preferredIdentity.username);

    let conversations: Json[] = [];
    if (conversationId) {
      const query = await db.from('conversations')
        .select('id,customer_id,last_inbound_at,last_customer_message_at,window_expires_at,window_status,needs_reply')
        .eq('id', conversationId)
        .eq('channel', 'whatsapp')
        .maybeSingle();
      if (query.error) throw query.error;
      if (query.data) conversations = [query.data];
    } else {
      const query = await db.from('conversations')
        .select('id,customer_id,last_inbound_at,last_customer_message_at,window_expires_at,window_status,needs_reply')
        .eq('channel', 'whatsapp')
        .eq('archived', false)
        .in('customer_id', customerIds)
        .limit(100);
      if (query.error) throw query.error;
      conversations = query.data || [];
    }

    if (!conversations.length) {
      return json({
        ok: true,
        found: true,
        conversation_id: conversationId || null,
        customer_id: customerIds[0] || null,
        customer_master_id: masterResolved || null,
        phone: phone || null,
        bsuid: bsuid || null,
        username: username || null,
        whatsapp_link: whatsappLink(phone, username),
        has_24h_window: false,
        can_send_freeform: false,
        should_use_template: true,
        reason: 'conversation_not_found',
      });
    }

    const conversation = conversations.reduce((latest, candidate) => (
      latestCustomerAt(candidate) > latestCustomerAt(latest) ? candidate : latest
    ));
    const lastCustomerMs = latestCustomerAt(conversation);
    const hasCustomerMessage = Number.isFinite(lastCustomerMs) && lastCustomerMs > Number.NEGATIVE_INFINITY;
    const lastCustomerMessageAt = hasCustomerMessage ? new Date(lastCustomerMs).toISOString() : null;
    const expiresMs = hasCustomerMessage ? lastCustomerMs + 86_400_000 : Number.NEGATIVE_INFINITY;
    const windowExpiresAt = hasCustomerMessage ? new Date(expiresMs).toISOString() : null;
    const open = hasCustomerMessage && expiresMs > Date.now();

    return json({
      ok: true,
      found: true,
      conversation_id: conversation.id,
      customer_id: conversation.customer_id,
      customer_master_id: masterResolved || null,
      phone: phone || null,
      bsuid: bsuid || null,
      username: username || null,
      whatsapp_link: whatsappLink(phone, username),
      has_24h_window: open,
      can_send_freeform: open,
      should_use_template: !open,
      window_status: open ? 'open' : 'expired',
      db_window_status: conversation.window_status,
      last_customer_message_at: lastCustomerMessageAt,
      last_inbound_at: conversation.last_inbound_at || null,
      window_expires_at: windowExpiresAt,
      stored_window_expires_at: conversation.window_expires_at || null,
      remaining_seconds: Math.max(0, Math.floor((expiresMs - Date.now()) / 1000)),
      needs_reply: conversation.needs_reply,
      decision_source: 'greatest(last_customer_message_at,last_inbound_at)',
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
