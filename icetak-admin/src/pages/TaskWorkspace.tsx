import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {taskRequest,workStatuses,workMatches,dueAt,type WorkTask,type TaskSnapshot} from '../lib/taskWorkspace';
import './TaskWorkspace.css';
import TaskBrief,{ReadinessBadge} from '../components/TaskBrief';
import {TaskDesignSummary,TaskMessages,TaskAssetCard} from '../components/TaskDesignDesk';
import TaskPanelControls,{CopyValue} from '../components/TaskPanelControls';
import type {PanelOptions} from '../lib/taskPanel';
import TaskPanelOutput from '../components/TaskPanelOutput';
import './TaskSidePanel.css';

const tabs=[['all','Semua task'],['designer','Designer'],['printing','Printing'],['acrylic','Acrylic / Laser'],['mine','Kerja saya']];
const date=(value:string|null|undefined)=>value&&!Number.isNaN(new Date(value).getTime())?new Date(value).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
const stateLabel=(status:string)=>workStatuses.find(s=>s[0]===status)?.[1]||status;
const colour=(status:string)=>workStatuses.find(s=>s[0]===status)?.[2]||'#aaa';
type Props={request?:typeof taskRequest;onOpenOrder?:(reference:string)=>void;onOpenMarketplace?:(reference:string)=>void};
function Caret({open}:{open:boolean}){return <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{transform:open?'rotate(90deg)':undefined}}><path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.6"/></svg>;}
export default function TaskWorkspace({request=taskRequest,onOpenOrder,onOpenMarketplace}:Props){
 const [data,setData]=useState<TaskSnapshot|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const [view,setView]=useState('all'),[query,setQuery]=useState(''),[sort,setSort]=useState('due'),[completed,setCompleted]=useState(false),[readinessFilter,setReadinessFilter]=useState('all');
 const [collapsed,setCollapsed]=useState<Set<string>>(()=>new Set()),[selected,setSelected]=useState<string|null>(()=>{const id=new URLSearchParams(window.location.search).get('task');return id&&/^[a-zA-Z0-9_-]{1,80}$/.test(id)?id:null;}),[light,setLight]=useState(false);
 const [columns,setColumns]=useState(()=>{try{return JSON.parse(localStorage.getItem('icetak.task-columns.v1')||'{}') as Record<string,boolean>;}catch{return {};}});
 const mounted=useRef(true),inflight=useRef(false),navigationGuard=useRef<()=>boolean>(()=>true);
 const [panelWidth,setPanelWidth]=useState(()=>{try{return Math.max(440,Math.min(850,Number(localStorage.getItem('icetak.task-panel-width.v1'))||560));}catch{return 560;}});
 const selectTask=useCallback((id:string)=>{if(navigationGuard.current()){setSelected(id);const url=new URL(window.location.href);url.searchParams.set('task',id);window.history.replaceState({},'',url);}},[]);
 const load=useCallback(async()=>{
  if(inflight.current)return;inflight.current=true;setLoading(true);
  try{const next=await request({action:'list'});if(mounted.current){setData(next);setError('');}}
  catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Data gagal dimuat.');}
  finally{inflight.current=false;if(mounted.current)setLoading(false);}
 },[request]);
 useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;};},[load]);
 useEffect(()=>{const timer=setInterval(()=>{if(!selected&&document.visibilityState==='visible')void load();},30000);return()=>clearInterval(timer);},[load,selected]);
 const all=data?.items||[];
 const visible=useMemo(()=>all.filter(t=>(completed?t.status==='complete':t.status!=='complete')&&workMatches(t,view,query,data?.actor||'')&&(readinessFilter==='all'||(readinessFilter==='print'?t.readiness?.print_ready:t.readiness?.status===readinessFilter)))
  .sort((a,b)=>sort==='due'?(dueAt(a)||'9999').localeCompare(dueAt(b)||'9999')||a.task_id.localeCompare(b.task_id):b.source_updated_at.localeCompare(a.source_updated_at)),[all,completed,view,query,data?.actor,sort,readinessFilter]);
 const statuses=[...['cake topper - printing','ready stock','design edible image','design editing -topper','new custom','acrylic','wafer paper','review','edible image -printing','wafer - printing','print alamat','complete'],...new Set(visible.map(t=>t.status).filter(s=>!workStatuses.some(w=>w[0]===s)))];
 const show=(key:string)=>columns[key]!==false;
 function toggleColumn(key:string){setColumns(old=>{const next={...old,[key]:old[key]===false};try{localStorage.setItem('icetak.task-columns.v1',JSON.stringify(next));}catch{}return next;});}
 return <section className={`tw-workspace ${light?'tw-light':''} ${selected?'tp-open':''}`} style={{'--tp-width':panelWidth+'px'} as React.CSSProperties}>
  <header className="tw-heading"><div><h1>Task Workspace</h1><p>Buka task → baca arahan & gambar asal → mula design.</p></div><div className="tw-live"><i/>{data?`Webhook ${date(data.last_webhook_at)}`:'Menyambung…'}</div></header>
  <nav className="tw-tabs" aria-label="View kerja">{tabs.map(([key,label])=><button key={key} aria-pressed={view===key} onClick={()=>{setView(key);setCompleted(false);}}>{label}<span>{all.filter(t=>t.status!=='complete'&&workMatches(t,key,'',data?.actor||'')).length}</span></button>)}</nav>
  <div className="tw-toolbar"><input aria-label="Cari task" placeholder="Cari order, nama, SKU, telefon atau wording…" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Susunan task" value={sort} onChange={e=>setSort(e.target.value)}><option value="due">Due paling dekat</option><option value="latest">Update terbaru</option></select><details><summary>Columns</summary><div className="tw-column-menu">{[['phone','Telefon'],['sku','SKU'],['wording','Wording'],['review','Review'],['courier','Courier']].map(([key,label])=><label key={key}><input type="checkbox" checked={show(key)} onChange={()=>toggleColumn(key)}/>{label}</label>)}</div></details><button aria-pressed={completed} onClick={()=>setCompleted(!completed)}>Selesai <span>{all.filter(t=>t.status==='complete').length}</span></button><button onClick={()=>setLight(!light)}>{light?'Dark':'Light'}</button><button disabled={loading} onClick={()=>void load()}>{loading?'Memuatkan…':'Refresh'}</button></div>
  <nav className="tw-readiness-filters" aria-label="Kelengkapan task">{[['all','Semua detail'],['review','Perlu semakan admin'],['missing','Info belum cukup'],['ready','Confirmed · Designer'],['print','Ready print / cut']].map(([key,label])=><button key={key} aria-pressed={readinessFilter===key} onClick={()=>setReadinessFilter(key)}>{label}<b>{all.filter(t=>t.status!=='complete'&&(key==='all'||(key==='print'?t.readiness?.print_ready:t.readiness?.status===key))).length}</b></button>)}</nav>
  {error&&<div className="tw-alert" role="alert">{error} {data?'Data lama dikekalkan.':''}<button onClick={()=>void load()}>Cuba semula</button></div>}
  {data?.truncated&&<div className="tw-alert" role="alert">Had 1,000 task dicapai. Kiraan ini belum meliputi semua task.</div>}
  <div className="tw-count"><strong>{visible.length} task {completed?'selesai':'aktif'}</strong><span>Lain2 & Prospect diasingkan · Refresh automatik 30 saat</span></div>
  {!data&&loading?<p className="tw-empty" role="status">Memuatkan task…</p>:!visible.length?<p className="tw-empty">{error&&!data?'Data belum tersedia. Cuba semula.':'Tiada task untuk pilihan ini.'}</p>:<div className="tw-groups">{statuses.map(status=>{
   const rows=visible.filter(t=>t.status===status);if(!rows.length)return null;const open=!collapsed.has(status);
   return <section className="tw-group" key={status}><button className="tw-group-heading" aria-expanded={open} onClick={()=>setCollapsed(old=>{const next=new Set(old);if(next.has(status))next.delete(status);else next.add(status);return next;})}><Caret open={open}/><span className="tw-status" style={{background:colour(status)}}>{stateLabel(status)}</span><b>{rows.length}</b></button>
    {open&&<div className="tw-table-scroll"><table><thead><tr><th>Task / item</th><th className="tw-col-readiness">Detail / readiness</th>{show('phone')&&<th className="tw-col-phone">Telefon</th>}{show('sku')&&<th className="tw-col-sku">SKU</th>}{show('wording')&&<th className="tw-col-wording">Customize / wording</th>}<th className="tw-col-order">Order / customer</th><th className="tw-col-pic">PIC</th>{show('review')&&<th className="tw-col-review">Review</th>}<th className="tw-col-due">Due date</th>{show('courier')&&<th className="tw-col-courier">Courier</th>}<th>Set</th><th>Fail</th></tr></thead><tbody>{rows.map(task=><tr key={task.task_id} data-task-id={task.task_id} aria-selected={selected===task.task_id}>
     <td><button className="tw-task-name" onClick={()=>selectTask(task.task_id)}><i style={{borderColor:colour(status)}}/><span>{task.title}</span></button><span className={`tw-source ${task.source.toLowerCase()}`}>{task.source}</span>{task.native_status&&<span className="tw-native">iCetak</span>}</td>
     <td><button className="tw-readiness-open" onClick={()=>selectTask(task.task_id)}><ReadinessBadge readiness={task.readiness}/></button></td>
     {show('phone')&&<td>{task.phone||'—'}</td>}{show('sku')&&<td title={task.sku}>{task.sku||'—'}</td>}{show('wording')&&<td title={task.wording}>{task.wording||'—'}</td>}<td><button className="tw-reference" onClick={()=>selectTask(task.task_id)}>{task.order_reference||task.task_id}</button></td><td>{data?.staff.find(s=>s.username===task.assignee)?.name||task.assignee||'Belum ambil'}</td>{show('review')&&<td>{task.review_status||'—'}</td>}<td className={dueAt(task)&&new Date(dueAt(task)!).getTime()<Date.now()?'tw-overdue':''}>{date(dueAt(task))}</td>{show('courier')&&<td><span className="tw-courier">{task.courier||'—'}</span></td>}<td>{(task.sets||[]).map(set=><span className="tw-set" key={set}>{set}</span>)}</td><td>{task.file_count||task.images.length||'—'}</td>
    </tr>)}</tbody></table></div>}
   </section>;
  })}</div>}
  <footer className="tw-footer">{data?`Dibaca ${date(data.read_at)} · `:''}Status kerja iCetak disimpan berasingan daripada status asal ClickUp.</footer>
  {selected&&<TaskDetail key={selected} id={selected} request={request} canEdit={data?.can_edit||false} canConfirm={data?.can_confirm||false} queue={all} guard={navigationGuard} width={panelWidth} onWidth={setPanelWidth} staff={data?.staff||[]} actor={data?.actor||''} onClose={()=>{setSelected(null);navigationGuard.current=()=>true;const url=new URL(window.location.href);url.searchParams.delete('task');window.history.replaceState({},'',url);}} onSaved={()=>void load()} onOpenOrder={onOpenOrder} onOpenMarketplace={onOpenMarketplace}/>}
 </section>;
}

