import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {taskRequest,workStatuses,workMatches,dueAt,type WorkTask,type TaskSnapshot} from '../lib/taskWorkspace';
import './TaskWorkspace.css';
import TaskBrief,{ReadinessBadge} from '../components/TaskBrief';

const tabs=[['all','Semua task'],['designer','Designer'],['printing','Printing'],['acrylic','Acrylic / Laser'],['mine','Kerja saya']];
const date=(value:string|null|undefined)=>value&&!Number.isNaN(new Date(value).getTime())?new Date(value).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
const stateLabel=(status:string)=>workStatuses.find(s=>s[0]===status)?.[1]||status;
const colour=(status:string)=>workStatuses.find(s=>s[0]===status)?.[2]||'#aaa';
type Props={request?:typeof taskRequest;onOpenOrder?:(reference:string)=>void;onOpenMarketplace?:(reference:string)=>void};
function Caret({open}:{open:boolean}){return <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{transform:open?'rotate(90deg)':undefined}}><path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.6"/></svg>;}
export default function TaskWorkspace({request=taskRequest,onOpenOrder,onOpenMarketplace}:Props){
 const [data,setData]=useState<TaskSnapshot|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const [view,setView]=useState('all'),[query,setQuery]=useState(''),[sort,setSort]=useState('due'),[completed,setCompleted]=useState(false),[readinessFilter,setReadinessFilter]=useState('all');
 const [collapsed,setCollapsed]=useState<Set<string>>(()=>new Set()),[selected,setSelected]=useState<string|null>(null),[light,setLight]=useState(false);
 const [columns,setColumns]=useState(()=>{try{return JSON.parse(localStorage.getItem('icetak.task-columns.v1')||'{}') as Record<string,boolean>;}catch{return {};}});
 const mounted=useRef(true),inflight=useRef(false);
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
 return <section className={`tw-workspace ${light?'tw-light':''}`}>
  <header className="tw-heading"><div><h1>Task Workspace</h1><p>Design, review & production dalam satu tempat.</p></div><div className="tw-live"><i/>{data?`Webhook ${date(data.last_webhook_at)}`:'Menyambung…'}</div></header>
  <nav className="tw-tabs" aria-label="View kerja">{tabs.map(([key,label])=><button key={key} aria-pressed={view===key} onClick={()=>{setView(key);setCompleted(false);}}>{label}<span>{all.filter(t=>t.status!=='complete'&&workMatches(t,key,'',data?.actor||'')).length}</span></button>)}</nav>
  <div className="tw-toolbar"><input aria-label="Cari task" placeholder="Cari order, nama, SKU, telefon atau wording…" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Susunan task" value={sort} onChange={e=>setSort(e.target.value)}><option value="due">Due paling dekat</option><option value="latest">Update terbaru</option></select><details><summary>Columns</summary><div className="tw-column-menu">{[['phone','Telefon'],['sku','SKU'],['wording','Wording'],['review','Review'],['courier','Courier']].map(([key,label])=><label key={key}><input type="checkbox" checked={show(key)} onChange={()=>toggleColumn(key)}/>{label}</label>)}</div></details><button aria-pressed={completed} onClick={()=>setCompleted(!completed)}>Selesai <span>{all.filter(t=>t.status==='complete').length}</span></button><button onClick={()=>setLight(!light)}>{light?'Dark':'Light'}</button><button disabled={loading} onClick={()=>void load()}>{loading?'Memuatkan…':'Refresh'}</button></div>
  <nav className="tw-readiness-filters" aria-label="Kelengkapan task">{[['all','Semua detail'],['review','Perlu semakan admin'],['missing','Info belum cukup'],['ready','Confirmed · Designer'],['print','Ready print / cut']].map(([key,label])=><button key={key} aria-pressed={readinessFilter===key} onClick={()=>setReadinessFilter(key)}>{label}<b>{all.filter(t=>t.status!=='complete'&&(key==='all'||(key==='print'?t.readiness?.print_ready:t.readiness?.status===key))).length}</b></button>)}</nav>
  {error&&<div className="tw-alert" role="alert">{error} {data?'Data lama dikekalkan.':''}<button onClick={()=>void load()}>Cuba semula</button></div>}
  {data?.truncated&&<div className="tw-alert" role="alert">Had 1,000 task dicapai. Kiraan ini belum meliputi semua task.</div>}
  <div className="tw-count"><strong>{visible.length} task {completed?'selesai':'aktif'}</strong><span>Lain2 & Prospect diasingkan · Refresh automatik 30 saat</span></div>
  {!data&&loading?<p className="tw-empty" role="status">Memuatkan task…</p>:!visible.length?<p className="tw-empty">{error&&!data?'Data belum tersedia. Cuba semula.':'Tiada task untuk pilihan ini.'}</p>:<div className="tw-groups">{statuses.map(status=>{
   const rows=visible.filter(t=>t.status===status);if(!rows.length)return null;const open=!collapsed.has(status);
   return <section className="tw-group" key={status}><button className="tw-group-heading" aria-expanded={open} onClick={()=>setCollapsed(old=>{const next=new Set(old);if(next.has(status))next.delete(status);else next.add(status);return next;})}><Caret open={open}/><span className="tw-status" style={{background:colour(status)}}>{stateLabel(status)}</span><b>{rows.length}</b></button>
    {open&&<div className="tw-table-scroll"><table><thead><tr><th>Task / item</th><th className="tw-col-readiness">Detail / readiness</th>{show('phone')&&<th className="tw-col-phone">Telefon</th>}{show('sku')&&<th className="tw-col-sku">SKU</th>}{show('wording')&&<th className="tw-col-wording">Customize / wording</th>}<th className="tw-col-order">Order / customer</th><th className="tw-col-pic">PIC</th>{show('review')&&<th className="tw-col-review">Review</th>}<th className="tw-col-due">Due date</th>{show('courier')&&<th className="tw-col-courier">Courier</th>}<th>Set</th><th>Fail</th></tr></thead><tbody>{rows.map(task=><tr key={task.task_id} data-task-id={task.task_id}>
     <td><button className="tw-task-name" onClick={()=>setSelected(task.task_id)}><i style={{borderColor:colour(status)}}/><span>{task.title}</span></button><span className={`tw-source ${task.source.toLowerCase()}`}>{task.source}</span>{task.native_status&&<span className="tw-native">iCetak</span>}</td>
     <td><button className="tw-readiness-open" onClick={()=>setSelected(task.task_id)}><ReadinessBadge readiness={task.readiness}/></button></td>
     {show('phone')&&<td>{task.phone||'—'}</td>}{show('sku')&&<td title={task.sku}>{task.sku||'—'}</td>}{show('wording')&&<td title={task.wording}>{task.wording||'—'}</td>}<td><button className="tw-reference" onClick={()=>setSelected(task.task_id)}>{task.order_reference||task.task_id}</button></td><td>{data?.staff.find(s=>s.username===task.assignee)?.name||task.assignee||'Belum ambil'}</td>{show('review')&&<td>{task.review_status||'—'}</td>}<td className={dueAt(task)&&new Date(dueAt(task)!).getTime()<Date.now()?'tw-overdue':''}>{date(dueAt(task))}</td>{show('courier')&&<td><span className="tw-courier">{task.courier||'—'}</span></td>}<td>{(task.sets||[]).map(set=><span className="tw-set" key={set}>{set}</span>)}</td><td>{task.file_count||task.images.length||'—'}</td>
    </tr>)}</tbody></table></div>}
   </section>;
  })}</div>}
  <footer className="tw-footer">{data?`Dibaca ${date(data.read_at)} · `:''}Status kerja iCetak disimpan berasingan daripada status asal ClickUp.</footer>
  {selected&&<TaskDetail key={selected} id={selected} request={request} canEdit={data?.can_edit||false} canConfirm={data?.can_confirm||false} staff={data?.staff||[]} actor={data?.actor||''} onClose={()=>setSelected(null)} onSaved={()=>void load()} onOpenOrder={onOpenOrder} onOpenMarketplace={onOpenMarketplace}/>}
 </section>;
}

