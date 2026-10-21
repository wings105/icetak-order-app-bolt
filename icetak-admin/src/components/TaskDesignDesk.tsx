import {useEffect,useRef,useState} from 'react';
import {taskAsset,type WorkTask,type TaskAsset} from '../lib/taskWorkspace';
export const sourceTime=(v?:string|null)=>v?new Date(v).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
const productNames:Record<string,string>={edible:'Edible image',wafer:'Wafer paper',topper:'Cake topper',acrylic:'Acrylic'};
export function TaskAssetCard({asset,taskId,loader=taskAsset}:{asset:TaskAsset;taskId:string;loader?:typeof taskAsset}){
 const [notice,setNotice]=useState(''),[working,setWorking]=useState(false),[zoom,setZoom]=useState(false),[dimensions,setDimensions]=useState(''),[broken,setBroken]=useState(false);
 const cache=useRef<Promise<Blob>|null>(null);
 const [localPreview,setLocalPreview]=useState('');
 useEffect(()=>()=>{if(localPreview)URL.revokeObjectURL(localPreview);},[localPreview]);
 const preview=asset.url||localPreview;
 const isPdf=asset.mime==='application/pdf';
 function original(){return cache.current||=(loader(taskId,asset.id).then(blob=>{if(!asset.url&&blob.type.startsWith('image/'))setLocalPreview(URL.createObjectURL(blob));return blob;}).catch(e=>{cache.current=null;throw e;}));}
 async function act(copy:boolean){
  if(working)return;setWorking(true);setNotice('');
  try{
   if(copy){
    if(!navigator.clipboard?.write||typeof ClipboardItem==='undefined')throw Error('Browser ini tidak menyokong copy gambar. Gunakan Download original.');
    // Start the clipboard operation during the click gesture; decode at native resolution, never upscale.
    const png=original().then(async blob=>{if(blob.type==='image/png')return blob;const bitmap=await createImageBitmap(blob);try{if(bitmap.width*bitmap.height>40000000)throw Error('Gambar terlalu besar untuk clipboard. Gunakan Download original.');const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d');if(!context)throw Error('Clipboard gambar tidak tersedia.');context.drawImage(bitmap,0,0);return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Copy gagal. Gunakan Download original.')),'image/png'));}finally{bitmap.close();}});
    await navigator.clipboard.write([new ClipboardItem({'image/png':png})]);setNotice('Gambar disalin. Boleh paste ke Photoshop.');
   }else{const blob=await original(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;const ext=blob.type==='application/pdf'?'pdf':blob.type.split('/')[1]?.replace('jpeg','jpg')||'bin';a.download=asset.name.replace(/[^\p{L}\p{N}._ -]/gu,'_').replace(/\.(png|jpe?g|webp|gif|pdf)$/i,'')+'.'+ext;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);setNotice('Original dimuat turun.');}
  }catch(e){setNotice(e instanceof Error?e.message:'Fail belum tersedia. Cuba semula.');}finally{setWorking(false);}
 }
 const label=asset.purpose==='payment'?'BUKTI BAYARAN':asset.purpose==='order'?'SCREENSHOT ORDER':asset.kind==='product'?'CONTOH PRODUK':asset.kind==='file'?'FAIL KERJA':asset.kind==='clickup'?'ATTACHMENT CLICKUP':asset.direction==='outbound'?'GAMBAR BALASAN':'GAMBAR CUSTOMER';
 return <article className={`tw-asset-card ${asset.selected?'is-selected':''}`}>
  <div className="tw-asset-label"><span>{label}</span>{asset.selected&&<b>Dipilih</b>}</div>
  {preview&&!isPdf&&!broken?<button type="button" className="tw-image-preview" onClick={()=>setZoom(!zoom)} aria-label={`Zoom ${asset.name}`} aria-expanded={zoom}><img src={preview} alt={asset.name} loading="lazy" referrerPolicy="no-referrer" onLoad={e=>setDimensions(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight} px`)} onError={()=>setBroken(true)}/></button>:<div className="tw-asset-unavailable">{isPdf?'PDF · fail kerja':'Original / preview belum tersedia'}</div>}
  {zoom&&preview&&<div className="tw-image-expanded"><button type="button" onClick={()=>setZoom(false)}>Tutup zoom</button><img src={preview} alt={'Zoom '+asset.name} referrerPolicy="no-referrer"/></div>}
  <strong>{asset.name}</strong><small>{[asset.channel,sourceTime(asset.at),dimensions].filter(Boolean).join(' · ')}</small>
  <div className="tw-asset-actions">{!isPdf&&<button type="button" disabled={!(asset.available||asset.can_load)||working} onClick={()=>void act(true)}>Copy gambar</button>}<button type="button" disabled={!(asset.available||asset.can_load)||working} onClick={()=>void act(false)}>{working?'Memuat…':!preview&&asset.can_load?'Muat original':'Download original'}</button>{asset.url&&<a href={asset.url} target="_blank" rel="noreferrer">Buka ↗</a>}</div>
  {notice&&<p className="tw-asset-notice" role="status">{notice}</p>}
 </article>;
}
export function TaskDesignSummary({task,onSource}:{task:WorkTask;onSource:(messageId:string|null)=>void}){
 const r=task.readiness,d=task.dossier,values=r?.values||{};
 async function copy(value:string){try{await navigator.clipboard.writeText(value);setNotice('Wording disalin.');}catch{setNotice('Salin gagal. Pilih teks wording untuk copy.');}}
 const [notice,setNotice]=useState('');
 const instructions=(values.instructions||'').split(/\n\s*\n/).filter(block=>block.trim().replace(/^(?:wording|text|tulisan)\s*:\s*/i,'')!==values.wording).join('\n\n');
 const fields=[['product','Produk'],['size','Saiz'],['shape','Bentuk'],['colour','Warna'],['material','Material'],['quantity','Kuantiti']];
 function source(key:string){const s=d?.sources[key]||r?.sources[key];return s?<button type="button" className="tw-provenance" onClick={()=>onSource(d?.sources[key]?.message_id||null)}>{s.source}</button>:<small className="tw-muted">Belum diketahui</small>;}
 return <section className="tw-design-summary" aria-label="Brief untuk mula design">
  <div className="tw-section-heading"><div><span className="tw-eyebrow">BRIEF DESIGN</span><h3>{productNames[values.product]||'Detail task'}</h3></div><span className={`tw-decision ${r?.status}`}>{r?.status==='ready'?'Boleh mula design':r?.status==='missing'?'Maklumat belum cukup':'Perlu keputusan admin'}</span></div>
  <p className="tw-design-reason">{r?.status==='ready'?'Content customer mencukupi mengikut rule produk. Semak spesifikasi dan bahan asal di bawah.':r?.warnings[0]||r?.missing.map(m=>m.label).join(' · ')||'Sumber belum dapat disemak.'}</p>
  <div className="tw-sku-strip"><span>SKU / TEMPLATE</span><strong>{task.sku||values.template||'Belum diketahui'}</strong><span>{task.sets.join(' · ')}</span></div>
  <dl className="tw-spec-grid">{fields.map(([key,label])=><div key={key}><dt>{label}</dt><dd>{key==='product'?productNames[values[key]]||values[key]||'Belum diketahui':values[key]||'Belum diketahui'}</dd>{source(key)}</div>)}</dl>
  <div className="tw-wording-card"><div className="tw-section-heading"><h4>Wording tepat</h4><button type="button" disabled={!values.wording} onClick={()=>void copy(values.wording)}>Copy wording</button></div><pre>{values.wording||'Belum ada wording yang dapat dipastikan.'}</pre>{source('wording')}{notice&&<small role="status">{notice}</small>}</div>
  <div className="tw-instructions"><h4>Arahan designer</h4><p>{instructions||'Tiada arahan tambahan yang dikenal pasti. Baca mesej asal untuk konteks.'}</p>{values.instructions&&source('instructions')}</div>
  {r?.warnings.map(w=><p className="tw-brief-warning" key={w}>{w}</p>)}
  {!!r?.conflicts.length&&<div className="tw-brief-warning"><b>Nilai berbeza — pilih selepas baca sumber</b>{r.conflicts.map((c,i)=><p key={i}>{c.label}: {c.value}<small>{c.source}</small></p>)}</div>}
  {r?.previous_values&&<details className="tw-previous"><summary>Perubahan berbanding brief terdahulu</summary>{Object.keys({...r.previous_values,...values}).filter(k=>r.previous_values?.[k]!==values[k]).map(k=><p key={k}><b>{k}</b><del>{r.previous_values?.[k]||'—'}</del><span>→ {values[k]||'—'}</span></p>)}</details>}
  {r?.asset_warning&&<p className="tw-brief-warning">{r.asset_warning}</p>}
 </section>;
}
export function TaskMessages({task,highlight,onHighlight}:{task:WorkTask;highlight:string|null;onHighlight:(id:string|null)=>void}){
 const [filter,setFilter]=useState('all'),[channel,setChannel]=useState('all');const d=task.dossier;
 const important=d?.messages.filter(m=>m.important)||[],messages=(filter==='important'?important:d?.messages||[]).filter(m=>channel==='all'||m.channel===channel);
 const refs=useRef<Record<string,HTMLElement|null>>({});
 useEffect(()=>{if(!highlight||highlight==='notes')return;setFilter('all');setChannel('all');const frame=requestAnimationFrame(()=>refs.current[highlight]?.scrollIntoView({block:'center',behavior:'smooth'}));return()=>cancelAnimationFrame(frame);},[highlight,task.task_id]);
 function context(id:string){setFilter('all');setChannel('all');onHighlight(id);requestAnimationFrame(()=>refs.current[id]?.scrollIntoView({block:'center',behavior:'smooth'}));}
 return <aside className="tw-message-panel" aria-label="Mesej asal customer">
  <div className="tw-section-heading"><div><span className="tw-eyebrow">BUKTI & KONTEKS</span><h3>Mesej asal customer</h3></div><span>{d?.messages.length||0} mesej</span></div>
  <div className="tw-channel-health">{d?.channels.map(c=><span key={c.channel} className={c.status==='matched'?'is-matched':''}>{c.channel==='shopee'?'Shopee':'WhatsApp'} · {c.status==='matched'?'Dipadankan':c.status==='unavailable'?'Gagal dibaca':c.status==='ambiguous'?'Perlu padanan':'Belum dipadankan'}</span>)}</div>
  {!d&&<p className="tw-brief-warning">Mesej asal belum tersedia. Semak semula sumber selepas backend dikemas kini.</p>}
  {d?.unavailable&&<p className="tw-brief-warning">Sumber chat gagal dibaca. Ini bukan bukti customer belum beri detail.</p>}
  {d?.ambiguous&&<p className="tw-brief-warning">Ada padanan yang belum pasti. Hanya mesej daripada skop yang sah dipaparkan.</p>}
  {d?.truncated&&<p className="tw-brief-warning">Paparan terhad kepada 120 mesej setiap padanan. Baki sejarah perlu disemak di sumber sebelum membuat keputusan.</p>}
  {d?.multi_item&&<p className="tw-scope-note">Order mempunyai beberapa item. Chat di bawah ialah konteks order; hanya arahan yang dipadankan dengan item ini masuk brief.</p>}
  <div id="tw-source-notes" className={`tw-original-notes ${highlight==='notes'?'is-highlighted':''}`}><h4>Note checkout asal</h4><p>{d?.order_note||'Tiada note checkout diterima.'}</p>{d?.task_wording&&<><h4>Customization asal task</h4><p>{d.task_wording}</p></>}{d?.task_note&&<><h4>Noted task</h4><p>{d.task_note}</p></>}</div>
  <div className="tw-message-filters"><button type="button" aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>Semua mesej</button><button type="button" aria-pressed={filter==='important'} onClick={()=>setFilter('important')}>Bukti brief ({important.length})</button><select aria-label="Channel mesej" value={channel} onChange={e=>setChannel(e.target.value)}><option value="all">Semua channel</option><option value="shopee">Shopee</option><option value="whatsapp">WhatsApp</option></select></div>
  <div className="tw-message-list">{messages.map(m=><article id={'tw-message-'+m.id} key={m.id} ref={node=>{refs.current[m.id]=node;}} className={`tw-message ${m.direction} ${highlight===m.id?'is-highlighted':''}`}><header><b>{m.direction==='inbound'?'Customer':'Balasan kita'}</b><span>{m.channel==='shopee'?'Shopee':'WhatsApp'} · {sourceTime(m.at)}</span></header>{(m.text||m.caption)&&<p>{m.text||m.caption}</p>}{m.caption&&m.text&&m.text!==m.caption&&<p>{m.caption}</p>}{m.asset_id&&d?.assets.find(a=>a.id===m.asset_id)&&<TaskAssetCard key={m.asset_id+':'+d.assets.find(a=>a.id===m.asset_id)?.url} asset={d.assets.find(a=>a.id===m.asset_id)!} taskId={task.task_id}/ >}{!m.text&&!m.caption&&!m.asset_id&&<p className="tw-muted">{m.type||'Mesej tanpa teks'}</p>}{m.text_limited&&<small className="tw-brief-warning">Teks panjang dipendekkan oleh sumber. Semak mesej asal jika perlu.</small>}<button className="tw-context-button" type="button" onClick={()=>context(m.id)}>Lihat konteks</button></article>)}{!messages.length&&<p className="tw-muted">{filter==='important'?'Tiada bukti brief untuk pilihan ini.':'Tiada mesej diterima dalam skop order yang dipadankan.'}</p>}</div>
  <small className="tw-message-check">Disemak {sourceTime(d?.checked_at)} · Mesej order ini sahaja</small>
 </aside>;
}
