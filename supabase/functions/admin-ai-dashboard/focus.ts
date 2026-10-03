import { analyze, identity } from './analysis.ts';
import { orderOperation } from './operations.ts';
type Data = Record<string, any>;
const norm=(v:unknown)=>String(v||'').toLowerCase().trim().replace(/\s+/g,'_');
const time=(v:unknown)=>{const n=Date.parse(String(v||''));return Number.isFinite(n)&&n>Date.parse('2020-01-01')?n:null;};
const day=(n:number)=>new Date(n).toLocaleDateString('en-CA',{timeZone:'Asia/Kuala_Lumpur'});
const roles:Data={design:'Design',production:'Printing / production',review:'Review artwork',ready:'Packing / pos',pickup:'Pickup',payment:'Semak bayaran',issue:'Masalah courier',unknown:'Semak status',done:'Selesai'};
export function focusRows(snapshot:Data,chats:Data[],identities:Data,now=Date.now()) {
 const states=snapshot.states||{},reviews=snapshot.reviews||{};
 const byOrder=new Map<string,Data[]>(),byCustomerOrder=new Map<string,Data[]>(),chatItems=new Map<string,Data>(),unbound:Data[]=[];
 const orders:Data[]=[...(snapshot.orders||[]),...(snapshot.drafts||[])];
 const refs=new Map(orders.map(o=>[String(o.reference).toUpperCase(),o]));
 const masterOrders=new Map<string,Data[]>(),uidOrders=new Map<string,Data[]>();
 for(const o of orders){if(o.master_id){const a=masterOrders.get(o.master_id)||[];a.push(o);masterOrders.set(o.master_id,a);}if(o.buyer_user_id){const a=uidOrders.get(o.buyer_user_id)||[];a.push(o);uidOrders.set(o.buyer_user_id,a);}}
 for(const c of chats){
  const id=identities[c.id]||{};
  const a=analyze(c,{review:reviews[c.id]},null,now);
  const text=a.evidence.map((e:Data)=>e.text).join('\n').toUpperCase();
  const candidates=id.identity_status==='ambiguous'?[]:id.master_id?masterOrders.get(id.master_id)||[]:c.channel==='shopee'?uidOrders.get(c.external_customer_id)||[]:[];
  // Current customer text plus exact canonical identity; never bind by name or simply newest order.
  const exact=candidates.filter(o=>text.includes(String(o.reference).toUpperCase())&&refs.has(String(o.reference).toUpperCase()));
  const item={...c,identity:id,analysis:a,related_references:candidates.filter(o=>orderOperation(o,now).active).map(o=>o.reference)};
  chatItems.set(c.id,item);
  for(const o of candidates.filter(o=>orderOperation(o,now).active)){const key=`${o.kind}:${o.id}`;const a=byCustomerOrder.get(key)||[];a.push(item);byCustomerOrder.set(key,a);}
  if(exact.length===1){const key=`${exact[0].kind}:${exact[0].id}`;const a=byOrder.get(key)||[];a.push(item);byOrder.set(key,a);}else unbound.push(item);
 }
 const result:Data[]=[];
 const decision=(key:string)=>states[key]||{version:0,data:{}};
 const chatInfo=(c:Data|null)=>{
  if(!c)return {state:'Tiada chat dipadankan',reply:false,preview:'',id:null,at:null,urgent:false};
  const s=decision(`chat:${c.id}`).data;
  const current=s.chat_revision===c.inbound_revision&&(!reviews[c.id]?.updated_at||time(decision(`chat:${c.id}`).updated_at)!>=time(reviews[c.id].updated_at)!);
  const review=c.analysis.status;
  let state=current&&s.work_state?s.work_state:review==='resolved'?'resolved':review==='waiting_customer'?'waiting':review==='snoozed'?'snoozed':'reply';
  if(state==='snoozed'&&time(s.snoozed_until)!=null&&time(s.snoozed_until)!<=now)state='reply';
  const age=time(c.last_inbound_at)==null?Infinity:(now-time(c.last_inbound_at)!)/86400000;
  const reply=!!c.last_inbound_at&&state==='reply';
  const latest=(c.messages||[]).filter((m:Data)=>m.direction==='inbound').at(-1);
  return {id:c.id,channel:c.channel,state:state==='reply'?'Perlu balas':state==='waiting'?'Menunggu customer':state==='snoozed'?'Ditangguhkan':'Selesai chat',
   reply,preview:latest?.text_content||latest?.caption||c.analysis.summary,at:c.last_inbound_at,
   urgent:reply&&age<=30&&c.analysis.urgent,backlog:age>30,acknowledgement:c.analysis.acknowledgement,
   revision:c.inbound_revision,name:c.name,identity_status:c.identity.identity_status,related_references:c.related_references};
 };
 function decorate(row:Data,s:Data,work:Data){
  const d=s.data||{},current=d.source_fingerprint===row.source_fingerprint;
  row.state=s;row.detail_status=d.detail_status||'unknown';row.missing_details=d.missing_details||'';row.note=d.note||'';
  row.customer_needed=d.customer_needed||row.customer_needed||null;row.dispatch_by=d.dispatch_by||null;row.design_by=d.design_by||null;
  row.urgent=!!d.urgent||row.chat.urgent;row.snoozed_until=d.snoozed_until||null;
  row.manual_work=current?d.work_state||'': '';row.manual_expired=!!d.work_state&&!current;
  row.category=work.key;row.action=work.title;row.reason=work.next;
  if(row.kind==='chat'){row.category=row.chat.reply?'reply':row.chat.state==='Menunggu customer'?'waiting':row.chat.state==='Ditangguhkan'?'snoozed':'done';row.action=row.chat.acknowledgement?'Semak penutup chat':'Balas pertanyaan customer';row.reason=row.chat.preview;}
  else if(['in_cancel','unknown'].includes(norm(row.status))){row.category='unknown';row.action=norm(row.status)==='in_cancel'?'Semak permintaan cancel':'Semak status order';row.reason='Status sumber belum membenarkan kerja production dipastikan.';}
  else if(work.active&&!work.shipped&&row.detail_status==='missing'&&['design','unknown','review'].includes(row.category)){row.category='details';row.action=work.paid?'Dah bayar · minta detail':'Minta detail order';row.reason=row.missing_details||'Detail ditanda belum lengkap oleh admin.';}
  else if(work.active&&work.paid&&!work.tasks.length&&row.category==='unknown'){row.action=row.detail_status==='complete'?'Detail lengkap · semak task design':'Dah bayar · semak detail / task';row.reason='Belum ada task dipadankan. Semak detail sebelum mula design.';if(row.detail_status==='complete')row.category='design';}
  const providerUncertain=['in_cancel','unknown'].includes(norm(row.status));
  if(work.active&&!work.shipped&&!providerUncertain&&row.category!=='issue'){

   if(row.manual_work==='design_done'&&['design','review','details','unknown'].includes(row.category)){row.category='production';row.action='Design ditanda siap · production';}
   if(row.manual_work==='production_done'){row.category=/pickup/i.test(row.delivery_method||'')?'pickup':'ready';row.action='Production ditanda siap · '+roles[row.category];}
   if(row.manual_work==='waiting'){row.category='waiting';row.action='Menunggu customer';}
   if(row.manual_work==='handled'){row.category='done';row.action='Tindakan panel selesai';}
  }
  if(work.active&&!work.shipped&&row.manual_work==='handled'){row.category='done';row.action='Tindakan panel selesai';}
  if(work.active&&!work.shipped&&row.manual_work==='waiting'&&row.category==='unknown'){row.category='waiting';row.action='Menunggu customer';}
  if(current&&['waiting','handled'].includes(row.manual_work)){row.chat={...row.chat,reply:false,state:row.manual_work==='waiting'?'Menunggu customer (panel)':'Tindakan chat ditanda selesai (panel)'};}
  if(row.chat.reply&&row.kind!=='chat'){row.action+=' · balas chat';}
  row.actionable=!['done','waiting','production','snoozed'].includes(row.category)||row.chat.reply;
  if(work.shipped&&row.category!=='issue'&&!row.chat.reply)row.actionable=false;
  row.backlog=row.kind==='chat'&&row.chat.backlog&&!d.urgent;
  if(row.backlog){row.actionable=false;row.reason='Chat lebih 30 hari; semak melalui filter Backlog chat.';}
  const snoozed=time(d.snoozed_until);row.snoozed=!!(snoozed&&snoozed>now&&current);
  if(row.snoozed){row.actionable=false;row.category='snoozed';row.action='Ditangguhkan oleh admin';}
  // Only compare work dates of the same meaning. Customer arrival date is displayed separately.
  const internal=['design','review','details'].includes(row.category)?time(row.design_by||row.clickup_due):null;
  const dispatch=time(row.dispatch_by),platform=time(row.platform_deadline);
  const dates=[internal,dispatch,platform].filter((v):v is number=>v!=null);
  row.focus_due=dates.length?new Date(Math.min(...dates)).toISOString():null;
  row.due_source=internal!=null&&time(row.focus_due)===internal?row.design_by?'Design':'Due ClickUp':dispatch!=null&&time(row.focus_due)===dispatch?'Janji pos / pickup':platform!=null?'Platform':null;
  const due=time(row.focus_due);row.overdue=!!(due&&day(due)<day(now)&&row.actionable&&row.category!=='unknown');
  row.due_today=!!(due&&day(due)===day(now)&&row.actionable&&row.category!=='unknown');
  const needed=time(row.customer_needed);
  row.schedule_risk=!!(needed&&work.active&&!work.shipped&&!['done','snoozed','unknown'].includes(row.category)&&day(needed)<=day(now+2*86400000)&&!row.dispatch_by);
  if(row.schedule_risk&&!row.snoozed)row.actionable=true;
  row.priority=row.schedule_risk&&day(needed!)<=day(now)?0:row.schedule_risk?1:row.urgent&&row.actionable?0:row.overdue?0:row.due_today?1:row.actionable&&work.paid&&row.category!=='unknown'?2:row.actionable?3:4;
  row.priority_label=row.priority===0?'Segera':row.priority===1?'Hari ini':row.priority===2?'Dah bayar':row.priority===3?'Perlu tindakan':row.backlog?'Backlog':row.category==='done'?'Selesai':'Menunggu';
  row.priority_reason=row.schedule_risk?'Tarikh customer dekat; sasaran pos / pickup belum ditetapkan':row.urgent?'Urgent customer / admin':row.overdue?'Tarikh kerja sudah lewat':row.due_today?'Tarikh kerja hari ini':row.actionable&&work.paid?'Bayaran disahkan; tindakan belum selesai':row.actionable?'Tindakan customer belum selesai':row.reason;
  row.work_label=roles[row.category]||({details:'Minta detail',reply:'Perlu balas',waiting:'Menunggu customer',snoozed:'Ditangguhkan'} as Data)[row.category]||row.category;
  row.payment_label=work.paid?'Dah bayar':work.cod?'COD / tunai · semak penerimaan':row.kind==='draft'?'Bayaran draft · '+(row.payment_status||'perlu semak'):row.payment_status||'Belum dipadankan';
  result.push(row);
 }
 for(const o of orders){
  o.production_tasks=o.dated_tasks||o.production_tasks;
  const key=`${o.kind}:${o.id}`,work=o.kind==='draft'?{key:'draft',active:true,title:'Semak draft / detail customer',next:'Draft belum menjadi order. Semak detail, bayaran dan confirmation melalui Draft Orders.',paid:norm(o.payment_status)==='paid'&&!!o.payment_received_at&&Number(o.payment_amount)>0,tasks:[],fingerprint:JSON.stringify([o.status,o.payment_status,o.version,o.source_updated_at])}:orderOperation(o,now);
  const pendingDue=(o.production_tasks||[]).filter((t:Data)=>Number(t.progress_stage||0)<5).map((t:Data)=>time(t.due_at)).filter((t:number|null):t is number=>t!=null);
  const needed=(o.production_tasks||[]).map((t:Data)=>time(t.needed_at)).filter((t:number|null):t is number=>t!=null);
  o.clickup_due=pendingDue.length?new Date(Math.min(...pendingDue)).toISOString():null;
  if(!o.customer_needed&&needed.length)o.customer_needed=new Date(Math.min(...needed)).toISOString();
  const linked=(byOrder.get(key)||[]).sort((a,b)=>(time(b.last_inbound_at)||0)-(time(a.last_inbound_at)||0));
  const customerChats=(byCustomerOrder.get(key)||[]).sort((a,b)=>(time(b.last_inbound_at)||0)-(time(a.last_inbound_at)||0));
  const c=o.kind==='draft'&&o.conversation_id?chatItems.get(o.conversation_id)||null:linked.find(c=>chatInfo(c).reply)||linked[0]||customerChats[0]||null;
  decorate({...o,key,chat:{...chatInfo(c),order_confirmed:linked.some(x=>x.id===c?.id)},conversations:customerChats.map(c=>({id:c.id,name:c.name,channel:c.channel})),source_fingerprint:JSON.stringify([work.fingerprint,c?[c.id,c.inbound_revision]:null]),work},decision(key),work);
 }
 for(const c of unbound){
  const key=`chat:${c.id}`,chat=chatInfo(c);
  if(!c.last_inbound_at)continue;
  decorate({key,id:c.id,kind:'chat',reference:'Pertanyaan',customer_name:c.identity.name||c.name,phone:c.identity.phone||identity(c).phone,
   channel:c.channel,chat,conversations:[{id:c.id,name:c.name,channel:c.channel}],items:[],production_tasks:[],logistics:[],source_updated_at:c.last_message_at,
   source_fingerprint:c.inbound_revision,created_at:c.last_inbound_at,status:'Pertanyaan',work:{key:'reply'}},decision(key),{key:'reply',active:true,title:'Balas customer',next:chat.preview});
 }
 result.sort((a,b)=>a.priority-b.priority||(time(a.focus_due)||Infinity)-(time(b.focus_due)||Infinity)||(time(b.created_at)||0)-(time(a.created_at)||0)||a.key.localeCompare(b.key));
 return result;
}

