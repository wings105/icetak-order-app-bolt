import { useState } from 'react';

type Example = {id:string; question:string; answer:string; topics:string[]};
type Thread = {id:string;last_at:string;n:number};
type Message = {id:string;at:string;direction:string;source:string;body:string};
type Props = {
 api:(body:Record<string,unknown>)=>Promise<Record<string,any>>;
 onTest:(example:Example)=>void;
};
const topics=['Saiz','Fail dan design','Edible dan wafer','Penghantaran','Penghargaan','Bayaran','Harga','Pickup','Penyimpanan','Tempahan','Masa dan urgent','Topper','Potongan','Semakan','Sapaan dan pengesahan','Media dan lampiran','Lain-lain'];

export default function WhatsAppExamples({api,onTest}:Props){
 const [search,setSearch]=useState('');
 const [category,setCategory]=useState('');
 const [page,setPage]=useState<{rows:Example[];total:number;offset:number;search:string;category:string}|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [archive,setArchive]=useState<{kind:string;rows:(Thread|Message)[];total:number;offset:number}|null>(null);
 const [threadOffset,setThreadOffset]=useState(0);
 async function history(kind:string,offset:number){
  setBusy(true);setError('');
  try{
   const result=await api({action:'examples',category:kind,offset});
   setArchive({kind,offset,total:result.total,rows:result.rows});
   if(kind==='__threads')setThreadOffset(offset);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function read(offset:number,phrase:string,topic:string){
  setBusy(true);setError('');
  try{
   const data=await api({action:'examples',search:phrase,category:topic,offset});
   setPage({rows:data.rows,total:data.total,offset,search:phrase,category:topic});
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <details className="kb-panel"><summary>Soalan dan balasan asal WhatsApp</summary>
 <form className="kb-actions" onSubmit={event=>{event.preventDefault();void read(0,search,category);}}>
 <input aria-label="Cari dalam soalan WhatsApp" value={search} maxLength={100} onChange={event=>setSearch(event.target.value)} placeholder="Cari perkataan pelanggan"/>
 <select aria-label="Kategori sejarah WhatsApp" value={category} onChange={event=>setCategory(event.target.value)}><option value="">Semua kategori</option>{topics.map(t=><option key={t}>{t}</option>)}</select><button disabled={busy}>{busy?'Memuatkan…':'Papar rekod'}</button></form>
 {error&&<p role="alert">{error}</p>}
 {page&&<><p>{page.total? (page.offset+1)+'–'+(page.offset+page.rows.length)+' daripada '+page.total+' pasangan mesej':'Tiada rekod sepadan'}</p>
 {page.rows.map(row=><details key={row.id}><summary>{row.topics.join(' · ')} — {row.question.slice(0,110)}</summary><p style={{whiteSpace:'pre-wrap'}}>{row.question}</p><strong>Balasan kedai</strong><p style={{whiteSpace:'pre-wrap'}}>{row.answer}</p><button onClick={()=>onTest(row)}>Guna soalan dalam ujian</button></details>)}
 <div className="kb-actions"><button disabled={busy||!page.offset} onClick={()=>read(page.offset-20,page.search,page.category)}>Sebelumnya</button><button disabled={busy||page.offset+20>=page.total} onClick={()=>read(page.offset+20,page.search,page.category)}>Seterusnya</button></div></>}
 <details><summary>Arkib perbualan penuh</summary><button disabled={busy} onClick={()=>history('__threads',0)}>Papar semua perbualan</button>
 {archive&&<><p>{archive.offset+1}–{archive.offset+archive.rows.length} daripada {archive.total} {archive.kind==='__threads'?'perbualan':'mesej'}</p>
 {archive.kind!=='__threads'&&<button disabled={busy} onClick={()=>history('__threads',threadOffset)}>Kembali ke senarai perbualan</button>}
 {archive.rows.map(item=>'n' in item?<div key={item.id}><button disabled={busy} onClick={()=>history('thread:'+item.id,0)}>{new Date(item.last_at).toLocaleString('ms-MY',{timeZone:'Asia/Kuala_Lumpur'})} · {item.n} mesej · {item.id.slice(0,8)}</button></div>:<section key={item.id}><small>{item.direction==='inbound'?'Pelanggan':item.source==='business_app'?'Kedai':item.source} · {new Date(item.at).toLocaleString('ms-MY',{timeZone:'Asia/Kuala_Lumpur'})}</small><p style={{whiteSpace:'pre-wrap'}}>{item.body}</p>{item.direction==='inbound'&&<button onClick={()=>onTest({id:item.id,question:item.body,answer:'',topics:[]})}>Uji mesej ini</button>}</section>)}
 <div className="kb-actions"><button disabled={busy||!archive.offset} onClick={()=>history(archive.kind,archive.offset-20)}>Sebelumnya</button><button disabled={busy||archive.offset+20>=archive.total} onClick={()=>history(archive.kind,archive.offset+20)}>Seterusnya</button></div></>}
 </details></details>;
}