function TaskDetail({id,request,canEdit,canConfirm,staff,actor,onClose,onSaved,onOpenOrder,onOpenMarketplace}:{id:string;request:typeof taskRequest;canEdit:boolean;canConfirm:boolean;staff:TaskSnapshot['staff'];actor:string;onClose:()=>void;onSaved:()=>void;onOpenOrder?:Props['onOpenOrder'];onOpenMarketplace?:Props['onOpenMarketplace']}){
 const dialog=useRef<HTMLDialogElement>(null),alive=useRef(true),retry=useRef<{signature:string;id:string}|null>(null);
 const [task,setTask]=useState<WorkTask|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[success,setSuccess]=useState('');
 const [form,setForm]=useState({stage:'',assignee:'',note:''}),[original,setOriginal]=useState(''),[briefDirty,setBriefDirty]=useState(false);
 const workDirty=original!==''&&JSON.stringify(form)!==original,dirty=workDirty||briefDirty;
 const load=useCallback(async()=>{
  setLoading(true);try{const next=await request({action:'detail',task_id:id});if(!alive.current)return;const row=next.items[0];if(!row)throw Error('Task ini tidak lagi tersedia.');setTask(row);setBriefDirty(false);const fields={stage:row.native_status?row.status:'',assignee:row.assignee,note:row.note};setForm(fields);setOriginal(JSON.stringify(fields));setError('');}
  catch(e){if(alive.current)setError(e instanceof Error?e.message:'Detail gagal dimuat.');}finally{if(alive.current)setLoading(false);}
 },[id,request]);
 useEffect(()=>{alive.current=true;dialog.current?.showModal();void load();return()=>{alive.current=false;};},[load]);
 const close=()=>{if(busy)return;if(dirty&&!window.confirm('Buang perubahan yang belum disimpan?'))return;onClose();};
 async function save(){
  if(!task||busy)return;if(briefDirty){setError('Simpan brief sebelum simpan kerja.');return;}setBusy(true);setError('');setSuccess('');
  const signature=JSON.stringify([task.version,task.source_updated_at,form]);if(retry.current?.signature!==signature)retry.current={signature,id:crypto.randomUUID()};
  try{await request({action:'save',task_id:id,version:task.version,source_updated_at:task.source_updated_at,request_id:retry.current!.id,patch:form});await load();onSaved();setSuccess('Kerja disimpan.');}
  catch(e){setError(e instanceof Error?e.message:'Simpan gagal.');}finally{setBusy(false);}
 }
 async function upload(file:File){
  if(!task||busy)return;if(dirty){setError('Simpan perubahan sebelum upload fail.');return;}if(file.size>15728640){setError('Maksimum 15 MB setiap fail.');return;}
  setBusy(true);setError('');setSuccess('');const body=new FormData();body.set('payload',JSON.stringify({action:'upload',task_id:id,version:task.version,source_updated_at:task.source_updated_at,request_id:crypto.randomUUID()}));body.set('file',file);
  try{await request(body);await load();onSaved();setSuccess('Fail design disimpan.');}catch(e){setError(e instanceof Error?e.message:'Upload gagal.');}finally{setBusy(false);}
 }
 return <dialog className="tw-detail" ref={dialog} onCancel={e=>{e.preventDefault();close();}} aria-labelledby="tw-detail-title"><header><div><small>Task / {task?.sets.join(' · ')||id}</small><h2 id="tw-detail-title">{task?.title||'Detail task'}</h2><p>{task?.order_reference||id}</p></div><button aria-label="Tutup task" disabled={busy} onClick={close}>×</button></header>
  <div className="tw-detail-body">{error&&<div className="tw-alert" role="alert">{error}<button disabled={busy} onClick={()=>{if(!dirty||window.confirm('Refresh akan menggantikan perubahan belum disimpan. Teruskan?'))void load();}}>Refresh detail</button></div>}{success&&<p role="status" className="tw-success">{success}</p>}{loading&&!task?<p>Memuatkan detail…</p>:task&&<>
   <div className="tw-detail-links"><a href={`https://app.clickup.com/t/${encodeURIComponent(id)}`} target="_blank" rel="noreferrer">Task ClickUp ↗</a>{task.order_id&&onOpenOrder&&<button onClick={()=>{if(!dirty||window.confirm('Buang perubahan belum disimpan?'))onOpenOrder(task.order_id!);}}>Order iCetak ↗</button>}{task.marketplace_order_id&&onOpenMarketplace&&<button onClick={()=>{if(!dirty||window.confirm('Buang perubahan belum disimpan?'))onOpenMarketplace(task.order_reference);}}>Order Shopee ↗</button>}<button onClick={()=>{navigator.clipboard.writeText(task.order_reference||id).then(()=>setSuccess('Order ID disalin.')).catch(()=>setError('Salin gagal.'));}}>Copy Order ID</button></div>
   <div className="tw-detail-links"><button type="button" disabled={busy||loading} onClick={()=>{if(!dirty||window.confirm('Refresh akan menggantikan perubahan belum disimpan. Teruskan?'))void load();}}>{loading?'Menyemak…':'Semak semula sumber / chat'}</button></div>
   <TaskBrief key={`${task.readiness?.fingerprint}:${task.readiness?.version}`} task={task} request={request} canConfirm={canConfirm} busy={busy} workDirty={workDirty} onBusy={setBusy} onDirty={setBriefDirty} onSaved={async()=>{await load();onSaved();}}/>
   <dl className="tw-facts"><div><dt>Status ClickUp</dt><dd>{stateLabel(task.source_status)}</dd></div><div><dt>Sumber</dt><dd>{task.source} · {task.mapping_status==='conflict'?'Pautan perlu disemak':task.order_id||task.marketplace_order_id?'Order dipadankan':'Order belum dipautkan'}</dd></div><div><dt>Telefon</dt><dd>{task.phone||'—'}</dd></div><div><dt>SKU</dt><dd>{task.sku||'—'}</dd></div><div><dt>Due / ship by</dt><dd>{date(dueAt(task))}</dd></div><div><dt>Tarikh perlu</dt><dd>{task.needed_at||'—'}</dd></div><div><dt>Payment</dt><dd>{task.payment_status||'Belum diketahui'}</dd></div><div><dt>Fulfillment</dt><dd>{task.fulfillment_status||'Belum diketahui'}</dd></div></dl>
   <section className="tw-wording"><h3>Customize / wording asal</h3><p>{task.wording||'Belum tersedia dalam data task.'}</p></section>
   <div className="tw-artwork"><h3>Design & fail kerja</h3>{task.images.map(img=><a key={img.url} href={img.url} target="_blank" rel="noreferrer"><img src={img.url} alt={img.name} referrerPolicy="no-referrer" loading="lazy"/></a>)}{task.files.map(file=><a className="tw-file" key={file.id} href={file.url} target="_blank" rel="noreferrer">{file.mime.startsWith('image/')&&<img src={file.url} alt={file.name}/>}<span>{file.name}<small>{file.uploaded_by} · {date(file.created_at)}</small></span></a>)}{!task.images.length&&!task.files.length&&<p className="tw-muted">Belum ada design yang direkodkan.</p>}{canEdit&&<label className="tw-upload">{busy?'Memproses…':'Upload design / PDF'}<input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" disabled={busy||dirty} onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);e.target.value='';}}/><small>PNG, JPG, WebP, PDF · maksimum 15 MB</small></label>}</div>
   <form onSubmit={e=>{e.preventDefault();void save();}}><h3>Kerja iCetak</h3><label>PIC<select disabled={!canEdit||busy} value={form.assignee} onChange={e=>setForm({...form,assignee:e.target.value})}><option value="">Belum ambil</option>{staff.map(s=><option key={s.username} value={s.username}>{s.name}</option>)}</select></label>{canEdit&&<button type="button" disabled={busy} onClick={()=>setForm({...form,assignee:actor})}>Ambil task ini</button>}<label>Status kerja<select disabled={!canEdit||busy} value={form.stage} onChange={e=>setForm({...form,stage:e.target.value})}><option value="">Ikut status ClickUp</option>{workStatuses.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>Nota designer / production<textarea rows={5} maxLength={10000} disabled={!canEdit||busy} value={form.note} onChange={e=>setForm({...form,note:e.target.value})} placeholder="Arahan kerja, semakan design atau nota untuk production…"/></label><p className="tw-muted">Status ini untuk workspace iCetak. Status ClickUp dan penghantaran dikekalkan pada sumber masing-masing.</p><button className="tw-save" disabled={!canEdit||busy||!workDirty||briefDirty}>{busy?'Menyimpan…':'Simpan kerja'}</button></form>
   <section className="tw-history"><h3>Aktiviti iCetak</h3>{task.history?.length?task.history.map((event,i)=><article key={i}><b>{event.actor}</b><span>{event.kind==='upload'?'Upload fail':event.stage?stateLabel(event.stage):'Kemas kini kerja'}</span><time>{date(event.at)}</time></article>):<p className="tw-muted">Belum ada aktiviti iCetak.</p>}</section>
  </>}</div>
 </dialog>;
}
