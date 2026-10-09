import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

export const cancellationSourceLabel=(source?:string|null)=>source==='automation'?'Auto system':source==='admin'?'Manual admin':'Tidak direkodkan';
const when=(value:string)=>new Date(value).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur',dateStyle:'medium',timeStyle:'short'});
type History={total:number;offset:number;limit:number;events:{id:string;created_at:string;event_type:string;actor:string|null;source:string;reason_code:string|null;reason_label:string;reason_detail:string|null}[]};
type Target={id:string;customer_name:string|null;status:string;cancel_source?:string|null;rejected_at?:string|null;rejected_by?:string|null;cancel_reason_code?:string|null;cancel_reason_label?:string|null;cancel_reason_detail?:string|null};
export default function DraftCancellationHistory({draft,onClose}:{draft:Target;onClose:()=>void}){
  const [offset,setOffset]=useState(0),[data,setData]=useState<History|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const panel=useRef<HTMLElement>(null),closeButton=useRef<HTMLButtonElement>(null);
  useEffect(()=>{let active=true;setLoading(true);setError('');
    void (async()=>{try{
      const {data:response,error:apiError}=await supabase.functions.invoke('finance-admin',{body:{action:'draft_cancellation_history',draft_id:draft.id,offset}});
      if(apiError||!response?.success||!response.data)throw new Error(apiError?.message||response?.error||'Sejarah gagal dimuatkan');
      if(active)setData(response.data);
    }catch(e){if(active)setError(e instanceof Error?e.message:'Sejarah gagal dimuatkan')}finally{if(active)setLoading(false)}})();
    return()=>{active=false};
  },[draft.id,offset]);
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';closeButton.current?.focus();return()=>{document.body.style.overflow=overflow;previous?.focus()}},[]);
  useEffect(()=>{const keyboard=(e:KeyboardEvent)=>{
    if(e.key==='Escape'){e.preventDefault();onClose()}
    if(e.key==='Tab'){const buttons=Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[]);const first=buttons[0],last=buttons.at(-1);
      if(!panel.current?.contains(document.activeElement)){e.preventDefault();first?.focus()}
      else if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}
  };document.addEventListener('keydown',keyboard);return()=>document.removeEventListener('keydown',keyboard)},[onClose]);
  return <div className="draft-modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <section ref={panel} className="draft-modal draft-history-modal" role="dialog" aria-modal="true" aria-labelledby="draft-history-title">
      <div className="draft-modal-head"><div><h2 id="draft-history-title">Sejarah pembatalan</h2><p>{draft.customer_name||'Customer'} · {draft.id}</p></div><button ref={closeButton} className="draft-modal-close" aria-label="Tutup sejarah" onClick={onClose}>×</button></div>
      <p>Rekod pembatalan dan Reopen kekal walaupun draft dibuka semula. Masa dipaparkan dalam MYT.</p>
      {draft.status==='rejected'&&<div className="draft-cancelled-info"><b>Pembatalan semasa · {cancellationSourceLabel(draft.cancel_source)}</b><span>{draft.cancel_reason_label||draft.cancel_reason_code||'Sebab tidak direkodkan'}</span>{draft.cancel_reason_detail&&<span>{draft.cancel_reason_detail}</span>}<small>Oleh: {draft.rejected_by||'Tidak direkodkan'} · {draft.rejected_at?when(draft.rejected_at):'Masa tidak direkodkan'}</small></div>}
      {loading?<p role="status">Memuatkan sejarah…</p>:error?<div className="draft-error" role="alert">{error}</div>:data&&<>
        <p>{data.total} rekod · terbaru dahulu</p>
        {data.events.length===0?<div className="draft-empty">Tiada rekod sejarah pembatalan. Maklumat lama yang tidak direkodkan tidak dapat dibina semula.</div>:<ol className="draft-cancellation-timeline">{data.events.map(event=><li key={event.id}>
          <div><b>{event.event_type==='draft_reopened'?'Draft dibuka semula':cancellationSourceLabel(event.source)}</b><time dateTime={event.created_at}>{when(event.created_at)}</time></div>
          <small>Oleh: {event.actor||'Tidak direkodkan'}</small>
          <p>{event.event_type==='draft_reopened'?'Sebab pembatalan sebelum Reopen: ':''}{event.reason_label}</p>{event.reason_detail&&<p>{event.reason_detail}</p>}
        </li>)}</ol>}
        <div className="draft-pagination"><span>{data.total?`${offset+1}–${Math.min(offset+data.events.length,data.total)}`:'0'} daripada {data.total}</span><div><button className="btn btn-outline" disabled={offset===0} onClick={()=>setOffset(x=>Math.max(0,x-50))}>Sejarah sebelumnya</button><button className="btn btn-outline" disabled={offset+50>=data.total} onClick={()=>setOffset(x=>x+50)}>Sejarah seterusnya</button></div></div>
      </>}
    </section>
  </div>;
}
