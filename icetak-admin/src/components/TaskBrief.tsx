import {useRef,useState} from 'react';
import {taskRequest,type WorkTask,type TaskReadiness,type BriefForm} from '../lib/taskWorkspace';
const labels:Record<string,string>={product:'Produk',quantity:'Kuantiti',size:'Saiz',shape:'Bentuk',material:'Material',colour:'Warna',mode:'Keperluan design',name:'Nama',age:'Umur',wording:'Wording tepat',artwork:'Gambar dipilih (URL)',template:'Kod / template',instructions:'Arahan designer'};
const modes=[['wording','Wording / nama tepat'],['name_age','Nama + umur'],['image','Gambar'],['image_wording','Gambar + wording'],['template','Template sedia ada'],['standard','Standard tanpa customization']];
const time=(v:string|null)=>v?new Date(v).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur'}):'';
export function ReadinessBadge({readiness:r}:{readiness?:TaskReadiness}){
 return <span className={`tw-readiness ${r?.status||'review'}`}><strong>{r?.label||'Belum disemak'}</strong><small>{r?`${r.completeness}% lengkap · Keyakinan ${{high:'tinggi',medium:'sederhana',low:'rendah'}[r.confidence]}`:'Buka untuk semakan'}</small>{r?.missing.length?<small className="tw-missing">Kurang: {r.missing.slice(0,3).map(m=>m.label).join(', ')}{r.missing.length>3?'…':''}</small>:null}</span>;
}
type Props={task:WorkTask;request:typeof taskRequest;canConfirm:boolean;busy:boolean;workDirty:boolean;onBusy:(busy:boolean)=>void;onDirty:(dirty:boolean)=>void;onSaved:()=>Promise<void>};
export default function TaskBrief({task,request,canConfirm,busy,workDirty,onBusy,onDirty,onSaved}:Props){
 const r=task.readiness;
 const [form,setForm]=useState<BriefForm>(()=>r?.form||{values:{},same_design:false,final_file_id:'',artwork_qc:false,customer_approved:false}),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const retry=useRef<{signature:string;id:string}|null>(null);
 if(!r)return <section className="tw-brief"><ReadinessBadge/><p>Brief belum dapat disemak. Refresh detail untuk mendapatkan sumber semasa.</p></section>;
 const disabled=!canConfirm||busy;
 function update(next:BriefForm){setForm(next);onDirty(JSON.stringify(next)!==JSON.stringify(r!.form));setNotice('');retry.current=null;}
 function value(key:string,v:string){update({...form,values:{...form.values,[key]:v}});}
 async function save(confirm:boolean){
  if(workDirty){setError('Simpan perubahan kerja sebelum semak brief.');return;}
  const signature=JSON.stringify([r!.version,r!.fingerprint,form,confirm]);if(retry.current?.signature!==signature)retry.current={signature,id:crypto.randomUUID()};
  onBusy(true);setError('');setNotice('');
  try{await request({action:'brief_save',task_id:task.task_id,version:r!.version,fingerprint:r!.fingerprint,request_id:retry.current!.id,brief:form,confirm});onDirty(false);await onSaved();}
  catch(e){setError(e instanceof Error?e.message:'Brief gagal disimpan.');}finally{onBusy(false);}
 }
 async function copy(){
  const lines=[`BRIEF ${task.order_reference||task.task_id} · ${task.sets.join(', ')||task.task_id}`,r!.label,...Object.entries(r!.values).filter(([,v])=>v).map(([k,v])=>`${labels[k]||k}: ${v}`),`Pengesahan: ${r!.confirmed_by||'Belum disahkan'}`,`Print / cut: ${r!.print_ready?'Ready':r!.print_missing.join('; ')}`];
  try{await navigator.clipboard.writeText(lines.join('\n'));setNotice('Brief disalin.');}catch{setError('Salin gagal. Pilih teks brief untuk salin.');}
 }
 const visible=['product','quantity','size',...(['edible','wafer'].includes(form.values.product)?['shape']:[]),...(['acrylic','topper'].includes(form.values.product)?['material','colour']:[]),'mode',...(['name_age'].includes(form.values.mode)?['name','age']:[]),...(['wording','image_wording'].includes(form.values.mode)?['wording']:[]),...(['image','image_wording'].includes(form.values.mode)?['artwork']:[]),...(['template','standard'].includes(form.values.mode)?['template']:[]),'instructions'];
 const artwork=r.artwork_url||(/^https:\/\//i.test(r.values.artwork||'')?r.values.artwork:'');
 return <section className="tw-brief" aria-label="Brief designer dan production">
  <div className="tw-brief-top"><div><h3>Brief designer / production</h3><ReadinessBadge readiness={r}/></div><button type="button" onClick={()=>void copy()}>Copy brief</button></div>
  <p className="tw-muted">{r.confidence_reason}{r.confirmed_by?` · ${r.confirmed_by}`:''}{r.confirmed_at?` · ${time(r.confirmed_at)}`:''}</p>
  {r.expired&&<p className="tw-brief-warning">CONFIRMED lama tidak lagi sah. Semak semula sumber yang berubah.</p>}
  {r.expired&&r.previous_values&&<details className="tw-brief-evidence"><summary>Banding brief terdahulu · belum disahkan semula</summary>{Object.entries(r.previous_values).filter(([,v])=>v).map(([k,v])=><p key={k}><b>{labels[k]||k}:</b> {v}</p>)}</details>}
  {r.warnings.map(w=><p className="tw-brief-warning" key={w}>{w}</p>)}
  {r.conflicts.length>0&&<details className="tw-brief-evidence" open><summary>Nilai berbeza daripada sumber</summary>{r.conflicts.map((c,i)=><p key={i}><b>{c.label}:</b> {c.value} <small>· {c.source}</small></p>)}</details>}
  {error&&<p className="tw-alert" role="alert">{error}</p>}{notice&&<p role="status" className="tw-success">{notice}</p>}
  <form onSubmit={e=>{e.preventDefault();void save(false);}}>
   <div className="tw-brief-grid">{visible.map(k=><label key={k} className={['wording','instructions','artwork'].includes(k)?'tw-wide':''}>{labels[k]} {r.required.includes(k)?<em>*</em>:null}
    {k==='product'?<select aria-label={`Brief ${labels[k]}`} value={form.values[k]||''} disabled={disabled} onChange={e=>value(k,e.target.value)}><option value="">Pilih produk</option>{['edible','topper','acrylic','wafer'].map(x=><option value={x} key={x}>{x}</option>)}</select>:k==='mode'?<select aria-label={`Brief ${labels[k]}`} value={form.values[k]||''} disabled={disabled} onChange={e=>value(k,e.target.value)}><option value="">Pilih keperluan</option>{modes.map(([v,l])=><option value={v} key={v}>{l}</option>)}</select>:['wording','instructions'].includes(k)?<textarea aria-label={`Brief ${labels[k]}`} rows={k==='wording'?3:2} maxLength={k==='instructions'?3000:2000} value={form.values[k]||''} disabled={disabled} onChange={e=>value(k,e.target.value)}/>:<input aria-label={`Brief ${labels[k]}`} type={k==='quantity'||k==='age'?'number':'text'} min={k==='quantity'?1:0} maxLength={2000} value={form.values[k]||''} disabled={disabled} onChange={e=>value(k,e.target.value)}/>}
    <small>{r.sources[k]?.source||'Belum ada sumber'}</small>
    {k==='artwork'&&task.files.some(f=>f.mime.startsWith('image/'))&&<select aria-label="Pilih gambar asal task" disabled={disabled} value={form.values.artwork?.startsWith('task-file://')?form.values.artwork.slice(12):''} onChange={e=>{if(e.target.value)value('artwork','task-file://'+e.target.value);}}><option value="">Atau pilih gambar yang diupload ke task</option>{task.files.filter(f=>f.mime.startsWith('image/')).map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select>}
   </label>)}</div>
   {artwork&&<a className="tw-brief-artwork" href={artwork} target="_blank" rel="noreferrer"><img src={artwork} alt="Artwork dipilih untuk task ini"/>Buka gambar dipilih ↗</a>}
   {(Number(form.values.quantity)>1||task.sets.length>1)&&<label className="tw-brief-check"><input type="checkbox" disabled={disabled} checked={form.same_design} onChange={e=>update({...form,same_design:e.target.checked})}/>Semua unit / set dalam task ini guna design dan detail yang sama</label>}
   <details className="tw-print-check"><summary>Semakan print / cut · {r.print_ready?'Ready':r.print_missing.length+' perkara belum lengkap'}</summary><label>Fail final task ini<select aria-label="Fail final task ini" disabled={disabled} value={form.final_file_id} onChange={e=>update({...form,final_file_id:e.target.value,artwork_qc:false})}><option value="">Pilih fail final selepas upload</option>{task.files.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label><label className="tw-brief-check"><input type="checkbox" checked={form.artwork_qc} disabled={disabled} onChange={e=>update({...form,artwork_qc:e.target.checked})}/>Saiz, resolusi, warna dan layout artwork final telah disemak</label>{r.review_required&&<label className="tw-brief-check"><input type="checkbox" checked={form.customer_approved} disabled={disabled} onChange={e=>update({...form,customer_approved:e.target.checked})}/>Saya telah semak bukti kelulusan customer untuk artwork ini</label>}</details>
   {canConfirm?<div className="tw-brief-actions"><button type="submit" disabled={busy||workDirty}>Simpan draf brief</button><button type="button" className="tw-confirm" disabled={busy||workDirty} onClick={()=>void save(true)}>{busy?'Menyemak…':'Sahkan · Ready designer'}</button></div>:<p className="tw-muted">Admin dengan kebenaran edit order / manage customers boleh sahkan brief ini.</p>}
   <small className="tw-muted">Confirmed merekod semakan detail dalam iCetak. Bayaran dan status order dipaparkan berasingan.</small>
  </form>
  <details className="tw-brief-evidence"><summary>Bukti & sumber · {r.chat_linked?'Chat dipadankan':'Tiada chat dipadankan'}</summary>{r.evidence.length?r.evidence.map(e=><blockquote key={e.id}>{e.text}<small>{time(e.at)} · {e.id}</small></blockquote>):<p>Tiada detail tambahan daripada chat yang dapat dipadankan secara selamat.</p>}<small>Disemak {time(r.checked_at)}</small></details>
 </section>;
}
