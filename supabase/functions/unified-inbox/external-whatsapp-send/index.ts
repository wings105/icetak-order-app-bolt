import { createClient } from 'npm:@supabase/supabase-js@2.110.7';

type Json = Record<string, any>;
const H = { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST,OPTIONS', 'access-control-allow-headers': 'content-type,authorization,x-icetak-key,x-client-id' };
const out = (body: unknown, status = 200, extra: HeadersInit = {}) => new Response(JSON.stringify(body), { status, headers: { ...H, ...extra } });
const B = /^[A-Z]{2}\.(?:ENT\.)?[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/i;
const text = (v: unknown) => String(v ?? '').trim();
const bsuid = (v: unknown) => B.test(text(v)) ? text(v).toUpperCase() : '';
const phone = (v: unknown) => {
  const raw = text(v);
  if (!raw || B.test(raw)) return '';
  let d = raw.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = `60${d.slice(1)}`;
  else if (d.startsWith('1') && d.length >= 9 && d.length <= 10) d = `60${d}`;
  return /^[1-9]\d{7,14}$/.test(d) ? d : '';
};
const normalizeBase = (v: unknown) => {
  const fallback = 'https://officialapi.wasapflow.com/bridge/v1';
  const raw = text(v) || fallback;
  const match = raw.match(/https?:\/\/[^\s\"']+/i)?.[0] || fallback;
  try { return new URL(match).toString().replace(/\/$/, ''); } catch { return fallback; }
};
const publicImage = (v: unknown) => {
  const raw = text(v); if (!raw) return null;
  try {
    const u = new URL(raw); const h = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || h === 'localhost' || h.endsWith('.local') || h === '::1' || /^127\.|^10\.|^192\.168\.|^169\.254\.|^172\.(1[6-9]|2\d|3[01])\./.test(h)) return null;
    return u.toString();
  } catch { return null; }
};
async function sha(value: string) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join(''); }
async function auth(req: Request) {
  const client = text(req.headers.get('x-client-id')).toLowerCase();
  const token = text((req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.headers.get('x-icetak-key'));
  if (!client || !/^[a-z0-9][a-z0-9._-]{0,49}$/.test(client) || !token) return { ok: false, client, status: 401 };
  if (client === 'icetak-automation') {
    const db = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', { auth: { persistSession: false } });
    const q = await db.from('private_runtime_settings').select('setting_value').eq('setting_key','qrpay_ai_worker_token').maybeSingle();
    const expected = text(q.data?.setting_value);
    return { ok: !!expected && await sha(token) === await sha(expected), client, status: 401 };
  }
  const mapRaw = Deno.env.get('EXTERNAL_WHATSAPP_CLIENTS_JSON');
  let expected = text(Deno.env.get('EXTERNAL_WHATSAPP_WEBHOOK_SECRET'));
  if (mapRaw) { try { expected = text(JSON.parse(mapRaw)?.[client]); } catch { return { ok: false, client, status: 500 }; } }
  if (!expected) return { ok: false, client, status: 500 };
  return { ok: await sha(token) === await sha(expected), client, status: 401 };
}
async function providerJson(res: Response) { const raw = await res.text(); if (!raw) return {}; try { return JSON.parse(raw); } catch { return { raw }; } }
const providerId = (p: Json) => text(p.message_id ?? p.messageId ?? p.id) || null;
const providerError = (p: Json, status: number) => text(p?.error?.message ?? p.error ?? p.message ?? p?.data?.message) || `WasapFlow error ${status}`;
function templateList(p: any): Json[] { if (Array.isArray(p)) return p; for (const k of ['templates','data','items','results']) if (Array.isArray(p?.[k])) return p[k]; return []; }
function varCount(v: unknown) { if (typeof v !== 'string') return 0; const xs = [...v.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1])); return xs.length ? Math.max(...xs) : 0; }
function language(tpl: Json) { const v = tpl.language ?? tpl.language_code; if (typeof v === 'string') return v; return text(v?.code ?? v?.language_code ?? v?.locale) || 'ms'; }
function templateComponents(tpl: Json, values: string[]) {
  const schema = Array.isArray(tpl.components) ? tpl.components : [], components: Json[] = []; let cursor = 0;
  const body = schema.find((x: Json) => text(x.type).toUpperCase() === 'BODY'), n = varCount(body?.text);
  if (n) { const a = values.slice(cursor, cursor + n); if (a.length !== n || a.some(v => !v)) throw new Error(`Template body requires ${n} values.`); cursor += n; components.push({ type: 'body', parameters: a.map(v => ({ type: 'text', text: v })) }); }
  const buttons = schema.find((x: Json) => text(x.type).toUpperCase() === 'BUTTONS')?.buttons;
  if (Array.isArray(buttons)) buttons.forEach((b: Json, index: number) => { if (text(b.type).toUpperCase() !== 'URL') return; const count = varCount(b.url); if (!count) return; const a = values.slice(cursor, cursor + count); cursor += count; components.push({ type: 'button', sub_type: 'url', index: String(index), parameters: a.map(v => ({ type: 'text', text: v })) }); });
  if (cursor !== values.length) throw new Error(`Template requires ${cursor} values, received ${values.length}.`);
  return components;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: H });
  if (req.method !== 'POST') return out({ ok: false, error: 'POST required' }, 405);
  const a = await auth(req); if (!a.ok) return out({ ok: false, error: a.status === 500 ? 'External WhatsApp auth is not configured.' : 'Unauthorized.' }, a.status);
  const U = Deno.env.get('SUPABASE_URL'), K = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), partner = Deno.env.get('WF_PARTNER_KEY') ?? Deno.env.get('WASAPFLOW_PARTNER_KEY'), waba = Deno.env.get('WF_WABA_ID') ?? Deno.env.get('WASAPFLOW_WABA_ID');
  if (!U || !K || !partner || !waba) return out({ ok: false, error: 'Server secrets incomplete.' }, 500);
  const db = createClient(U, K, { auth: { persistSession: false } });
  const b = await req.json().catch(() => null) as Json | null; if (!b) return out({ ok: false, error: 'Valid JSON required.' }, 400);
  const requestId = text(b.request_id ?? b.idempotency_key); if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(requestId)) return out({ ok: false, error: 'Valid request_id required.' }, 400);
  const duplicate = await db.from('external_whatsapp_requests').select('id,status,provider_message_id,error_code,error_message,phone,recipient_bsuid,recipient_username,recipient_type,conversation_id,sent_at').eq('source', a.client).eq('request_id', requestId).maybeSingle();
  if (duplicate.data) return out({ ok: duplicate.data.status === 'sent', duplicate: true, source: a.client, request_id: requestId, ...duplicate.data }, duplicate.data.status === 'processing' ? 202 : 200);
  let p = phone(b.phone ?? b.to), id = bsuid(b.recipient_bsuid ?? b.bsuid ?? b.recipient), username = text(b.recipient_username ?? b.username), master = text(b.customer_master_id ?? b.order_system_master_customer_id), identity: Json | null = null;
  if (id) identity = (await db.from('customer_identities').select('customer_id,external_id,normalized_phone,username').eq('channel','whatsapp').eq('external_id',id).limit(1).maybeSingle()).data;
  if (!identity && p) identity = (await db.from('customer_identities').select('customer_id,external_id,normalized_phone,username').eq('channel','whatsapp').eq('normalized_phone',p).order('updated_at',{ascending:false}).limit(1).maybeSingle()).data;
  if (!identity && master) { const c = (await db.from('customers').select('id').eq('order_system_master_customer_id',master).limit(1).maybeSingle()).data; if (c?.id) identity = (await db.from('customer_identities').select('customer_id,external_id,normalized_phone,username').eq('channel','whatsapp').eq('customer_id',c.id).order('updated_at',{ascending:false}).limit(1).maybeSingle()).data; }
  if (identity) { p ||= phone(identity.normalized_phone); id ||= bsuid(identity.external_id); username ||= text(identity.username); }
  if (!p && !id) return out({ ok: false, error: 'No sendable WhatsApp phone or BSUID could be resolved.' }, 422);
  const recipientType = p ? 'phone' : 'bsuid', recipient = p ? { to: p } : { recipient: id };
  let conv: Json | null = null, windowOpen = false;
  if (identity?.customer_id) conv = (await db.from('conversations').select('id,order_id,last_inbound_at,last_customer_message_at,window_expires_at').eq('channel','whatsapp').eq('archived',false).eq('customer_id',identity.customer_id).order('last_message_at',{ascending:false,nullsFirst:false}).limit(1).maybeSingle()).data;
  if (conv) { const last = conv.last_customer_message_at ?? conv.last_inbound_at, expiry = conv.window_expires_at ?? (last ? new Date(new Date(last).getTime() + 86400000).toISOString() : null); windowOpen = Boolean(last && expiry && Date.now() < new Date(expiry).getTime()); }
  const typeRaw = text(b.type ?? b.message_type ?? 'auto').toLowerCase(), message = text(b.message ?? b.text ?? b.caption), image = publicImage(b.url_image ?? b.image_url ?? b.media_url), templateName = text(b.template_name ?? b.template?.name), values = Array.isArray(b.template_values ?? b.template?.values) ? (b.template_values ?? b.template?.values).map(text) : [], interactive = b.interactive && typeof b.interactive === 'object' ? b.interactive : null;
  const type = typeRaw === 'auto' ? (templateName ? 'template' : interactive ? 'interactive' : image ? 'image' : 'text') : typeRaw;
  if (!['text','image','template','interactive'].includes(type)) return out({ ok: false, error: 'type must be text, image, template, interactive, or auto.' }, 400);
  if (type === 'text' && !message) return out({ ok: false, error: 'message required.' }, 400);
  if (type === 'image' && !image) return out({ ok: false, error: 'A public HTTPS url_image is required.' }, 400);
  if (type === 'template' && !templateName) return out({ ok: false, error: 'template_name required.' }, 400);
  if (type === 'interactive' && !interactive) return out({ ok: false, error: 'interactive object required.' }, 400);
  if (b.dry_run === true) return out({ ok: true, dry_run: true, source: a.client, request_id: requestId, recipient_type: recipientType, phone: p || null, recipient: id || null, username: username || null, type, conversation_id: conv?.id ?? null, has_24h_window: windowOpen, can_send: type === 'template' || windowOpen });
  const row = await db.from('external_whatsapp_requests').insert({ source:a.client, request_id:requestId, phone:p||null, recipient_bsuid:id||null, recipient_username:username||null, recipient_type:recipientType, message_type:type, message_text:type==='interactive'?text(interactive?.body?.text):message||null, image_url:image, template_name:templateName||null, template_values:values, status:'processing', conversation_id:conv?.id??null, request_payload:b }).select('id').single();
  if (row.error) return out({ ok:false, error:'Failed to register outbound request.' }, 500);
  const fail = async (status:number, code:string, error:string, provider:Json={}) => { await db.from('external_whatsapp_requests').update({ status:code==='template_required'?'rejected':'failed', error_code:code, error_message:error, provider_response:provider, updated_at:new Date().toISOString() }).eq('id',row.data.id); return out({ ok:false, source:a.client, request_id:requestId, error_code:code, error }, status); };
  if (type !== 'template' && !windowOpen) return await fail(409,'template_required','The WhatsApp 24-hour customer service window is closed. Use an approved template.');
  const base = normalizeBase(Deno.env.get('WASAPFLOW_BASE_URL')), headers = { 'content-type':'application/json','x-partner-key':partner,'x-waba-id':waba }; let res:Response;
  if (type === 'text') res = await fetch(`${base}/messages/send`,{method:'POST',headers,body:JSON.stringify({...recipient,text:message,preview_url:false})});
  else if (type === 'image') res = await fetch(`${base}/messages/media`,{method:'POST',headers,body:JSON.stringify({...recipient,type:'image',media:{link:image,...(message?{caption:message}:{})}})});
  else if (type === 'interactive') res = await fetch(`${base}/messages/interactive`,{method:'POST',headers,body:JSON.stringify({...recipient,interactive})});
  else {
    const lr = await fetch(`${base}/templates`,{headers}), lp = await providerJson(lr); if (!lr.ok) return await fail(502,'template_lookup_failed',providerError(lp,lr.status),lp);
    const tpl = templateList(lp).find(x=>text(x.name)===templateName); if (!tpl) return await fail(404,'template_not_found',`Template ${templateName} was not found.`); if (text(tpl.status).toUpperCase()!=='APPROVED') return await fail(400,'template_not_approved',`Template ${templateName} is not APPROVED.`);
    const category = text(tpl.category).toUpperCase(); if (category==='AUTHENTICATION'&&!p) return await fail(400,'authentication_requires_phone','Authentication templates require a real phone number; BSUID is not accepted.');
    let components:Json[]; try { components=templateComponents(tpl,values); } catch(e) { return await fail(400,'template_values_invalid',e instanceof Error?e.message:String(e)); }
    res = await fetch(`${base}/messages/template`,{method:'POST',headers,body:JSON.stringify({...(category==='AUTHENTICATION'?{to:p}:recipient),template:{name:templateName,language:{code:language(tpl)},components}})});
  }
  const provider = await providerJson(res); if (!res.ok) return await fail(502,'provider_error',providerError(provider,res.status),provider);
  const pid = providerId(provider), now = new Date().toISOString(); await db.from('external_whatsapp_requests').update({status:'sent',provider_message_id:pid,provider_response:provider,sent_at:now,updated_at:now}).eq('id',row.data.id);
  let localMessageId:null|string=null;
  if (conv?.id) { const local=await db.from('messages').insert({conversation_id:conv.id,order_id:conv.order_id??null,channel:'whatsapp',provider_message_id:pid,direction:'outbound',sender_type:'system',source:`external_webhook:${a.client}`,recipient_phone:p||null,recipient_bsuid:id||null,message_type:type==='interactive'?'text':type,provider_message_type:type==='interactive'?'interactive':null,text_content:type==='template'?`[Template: ${templateName}]`:type==='interactive'?text(interactive?.body?.text):message||'[Image]',media_url:image,caption:type==='image'?message||null:null,status:'sent',sent_at:now,created_at:now,updated_at:now,raw_payload:{request_id:requestId,recipient_type:recipientType,provider}}).select('id').single(); localMessageId=local.data?.id??null; await db.from('conversations').update({last_message_at:now,last_outbound_at:now,last_message_sender:'seller',needs_reply:false,unread_count:0,updated_at:now}).eq('id',conv.id); }
  return out({ok:true,source:a.client,request_id:requestId,recipient_type:recipientType,phone:p||null,recipient:id||null,username:username||null,type,status:'sent',conversation_id:conv?.id??null,local_message_id:localMessageId,provider_message_id:pid});
});