export function validateFocusUpdate(b:Data,row:Data){
 if(!Number.isInteger(b.expected_version)||b.expected_version<0)throw Error('Invalid version');
 if(b.source_fingerprint!==row.source_fingerprint)throw Error('SOURCE_CHANGED: Status berubah. Muat semula sebelum simpan.');
 const d=b.data||{},out:Data={};
 if(!['unknown','missing','complete'].includes(d.detail_status))throw Error('Invalid detail status');out.detail_status=d.detail_status;
 if(!['','waiting','design_done','production_done','handled'].includes(d.work_state||''))throw Error('Invalid work state');out.work_state=d.work_state||'';
 if(['chat','draft'].includes(row.kind)&&['design_done','production_done'].includes(out.work_state))throw Error('Order diperlukan untuk status production');
 for(const k of ['missing_details','note']){out[k]=String(d[k]||'').trim();if(out[k].length>2000)throw Error('Nota terlalu panjang');}
 for(const k of ['customer_needed','dispatch_by','design_by','snoozed_until']){out[k]=d[k]||null;if(out[k]&&(time(out[k])==null||time(out[k])!>Date.parse('2100-01-01')))throw Error('Semak tarikh');}
 out.urgent=d.urgent===true;out.source_fingerprint=row.source_fingerprint;out.chat_revision=row.chat.revision||null;
 return out;
}
