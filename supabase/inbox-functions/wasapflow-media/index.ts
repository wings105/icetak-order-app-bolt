import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json' },
});

function extFor(mime: string) {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'application/pdf': 'pdf', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'video/mp4': 'mp4',
  };
  return map[mime.toLowerCase()] ?? 'bin';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function findWebhookMedia(admin: ReturnType<typeof createClient>, mediaId: string) {
  // The exact message retains its webhook payload even when newer messages exceed the old 100-event window.
  const { data: exact } = await admin.from('messages').select('raw_payload').eq('media_url', `wasapflow-media://${mediaId}`).order('created_at', { ascending: false }).limit(1).maybeSingle();
  const exactPayload = record(exact?.raw_payload);
  const exactMessage = record(record(record(exactPayload.data).raw).message);
  const exactType = String(exactMessage.type ?? '').toLowerCase();
  const exactMedia = record(exactMessage[exactType]);
  if (String(exactMedia.id ?? '') === mediaId && String(exactMedia.url ?? '')) return {
    url: String(exactMedia.url), mime: String(exactMedia.mime_type ?? 'application/octet-stream'),
    fileName: String(exactMedia.filename ?? exactMedia.file_name ?? ''), type: exactType,
  };
  const { data, error } = await admin.from('wasapflow_webhook_events')
    .select('payload')
    .eq('event_name', 'message.received')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;

  for (const row of data ?? []) {
    const payload = record(row.payload);
    const raw = record(record(payload.data).raw);
    const message = record(raw.message);
    const type = String(message.type ?? '').toLowerCase();
    if (!['image', 'sticker', 'document', 'audio', 'video'].includes(type)) continue;
    const media = record(message[type]);
    if (String(media.id ?? '') !== mediaId) continue;
    return {
      url: String(media.url ?? ''),
      mime: String(media.mime_type ?? 'application/octet-stream'),
      fileName: String(media.filename ?? media.file_name ?? ''),
      type,
    };
  }
  return null;
}

async function fetchProviderFallback(mediaId: string) {
  const partnerKey = Deno.env.get('WF_PARTNER_KEY') ?? Deno.env.get('WASAPFLOW_PARTNER_KEY');
  const wabaId = Deno.env.get('WF_WABA_ID') ?? Deno.env.get('WASAPFLOW_WABA_ID');
  const rawBase = Deno.env.get('WASAPFLOW_BASE_URL') ?? 'https://officialapi.wasapflow.com/bridge/v1';
  const match = rawBase.match(/https?:\/\/[^\s"']+/);
  const base = (match?.[0] ?? 'https://officialapi.wasapflow.com/bridge/v1').replace(/\/$/, '');
  if (!partnerKey || !wabaId) throw new Error('WasapFlow secrets incomplete.');
  const headers = { 'x-partner-key': partnerKey, 'x-waba-id': wabaId };

  const candidates = [
    `${base}/contacts/media/${encodeURIComponent(mediaId)}`,
    `${base}/media/${encodeURIComponent(mediaId)}`,
  ];
  for (const endpoint of candidates) {
    const response = await fetch(endpoint, { headers });
    if (!response.ok) continue;
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    if (contentType.includes('application/json')) {
      const meta = await response.json() as Record<string, unknown>;
      const url = String(meta.url ?? meta.link ?? '');
      if (!url) continue;
      const binary = await fetch(url, { headers });
      if (!binary.ok) continue;
      return {
        bytes: await binary.arrayBuffer(),
        mime: binary.headers.get('content-type') ?? String(meta.mime_type ?? 'application/octet-stream'),
        fileName: String(meta.file_name ?? ''),
      };
    }
    return { bytes: await response.arrayBuffer(), mime: contentType, fileName: '' };
  }
  throw new Error('Unable to download media from WasapFlow.');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'GET') return json({ error: 'GET required.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRole) return json({ error: 'Supabase secrets missing.' }, 500);

  const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
  const mediaId = new URL(request.url).searchParams.get('id');
  if (!mediaId) return json({ error: 'id is required.' }, 400);
  const bridge = request.headers.get('x-admin-window-token');
  if (bridge) {
    if (!/^\d{1,40}$/.test(mediaId)) return json({ error: 'Invalid media ID.' }, 400);
    const { data: settings, error } = await admin.from('private_runtime_settings').select('setting_value').eq('setting_key', 'admin_window_bridge_token').maybeSingle();
    if (error || !settings?.setting_value || bridge !== settings.setting_value) return json({ error: 'Invalid private bridge.' }, 401);
  } else {
    const authorization = request.headers.get('Authorization');
    if (!authorization) return json({ error: 'Authentication required.' }, 401);
    const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData.user) return json({ error: 'Invalid staff session.' }, 401);
  }

  try {
    const { data: cached } = await admin.from('message_media')
      .select('storage_path,mime_type,download_status')
      .eq('provider_media_id', mediaId)
      .eq('download_status', 'ready')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cached?.storage_path) {
      const { data, error } = await admin.storage.from('whatsapp-media').download(cached.storage_path);
      if (!error && data) {
        return new Response(await data.arrayBuffer(), {
          headers: { ...cors, 'Content-Type': cached.mime_type ?? data.type ?? 'application/octet-stream', 'Cache-Control': 'private, max-age=3600' },
        });
      }
    }

    let file: { bytes: ArrayBuffer; mime: string; fileName: string };
    const webhookMedia = await findWebhookMedia(admin, mediaId);
    if (webhookMedia?.url) {
      const direct = await fetch(webhookMedia.url);
      if (direct.ok) {
        file = {
          bytes: await direct.arrayBuffer(),
          mime: direct.headers.get('content-type') ?? webhookMedia.mime,
          fileName: webhookMedia.fileName,
        };
      } else {
        file = await fetchProviderFallback(mediaId);
      }
    } else {
      file = await fetchProviderFallback(mediaId);
    }

    const extension = extFor(file.mime);
    const safeName = (file.fileName || `${mediaId}.${extension}`).replace(/[^a-zA-Z0-9._-]/g, '_');
    const now = new Date();
    const storagePath = `incoming/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${mediaId}-${safeName}`;

    const { error: uploadError } = await admin.storage.from('whatsapp-media').upload(storagePath, file.bytes, {
      contentType: file.mime,
      upsert: true,
    });
    if (uploadError) throw uploadError;

    const { data: message } = await admin.from('messages')
      .select('id,message_type')
      .eq('media_url', `wasapflow-media://${mediaId}`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (message?.id) {
      const { data: existing } = await admin.from('message_media').select('id').eq('message_id', message.id).maybeSingle();
      const row = {
        message_id: message.id,
        provider_media_id: mediaId,
        media_type: message.message_type,
        mime_type: file.mime,
        file_name: safeName,
        file_size: file.bytes.byteLength,
        storage_path: storagePath,
        download_status: 'ready',
        download_error: null,
        updated_at: new Date().toISOString(),
      };
      if (existing?.id) await admin.from('message_media').update(row).eq('id', existing.id);
      else await admin.from('message_media').insert(row);
    }

    return new Response(file.bytes, {
      headers: { ...cors, 'Content-Type': file.mime, 'Cache-Control': 'private, max-age=3600' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Media download failed.';
    await admin.from('message_media').update({
      download_status: 'failed',
      download_error: message,
      updated_at: new Date().toISOString(),
    }).eq('provider_media_id', mediaId);
    return json({ error: message }, 502);
  }
});
