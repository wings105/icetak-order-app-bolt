import { actions, digest, https, inspectDesign, messages, readDesignRequest, roles, taskId, uuid, type Data } from '../_shared/inbox-clickup-contract.ts';
const out = (body: Data, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const attachmentDto = (a: Data) => a?.id && https(a.url) ? { id: String(a.id), url: https(a.url), name: String(a.title || a.name || '').slice(0, 180) } : null;
const sourceKind = (channel: string) => channel === 'shopee' ? 'shopee' : 'icetak';
export function clickUpBridgeHandler(deps: {
 secret: () => Promise<string>;
 db: (path: string, body?: Data, method?: string) => Promise<any>;
 fetcher?: typeof fetch;
 sync: (canonicalId: string, channel: string) => Promise<boolean>;
}) {
 const fetcher = deps.fetcher || fetch, db = deps.db;
 async function provider(token: string, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const multipart = body instanceof FormData;
  const r = await fetcher('https://api.clickup.com/api/v2/' + path, {
   method, headers: { authorization: token, ...(!multipart ? { 'content-type': 'application/json' } : {}) },
   ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(25000),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(Error(r.status < 500 ? 'PROVIDER_REJECTED' : 'UNKNOWN'), { rejected: r.status < 500 && method !== 'GET' });
  if (!data || data.err || data.error) throw Error('UNKNOWN'); return data;
 }
 const patch = (id: string, values: Data) => db(`inbox_clickup_actions?request_id=eq.${id}`, { ...values, updated_at: new Date().toISOString() }, 'PATCH');
 async function liveTask(token: string, id: string, active = true) {
  const t = await provider(token, 'task/' + encodeURIComponent(id));
  if (t.id !== id || active && (String(t.list?.id) !== '18375902' || t.archived)) throw Error('TASK_NOT_ACTIVE'); return t;
 }
 async function findComment(token: string, id: string, request: string) {
  const marker = `[iCetak Inbox:${request}]`;
  const data = await provider(token, 'task/' + encodeURIComponent(id) + '/comment');
  return (data.comments || []).find((c: Data) => String(c.comment_text || JSON.stringify(c.comment || [])).includes(marker));
 }
 async function project(task: Data, b: Data) {
  await db('rpc/icetak_project_clickup_work', { p_task: task, p_observed_at: new Date().toISOString() });
  let synced = false; try { synced = await deps.sync(b.canonical_id, b.source_channel); } catch { /* Existing durable work sync retries this independently. */ }
  return synced;
 }
 return async (req: Request) => {
  if (req.method !== 'POST') return out({ ok: false }, 405);
  let receipt: Data | null = null, step = 'claimed', dispatched = false, ownsClaim = false, attachment: Data | null = null;
  try {
   const supplied = req.headers.get('x-admin-window-token');
   if (!supplied || supplied !== await deps.secret()) return out({ ok: false }, 401);
   const { body: b, file } = await readDesignRequest(req);
   if (!b || !uuid(b.actor_id) || !roles.includes(b.actor_role) || !uuid(b.summary_id) || !uuid(b.canonical_id)
    || !['whatsapp', 'shopee'].includes(b.source_channel) || !actions.includes(b.action)
    || b.action !== 'list' && !taskId(b.task_id)) throw Error('INVALID_REQUEST');
   const canEdit = b.actor_role !== 'viewer';
   if (!['list', 'options'].includes(b.action) && !canEdit) throw Error('EDIT_REQUIRED');
   if (!['list', 'options'].includes(b.action) && !uuid(b.request_id)) throw Error('INVALID_REQUEST');
   const rows = await db(`ai_order_work_source?id=eq.${b.canonical_id}&kind=eq.${sourceKind(b.source_channel)}&select=id,reference,production_tasks&limit=1`);
   const source = rows[0]; if (!source) throw Error('ORDER_NOT_FOUND');
   const tasks = (source.production_tasks || []).filter((t: Data) => taskId(t.id)).map((t: Data) => ({ id: t.id, title: String(t.title || t.id).slice(0, 180), status: String(t.status || ''), url: https(t.url) }));
   const settings = await db('private_runtime_settings?setting_key=eq.clickup_designer_api_token&select=setting_value&limit=1');
   const token = settings[0]?.setting_value;
   if (b.action === 'list') {
    const history = await db(`inbox_clickup_actions?canonical_id=eq.${b.canonical_id}&summary_id=eq.${b.summary_id}&select=request_id,task_id,kind,state,result,created_at&order=created_at.desc&limit=5`);
    return out({ ok: true, configured: !!token, can_edit: canEdit && !!token, order_no: source.reference, tasks, history });
   }
   if (!tasks.some((t: Data) => t.id === b.task_id)) throw Error('INVALID_TASK');
   if (!token) throw Error('NOT_CONNECTED');
   if (b.action === 'options') {
    const [task, list] = await Promise.all([liveTask(token, b.task_id, false), provider(token, 'list/18375902')]);
    return out({ ok: true, configured: true, can_edit: canEdit && String(task.list?.id) === '18375902' && !task.archived, readonly_reason: String(task.list?.id) !== '18375902' || task.archived ? 'Task dipindahkan atau diarkibkan · paparan sahaja.' : undefined, task_id: task.id, status: task.status?.status, updated_at: String(task.date_updated),
     statuses: (list.statuses || []).map((s: Data) => ({ status: s.status, color: s.color })), attachments: (task.attachments || []).slice(-5).map(attachmentDto).filter(Boolean) });
   }
   const readReceipt = async () => {
    const rs = await db(`inbox_clickup_actions?request_id=eq.${b.request_id}&actor_id=eq.${b.actor_id}&summary_id=eq.${b.summary_id}&canonical_id=eq.${b.canonical_id}&task_id=eq.${encodeURIComponent(b.task_id)}&limit=1`);
    if (!rs[0]) throw Error('REQUEST_CONFLICT'); return rs[0];
   };
   if (b.action === 'receipt' || b.action === 'resume') {
    receipt = await readReceipt();
    if (receipt!.state === 'succeeded') return out({ ok: true, ...receipt!.result, request_id: receipt!.request_id, replayed: true });
    const task = await liveTask(token, b.task_id, false);
    if (receipt!.kind === 'status') {
     if (task.status?.status !== receipt!.payload.status) throw Error('UNKNOWN');
     const synced = await project(task, b), result = { task_id: task.id, status: task.status.status, verified: true, synced };
     await patch(receipt!.request_id, { state: 'succeeded', step: 'verified', result }); return out({ ok: true, ...result, request_id: receipt!.request_id });
    }
    attachment = receipt!.result?.attachment || null;
    if (receipt!.payload.file) {
     // Request-specific filename reconciles an upload whose response was lost.
     const filename = `icetak-${receipt!.request_id}-${receipt!.payload.file.name}`;
     const found = (task.attachments || []).find((a: Data) => String(a.title || a.name) === filename);
     if (!found || attachment && String(found.id) !== attachment.id) throw Error('UNKNOWN');
     attachment = attachmentDto(found); if (!attachment) throw Error('UNKNOWN');
    }
    const found = await findComment(token, b.task_id, receipt!.request_id);
    if (found) {
     const result = { task_id: b.task_id, attachment, comment_id: String(found.id), verified: true };
     await patch(receipt!.request_id, { state: 'succeeded', step: 'verified', result }); return out({ ok: true, ...result, request_id: receipt!.request_id });
    }
    const canResume = !!attachment && ['attachment', 'attachment_saved', 'comment_rejected'].includes(receipt!.step)
     && (receipt!.state !== 'processing' || Date.now() - Date.parse(receipt!.updated_at) > 120000);
    if (b.action === 'receipt') {
     if (canResume) await patch(receipt!.request_id, { state: 'unknown', step: 'attachment_saved', result: { attachment } });
     return out({ ok: false, uncertain: true, can_resume: canResume, request_id: receipt!.request_id, error: canResume ? 'Gambar sudah di ClickUp. Tekan Sambung komen untuk lengkapkan nota.' : messages.UNKNOWN, attachment }, 409);
    }
    if (!canResume) throw Error('UNKNOWN');
    const claimed = await db('rpc/icetak_resume_inbox_clickup_comment', { p_request: b.request_id, p_actor: b.actor_id });
    if (!claimed) throw Error('TASK_BUSY');
    ownsClaim = true;
    step = 'comment';
   } else {
    if (file && b.action !== 'upload') throw Error('INVALID_REQUEST');
    if (b.action === 'upload' && (typeof b.comment !== 'string' || b.comment.length > 3000 || !file && !b.comment.trim())) throw Error('INVALID_REQUEST');
    if (b.action === 'status' && (typeof b.status !== 'string' || b.status.length > 100 || typeof b.expected_status !== 'string' || typeof b.expected_updated_at !== 'string')) throw Error('INVALID_REQUEST');
    const info = file ? await inspectDesign(file) : null;
    const payload = b.action === 'status' ? { status: b.status, expected_status: b.expected_status, expected_updated_at: b.expected_updated_at }
     : { file: info, comment: b.comment.trim(), actor_label: String(b.actor_label || 'Staf Inbox').slice(0, 100) };
    const fingerprint = await digest(JSON.stringify({ canonical_id: b.canonical_id, kind: b.action, ...payload, ...(b.action === 'upload' ? { actor_label: undefined } : {}) }));
    const claim = await db('rpc/icetak_claim_inbox_clickup_action', { p_request: b.request_id, p_task: b.task_id, p_actor: b.actor_id, p_summary: b.summary_id, p_canonical: b.canonical_id, p_channel: b.source_channel, p_kind: b.action, p_fingerprint: fingerprint, p_payload: payload });
    receipt = claim.receipt;
    if (!claim.claimed) {
     if (receipt!.state === 'succeeded') return out({ ok: true, ...receipt!.result, request_id: receipt!.request_id, replayed: true });
     throw Error('UNKNOWN');
    }
    ownsClaim = true;
    const task = await liveTask(token, b.task_id);
    if (b.action === 'status') {
     const list = await provider(token, 'list/18375902');
     if (!(list.statuses || []).some((s: Data) => s.status === b.status)) throw Error('INVALID_REQUEST');
     if (task.status?.status !== b.expected_status || String(task.date_updated) !== b.expected_updated_at) throw Error('TASK_CHANGED');
     step = 'status'; await patch(receipt!.request_id, { step }); dispatched = true;
     await provider(token, 'task/' + encodeURIComponent(b.task_id), { status: b.status }, 'PUT');
     const fresh = await liveTask(token, b.task_id, false); if (fresh.status?.status !== b.status) throw Error('UNKNOWN');
     const synced = await project(fresh, b), result = { task_id: b.task_id, status: fresh.status.status, updated_at: String(fresh.date_updated), verified: true, synced };
     await patch(receipt!.request_id, { state: 'succeeded', step: 'verified', result }); return out({ ok: true, ...result, request_id: receipt!.request_id });
    }
    if (file) {
     const form = new FormData(); form.set('attachment', file, `icetak-${receipt!.request_id}-${info!.name}`);
     step = 'attachment'; await patch(receipt!.request_id, { step }); dispatched = true;
     const uploaded = await provider(token, 'task/' + encodeURIComponent(b.task_id) + '/attachment', form);
     attachment = attachmentDto(uploaded); if (!attachment) throw Error('UNKNOWN');
     step = 'attachment_saved'; await patch(receipt!.request_id, { step, result: { attachment } });
     const fresh = await liveTask(token, b.task_id, false);
     if (!(fresh.attachments || []).some((a: Data) => String(a.id) === attachment!.id)) throw Error('UNKNOWN');
    }
   }
   const note = [receipt!.payload.comment, attachment ? 'Fail design: ' + attachment.url : '', 'Oleh: ' + receipt!.payload.actor_label, `[iCetak Inbox:${receipt!.request_id}]`].filter(Boolean).join('\n\n');
   step = 'comment'; await patch(receipt!.request_id, { step }); dispatched = true;
   const comment = await provider(token, 'task/' + encodeURIComponent(b.task_id) + '/comment', { comment_text: note, notify_all: false });
   if (!comment.id) throw Error('UNKNOWN');
   const confirmed = await findComment(token, b.task_id, receipt!.request_id); if (!confirmed || String(confirmed.id) !== String(comment.id)) throw Error('UNKNOWN');
   const result = { task_id: b.task_id, attachment, comment_id: String(comment.id), verified: true };
   await patch(receipt!.request_id, { state: 'succeeded', step: 'verified', result });
   return out({ ok: true, ...result, request_id: receipt!.request_id });
  } catch (e) {
   const code = e instanceof Error ? e.message : 'UNKNOWN', rejected = !!(e as { rejected?: boolean })?.rejected;
   const uncertain = Boolean(receipt && !ownsClaim) || dispatched && !rejected || code === 'UNKNOWN';
   if (receipt && ownsClaim && dispatched) {
    const savedStep = rejected ? `${step}_rejected` : step;
    await patch(receipt.request_id, { state: uncertain ? 'unknown' : 'failed', step: savedStep, ...(attachment ? { result: { attachment } } : {}) }).catch(() => {});
   } else if (receipt && ownsClaim && step === 'claimed' && code !== 'UNKNOWN') await patch(receipt.request_id, { state: 'failed', step }).catch(() => {});
   return out({ ok: false, error: messages[code] || messages.BRIDGE_UNAVAILABLE, ...(receipt ? { request_id: receipt.request_id, uncertain, can_resume: !!attachment && rejected && step === 'comment' } : {}) }, /EDIT/.test(code) ? 403 : /INVALID|LARGE/.test(code) ? 400 : /CHANGED|BUSY|CONFLICT|UNKNOWN/.test(code) ? 409 : 503);
  }
 };
}
