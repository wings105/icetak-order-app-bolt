import { useState } from 'react';

type Example = {id:string; question:string; answer:string; topics:string[]};
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
 </details>;
}
