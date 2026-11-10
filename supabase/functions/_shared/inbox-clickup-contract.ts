/** Shared bounded, binary-only transport. No Storage or base64 image persistence. */
export type Data = Record<string, any>;
export const MAX_DESIGN_BYTES = 15 * 1024 * 1024;
export const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const taskId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(v);
export const roles = ['owner', 'admin', 'designer', 'production', 'support', 'viewer'];
export const actions = ['list', 'options', 'upload', 'status', 'receipt', 'resume'];
export const https = (v: unknown) => { try { const u = new URL(String(v)); return u.protocol === 'https:' ? u.href : null; } catch { return null; } };
export async function digest(value: string | ArrayBuffer) {
 const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export async function readDesignRequest(req: Request): Promise<{ body: Data; file: File | null }> {
 if (Number(req.headers.get('content-length')) > MAX_DESIGN_BYTES + 1024 * 1024) throw Error('FILE_TOO_LARGE');
 const reader = req.body?.getReader(); if (!reader) throw Error('INVALID_REQUEST');
 const parts: Uint8Array[] = []; let size = 0;
 for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_DESIGN_BYTES + 1024 * 1024) { await reader.cancel(); throw Error('FILE_TOO_LARGE'); } parts.push(value); }
 const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
 if (req.headers.get('content-type')?.startsWith('multipart/form-data')) {
  const form = await new Response(bytes, { headers: { 'content-type': req.headers.get('content-type')! } }).formData();
  const payload = form.get('payload'); if (typeof payload !== 'string' || payload.length > 12000) throw Error('INVALID_REQUEST');
  const file = form.get('file'); if (file !== null && !(file instanceof File)) throw Error('INVALID_FILE');
  return { body: JSON.parse(payload), file: file as File | null };
 }
 if (size > 12000) throw Error('INVALID_REQUEST');
 return { body: JSON.parse(new TextDecoder().decode(bytes)), file: null };
}
export async function inspectDesign(file: File) {
 if (!file.size || file.size > MAX_DESIGN_BYTES) throw Error('FILE_TOO_LARGE');
 const bytes = await file.arrayBuffer(), b = new Uint8Array(bytes), ascii = new TextDecoder().decode(b.slice(0, 12));
 const valid = file.type === 'image/png' && [137,80,78,71,13,10,26,10].every((v, i) => b[i] === v)
  || file.type === 'image/jpeg' && b[0] === 255 && b[1] === 216 && b[2] === 255
  || file.type === 'image/webp' && ascii.startsWith('RIFF') && ascii.slice(8) === 'WEBP'
  || file.type === 'application/pdf' && ascii.startsWith('%PDF-');
 if (!valid) throw Error('INVALID_FILE');
 const name = file.name.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(-100) || 'design';
 return { name, mime: file.type, size: file.size, sha256: await digest(bytes) };
}
export function packDesign(body: Data, file: File | null): string | FormData {
 if (!file) return JSON.stringify(body);
 const form = new FormData(); form.set('payload', JSON.stringify(body)); form.set('file', file); return form;
}
export const messages: Record<string, string> = {
 LOGIN_REQUIRED: 'Sila login semula.', STAFF_REQUIRED: 'Akses staf aktif diperlukan.', EDIT_REQUIRED: 'Akses designer diperlukan untuk tindakan ini.',
 ORDER_NOT_FOUND: 'Order belum dipautkan atau tidak tersedia.', INVALID_TASK: 'Task ini tidak dipautkan kepada order yang dipilih.',
 TASK_NOT_ACTIVE: 'Task sudah dipindahkan atau diarkibkan di ClickUp. Semak task asal.',
 NOT_CONNECTED: 'Sambungkan API ClickUp di Settings Admin iCetak dahulu.', FILE_TOO_LARGE: 'Fail mesti antara 1 bait dan 15 MB.',
 INVALID_FILE: 'Pilih fail PNG, JPG, WebP atau PDF yang sah.', INVALID_REQUEST: 'Permintaan tidak sah.',
 TASK_CHANGED: 'Status task berubah. Refresh dan pilih status semula.', TASK_BUSY: 'Task sedang diproses. Semak penghantaran sebentar lagi.',
 REQUEST_CONFLICT: 'Rujukan penghantaran tidak sepadan dengan data ini.', UNKNOWN: 'Hasil belum dapat disahkan. Tekan Semak penghantaran sebelum cuba lagi.',
 PROVIDER_REJECTED: 'ClickUp menolak permintaan. Semak sambungan dan akses task.', BRIDGE_UNAVAILABLE: 'Sambungan ClickUp belum tersedia. Cuba semula.',
};
