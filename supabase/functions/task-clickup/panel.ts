type Data = Record<string, any>;
export const REVIEW_FIELD = '01cec4ef-a30b-443d-a43a-9ab09835b78c';
export function reviewField(task: Data) {
 const field = (task.custom_fields || []).find((f: Data) => f.id === REVIEW_FIELD);
 const options = (field?.type_config?.options || []).map((o: Data) => ({id: String(o.id), name: String(o.name || ''), color: String(o.color || '#777'), orderindex: o.orderindex})).sort((a:Data,b:Data)=>Number(a.orderindex||0)-Number(b.orderindex||0));
 const raw = field?.value && typeof field.value === 'object' ? field.value.id : field?.value;
 const value = raw === undefined || raw === null || raw === '' ? null : options.find((o: Data) => o.id === String(raw) || String(o.orderindex) === String(raw))?.id || null;
 return {id: REVIEW_FIELD, available: !!field, value, options};
}
export function panelFields(task: Data) {
 const fields = task.custom_fields || [];
 const field = (name: string) => fields.find((f: Data) => String(f.name).toLowerCase().trim() === name);
 const text = (name: string) => {const v = field(name)?.value; return typeof v === 'string' || typeof v === 'number' ? String(v) : '';};
 const labels = (name: string) => {const f = field(name); return (Array.isArray(f?.value) ? f.value : []).map((v: any) => typeof v === 'object' ? v.label || v.name || '' : (f.type_config?.options || []).find((o: Data) => o.id === v)?.label || (f.type_config?.options || []).find((o: Data) => o.id === v)?.name || '').filter(Boolean);};
 return {title: String(task.name || ''), order_reference: text('order id / customer name'), phone: text('phone'), username: text('whatsapp@username'), sku: text('sku'), wording: text('customize name'), products: labels('job'), sets: labels('set'), due_date: task.due_date ? String(task.due_date) : null, due_date_time: task.due_date_time !== false};
}
export function clickUpAssetUrl(value: unknown) {
 try {const u = new URL(String(value || '')); return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && (u.hostname === 'attachments.clickup.com' || u.hostname.endsWith('.clickup-attachments.com')) ? u.href : '';} catch {return '';}
}
export function taskAttachments(task: Data, comments: Data[] = []) {
 const found: Data[] = [];
 function collect(a: Data, source: string, at?: string) {
  if (!a || a.deleted || a.is_deleted) return;
  const url = clickUpAssetUrl(a.url || a.download_url);
  if (!url) return;
  const name = String(a.title || a.name || 'Attachment').slice(0, 500), extension = String(a.extension || '').toLowerCase().replace(/^\./, '');
  const mime = String(a.mimetype || a.mime_type || a.type || '');
  const image = /^image\/(png|jpe?g|webp|gif|bmp)$/i.test(mime) || /^(png|jpe?g|webp|gif|bmp)$/.test(extension) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(name) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(new URL(url).pathname);
  found.push({id: String(a.id || new URL(url).origin + new URL(url).pathname), name, url, thumbnail: clickUpAssetUrl(a.thumbnail_small || a.thumbnail_medium) || url, mime: image ? (mime.startsWith('image/') ? mime : 'image/' + (extension === 'jpg' ? 'jpeg' : extension || 'png')) : mime || 'application/octet-stream', is_image: image, size: Number(a.size) || 0, at: String(a.date || at || ''), source});
 }
 for (const a of task.attachments || []) collect(a, 'Attachment task');
 for (const f of task.custom_fields || []) if (f.type === 'attachment' || f.type === 'files') for (const a of Array.isArray(f.value) ? f.value : []) collect(a, 'Field ' + f.name);
 for (const c of comments) {
  for (const a of c.attachments || []) collect(a, 'Komen ClickUp', c.date);
  for (const part of c.comment || []) {if (part.attachment) collect(part.attachment, 'Komen ClickUp', c.date); if (part.image) collect(part.image, 'Komen ClickUp', c.date); for (const a of part.attachments || []) collect(a, 'Komen ClickUp', c.date);}
 }
 const ids = new Set(), urls = new Set();
 return found.filter(a => {const url = new URL(a.url); const key = url.origin + url.pathname; if (ids.has(a.id) || urls.has(key)) return false; ids.add(a.id); urls.add(key); return true;}).sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
}
export async function originalAttachment(asset: Data, fetcher: typeof fetch = fetch) {
 let url = clickUpAssetUrl(asset.url);
 for (let hop = 0; hop < 4; hop++) {
  if (!url) throw Error('INVALID_ATTACHMENT_HOST');
  const r = await fetcher(url, {redirect: 'manual', signal: AbortSignal.timeout(25000)});
  if ([301, 302, 303, 307, 308].includes(r.status)) {url = clickUpAssetUrl(new URL(r.headers.get('location') || '', url).href); continue;}
  if (!r.ok || !r.body) throw Error('ATTACHMENT_UNAVAILABLE');
  const max = 50 * 1024 * 1024;
  if (Number(r.headers.get('content-length')) > max) throw Error('ATTACHMENT_TOO_LARGE');
  const reader = r.body.getReader(), parts: Uint8Array[] = []; let size = 0;
  while (true) {const {value, done} = await reader.read(); if (done) break; size += value.length; if (size > max) {await reader.cancel(); throw Error('ATTACHMENT_TOO_LARGE');} parts.push(value);}
  if (!size) throw Error('ATTACHMENT_UNAVAILABLE');
  const bytes = new Uint8Array(size); let offset = 0; for (const p of parts) {bytes.set(p, offset); offset += p.length;}
  const prefix = new TextDecoder().decode(bytes.slice(0, 12));
  const mime = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 ? 'image/png' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg' : prefix.startsWith('RIFF') && prefix.slice(8) === 'WEBP' ? 'image/webp' : prefix.startsWith('GIF8') ? 'image/gif' : prefix.startsWith('BM') ? 'image/bmp' : prefix.startsWith('%PDF-') ? 'application/pdf' : 'application/octet-stream';
  if (asset.is_image && !mime.startsWith('image/')) throw Error('INVALID_ATTACHMENT_FORMAT');
  return {bytes, mime};
 }
 throw Error('ATTACHMENT_UNAVAILABLE');
}