function TaskDetail({id,request,canEdit,canConfirm,queue,guard,width,onWidth,staff,actor,onClose,onSaved,onOpenOrder,onOpenMarketplace}:{id:string;request:typeof taskRequest;canEdit:boolean;canConfirm:boolean;queue:WorkTask[];guard:React.RefObject<()=>boolean>;width:number;onWidth:(width:number)=>void;staff:TaskSnapshot['staff'];actor:string;onClose:()=>void;onSaved:()=>void;onOpenOrder?:Props['onOpenOrder'];onOpenMarketplace?:Props['onOpenMarketplace']}){
 const panel=useRef<HTMLElement>(null),alive=useRef(true),loadSequence=useRef(0),retry=useRef<{signature:string;id:string}|null>(null);
 const [task,setTask]=useState<WorkTask|null>(()=>queue.find(t=>t.task_id===id)||null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[success,setSuccess]=useState('');
 const [highlight,setHighlight]=useState<string|null>(null),[handoffPreview,setHandoffPreview]=useState(false),[messagesOpen,setMessagesOpen]=useState(false);
 const uploading=useRef(false);
 const [form,setForm]=useState({stage:'',assignee:'',note:''}),[original,setOriginal]=useState(''),[briefDirty,setBriefDirty]=useState(false),[outputDirty,setOutputDirty]=useState(false);
 const workDirty=original!==''&&JSON.stringify(form)!==original,dirty=workDirty||briefDirty||outputDirty;
 const load=useCallback(async()=>{
  const sequence=++loadSequence.current;setLoading(true);try{const next=await request({action:'detail',task_id:id});if(!alive.current||sequence!==loadSequence.current)return;const row=next.items[0];if(!row)throw Error('Task ini tidak lagi tersedia.');setTask(row);setBriefDirty(false);const fields={stage:row.native_status?row.status:'',assignee:row.assignee,note:row.note};setForm(fields);setOriginal(JSON.stringify(fields));setError('');}
  catch(e){if(alive.current&&sequence===loadSequence.current)setError(e instanceof Error?e.message:'Detail gagal dimuat.');}finally{if(alive.current&&sequence===loadSequence.current)setLoading(false);}
 },[id,request]);
 useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;};},[load]);
 useEffect(()=>{guard.current=()=>!busy&&(!dirty||window.confirm('Buang perubahan yang belum disimpan?'));return()=>{guard.current=()=>true;};},[busy,dirty,guard]);
 useEffect(()=>{const navigate=(e:Event)=>{if(!guard.current())e.preventDefault();};const unload=(e:BeforeUnloadEvent)=>{if(busy||dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('icetak:before-navigate',navigate);window.addEventListener('beforeunload',unload);return()=>{window.removeEventListener('icetak:before-navigate',navigate);window.removeEventListener('beforeunload',unload);};},[busy,dirty,guard]);
 const close=()=>{if(busy)return;if(dirty&&!window.confirm('Buang perubahan yang belum disimpan?'))return;onClose();};
 async function save(){
  if(!task||busy)return;if(briefDirty){setError('Simpan brief sebelum simpan kerja.');return;}setBusy(true);setError('');setSuccess('');
  const signature=JSON.stringify([task.version,task.source_updated_at,form]);if(retry.current?.signature!==signature)retry.current={signature,id:crypto.randomUUID()};
  try{await request({action:'save',task_id:id,version:task.version,source_updated_at:task.source_updated_at,request_id:retry.current!.id,patch:form});await load();onSaved();setSuccess('Kerja disimpan.');}
  catch(e){setError(e instanceof Error?e.message:'Simpan gagal.');}finally{setBusy(false);}
 }
 async function upload(file:File){
  if(!task||busy||uploading.current)return;if(dirty){setError('Simpan perubahan sebelum upload fail.');return;}if(file.size>15728640){setError('Maksimum 15 MB setiap fail.');return;}
  uploading.current=true;setBusy(true);setError('');setSuccess('');const body=new FormData();body.set('payload',JSON.stringify({action:'upload',task_id:id,version:task.version,source_updated_at:task.source_updated_at,request_id:crypto.randomUUID()}));body.set('file',file);
  try{await request(body);await load();onSaved();setSuccess('Fail design disimpan.');}catch(e){setError(e instanceof Error?e.message:'Upload gagal.');}finally{uploading.current=false;setBusy(false);}
 }
 function source(messageId:string|null){setHighlight(messageId||'notes');setMessagesOpen(true);requestAnimationFrame(()=>document.getElementById(messageId?'tw-message-'+messageId:'tw-source-notes')?.scrollIntoView({block:'center',behavior:'smooth'}));}
 function resize(next:number){const value=Math.max(440,Math.min(850,window.innerWidth-200,next));onWidth(value);try{localStorage.setItem('icetak.task-panel-width.v1',String(value));}catch{}}
 async function providerChanged(options:PanelOptions){setTask(old=>old?{...old,source_status:options.status||old.source_status,status:options.status||old.status,native_status:false,review_status:options.review?.options.find(o=>o.id===options.review?.value)?.name||old.review_status}:old);await load();onSaved();}
 async function handoff(){
  if(!task?.readiness||busy||dirty)return;const r=task.readiness;
  const stage=r.values.product==='edible'?'edible image -printing':r.values.product==='wafer'?'wafer - printing':'cake topper - printing';
  const payload={action:'handoff',task_id:id,version:task.version,source_updated_at:task.source_updated_at,fingerprint:r.fingerprint,stage,assignee:form.assignee,note:form.note};
  const signature=JSON.stringify(payload);if(retry.current?.signature!==signature)retry.current={signature,id:crypto.randomUUID()};
  setBusy(true);setError('');try{await request({...payload,request_id:retry.current!.id});await load();onSaved();setHandoffPreview(false);setSuccess('Diserahkan ke queue Printing iCetak. Fail final dan QC dikekalkan.');}catch(e){setError(e instanceof Error?e.message:'Serahan gagal.');}finally{setBusy(false);}
 }
 return <aside className="tw-detail tw-side-panel" ref={panel} role="dialog" aria-modal="false" aria-labelledby="tw-detail-title" onKeyDown={e=>{if(e.key==='Escape'&&!panel.current?.querySelector('dialog[open]')){e.preventDefault();close();}}} style={{width:width+'px'}}>
  <div className="tp-resize" role="separator" aria-label="Lebar side panel" aria-orientation="vertical" aria-valuemin={440} aria-valuemax={850} aria-valuenow={width} tabIndex={0} onKeyDown={e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();resize(width+(e.key==='ArrowLeft'?30:-30));}}} onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))resize(window.innerWidth-e.clientX);}} onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}/>
  <header><div><small>TASK / {task?.sets.join(' · ')||id}</small><div className="tp-title"><h2 id="tw-detail-title">{task?.title||'Detail task'}</h2><CopyValue label="task name" value={task?.title||''}/></div><p>{task?.order_reference||id} · <a href={`https://app.clickup.com/t/${encodeURIComponent(id)}`} target="_blank" rel="noreferrer">Buka ClickUp ↗</a></p></div><button aria-label="Tutup task" disabled={busy} onClick={close}>×</button></header>
  <div className="tw-design-layout tp-layout">
   <main className="tw-detail-body tw-design-main">
    {task&&<TaskPanelControls task={task} blocked={dirty||busy} onBusy={setBusy} onChanged={providerChanged}/>}
    {error&&<div className="tw-alert" role="alert">{error}<button disabled={busy} onClick={()=>{if(!dirty||window.confirm('Refresh akan menggantikan perubahan belum disimpan. Teruskan?'))void load();}}>Refresh detail</button></div>}{success&&<p role="status" className="tw-success">{success}</p>}
    {loading&&!task?<p role="status">Mengumpulkan brief, gambar & mesej asal…</p>:task&&<>
     <div className="tw-detail-links"><button type="button" disabled={busy||loading} onClick={()=>{if(!dirty||window.confirm('Refresh akan menggantikan perubahan belum disimpan. Teruskan?'))void load();}}>{loading?'Menyemak…':'Semak semula sumber / chat'}</button><button onClick={()=>{const url=new URL(window.location.href);url.searchParams.set('admin','v2');url.searchParams.set('view','task-workspace');url.searchParams.set('task',id);navigator.clipboard.writeText(url.href).then(()=>setSuccess('Pautan task disalin.')).catch(()=>setError('Salin gagal.'));}}>Copy pautan task</button><button onClick={()=>{navigator.clipboard.writeText(task.order_reference||id).then(()=>setSuccess('Order ID disalin.')).catch(()=>setError('Salin gagal.'));}}>Copy Order ID</button><a href={`https://app.clickup.com/t/${encodeURIComponent(id)}`} target="_blank" rel="noreferrer">ClickUp ↗</a></div>
     <details className="tp-expand"><summary>Brief & arahan designer</summary><TaskDesignSummary task={task} onSource={source}/></details>
     <TaskPanelOutput taskId={id} canEdit={canEdit&&!/^(complete|closed|cancelled|canceled)$/i.test(task.source_status)} blocked={workDirty||briefDirty||busy} onBusy={setBusy} onDirty={setOutputDirty} onSaved={async()=>{await load();onSaved();}}/>
     <details className="tp-expand"><summary>Gambar customer & template</summary><section className="tw-design-assets" aria-label="Bahan asal untuk design"><div className="tw-section-heading"><div><span className="tw-eyebrow">BAHAN DESIGN</span><h3>Gambar & template</h3></div><button type="button" onClick={()=>source(null)}>Baca arahan asal →</button></div>
      <p className="tw-muted">Gambar chat ialah bahan rujukan; label Dipilih menunjukkan artwork dalam brief. Copy gambar mengekalkan resolusi fail yang tersedia.</p>
      <div className="tw-asset-grid">{(task.dossier?.assets||[]).filter(a=>a.kind!=='file'&&a.direction!=='outbound'&&!['payment','order'].includes(a.purpose||'')).map(a=><TaskAssetCard key={a.id+':'+a.url} asset={a} taskId={id}/>)}</div>
      {!task.dossier?.assets.some(a=>a.kind!=='file'&&a.direction!=='outbound'&&!['payment','order'].includes(a.purpose||''))&&<p className="tw-empty-assets">Belum ada gambar yang dapat dibuka untuk task ini. Semak mesej asal dan keadaan padanan channel.</p>}
     </section></details>
     <TaskBrief key={`${task.readiness?.fingerprint}:${task.readiness?.version}`} task={task} request={request} canConfirm={canConfirm} busy={busy} workDirty={workDirty} onBusy={setBusy} onDirty={setBriefDirty} onSaved={async()=>{await load();onSaved();}}/>
     <details className="tp-expand"><summary>Fail internal, QC & serahan production</summary><section className="tw-result-section" aria-label="Hasil design dan serahan"><div className="tw-section-heading"><div><span className="tw-eyebrow">HASIL KERJA</span><h3>Design siap & production</h3></div><span>{task.files.length} fail</span></div>
      {canEdit&&<label className="tw-upload" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const file=e.dataTransfer.files[0];if(file)void upload(file);}}>{busy?'Memproses…':'Paste gambar di ruang ini, drop fail atau pilih fail'}<input aria-label="Upload hasil design" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" disabled={busy||dirty} onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);e.target.value='';}}/><small>PNG, JPG, WebP, PDF · maksimum 15 MB · simpan brief sebelum upload</small></label>}
      <div className="tw-asset-grid">{(task.dossier?.assets||[]).filter(a=>a.kind==='file').map(a=><TaskAssetCard key={a.id+':'+a.url} asset={a} taskId={id}/>)}</div>
      <p className="tw-muted">{task.readiness?.print_ready?'Fail final dan QC lengkap. Boleh serahkan ke queue Printing.':task.readiness?.print_missing.join(' · ')}</p>
      <button type="button" className="tw-handoff-button" disabled={!canEdit||busy||dirty||!task.readiness?.print_ready} onClick={()=>setHandoffPreview(true)}>Serah ke production</button>
      {handoffPreview&&<div className="tw-handoff-preview"><h4>Semak serahan production</h4><p>Order {task.order_reference} · {task.sets.join(' · ')}</p><p>Fail final: {task.files.find(f=>f.id===task.readiness?.form.final_file_id)?.name}</p><p>PIC: {staff.find(s=>s.username===form.assignee)?.name||'Queue production · belum ditugaskan'}</p><p>Serahan ini mengemas kini queue iCetak. Sync attachment/status ke ClickUp belum disambungkan.</p><button type="button" disabled={busy} onClick={()=>void handoff()}>Sahkan serahan iCetak</button><button type="button" disabled={busy} onClick={()=>setHandoffPreview(false)}>Batal</button></div>}
     </section></details>
     <details className="tw-work-settings"><summary>PIC, nota kerja & status iCetak</summary><form onSubmit={e=>{e.preventDefault();void save();}}><label>PIC<select aria-label="PIC task" disabled={!canEdit||busy} value={form.assignee} onChange={e=>setForm({...form,assignee:e.target.value})}><option value="">Belum ditugaskan</option>{staff.map(s=><option key={s.username} value={s.username}>{s.name}</option>)}</select></label>{canEdit&&<button type="button" disabled={busy} onClick={()=>setForm({...form,assignee:actor})}>Ambil task ini</button>}<label>Status kerja<select aria-label="Status kerja iCetak" disabled={!canEdit||busy} value={form.stage} onChange={e=>setForm({...form,stage:e.target.value})}><option value="">Ikut status ClickUp</option>{workStatuses.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>Nota designer / production<textarea aria-label="Nota designer / production" rows={4} maxLength={10000} disabled={!canEdit||busy} value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></label><button className="tw-save" disabled={!canEdit||busy||!workDirty||briefDirty}>{busy?'Menyimpan…':'Simpan kerja'}</button></form></details>
     <details className="tw-work-settings"><summary>Fakta order & aktiviti</summary><dl className="tw-facts"><div><dt>Status ClickUp</dt><dd>{stateLabel(task.source_status)}</dd></div><div><dt>Telefon</dt><dd>{task.phone||'Belum diketahui'}</dd></div><div><dt>Due / ship by</dt><dd>{date(dueAt(task))}</dd></div><div><dt>Bayaran / fulfillment</dt><dd>{task.payment_status||'Belum diketahui'} · {task.fulfillment_status||'Belum diketahui'}</dd></div></dl><div className="tw-detail-links">{task.order_id&&onOpenOrder&&<button onClick={()=>{if(!dirty||window.confirm('Buang perubahan belum disimpan?'))onOpenOrder(task.order_id!);}}>Order iCetak ↗</button>}{task.marketplace_order_id&&onOpenMarketplace&&<button onClick={()=>{if(!dirty||window.confirm('Buang perubahan belum disimpan?'))onOpenMarketplace(task.order_reference);}}>Order Shopee ↗</button>}</div><section className="tw-history">{task.history?.map((event,i)=><article key={i}><b>{event.actor}</b><span>{event.kind==='upload'?'Upload fail':event.stage?stateLabel(event.stage):'Kemas kini kerja'}</span><time>{date(event.at)}</time></article>)}</section></details>
    </>}
   {task&&<details className="tp-expand tp-messages" open={messagesOpen} onToggle={e=>setMessagesOpen(e.currentTarget.open)}><summary>Chat asal Shopee / WhatsApp</summary><TaskMessages task={task} highlight={highlight} onHighlight={setHighlight}/></details>}
   </main>
  </div>
 </aside>;
}
