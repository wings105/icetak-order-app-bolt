import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import './AcrylicProduction.css';

type Item={task_id:string;title:string;order_reference:string;stage:string;status:string;material:string;colour:string;colour_source:string;size:string;quantity:number|null;sets:string[];sku:string;due_at:string|null;updated_at:string;issues:string[];images:{url:string;name:string}[];task_url:string};
export type Snapshot={ok:boolean;items:Item[];read_at:string;truncated:boolean;error?:string};
const stages=[['production','Sedia cut'],['review','Review'],['design','Menunggu design'],['all','Semua peringkat']];
const swatches:Record<string,string>={'Gold':'#c5a24c','Silver':'#a4b0bd','Rose Gold':'#c78d86','Black':'#292b32','White':'#fff','Bronze':'#9d7049','Clear / Transparent':'#d8ebef','Pink':'#ef9cc1','Red':'#d94343','Blue':'#4685d5','Green':'#5c9e67','Yellow':'#efcf4e','Orange':'#e69b40','Purple':'#9a72be'};
const time=(value:string)=>new Date(value).toLocaleString('en-MY',{timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});

async function readAdminSnapshot():Promise<Snapshot>{
 const {supabase}=await import('../lib/supabase');
 const {data,error}=await supabase.functions.invoke('acrylic-production',{body:{}});
 if(error)throw Error(error.message);return data as Snapshot;
}

