/** One customer-facing header status from scoped order facts and exact task states. */
export type ProspectStage = 'survey' | 'interested' | 'awaiting_confirm' | 'not_proceeding';
export type LifecycleStage = ProspectStage | 'draft' | 'unpaid' | 'design' | 'review' | 'edit' | 'printing' | 'printed' | 'task_complete' | 'pickup' | 'shipped' | 'completed' | 'cancelling' | 'cancelled' | 'return' | 'unknown';
export const LIFECYCLE_LABELS: Record<LifecycleStage, string> = {
 survey:'Survey',interested:'Berminat',awaiting_confirm:'Tunggu Confirm',not_proceeding:'Tak Jadi',draft:'Draft',unpaid:'Belum Bayar',design:'Belum Design',review:'Tunggu Review',edit:'Perlu Edit',printing:'Printing',printed:'Dah Print · Belum Ship',task_complete:'Task Siap · Belum Ship',pickup:'Sedia Ambil',shipped:'Dihantar',completed:'Selesai',cancelling:'Proses Batal',cancelled:'Batal',return:'Return / Refund',unknown:'Semak Status',
};
export interface HeaderTask { id:string; title?:string; status:string; review_status?:string|null; url?:string|null; updated_at?:string|null }
export interface HeaderOrder {
 id:string; canonical_id?:string|null; order_no:string; source_channel:string; order_status?:string|null; payment_status?:string|null; payment_method?:string|null;
 delivery_method?:string|null; shipment_status?:string|null; fulfillment_status?:string|null; shipped_at?:string|null;
 date_need?:string|null; ship_by_at?:string|null; placed_at?:string|null; order_updated_at?:string|null; last_synced_at?:string|null;
 balance_amount?:number|null; tracking_no?:string|null; public_order_url?:string|null; linked?:boolean; is_primary?:boolean;
 metadata?: { design_work?: {tasks?:HeaderTask[]}; [key:string]:unknown }; tasks?:HeaderTask[]; items?:Array<{title?:string;quantity?:number}>;
}
export interface HeaderMessage { id:string; direction:string; text_content?:string|null; created_at:string; sender_type?:string|null; message_type?:string|null }
export interface HeaderSource { conversation:{id:string;channel:string}; orders:HeaderOrder[]; messages:HeaderMessage[]; can_edit_prospect?:boolean; missing_links?:number; truncated?:boolean; identity_ambiguous?:boolean; prospect?:{stage:ProspectStage|null;scope_key:string;updated_at?:string}|null }
export interface HeaderCanonical { session?:{session_id?:string|null;opened_at?:string|null;boundary_at?:string|null;session_status?:string|null}; drafts?:Array<{id:string;status:string;order_session_id?:string|null;created_at:string;order_no?:string|null}> }
export interface OrderBadge { stage:LifecycleStage;label:string;complete:number;total:number;tasks:HeaderTask[];reason:string }
export interface LifecycleResult extends OrderBadge { scope_key:string; prospect_editable:boolean; manual:boolean; orders:Array<HeaderOrder&{badge:OrderBadge}>;history_count:number;history:Array<HeaderOrder&{badge:OrderBadge}>;extra_orders:number; checked_at:string; reason:string }
const txt=(v:unknown)=>typeof v==='string'?v.trim():'';
const norm=(v:unknown)=>txt(v).toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ');
const at=(v:unknown)=>Date.parse(txt(v))||0;
const text=(m:HeaderMessage)=>txt(m.text_content);
const prospectStages=new Set(['survey','interested','awaiting_confirm','not_proceeding']);
export function taskStage(task:HeaderTask): 'design'|'review'|'edit'|'printing'|'printed'|'complete'|'cancelled'|'unknown' {
 const s=norm(task.status),r=norm(task.review_status);
 if(['cancelled','canceled','archived'].includes(s))return 'cancelled';
 if(['complete','completed','done','closed'].includes(s))return 'complete';
 if(['printed','print completed','selesai print','printing completed'].includes(s))return 'printed';
 if(s.includes('printing')||['print alamat','ready stock','edible print ready stock'].includes(s))return 'printing';
 if(s==='review')return /^(edit requested|request edit|edit|reject|rejected|changes requested|revision requested|minta edit|ubah design)$/.test(r)?'edit':'review';
 if(/^(new custom|design editing topper|design edible image|acrylic|wafer paper)$/.test(s))return 'design';
 return 'unknown';
}
export function orderBadge(o:HeaderOrder):OrderBadge {
 const map=new Map<string,HeaderTask>();
 for(const t of o.tasks??o.metadata?.design_work?.tasks??[]){if(!t.id)continue;const prev=map.get(t.id);if(!prev||at(t.updated_at)>=at(prev.updated_at))map.set(t.id,t);}
 const tasks=[...map.values()],states=tasks.map(taskStage),active=states.filter(s=>s!=='cancelled');
 const complete=active.filter(s=>s==='complete').length,total=active.length;
 const status=norm(o.order_status),shipping=norm(o.shipment_status)+' '+norm(o.fulfillment_status);
 const badge=(stage:LifecycleStage,reason:string):OrderBadge=>({stage,label:LIFECYCLE_LABELS[stage],complete,total,tasks,reason});
 if(/return|refund/.test(status+' '+shipping))return badge('return','Rekod order/penghantaran menunjukkan pemulangan atau refund.');
 if(/in cancel|cancellation requested|cancel requested|pending cancel/.test(status))return badge('cancelling','Pembatalan masih diproses.');
 if(/^(cancelled|canceled|invalid)$/.test(status))return badge('cancelled','Order telah dibatalkan.');
 if(/^(completed|complete|customer collected|collected)$/.test(status)||/delivery done|delivered/.test(shipping))return badge('completed','Order selesai atau pengambilan/penerimaan disahkan.');
 if(at(o.shipped_at)||/^(shipped|to confirm receive|to receive|out for delivery)$/.test(status)||/pickup done|in transit|out for delivery|logistics shipped/.test(shipping))return badge('shipped','Ada rekod order sudah dihantar.');
 if(/ready for pickup|ready to pickup/.test(status+' '+shipping))return badge('pickup','Rekod order menunjukkan sedia diambil.');
 const counter=/cash counter|cod|cash on delivery/.test(norm(o.payment_method)+' '+norm(o.metadata?.payment_mode));
 if(!counter&&/^(unpaid|pending|awaiting payment|waiting payment)$/.test(norm(o.payment_status)))return badge('unpaid','Order menunggu pembayaran.');
 if(active.includes('edit'))return badge('edit','Ada task review dengan permintaan edit.');
 if(active.includes('design'))return badge('design','Masih ada task yang memerlukan design.');
 if(active.includes('unknown')||!active.length)return badge('unknown',tasks.length?'Status task belum jelas atau semua task dibatalkan.':'Status task belum tersedia.');
 if(active.includes('review'))return badge('review','Masih ada task menunggu review.');
 if(active.includes('printing'))return badge('printing','Masih ada task dalam proses printing/packing; belum disahkan selesai print.');
 if(active.includes('printed'))return badge('printed','Semua baki task mempunyai bukti selesai print.');
 return badge('task_complete','Semua task kerja complete; penghantaran belum disahkan.');
}
const newPurchase=/(?:nak|mahu|want|boleh|can i|would like to).{0,24}(?:order|tempah|beli|buy)|(?:order|tempah).{0,14}(?:baru|lagi|another|new)|new order/i;
const afterSales=/tracking|parcel|courier|dah.{0,12}(?:ship|pos|siap)|belum.{0,12}(?:sampai|ship|pos)|order.{0,14}(?:mana|status)|refund|rosak|salah barang/i;
export function prospectStage(messages:HeaderMessage[]):{stage:ProspectStage;reason:string} {
 const inbound=messages.filter(m=>m.direction==='inbound'&&m.sender_type!=='system'&&text(m));
 if(!inbound.length)return {stage:'survey',reason:'Tahap awal pertanyaan; belum ada bukti order semasa.'};
 const latest=text(inbound[inbound.length-1]);
 if(/\b(?:tak jadi|x jadi|tidak jadi|cancel dulu|batal dulu|tak nak dah|not proceeding|no longer interested)\b/i.test(latest))return {stage:'not_proceeding',reason:'Customer menyatakan tidak mahu meneruskan pembelian.'};
 const seller=messages.filter(m=>m.direction==='outbound'&&m.sender_type==='seller').slice(-4).map(text).join(' ');
 const asksConfirm=/(?:confirm|sahkan|setuju|proceed|teruskan)/i.test(seller);
 const quote=/rm\s*\d|jumlah|total|quotation|sebut harga/i.test(seller);
 const buyingText=inbound.slice(-6).map(text).join(' ').replace(/\b(?:nak tanya|mahu tanya|nak tahu|want to know|just asking|survey)\b/gi,'');
 const selected=/(?:nak|mahu|want|ambil|pilih|choose|order|tempah).{0,45}(?:edible|wafer|topper|acrylic|akrilik|a[4-7]|\d+\s*(?:pcs|keping|set|inci|inch|cm))|\d+\s*(?:pcs|keping|set).{0,30}(?:edible|wafer|topper|acrylic)|\bquotation\b|\bquote\b/i.test(buyingText);
 if(selected&&quote&&asksConfirm)return {stage:'awaiting_confirm',reason:'Pilihan customer dan quotation tersedia; menunggu pengesahan.'};
 if(selected||newPurchase.test(buyingText))return {stage:'interested',reason:'Customer menunjukkan pilihan atau niat pembelian yang khusus.'};
 return {stage:'survey',reason:'Pertanyaan awal tentang produk/harga; keputusan membeli belum jelas.'};
}
export function conversationLifecycle(source:HeaderSource,canonical:HeaderCanonical={},now=Date.now()):LifecycleResult {
 const all=[...source.messages].sort((a,b)=>at(a.created_at)-at(b.created_at)||a.id.localeCompare(b.id));
 const session=canonical.session??{},boundary=Math.max(at(session.opened_at),at(session.boundary_at));
 let messages=all.filter(m=>at(m.created_at)>=boundary);
 // Separate a later chat episode without treating inactivity as a lost sale.
 let newEpisode=false;
 for(let i=messages.length-1;i>0;i--)if(at(messages[i].created_at)-at(messages[i-1].created_at)>48*3600000){messages=messages.slice(i);newEpisode=true;break;}
 const cutoff=Math.max(boundary,at(messages[0]?.created_at));

 const orders=source.orders.map(o=>({...o,badge:orderBadge(o)}));
 const terminal=new Set(['shipped','completed','cancelled','return']);
 const latestInbound=messages.filter(m=>m.direction==='inbound').slice(-1)[0];
 const freshRequest=messages.filter(m=>m.direction==='inbound'&&newPurchase.test(text(m))).slice(-1)[0];
 const scope_key=[source.conversation.id,session.session_id||'',boundary||'',hasEpisode(messages,all)].join(':');
 const latestText=text(latestInbound??{id:'',direction:'',created_at:''});
 // An earlier tracking reference must not override a later repeat-purchase request.
 const referenceMessages=freshRequest?messages.filter(m=>at(m.created_at)>=at(freshRequest.created_at)):messages;
 const refs=orders.filter(o=>referenceMessages.some(m=>m.direction==='inbound'&&new RegExp('(?:^|[^a-z0-9])'+o.order_no.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:$|[^a-z0-9])','i').test(text(m))));
 const hasActiveSession=Boolean(session.session_id);
 let current=orders.filter(o=>hasActiveSession?at(o.placed_at)>=boundary:!freshRequest||at(o.placed_at)>=at(freshRequest.created_at)-300000);
 if(refs.length)current=refs;
 else if(!hasActiveSession&&!freshRequest){
  const linked=orders.filter(o=>o.linked);
  current=linked.length?linked:orders.filter(o=>!terminal.has(o.badge.stage)&&at(o.placed_at)>=cutoff-300000);
  if(newEpisode&&current.every(o=>terminal.has(o.badge.stage))&&!afterSales.test(latestText))current=[];
 }
 if(!refs.length&&current.some(o=>!terminal.has(o.badge.stage)))current=current.filter(o=>!terminal.has(o.badge.stage));
 const explicit=current.filter(o=>o.linked||refs.includes(o));
 if(explicit.length)current=explicit;
 const ambiguous=(source.identity_ambiguous&&!explicit.length)||(!explicit.length&&current.length>1)||source.truncated||Boolean(source.missing_links&&!freshRequest);
 const selected=[...current].sort((a,b)=>Number(terminal.has(a.badge.stage))-Number(terminal.has(b.badge.stage))||Number(b.is_primary)-Number(a.is_primary)||at(b.placed_at)-at(a.placed_at)||a.id.localeCompare(b.id))[0];
 const drafts=(canonical.drafts??[]).filter(d=>d.order_session_id===session.session_id&&!['converted','confirmed','rejected','cancelled','canceled','voided'].includes(norm(d.status)));
 const prospectCase=!selected&&!ambiguous&&!drafts.length;
 const editable=source.can_edit_prospect!==false&&prospectCase;
 const suggested=prospectStage(messages);
 const manual=prospectCase&&(!freshRequest||at(source.prospect?.updated_at)>=at(freshRequest.created_at))&&source.prospect?.scope_key===scope_key&&prospectStages.has(source.prospect?.stage??'');
 const base:OrderBadge=ambiguous?{stage:'unknown',label:'Semak Status',complete:0,total:0,tasks:[],reason:'Order/identiti bertindih atau pautan belum lengkap; semak order utama.'}:selected?.badge??(drafts.length?{stage:'draft',label:'Draft',complete:0,total:0,tasks:[],reason:'Ada draft semasa yang belum menjadi order sebenar.'}:{stage:manual?source.prospect!.stage!:suggested.stage,label:LIFECYCLE_LABELS[manual?source.prospect!.stage!:suggested.stage],complete:0,total:0,tasks:[],reason:manual?'Tahap prospek ditetapkan staf untuk sesi semasa.':suggested.reason});
 return {...base,scope_key,prospect_editable:editable,manual:Boolean(manual),orders:current,history_count:Math.max(0,orders.length-current.length),history:orders.filter(o=>!current.includes(o)).slice(0,5),extra_orders:Math.max(0,current.length-1),checked_at:new Date(now).toISOString()};
}

function hasEpisode(messages:HeaderMessage[],all:HeaderMessage[]){return messages.length&&all.length&&messages[0].id!==all[0].id?messages[0].id:'';}
