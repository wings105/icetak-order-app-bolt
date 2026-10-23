import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ExternalLink, ImagePlus, Loader2, RefreshCw, Send, X } from 'lucide-react';
import { ClickUpFailure, inboxClickUp, pendingClickUp, savePendingClickUp, safeClickUpFile, type ClickUpResult, type PendingClickUp } from '../lib/inboxClickUp';
import { confirmDesignNavigation, registerDesignDraft } from '../lib/designDraftGuard';
interface Props { orders: Array<{ id: string; order_no: string }>; conversationId?: string | null; defaultOpen?: boolean; onUpdated?: () => void }
export function InboxClickUpDesigner({ orders, conversationId, defaultOpen = false, onUpdated }: Props) {
 const [open, setOpen] = useState(defaultOpen), [chosenOrder, setChosenOrder] = useState('');
 const summaryId = orders.some(o => o.id === chosenOrder) ? chosenOrder : orders[0]?.id || '';
 const [list, setList] = useState<ClickUpResult | null>(null), [task, setTask] = useState(''), [options, setOptions] = useState<ClickUpResult | null>(null);
 const [status, setStatus] = useState(''), [file, setFile] = useState<File | null>(null), [preview, setPreview] = useState(''), [pixels, setPixels] = useState('');
 const [comment, setComment] = useState(''), [listLoading, setListLoading] = useState(false), [optionsLoading, setOptionsLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
 const [pending, setPending] = useState<PendingClickUp | null>(null), [canResume, setCanResume] = useState(false), [posted, setPosted] = useState<string>();
 const input = useRef<HTMLInputElement>(null), listGeneration = useRef(0), generation = useRef(0), busyRef = useRef(false), retry = useRef<{ signature: string; id: string }>();
 const loading = listLoading || optionsLoading;
 const dirty = !!file || !!comment.trim() || !!options && status !== options.status;
 useEffect(() => registerDesignDraft(`clickup-${summaryId}`, dirty, busy), [summaryId, dirty, busy]);
 useEffect(() => {
  busyRef.current=false; setBusy(false); setFile(null); setComment(''); setOptions(null); setList(null); setTask(''); setError(''); setNotice(''); setPosted(undefined); retry.current = undefined;
  const saved = pendingClickUp(summaryId); setPending(saved); setCanResume(false); if (saved) { setTask(saved.task_id); setOpen(true); }
 }, [summaryId]);
 useEffect(() => {
  const current = ++listGeneration.current; setOptions(null); setError('');
  if (!open || !summaryId) { setListLoading(false); return; }
  setListLoading(true);
  void inboxClickUp({ action: 'list', summary_id: summaryId, conversation_id: conversationId || undefined }).then(data => {
   if (listGeneration.current !== current) return; setList(data); const saved = pendingClickUp(summaryId);
   setTask(previous => saved?.task_id || (data.tasks?.some(t => t.id === previous) ? previous : data.tasks?.length === 1 ? data.tasks[0].id : ''));
  }).catch(e => { if (listGeneration.current === current) setError(e.message); }).finally(() => { if (listGeneration.current === current) setListLoading(false); });
  return () => { listGeneration.current++; };
 }, [open, summaryId, conversationId]);
 useEffect(() => {
  const current = ++generation.current; setOptions(null); setError(''); setStatus('');
  if (!open || !task || !summaryId) { setOptionsLoading(false); return; }
  setOptionsLoading(true);
  void inboxClickUp({ action: 'options', summary_id: summaryId, conversation_id: conversationId || undefined, task_id: task }).then(data => {
   if (generation.current === current) { setOptions(data); setStatus(data.status || ''); }
  }).catch(e => { if (generation.current === current) setError(e.message); }).finally(() => { if (generation.current === current) setOptionsLoading(false); });
  return () => { generation.current++; };
 }, [task, summaryId, open, conversationId]);
 useEffect(() => {
  setPixels(''); if (!file?.type.startsWith('image/')) { setPreview(''); return; }
  const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url);
 }, [file]);
 function remember(value: PendingClickUp | null) { setPending(value); savePendingClickUp(summaryId, value); }
 function choose(next?: File) {
  if (!next || busy || pending) return;
  if (!/^(image\/(png|jpeg|webp)|application\/pdf)$/.test(next.type) || !next.size || next.size > 15 * 1024 * 1024) { setError('Pilih PNG, JPG, WebP atau PDF, maksimum 15 MB.'); return; }
  setFile(next); setError(''); setNotice(''); setPosted(undefined); retry.current = undefined;
 }
 async function refresh() {
  if (busy || !summaryId) return; if (dirty && !confirmDesignNavigation()) return;
  const current = ++generation.current; setOptionsLoading(true); setError('');
  try { const data = await inboxClickUp({ action: 'list', summary_id: summaryId, conversation_id: conversationId || undefined }); if (generation.current !== current) return; setList(data);
   if (task) { const next = await inboxClickUp({ action: 'options', summary_id: summaryId, conversation_id: conversationId || undefined, task_id: task }); if (generation.current === current) { setOptions(next); setStatus(next.status || ''); } }
  } catch (e) { if (generation.current === current) setError((e as Error).message); } finally { if (generation.current === current) setOptionsLoading(false); }
 }
 async function act(kind: 'upload' | 'status' | 'receipt' | 'resume') {
  if (busyRef.current || loading || !task || !summaryId) return;
  const current = generation.current, base = { summary_id: summaryId, conversation_id: conversationId || undefined, task_id: task };
  const payload = kind === 'upload' ? { comment: comment.trim() } : kind === 'status' ? { status, expected_status: options?.status, expected_updated_at: options?.updated_at } : {};
  const signature = JSON.stringify([summaryId, task, kind, payload, file?.name, file?.size, file?.lastModified]);
  if (kind === 'upload' || kind === 'status') { if (retry.current?.signature !== signature) retry.current = { signature, id: crypto.randomUUID() }; }
  const id = kind === 'receipt' || kind === 'resume' ? pending?.request_id : retry.current?.id; if (!id) return;
  const draft: PendingClickUp = pending && ['receipt', 'resume'].includes(kind) ? pending : { summary_id: summaryId, task_id: task, request_id: id, kind: kind as 'upload' | 'status' };
  remember(draft); busyRef.current=true; setBusy(true); setError(''); setNotice('');
  try {
   const data = await inboxClickUp({ ...base, action: kind, request_id: id, ...payload }, kind === 'upload' ? file : undefined);
   if (generation.current !== current) return;
   remember(null); setCanResume(false); setPosted(safeClickUpFile(data.attachment?.url));
   if (draft.kind === 'upload') { setFile(null); setComment(''); setNotice('Gambar / komen disahkan di ClickUp.'); }
   else { setNotice(data.synced === false ? 'Status ClickUp disahkan. Inbox sedang diselaraskan.' : 'Status ClickUp dan Inbox dikemas kini.'); }
   retry.current = undefined;
   try { const next = await inboxClickUp({ ...base, action: 'options' }); if (generation.current === current) { setOptions(next); setStatus(next.status || ''); } } catch { setError('Tindakan berjaya. Refresh task untuk status terkini.'); }
   window.dispatchEvent(new CustomEvent('icetak-clickup-updated', { detail: { summaryId } })); onUpdated?.();
  } catch (e) {
   if (generation.current !== current) return;
   const failure = e as ClickUpFailure; setError(failure.message); setCanResume(!!failure.result?.can_resume);
   if (failure.result?.request_id) { const actual = { ...draft, request_id: failure.result.request_id }; remember(actual); if (retry.current) retry.current.id = actual.request_id; }
   if (!['receipt', 'resume'].includes(kind) && !failure.result?.uncertain && !failure.result?.can_resume) remember(null);
  } finally { if (generation.current === current) {busyRef.current=false;setBusy(false);} }
 }
 if (!summaryId) return null;
 const selected = list?.tasks?.find(t => t.id === task), enabled = !!options?.can_edit && !loading && !busy && !pending;
 return <section data-inbox-design aria-label="Design ClickUp" className="shrink-0 border-b border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--text)]">
  <button type="button" aria-expanded={open} onClick={() => { if (!open) setOpen(true); else if (confirmDesignNavigation()) { setFile(null); setComment(''); setStatus(options?.status || ''); setOpen(false); } }} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left font-semibold"><span className="flex items-center gap-2"><ImagePlus size={15} className="text-[var(--accent)]"/>Design · ClickUp</span><ChevronDown size={14} className={open ? 'rotate-180' : ''}/></button>
  {open && <div className="max-h-[58vh] space-y-3 overflow-y-auto px-4 pb-4">
   {orders.length > 1 && <label className="block text-[10px] text-[var(--text-secondary)]">Order sasaran<select aria-label="Order sasaran design" value={summaryId} disabled={busy} onChange={e => { if (confirmDesignNavigation()) setChosenOrder(e.target.value); }} className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface-muted)] p-2 text-xs text-[var(--text)]">{orders.map(o => <option key={o.id} value={o.id}>#{o.order_no}</option>)}</select></label>}
   <div className="flex items-center justify-between gap-2"><span className="min-w-0 truncate text-[10px] text-[var(--text-secondary)]">#{orders.find(o => o.id === summaryId)?.order_no}</span><button type="button" aria-label="Refresh task ClickUp" disabled={busy} onClick={() => void refresh()} className="rounded p-1.5 hover:bg-[var(--surface-hover)]"><RefreshCw size={13} className={loading ? 'animate-spin' : ''}/></button></div>
   {list?.configured === false && <p className="rounded-lg bg-amber-500/10 p-2 text-[11px]">Sambungkan API ClickUp melalui Settings Admin iCetak.</p>}
   {list?.tasks?.length === 0 && <p className="text-[11px] text-[var(--text-secondary)]">Belum ada task ClickUp dipautkan kepada order ini.</p>}
   {!!list?.tasks?.length && <label className="block text-[10px] text-[var(--text-secondary)]">Task sasaran<select aria-label="Task sasaran ClickUp" value={task} disabled={busy || !!pending} onChange={e => { if (confirmDesignNavigation()) { setTask(e.target.value); setFile(null); setComment(''); setPending(pendingClickUp(summaryId)); setNotice(''); setPosted(undefined); } }} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-2 text-xs text-[var(--text)]"><option value="">Pilih task…</option>{list.tasks.map(t => <option key={t.id} value={t.id}>{t.title} · {t.status}</option>)}</select></label>}
   {selected && <a href={safeClickUpFile(selected.url || undefined) || `https://app.clickup.com/t/${encodeURIComponent(task)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] text-[var(--accent)]">Buka task ClickUp <ExternalLink size={10}/></a>}
   {loading && <p className="flex items-center gap-2 text-[10px] text-[var(--text-secondary)]"><Loader2 size={12} className="animate-spin"/>Menyemak task…</p>}
   {options && <><div className="flex items-center gap-2"><select aria-label="Status ClickUp" disabled={!enabled} value={status} onChange={e => setStatus(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-2 text-[11px]">{!options.statuses?.some(s => s.status === options.status) && <option>{options.status}</option>}{options.statuses?.map(s => <option key={s.status} value={s.status}>{s.status}</option>)}</select><button type="button" disabled={!enabled || status === options.status} onClick={() => void act('status')} className="rounded-lg bg-[var(--surface-hover)] px-2 py-2 text-[10px] font-semibold disabled:opacity-40">Tukar status</button></div>
    {!options.can_edit && <p className="text-[10px] text-[var(--text-secondary)]">{options.readonly_reason || 'Paparan sahaja · akses designer diperlukan.'}</p>}
    {options.can_edit && <><div tabIndex={0} role="group" aria-label="Paste gambar design" onClick={e => e.currentTarget.focus()} onPaste={e => { const next = [...e.clipboardData.items].find(i => i.kind === 'file')?.getAsFile(); if (next) { e.preventDefault(); e.stopPropagation(); choose(next); } }} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); e.stopPropagation(); choose(e.dataTransfer.files[0]); }} className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-muted)] p-3 outline-none focus:ring-2 focus:ring-[#00a884]">
     {preview ? <img src={preview} alt="Preview design sebelum POST" onLoad={e => setPixels(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight} px`)} className="mx-auto max-h-36 max-w-full rounded object-contain"/> : <p className="py-3 text-center text-[11px] text-[var(--text-secondary)]">Klik sini dan Ctrl+V gambar<br/>atau drag fail design</p>}
     {file && <div className="mt-2 flex items-start gap-2"><span className="min-w-0 flex-1 break-words text-[10px]">{file.name}<span className="block text-[var(--text-secondary)]">{pixels}{pixels ? ' · ' : ''}{(file.size / 1024 / 1024).toFixed(2)} MB</span></span><button type="button" aria-label="Buang gambar design" disabled={busy || !!pending} onClick={() => setFile(null)} className="rounded p-1 disabled:opacity-40"><X size={12}/></button></div>}
     <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" aria-label="Fail design ClickUp" disabled={!enabled} onChange={e => { choose(e.target.files?.[0]); e.target.value = ''; }} className="hidden"/><button type="button" disabled={!enabled} onClick={e => { e.stopPropagation(); input.current?.click(); }} className="mt-2 rounded border border-[var(--border)] px-2 py-1 text-[10px] disabled:opacity-40">Pilih fail</button>
    </div><textarea aria-label="Nota design ClickUp" placeholder="Nota design (pilihan)" maxLength={3000} rows={2} value={comment} disabled={!enabled} onChange={e => setComment(e.target.value)} className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-2 text-xs text-[var(--text)]"/>
    <button type="button" disabled={!enabled || !file && !comment.trim()} onClick={() => void act('upload')} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#00a884] px-3 py-2 font-semibold text-white disabled:opacity-40">{busy ? <Loader2 size={13} className="animate-spin"/> : <Send size={13}/>}POST ke ClickUp</button><p className="text-[9px] leading-relaxed text-[var(--text-secondary)]">PNG / JPG / WebP / PDF · maksimum 15 MB. Draft belum dihantar akan hilang selepas refresh. Fail dihantar terus ke ClickUp.</p></>}
   </>}
   {pending && <div className="space-y-2 rounded-lg bg-amber-500/10 p-2 text-[10px]"><p>Penghantaran perlu disemak sebelum tindakan baharu.</p><button type="button" disabled={busy || loading} onClick={() => void act('receipt')} className="rounded border border-[var(--border)] px-2 py-1">Semak penghantaran</button>{canResume && <button type="button" disabled={busy || loading} onClick={() => void act('resume')} className="ml-2 rounded bg-[#00a884] px-2 py-1 text-white">Sambung komen</button>}</div>}
   {error && <p role="alert" className="text-[11px] leading-relaxed text-red-700 dark:text-red-300">{error}</p>}{notice && <p role="status" className="text-[11px] text-emerald-700 dark:text-emerald-300">{notice} {posted && <a href={posted} target="_blank" rel="noreferrer" className="underline">Buka fail ↗</a>}</p>}
   {!!options?.attachments?.length && <details className="text-[10px] text-[var(--text-secondary)]"><summary className="cursor-pointer">Attachment ClickUp terkini ({options.attachments.length})</summary><div className="mt-2 space-y-1">{options.attachments.map(a => safeClickUpFile(a.url) && <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="block truncate text-[var(--accent)]">{a.name || 'Buka fail'} ↗</a>)}</div></details>}
  </div>}
 </section>;
}
