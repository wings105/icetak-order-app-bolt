import {useCallback,useEffect,useRef,useState} from 'react';
import {copyOriginalImage,panelOriginal,type PanelAttachment} from '../lib/taskPanel';

export default function TaskPanelAttachment({asset,taskId}:{asset:PanelAttachment;taskId:string}){
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[zoom,setZoom]=useState(false);
 const [imageUrl,setImageUrl]=useState(''),[imageError,setImageError]=useState(''),[attempt,setAttempt]=useState(0),[dimensions,setDimensions]=useState('');
 const cached=useRef<Promise<Blob>|null>(null),tile=useRef<HTMLElement>(null),zoomDialog=useRef<HTMLDialogElement>(null);
 const original=useCallback(()=>cached.current||=(panelOriginal(taskId,asset).catch(e=>{cached.current=null;throw e;})),[taskId,asset]);

 useEffect(()=>{
  if(!asset.is_image)return;
  let disposed=false,started=false,url='';
  setImageUrl('');setImageError('');
  // Display the original bytes, and reuse them for copy/download/zoom. Never
  // put a provider thumbnail in <img>, including while the original loads.
  const load=()=>{
   if(started)return;started=true;
   void original().then(blob=>{
    if(disposed)return;
    url=URL.createObjectURL(blob);setImageUrl(url);
   }).catch(e=>{if(!disposed)setImageError((e as Error).message);});
  };
  const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>{
   if(entries.some(entry=>entry.isIntersecting)){observer?.disconnect();load();}
  },{rootMargin:'240px'});
  if(observer&&tile.current)observer.observe(tile.current);else load();
  return()=>{disposed=true;observer?.disconnect();if(url)URL.revokeObjectURL(url);};
 },[asset.is_image,original,attempt]);

 async function act(copy:boolean){
  if(busy)return;setBusy(true);setNotice('');
  try{
   if(copy){await copyOriginalImage(original());setNotice('Gambar original disalin.');}
   else{
    const blob=await original(),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=asset.name.replace(/[/\\\u0000-\u001f]/g,'_');document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);setNotice('Original dimuat turun.');
   }
  }catch(e){setNotice((e as Error).message);}finally{setBusy(false);}
 }

 return <article ref={tile} className="tp-attachment">
  <button type="button" className="tp-original-image" disabled={!asset.is_image||!imageUrl} aria-label={`Preview ${asset.name}`} onClick={()=>{setZoom(true);zoomDialog.current?.showModal();}}>
   {asset.is_image?imageUrl?<img src={imageUrl} alt={asset.name} onLoad={e=>setDimensions(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight} px`)} onError={()=>setImageError('Gambar asal tidak dapat dipaparkan. Gunakan Download original.')}/>:<span className="tp-image-loading" role="status">{imageError?'Gambar tidak tersedia':'Memuat gambar asal…'}</span>:<span>{asset.name.split('.').at(-1)?.toUpperCase().slice(0,7)||'FILE'}</span>}
  </button>
  <strong title={asset.name}>{asset.name}</strong>
  <small>{asset.source}{asset.size?` · ${(asset.size/1024).toFixed(0)} KB`:''}{dimensions?` · ${dimensions}`:''}</small>
  <div className="tp-file-actions">
   {asset.is_image&&<button type="button" disabled={busy||!imageUrl} onClick={()=>void act(true)} aria-label={`Copy gambar ${asset.name}`}>{busy?'Menyalin…':'Copy gambar'}</button>}
   <button type="button" disabled={busy} onClick={()=>void act(false)} aria-label={`Download original ${asset.name}`}>Download</button>
   {imageError&&<button type="button" onClick={()=>setAttempt(n=>n+1)}>Muat semula gambar</button>}
  </div>
  {imageError&&<p role="alert">{imageError}</p>}{notice&&<p role="status">{notice}</p>}
  <dialog ref={zoomDialog} className="tp-zoom" onCancel={()=>setZoom(false)}>
   <header><span>{asset.name}</span><button type="button" aria-label="Tutup preview" onClick={()=>{zoomDialog.current?.close();setZoom(false);}}>×</button></header>
   {zoom&&imageUrl&&<img src={imageUrl} alt={`Original ${asset.name}`}/>}
   <small>{dimensions}</small>
   <div className="tp-file-actions"><button type="button" disabled={busy||!imageUrl} onClick={()=>void act(true)}>Copy gambar</button><button type="button" disabled={busy} onClick={()=>void act(false)}>Download original</button></div>
   {notice&&<p role="status">{notice}</p>}
  </dialog>
 </article>;
}
