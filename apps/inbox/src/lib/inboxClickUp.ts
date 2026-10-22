import { supabase } from './supabase';
export interface ClickUpTask { id: string; title: string; status: string; url: string | null }
export interface ClickUpAttachment { id: string; url: string; name?: string }
export interface ClickUpResult {
 ok: boolean; readonly_reason?: string; configured?: boolean; can_edit?: boolean; tasks?: ClickUpTask[]; status?: string; updated_at?: string;
 statuses?: Array<{ status: string; color: string }>; attachments?: ClickUpAttachment[];
 attachment?: ClickUpAttachment | null; verified?: boolean; synced?: boolean; request_id?: string; uncertain?: boolean; can_resume?: boolean;
 history?: Array<{ request_id: string; task_id: string; kind: string; state: string; created_at: string; result: { attachment?: ClickUpAttachment; status?: string } }>;
}
export class ClickUpFailure extends Error {
 constructor(message: string, public result: ClickUpResult) { super(message); }
}
export async function inboxClickUp(body: Record<string, unknown>, file?: File | null): Promise<ClickUpResult> {
 let payload: Record<string, unknown> | FormData = body;
 if (file) { const form = new FormData(); form.set('payload', JSON.stringify(body)); form.set('file', file); payload = form; }
 const { data, error } = await supabase.functions.invoke('inbox-task-clickup', { body: payload });
 if (error || !data?.ok) {
  let detail = data; if (error) { try { detail = await (error as { context?: Response }).context?.json() || detail; } catch { /* Transport failure retains the request receipt. */ } }
  throw new ClickUpFailure(detail?.error || 'Sambungan ClickUp gagal. Semak penghantaran sebelum cuba lagi.', detail || { ok: false, uncertain: !!body.request_id });
 }
 return data;
}
export interface PendingClickUp { summary_id: string; task_id: string; request_id: string; kind: 'upload' | 'status' }
const key = 'icetak-inbox-clickup-pending-v1';
export function pendingClickUp(summaryId: string): PendingClickUp | null {
 try { const all = JSON.parse(localStorage.getItem(key) || '{}'); const p = all[summaryId]; return p && typeof p.request_id === 'string' && typeof p.task_id === 'string' && ['upload', 'status'].includes(p.kind) ? p : null; } catch { return null; }
}
export function savePendingClickUp(summaryId: string, pending: PendingClickUp | null) {
 try { const all = JSON.parse(localStorage.getItem(key) || '{}'); if (pending) all[summaryId] = pending; else delete all[summaryId]; localStorage.setItem(key, JSON.stringify(all)); } catch { /* Memory still retains the active receipt. */ }
}
export const safeClickUpFile = (url?: string) => { try { const u = new URL(url || ''); return u.protocol === 'https:' ? u.href : undefined; } catch { return undefined; } };