export default function AcrylicProduction({readSnapshot=readAdminSnapshot}:{readSnapshot?:()=>Promise<Snapshot>}={}){
 const [data,setData]=useState<Snapshot|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const [stage,setStage]=useState('production'),[material,setMaterial]=useState('Acrylic'),[colour,setColour]=useState(''),[query,setQuery]=useState(''),[auto,setAuto]=useState(true);
 const [zoom,setZoom]=useState<{item:Item;index:number}|null>(null);const dialog=useRef<HTMLDialogElement>(null),inflight=useRef(false),mounted=useRef(true);
 const load=useCallback(async()=>{
  if(inflight.current)return;inflight.current=true;setLoading(true);
  try{const next=await readSnapshot();if(!next?.ok)throw Error(next?.error||'Data production tidak tersedia.');if(mounted.current){setData(next);setError('');}}
  catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Data gagal dimuat.');}
  finally{inflight.current=false;if(mounted.current)setLoading(false);}
 },[readSnapshot]);
 useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;};},[load]);
 useEffect(()=>{if(!auto)return;const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void load();},60000);const visible=()=>{if(document.visibilityState==='visible')void load();};document.addEventListener('visibilitychange',visible);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visible);};},[auto,load]);
 useEffect(()=>{if(zoom){dialog.current?.showModal();}else{dialog.current?.close();}},[zoom]);
 const all=data?.items||[];
 const scope=useMemo(()=>all.filter(i=>(!material||i.material===material)&&(stage==='all'||i.stage===stage)),[all,material,stage]);
 const colours=useMemo(()=>[...new Set([...scope.map(i=>i.colour),...(colour?[colour]:[])])].sort((a,b)=>a==='Belum ditentukan'?1:b==='Belum ditentukan'?-1:a.localeCompare(b)),[scope,colour]);
 const visible=useMemo(()=>scope.filter(i=>(!colour||i.colour===colour)&&`${i.title} ${i.order_reference} ${i.sku} ${i.size} ${i.sets.join(' ')}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>(a.due_at||'9999').localeCompare(b.due_at||'9999')||a.task_id.localeCompare(b.task_id)),[scope,colour,query]);
 const warnings=visible.filter(i=>i.issues.length>0).length;
 return <div className="acp-page fade-in">
  <header className="acp-header"><div><p className="acp-eyebrow">PRODUCTION / CUTTING</p><h1>Acrylic & Artpaper</h1><p>Pilih material dan warna sebelum mula cut.</p></div><div className="acp-refresh"><label><input type="checkbox" checked={auto} onChange={e=>setAuto(e.target.checked)}/>Auto refresh 1 minit</label><button className="btn btn-outline" disabled={loading} onClick={()=>void load()}>{loading?'Memuatkan…':'↻ Refresh'}</button></div></header>
  {error&&<div className="acp-alert" role="alert">{error} {data?'Paparan masih menggunakan data sebelumnya. Semak semula sebelum cut.':''}<button onClick={()=>void load()}>Cuba semula</button></div>}
  <nav className="acp-stages" aria-label="Peringkat kerja">{stages.map(([key,label])=><button key={key} aria-pressed={stage===key} onClick={()=>setStage(key)}>{label}<span>{all.filter(i=>(!material||i.material===material)&&(key==='all'||i.stage===key)).length}</span></button>)}</nav>
  <section className="acp-filters" aria-label="Tapis production">
   <div className="acp-filter-line"><b>Material</b><div className="acp-pills">{[['Acrylic','Acrylic'],['Artpaper','Artpaper'],['','Semua material']].map(([key,label])=><button key={key} aria-pressed={material===key} onClick={()=>{setMaterial(key);setColour('');}}>{label}</button>)}</div></div>
   <div className="acp-filter-line"><b>Warna</b><div className="acp-pills acp-colours"><button aria-pressed={!colour} onClick={()=>setColour('')}>Semua warna <span>{scope.length}</span></button>{colours.map(c=><button key={c} aria-pressed={colour===c} className={c==='Belum ditentukan'?'acp-unknown':''} onClick={()=>setColour(c)}><i style={{background:swatches[c]||'#d7d2c3'}}/>{c}<span>{scope.filter(i=>i.colour===c).length}</span></button>)}</div></div>
  </section>
  <div className="acp-results"><div><strong>{colour||'Semua warna'}</strong><span>{visible.length} task{warnings>0?` · ${warnings} perlu semakan`:''}</span></div><input aria-label="Cari task" placeholder="Cari nama task, order atau saiz…" value={query} onChange={e=>setQuery(e.target.value)}/></div>
  {data?.truncated&&<p role="alert" className="acp-alert">Had bacaan dicapai. Senarai mungkin belum lengkap; semak ClickUp sebelum production.</p>}
  {!data&&loading?<div className="acp-empty" role="status">Memuatkan task ClickUp…</div>:visible.length===0?<div className="acp-empty"><span>✓</span><h2>Tiada task untuk pilihan ini</h2><p>Cuba warna, material atau peringkat kerja lain.</p></div>:<div className="acp-grid">{visible.map(item=><article className="acp-card" key={item.task_id} data-task-id={item.task_id}>
   <div className="acp-card-head"><span className={`acp-material ${item.material==='Artpaper'?'paper':''}`}>{item.material}</span><span>{item.sets.join(' · ')||'Task'}</span></div>
   <div className="acp-images">{item.images.length?item.images.map((img,index)=><button key={img.url} onClick={()=>setZoom({item,index})} aria-label={`Besarkan design ${item.title}${item.images.length>1?` ${index+1}`:''}`}><img src={img.url} alt={img.name||item.title} loading="lazy" referrerPolicy="no-referrer" onError={e=>{e.currentTarget.hidden=true;const label=e.currentTarget.nextElementSibling;if(label)label.textContent='Gambar gagal dimuat. Buka ClickUp.';}}/><span>↗ Besarkan{item.images.length>1?` ${index+1}/${item.images.length}`:''}</span></button>):<div className="acp-no-image">Design belum tersedia<span>Buka task untuk semak attachment.</span></div>}</div>
   <div className="acp-card-body"><div className={`acp-colour ${item.colour==='Belum ditentukan'?'unknown':''}`} title={item.colour_source||'Semak warna dalam task'}><i style={{background:swatches[item.colour]||'#d7d2c3'}}/>{item.colour}</div><h2><a href={item.task_url} target="_blank" rel="noopener noreferrer">{item.title} ↗</a></h2><p className="acp-order">{item.order_reference||'Order ID belum tersedia'}</p><div className="acp-specs"><div><span>SAIZ</span><strong>{item.size}</strong></div><div><span>KUANTITI</span><strong>{item.quantity?`${item.quantity} pcs`:'Semak'}</strong></div></div>{item.issues.length>0&&<p className="acp-card-warning">Semak sebelum cut: {item.issues.join(' · ')}</p>}<footer><span className={`acp-stage ${item.stage}`}>{item.status}</span>{item.due_at&&<time dateTime={item.due_at}>{time(item.due_at)}</time>}</footer></div>
  </article>)}</div>}
  <p className="acp-footnote">Task dan design mengikut kemas kini ClickUp.{data?` Dibaca ${time(data.read_at)}.`:''} Perubahan muncul selepas webhook task diterima.</p>
  <dialog ref={dialog} className="acp-dialog" onCancel={()=>setZoom(null)} onClose={()=>setZoom(null)} onClick={e=>{if(e.target===dialog.current)setZoom(null);}}>{zoom&&<><header><div><strong>{zoom.item.colour} · {zoom.item.size} · {zoom.item.quantity||'?'} pcs</strong><p>{zoom.item.title}</p></div><button autoFocus onClick={()=>setZoom(null)} aria-label="Tutup design">✕</button></header><img src={zoom.item.images[zoom.index].url} alt={zoom.item.title}/><footer><span>{zoom.item.order_reference}</span><a href={zoom.item.images[zoom.index].url} target="_blank" rel="noopener noreferrer">Buka gambar asal ↗</a></footer></>}</dialog>
 </div>;
}
