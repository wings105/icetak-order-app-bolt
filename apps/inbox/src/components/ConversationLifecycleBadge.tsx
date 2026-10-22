import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, ExternalLink, Loader2, Package, RefreshCw, ShoppingBag, Truck, X } from 'lucide-react';
import type { Conversation } from '../types';
import { useConversationLifecycle } from '../lib/useConversationLifecycle';
import { LIFECYCLE_LABELS, type LifecycleStage, type ProspectStage } from '../../../../supabase/functions/_shared/conversation-lifecycle.ts';
function tone(stage:LifecycleStage){
 if(['cancelled','not_proceeding','return','edit'].includes(stage))return 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300';
 if(['task_complete','printed','pickup','completed'].includes(stage))return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300';
 if(['printing','awaiting_confirm','review','unpaid','cancelling','unknown'].includes(stage))return 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300';
 if(['interested','design','shipped','draft'].includes(stage))return 'bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300';
 return 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
}
function time(value?:string|null){if(!value||!Number.isFinite(Date.parse(value)))return 'Belum tersedia';return new Intl.DateTimeFormat('ms-MY',{timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value));}
const safeLink=(value?:string|null)=>{try{const u=new URL(value||'');return u.protocol==='https:'&&['app.clickup.com','shop.decocake.my'].includes(u.hostname)?u.href:null;}catch{return null;}};
export function ConversationLifecycleBadge({conversation}:{conversation:Conversation}){
 const {data,loading,error,refresh,setProspect}=useConversationLifecycle(conversation);
 const [open,setOpen]=useState(false),[saving,setSaving]=useState(false),[saveError,setSaveError]=useState('');
 const root=useRef<HTMLDivElement>(null),button=useRef<HTMLButtonElement>(null);
 useEffect(()=>{setOpen(false);setSaveError('');},[conversation.id]);
 useEffect(()=>{if(!open)return;const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);button.current?.focus();}};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};},[open]);
 const stage=loading?'unknown':data?.stage??'unknown';
 const Icon=stage==='shipped'?Truck:['completed','task_complete','printed'].includes(stage)?CheckCircle2:['survey','interested','awaiting_confirm','not_proceeding'].includes(stage)?ShoppingBag:Package;
 const progress=data&&data.total>1&&data.complete<data.total&&data.complete>0?` · ${data.complete}/${data.total} Siap`:'';
 const label=loading?'Semak…':data?.label??'Semak Status';
 async function save(stage:ProspectStage|null){setSaving(true);setSaveError('');try{await setProspect(stage);}catch(e){setSaveError(e instanceof Error?e.message:'Gagal menyimpan.');}finally{setSaving(false);}}
 return <div ref={root} className="relative min-w-0">
  <button ref={button} type="button" aria-label={`Status customer: ${label}${loading?'':progress}`} aria-expanded={open} aria-haspopup="dialog" onClick={()=>setOpen(v=>!v)} title={loading?'Menyemak status semasa':data?.reason||error}
   className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold leading-tight ${tone(stage)}`}>
   {loading?<Loader2 size={11} className="shrink-0 animate-spin"/>:<Icon size={11} className="shrink-0"/>}<span className="truncate">{label}{loading?'':progress}{!loading&&data?.extra_orders?` · +${data.extra_orders} Order`:''}</span><ChevronDown size={10} className="shrink-0"/>
  </button>
  {open&&<div role="dialog" aria-label="Ringkasan status customer" className="fixed inset-x-3 top-28 z-50 max-h-[70vh] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs text-[var(--text)] shadow-xl sm:absolute sm:inset-x-auto sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80">
   <div className="mb-2 flex items-center justify-between gap-2"><p className="font-semibold">Status customer</p><div className="flex"><button type="button" onClick={refresh} aria-label="Semak semula status" className="rounded p-1.5 hover:bg-[var(--surface-hover)]"><RefreshCw size={13}/></button><button type="button" onClick={()=>{setOpen(false);button.current?.focus();}} aria-label="Tutup ringkasan status" className="rounded p-1.5 hover:bg-[var(--surface-hover)]"><X size={14}/></button></div></div>
   {loading?<p className="py-2 text-[var(--text-secondary)]">Menyemak order dan task…</p>:error?<p role="alert" className="text-amber-700 dark:text-amber-300">{error}</p>:data&&<>
    <p className="mb-2 text-[11px] leading-5 text-[var(--text-secondary)]">{data.reason}</p>
    {data.orders.map(order=><div key={order.id} className="mb-2 rounded-lg border border-[var(--border)] p-2">
     <div className="flex items-center justify-between gap-2"><span className="font-semibold">{order.order_no}</span>{safeLink(order.public_order_url)&&<a href={safeLink(order.public_order_url)!} target="_blank" rel="noreferrer" aria-label={`Buka order ${order.order_no}`}><ExternalLink size={12}/></a>}</div>
     <p className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] ${tone(order.badge.stage)}`}>{order.badge.label}</p>
     <p className="mt-1 text-[10px] text-[var(--text-secondary)]">Bayaran: {order.payment_status||'Belum jelas'}{Number(order.balance_amount)>0?` · Baki RM${Number(order.balance_amount).toFixed(2)}`:''}</p>
     {(order.items??[]).length>0&&<p className="mt-1 text-[10px] text-[var(--text-secondary)]">{order.items!.map(i=>i.title).filter(Boolean).join(' · ')}</p>}
     <div className="mt-1.5 space-y-1">{order.badge.tasks.map((task,index)=><div key={task.id} className="flex items-start justify-between gap-2 text-[10px]"><span className="min-w-0 flex-1 break-words">{task.title||`Task ${index+1}`}<span className="block text-[var(--text-secondary)]">{task.status||'Status belum tersedia'}</span></span>{safeLink(task.url)&&<a className="shrink-0 p-1" href={safeLink(task.url)!} target="_blank" rel="noreferrer" aria-label={`Buka task ${index+1}`}><ExternalLink size={11}/></a>}</div>)}</div>
     {order.tracking_no&&<p className="mt-1.5 text-[10px] text-[var(--text-secondary)]">Tracking: {order.tracking_no}</p>}
     <p className="mt-1.5 text-[9px] text-[var(--text-secondary)]">Sync order: {time(order.last_synced_at)}</p>
    </div>)}
    {data.history_count>0&&<details className="mb-2 text-[10px] text-[var(--text-secondary)]"><summary className="cursor-pointer py-1">{data.history_count} order terdahulu diasingkan daripada sesi ini</summary><div className="mt-1 space-y-1">{data.history.map(order=><div key={order.id} className="flex items-center justify-between gap-2 rounded border border-[var(--border)] p-2"><span>{order.order_no}<span className="block">{time(order.placed_at)}</span></span><span className={`rounded px-1.5 py-0.5 ${tone(order.badge.stage)}`}>{order.badge.label}</span></div>)}</div>{data.history_count>data.history.length&&<p className="mt-1">Sejarah penuh tersedia di panel Order.</p>}</details>}
    {data.prospect_editable&&<label className="mt-2 block text-[11px] text-[var(--text-secondary)]">Tahap prospek {data.manual?'· pilihan staf':'· automatik'}<select aria-label="Tetapkan tahap prospek" disabled={saving} value={data.manual?data.stage:'auto'} onChange={e=>void save(e.target.value==='auto'?null:e.target.value as ProspectStage)} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-2 text-xs text-[var(--text)]"><option value="auto">Automatik</option>{(['survey','interested','awaiting_confirm','not_proceeding'] as ProspectStage[]).map(s=><option key={s} value={s}>{LIFECYCLE_LABELS[s]}</option>)}</select></label>}
    <p className="mt-2 text-[9px] text-[var(--text-secondary)]">Disemak {time(data.checked_at)} · Waktu Malaysia</p>
   </>}
   {saveError&&<p role="alert" className="mt-2 text-[11px] text-red-600 dark:text-red-300">{saveError}</p>}
  </div>}
 </div>;
}
