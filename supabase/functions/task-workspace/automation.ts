import {customerText} from './customer-details.ts';
import {briefFingerprint} from './readiness.ts';
type Data=Record<string,any>;
const text=(v:unknown)=>String(v??'').trim();
const ack=/^(?:ok(?:ay|ey|ie)?|baik(?:lah)?|ya|yes|done|dah|sudah|tq|thanks?|thank you|terima kasih|noted|hi|hai|hello|salam|assalamualaikum|👍|🙏|❤️)(?:\s+(?:sis|boss|kak|ya|tq|done))*[\s.!?,]*$/i;
export function messageKind(m:Data){
 const v=text(m.text_content||m.caption);
 if(['system','sticker','reaction'].includes(m.message_type))return 'ack';
 if(m.message_type==='image'&&/resit|receipt|payment|bayar|transfer|bank|screenshot\s*(?:order|checkout)/i.test(v))return 'question';
 if(m.message_type==='image')return 'change';
 if(!v||ack.test(v))return 'ack';
 if(/\b(?:tukar|ubah|ganti|betulkan|change|replace|correction|cancel|batal|jangan|hold|tunggu|font|warna|colou?r|saiz|size|background|crop|layout|qty|quantity|kuantiti)\b/i.test(v))return 'change';
 if(/\?|\b(?:bila|berapa|sampai|pos|shipping|courier|tracking|parcel|alamat|delivery|pickup|bayar|paid|payment|harga|price|stok|stock)\b/i.test(v))return 'question';
 const parsed=customerText(v);
 return parsed.wording||parsed.name||parsed.age||parsed.instructions?'change':'question';
}
export function inbound(context:Data){return (context.messages||[]).filter((m:Data)=>m.direction==='inbound'&&!m.is_history&&(context.bindings||[]).some((b:Data)=>b.usable&&b.id===m.conversation_id&&(!b.start_at||Date.parse(m.created_at)>=Date.parse(b.start_at))&&(!b.end_at||Date.parse(m.created_at)<Date.parse(b.end_at))));}
// Operational replies are monitored separately; they do not expire an approved design/QC fingerprint.
export function designContext(context:Data){return {...context,bindings:(context.bindings||[]).map(({revision,...b}:Data)=>b),messages:(context.messages||[]).filter((m:Data)=>m.direction==='inbound'&&messageKind(m)==='change')};}
export async function observe(loaded:Data,previous:Data|null,now=new Date().toISOString()){
 const r=loaded.readiness,old=previous?.data||{},messages=inbound(loaded.context);
 const seen=Object.fromEntries(await Promise.all(messages.map(async(m:Data)=>[m.id,await briefFingerprint([m.text_content,m.caption,m.media_url,m.message_type])])));
 const changed=old.seen?messages.filter((m:Data)=>seen[m.id]!==old.seen[m.id]):[];
 const adminAck=loaded.saved?.confirmed===true&&loaded.saved.version>(old.acknowledged_brief_version||0)&&loaded.saved.source_fingerprint===r.fingerprint&&(!old.attention_at||Date.parse(loaded.saved.updated_at)>=Date.parse(old.attention_at));
 let attention=adminAck?'none':old.attention||'none',attentionAt=adminAck?null:old.attention_at||null,alerts=adminAck?[]:old.alerts||[];
 const baselineValid=!!old.ready_at&&Object.keys(old.ready_values||{}).length>0;
 const readyAt=old.ready_at||(r.status==='ready'?now:null);
 const oldValues=baselineValid?old.ready_values:old.values||{};
 // Repair observations created before their first complete baseline, without dismissing actual message alerts.
 if(!baselineValid&&attention==='change'&&!alerts.length&&r.status==='ready'){attention='none';attentionAt=null;}
 const designValues=(v:Data)=>Object.fromEntries(['wording','name','age','artwork','instructions','size','shape','colour','material'].filter(k=>v[k]).map(k=>[k,v[k]]));
 const orderItems=await briefFingerprint(loaded.order?.items||[]);
 const valueChanged=baselineValid&&!adminAck&&loaded.context.unavailable!==true&&(await briefFingerprint(designValues(oldValues))!==await briefFingerprint(designValues(r.values))||!!old.order_item_fingerprint&&old.order_item_fingerprint!==orderItems);
 if(baselineValid){
  const meaningful=changed.filter((m:Data)=>messageKind(m)!=='ack'&&(!adminAck||Date.parse(m.created_at)>Date.parse(loaded.saved.updated_at)));
  const change=meaningful.some((m:Data)=>messageKind(m)==='change')||valueChanged;
  if(change||meaningful.length){attention=change?'change':attention==='change'?'change':'question';attentionAt=attentionAt||now;
   alerts=[...alerts,...meaningful.map((m:Data)=>({id:m.id,text:text(m.text_content||m.caption)||'Gambar baharu diterima',at:m.created_at,kind:messageKind(m)}))].slice(-12);
  }
 }
 const placed=Date.parse(loaded.order?.created_at||loaded.order?.placed_at||''),first=old.first_checked_at||now;
 const due=Number.isFinite(placed)?new Date(placed+30*60000).toISOString():new Date(Date.parse(first)+30*60000).toISOString();
 const rechecked=old.rechecked_at||r.status!=='ready'&&Date.parse(now)>=Date.parse(due)?old.rechecked_at||now:null;
 const production=/printing|laser|cutting|print alamat|ready stock|complete/i.test(loaded.source.status||'');
 const blocked=attention==='change';
 const status=blocked?'review':r.status;
 const remark=[status==='ready'?'Info lengkap untuk production.':status==='missing'?'Info belum lengkap.':'Perlu semakan admin.',
  r.values.wording?`Wording: ${r.values.wording}`:'',r.values.artwork?'Gambar customer diterima.':'',
  attention==='change'?`Customer / sumber mengubah detail${production?' selepas kerja production bermula':''}; semak versi lama dan baharu.`:attention==='question'?'Customer ada soalan baharu; admin perlu semak / balas.':'',
  ...r.missing.map((m:Data)=>`Kurang: ${m.label}`)].filter(Boolean).join('\n');
 return {rules_version:'detail-automation-v1',fingerprint:r.fingerprint,order_item_fingerprint:orderItems,status,info_status:r.status,values:r.values,sources:r.sources,evidence:r.evidence,
  ready_at:readyAt,ready_values:adminAck||!baselineValid&&r.status==='ready'?r.values:oldValues,previous_values:blocked?oldValues:null,
  attention,attention_at:attentionAt,alerts,remark,seen,first_checked_at:first,checked_at:now,recheck_due_at:due,rechecked_at:rechecked,
  production_started:production,chat_unavailable:loaded.context.unavailable===true,missing:r.missing,warnings:r.warnings,
  acknowledged_brief_version:adminAck?loaded.saved.version:old.acknowledged_brief_version||0};
}
export function applyObservation(r:Data,record:Data|null){
 const a=record?.data;if(!a)return r;
 const acknowledged=r.version>=(a.acknowledged_brief_version||0)&&r.confirmed_by&&r.confirmed_by!=='Sistem · detail customer lengkap'&&Date.parse(r.confirmed_at||'')>=Date.parse(a.attention_at||'9999');
 const attention=acknowledged?'none':a.attention;
 const stale=a.fingerprint!==r.fingerprint;
 // A new detail arriving after this snapshot remains subject to the live readiness calculation.
 const blocked=attention==='change';
 const warnings=[...r.warnings,...(blocked?['Detail berubah selepas lengkap. Admin perlu semak semula.']:attention==='question'?['Customer ada soalan baharu; admin perlu semak / balas.']:[])];
 const previous=blocked?Object.entries(a.previous_values||{}).filter(([field,value])=>value&&value!==r.values[field]).map(([field,value])=>({field,label:`${field} terdahulu`,value,source:'Versi lengkap sebelum perubahan'})):[];
 return {...r,...(blocked?{status:'review',label:'Perlu semakan semula',print_ready:false,confirmed_by:null,previous_values:a.previous_values}:attention==='question'&&r.status==='ready'?{label:'Info lengkap · Perhatian admin'}:{}),
  confidence_reason:`${r.confidence_reason} · Semakan automatik: ${a.remark}`,
  conflicts:[...r.conflicts,...previous],evidence:[...r.evidence,...(a.alerts||[]).filter((m:Data)=>!r.evidence.some((e:Data)=>e.id===m.id))],
  automation:{...a,attention,stale,version:record.version},warnings};
}
