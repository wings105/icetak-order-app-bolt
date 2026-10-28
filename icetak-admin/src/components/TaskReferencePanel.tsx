import {useEffect,useRef,useState} from 'react';
import {taskRequest,type WorkTask} from '../lib/taskWorkspace';

type Props={id:string;request:typeof taskRequest;queue:WorkTask[];guard:React.RefObject<()=>boolean>;width:number;onWidth:(width:number)=>void;onClose:()=>void;onShowDetail:()=>void};

export default function TaskReferencePanel({id,request,queue,guard,width,onWidth,onClose,onShowDetail}:Props){
 const listed=queue.find(task=>task.task_id===id),listedOrder=(listed?.order_reference||'').trim();
 const [lookup,setLookup]=useState<{loading:boolean;task:WorkTask|null;error:string}>({loading:false,task:null,error:''});
 const [retry,setRetry]=useState(0),[busy,setBusy]=useState(false),[order,setOrder]=useState(listedOrder);
 const frame=useRef<HTMLIFrameElement>(null),busyRef=useRef(false);
 useEffect(()=>{
  if(listedOrder)return;
  let current=true;setLookup({loading:true,task:null,error:''});
  void request({action:'detail',task_id:id}).then(result=>{if(current)setLookup({loading:false,task:result.items[0]||null,error:''});}).catch(error=>{if(current)setLookup({loading:false,task:null,error:error instanceof Error?error.message:'Order ID gagal dimuat.'});});
  return()=>{current=false;};
 },[id,request,listedOrder,retry]);
 useEffect(()=>{
  guard.current=()=>!busyRef.current;
  const message=(event:MessageEvent)=>{if(event.origin!==window.location.origin||event.source!==frame.current?.contentWindow||event.data?.type!=='icetak:awb-preview-busy'||typeof event.data.busy!=='boolean')return;busyRef.current=event.data.busy;setBusy(event.data.busy);};
  const unload=(event:BeforeUnloadEvent)=>{if(busyRef.current){event.preventDefault();event.returnValue='';}};
  window.addEventListener('message',message);window.addEventListener('beforeunload',unload);
  return()=>{window.removeEventListener('message',message);window.removeEventListener('beforeunload',unload);guard.current=()=>true;};
 },[guard]);
 const candidate=listedOrder||(lookup.task?.order_reference||'').trim(),title=listed?.title||lookup.task?.title||'Task';
 useEffect(()=>{if(!busy)setOrder(candidate);},[busy,candidate]);
 const src='/?'+new URLSearchParams({awbpreview:order}).toString();
 function resize(next:number){const value=Math.max(440,Math.min(850,window.innerWidth-200,next));onWidth(value);try{localStorage.setItem('icetak.task-panel-width.v1',String(value));}catch{}}
 return <aside className="tw-detail tw-side-panel tw-reference-panel" role="dialog" aria-modal="false" aria-labelledby="tw-reference-title" onKeyDown={event=>{if(event.key==='Escape'&&!busyRef.current){event.preventDefault();onClose();}}} style={{width:width+'px'}}>
  <div className="tp-resize" role="separator" aria-label="Lebar side panel" aria-orientation="vertical" aria-valuemin={440} aria-valuemax={850} aria-valuenow={width} tabIndex={0} onKeyDown={event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();resize(width+(event.key==='ArrowLeft'?30:-30));}}} onPointerDown={event=>{event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);}} onPointerMove={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))resize(window.innerWidth-event.clientX);}} onPointerUp={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}/>
  <header><div><small>{title}</small><h2 id="tw-reference-title">Print Reference</h2><p>{order||'Order ID belum tersedia'}</p></div><button type="button" className="tp-mode-button" disabled={busy} onClick={onShowDetail}>Sidebar biasa</button><button type="button" aria-label="Tutup task" disabled={busy} onClick={()=>{if(!busyRef.current)onClose();}}>×</button></header>
  {busy&&<p className="tp-reference-status" role="status">Tindakan sedang diproses. Tunggu sehingga selesai.</p>}
  {order?<iframe ref={frame} className="tp-reference-frame" title={`Print Reference Order ${order}`} src={src} referrerPolicy="no-referrer" allow="clipboard-write"/>:<div className="tp-reference-empty">{lookup.loading?<p role="status">Mencari Order ID…</p>:<><p role="alert">{lookup.error||'Task ini tiada Order ID untuk membuka Print Reference.'}</p>{lookup.error&&<button type="button" onClick={()=>setRetry(value=>value+1)}>Cuba semula</button>}<button type="button" onClick={onShowDetail}>Buka sidebar biasa</button></>}</div>}
 </aside>;
}
