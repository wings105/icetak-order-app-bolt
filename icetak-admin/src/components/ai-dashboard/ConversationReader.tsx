import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

type Message = { id:string; created_at?:string; direction?:string; source?:string; message_type?:string; text_content?:string; caption?:string; media_url?:string };
type Props = { messages:Message[]; boundary?:string; onQuote:(text:string)=>void; canQuote:boolean };
const day=(v?:string)=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleDateString('ms-MY',{timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'long',year:'numeric'}):'Tarikh tidak tersedia';
const time=(v?:string)=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleTimeString('ms-MY',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit'}):'—';
const url=(v?:string)=>{try{const u=new URL(v||'');return u.protocol==='https:'?u.href:null;}catch{return null;}};
function Text({text,query}:{text:string;query:string}){
 const pieces=text.split(/(https:\/\/[^\s<>]+)/g);
 return <>{pieces.map((part,i)=>{
  const link=url(part); if(link)return <a key={i} href={link} target="_blank" rel="noopener noreferrer">{part}</a>;
  if(!query)return <Fragment key={i}>{part}</Fragment>;
  const pos=part.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  return pos<0?<Fragment key={i}>{part}</Fragment>:<Fragment key={i}>{part.slice(0,pos)}<mark>{part.slice(pos,pos+query.length)}</mark>{part.slice(pos+query.length)}</Fragment>;
 })}</>;
}
function Attachment({message}:{message:Message}){
 const [failed,setFailed]=useState(false);const href=url(message.media_url);
 if(!href)return ['image','audio','voice','video','document','file','sticker'].includes(message.message_type||'')?<p className="ai-media-unavailable">[{message.message_type}] Lampiran belum tersedia.</p>:null;
 return <div className="ai-chat-attachment">{!failed&&(message.message_type==='image'?<a href={href} target="_blank" rel="noopener noreferrer" aria-label="Buka gambar saiz penuh"><img src={href} alt={message.caption||'Lampiran pelanggan'} loading="lazy" onError={()=>setFailed(true)}/></a>:message.message_type==='audio'||message.message_type==='voice'?<audio controls preload="none" src={href} onError={()=>setFailed(true)}/>:message.message_type==='video'?<video controls preload="metadata" src={href} onError={()=>setFailed(true)}/>:null)}{failed&&<p className="ai-media-unavailable">Pratonton tidak dapat dimuatkan. Cuba buka lampiran asal.</p>}<a href={href} target="_blank" rel="noopener noreferrer">Buka lampiran ↗</a></div>;
}
export default function ConversationReader({messages,boundary,onQuote,canQuote}:Props){
 const [query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[showHistory,setShowHistory]=useState(false),[copyStatus,setCopyStatus]=useState('');
 const scroll=useRef<HTMLDivElement>(null);
 const ordered=useMemo(()=>[...messages].sort((a,b)=>(Date.parse(a.created_at||'')||0)-(Date.parse(b.created_at||'')||0)||a.id.localeCompare(b.id)),[messages]);
 const term=query.trim();
 const boundaryTime=Date.parse(boundary||'');
 const historical=ordered.filter(m=>Date.parse(m.created_at||'')<=boundaryTime).length;
 const filtered=ordered.filter(m=>(showHistory||!historical||!(Date.parse(m.created_at||'')<=boundaryTime))&&(filter==='all'||filter==='media'&&!!m.media_url||m.direction===filter)&&(!term||`${m.text_content||''} ${m.caption||''}`.toLocaleLowerCase().includes(term.toLocaleLowerCase())));
 useEffect(()=>{if(!term&&filter==='all'&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;},[ordered,term,filter]);
 return <section className="ai-reader" aria-label="Conversation pelanggan">
  <div className="ai-chat-toolbar"><input aria-label="Cari dalam chat" placeholder="Cari dalam chat…" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Tapis mesej" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Semua mesej</option><option value="inbound">Pelanggan</option><option value="outbound">Seller / automation</option><option value="media">Lampiran</option></select><button onClick={()=>{setQuery('');setFilter('all');requestAnimationFrame(()=>{if(scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;});}}>↓ Terkini</button></div>
  <div className="ai-chat-meta"><span>{filtered.length} daripada {ordered.length} mesej dimuat</span><span role="status">{copyStatus}</span></div>
  {boundary&&<div className="ai-session-banner">Sempadan session: {day(boundary)} · {time(boundary)}. Chat lama untuk rujukan sahaja. {historical>0&&<button onClick={()=>setShowHistory(v=>!v)}>{showHistory?'Sembunyikan chat lama':`Lihat ${historical} mesej lama`}</button>}</div>}
  <div className="ai-chat-timeline" ref={scroll} tabIndex={0} aria-label="Sejarah perbualan">
   {!filtered.length&&<div className="ai-chat-empty"><h3>{messages.length?'Tiada mesej sepadan':'Belum ada mesej tersedia'}</h3><p>{messages.length?'Cuba kata carian atau tapisan lain.':'Muat semula conversation untuk semak data terkini.'}</p></div>}
   {filtered.map((m,i)=>{const text=[m.text_content,m.caption!==m.text_content?m.caption:null].filter(Boolean).join('\n');const old=Number.isFinite(boundaryTime)&&Date.parse(m.created_at||'')<=boundaryTime;return <Fragment key={m.id}>
    {(i===0||day(m.created_at)!==day(filtered[i-1].created_at))&&<div className="ai-chat-date">{day(m.created_at)}</div>}
    {i>0&&Number.isFinite(boundaryTime)&&Date.parse(m.created_at||'')>boundaryTime&&Date.parse(filtered[i-1].created_at||'')<=boundaryTime&&<div className="ai-session-divider">Mesej selepas sempadan session</div>}
    <article className={`ai-message ${m.direction==='inbound'?'inbound':'outbound'} ${old?'historical':''}`}><div className="ai-message-heading"><strong>{m.direction==='inbound'?'Pelanggan':m.direction==='outbound'?'Seller / automation':'Sistem'}</strong><time dateTime={m.created_at}>{time(m.created_at)}</time></div>
     {text&&<p className="ai-message-text"><Text text={text} query={term}/></p>}<Attachment message={m}/>
     <footer><span>{old?'Chat lama · ':''}{m.source||m.message_type||'Mesej'}</span><div>{text&&<><button title="Salin mesej" onClick={async()=>{try{await navigator.clipboard.writeText(text);setCopyStatus('Mesej disalin');}catch{setCopyStatus('Tidak dapat salin. Pilih teks dan salin manual.');}}}>Salin</button><button disabled={!canQuote} title="Masukkan petikan dalam nota admin" onClick={()=>onQuote(`[${day(m.created_at)} ${time(m.created_at)} · ${m.direction==='inbound'?'Pelanggan':'Seller'}]\n${text}`)}>Petik ke nota</button></>}</div></footer>
    </article></Fragment>;})}
  </div>
  <div className="ai-chat-footnote">Sehingga 100 mesej terkini. Balasan dari sistem luar mungkin belum disegerakkan. Membaca chat tidak menandakan isu selesai.</div>
 </section>;
}
