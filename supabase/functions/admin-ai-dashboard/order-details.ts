// Order detail collection is independent of payment, provider readiness and draft sessions.
type Data=Record<string,any>;
export const detailRules=['review','standard','name','name_age','wording','image','image_wording'];
const fields:Data={review:[],standard:[],name:['name'],name_age:['name','age'],wording:['wording'],image:['image'],image_wording:['image','wording']};
export const detailLabels:Data={name:'Nama',age:'Umur',wording:'Wording',image:'Gambar'};
// ClickUp checkbox values arrive as either a JSON boolean or a string.
export function clickupConfirmed(v:unknown){if(v===true||v===1||v==='true'||v==='1')return true;if(v===false||v===0||v==='false'||v==='0')return false;return null;}
const text=(v:unknown)=>String(v??'').trim();
const time=(v:unknown)=>Date.parse(text(v));
export function itemSignature(items:Data[]){return JSON.stringify(items.map(i=>[i.id||i.line_no||'',i.sku||'',i.title||'',i.size||'',i.quantity||1]));}
export function attachDetailSources(snapshot:Data,sources:Data){
 for(const o of snapshot.orders||[]){Object.assign(o,sources.links?.[`${o.kind}:${o.id}`]||{});for(const t of [...(o.production_tasks||[]),...(o.dated_tasks||[])]){const d=sources.tasks?.[t.id]||{};t.detail={...d,confirmed:clickupConfirmed(d.confirmed)};}}
}
function inferRule(i:Data){
 const t=`${i.title||''} ${i.size||''}`.toLowerCase();
 if(/print(?:ing)? (?:only|service)|edible image|burn.?away/.test(t))return 'image';
 if(/custom name/.test(t)&&/birthday/.test(t)&&/cake topper/.test(t))return 'name_age';
 if(/custom|personaliz/.test(t)&&/acrylic|engagement|wedding/.test(t))return 'wording';
 return 'review';
}
function extract(v:string){
 const values:Data={};
 const name=v.match(/(?:^|\n)\s*(?:nama|name)\s*[:=\-]\s*([^\n]+)/i);
 const age=v.match(/(?:^|\n)\s*(?:(?:umur|age)\s*[:=\-]?\s*)?(\d{1,3})\s*(?:tahun|years?(?:\s*old)?|y\/?o)\b/i);
 const wording=v.match(/(?:^|\n)\s*(?:wording(?:\s+(?:on|for)\s+(?:the\s+)?(?:cake\s+)?topper)?|tulisan(?:\s+(?:pada|atas)\s+topper)?|text(?:\s+on\s+topper)?)\s*[:=\-]\s*([\s\S]+)/i);
 if(name)values.name=name[1].trim();if(age)values.age=age[1];if(wording)values.wording=wording[1].trim();
 // An isolated name + age is accepted only after the caller has established an order session.
 const bare=v.match(/^([\p{L}][\p{L}\s.'’&-]{1,100})\s*\n\s*(\d{1,3})\s*(?:tahun|years?(?:\s*old)?|y\/?o)\s*$/iu);
 if(bare){values.name=bare[1].trim();values.age=bare[2];}
 const inline=v.match(/^([\p{L}][\p{L}\s.'’&-]{1,100}?)\s*\(?\s*(\d{1,3})\s*(?:tahun|years?(?:\s*old)?|y\/?o)\s*\)?\s*$/iu);
 if(inline){values.name=inline[1].trim();values.age=inline[2];}
 // Recognizable full birthday wording is already a complete design instruction.
 if(!values.wording&&!v.includes('\n')&&/^(?:happy\s+(?:\d{1,3}(?:st|nd|rd|th)\s+)?birthday\s+\S.+|[\p{L}][\p{L}\s.'’&-]{1,100}\s+turns\s+\d{1,3}|[\p{L}][\p{L}\s.'’&-]{1,100}\s+\d{1,3}(?:st|nd|rd|th)\s+birthday)$/iu.test(v.trim()))values.wording=v.trim();
 return values;
}
export function orderDetails(o:Data,context:Data={},now=Date.now()){
 const items:Data[]=o.items||[], saved=o.state?.data?.detail_check||{}, signature=itemSignature(items);
 const stale=!!saved.signature&&saved.signature!==signature;
 const tasks:Data[]=o.production_tasks||o.dated_tasks||[];
 const closed=/^(shipped|completed|cancelled|canceled|customer_collected)$/i.test(o.status||'');
 const locked=(tasks.length>0&&tasks.every(t=>Number(t.progress_stage||0)>=5))||closed;
 const bindings:Data[]=context.bindings||[];
 const messages:Data[]=(context.messages||[]).filter((m:Data)=>m.direction==='inbound'&&!m.is_history);
 const sessionKnown=bindings.some(b=>b.usable===true), truncated=context.truncated===true;
 const evidence:Data[]=[],warnings:string[]=[];
 if(stale)warnings.push('Item order berubah; semak dan sahkan semula detail.');
 if(context.ambiguous)warnings.push('Ada beberapa order aktif dalam chat; pilih session yang betul.');
 if(truncated)warnings.push('Mesej session melebihi had bacaan; semak sejarah sebelum sahkan.');
 const result=items.map((i,n)=>{
  const id=text(i.id||i.line_no||n),config=stale?{}:saved.items?.[id]||{};let rule=detailRules.includes(config.rule)?config.rule:inferRule(i);
  const values:Data={},sources:Data={},candidates:Data={};
  const add=(data:Data,source:string,at?:string)=>{for(const f of ['name','age','wording','image'])if(text(data[f])&&!/^(-|–|—|none|null|n\/a)$/i.test(text(data[f]))){if(values[f]&&values[f]!==text(data[f])){(candidates[f] ||= []).push({value:text(data[f]),source,at});}else if(!values[f]){values[f]=text(data[f]);sources[f]={source,at};}}};
  if(text(i.wording))add({wording:i.wording},'Order iCetak');
  // Never allocate a generic multi-item note or chat by array position.
  if(items.length===1){add(extract(text(o.order_note)),'Note to seller');
   if(sessionKnown&&!context.ambiguous&&!truncated)for(const m of messages){const data=extract(text(m.text_content||m.caption));add(data,`${m.channel||'Chat'} · ${m.id}`,m.created_at);if(Object.keys(data).length)evidence.push({id:m.id,text:m.text_content||m.caption,at:m.created_at});}
  }
  const matching=tasks.filter(t=>t.detail?.sku&&text(t.detail.sku)===text(i.sku));
  const assigned=matching.length===1?matching:items.length===1&&tasks.length===1?tasks:[];
  for(const t of assigned){if(t.detail?.customize_name){const raw=text(t.detail.customize_name),parsed=extract(raw);if(['name','name_age'].includes(rule)&&!parsed.name&&/^[\p{L}][\p{L}\s.'’&-]{1,100}$/u.test(raw)&&!raw.includes('\n'))parsed.name=raw;
   const approvedText=rule==='name_age'&&(clickupConfirmed(t.detail.confirmed)===true||Number(t.progress_stage||0)>=5);
   add({...parsed,...((!['name','name_age'].includes(rule)||approvedText)&&!parsed.wording?{wording:raw}:{})},`ClickUp ${t.id}`,t.source_updated_at);}}
  // Complete wording supplied for a topper supersedes title-only name/age inference.
  // Explicit staff requirements, image requirements and multi-item allocation remain intact.
  if(!detailRules.includes(config.rule)&&rule==='name_age'&&values.wording)rule='wording';
  // Explicit admin correction supersedes extracted candidates, with item signature protection.
  const changedReply=!!saved.chat_revision&&saved.chat_revision!==JSON.stringify(bindings.map(b=>[b.id,b.revision]));
  for(const f of ['name','age','wording','image'])if(text(config.values?.[f])){
   const fresh=changedReply&&sessionKnown&&!context.ambiguous&&!truncated&&items.length===1?messages.filter(m=>!saved.checked_at||time(m.created_at)>time(saved.checked_at)).map(m=>extract(text(m.text_content||m.caption))[f]).filter(v=>v&&v!==text(config.values[f])):[];
   delete candidates[f];
   if(fresh.length)candidates[f]=fresh.map(value=>({value,source:'Balasan baru; semak perubahan'}));
   values[f]=text(config.values[f]);sources[f]={source:'Disahkan admin',at:saved.checked_at};
  }
  const missing=(fields[rule]||[]).filter((f:string)=>!values[f]);
  const conflict=Object.keys(candidates).some(f=>(fields[rule]||[]).includes(f));
  const needsReview=rule==='review'||conflict||stale||(Number(i.quantity)>1&&config.same_design!==true&&rule!=='standard');
  const state=needsReview?'review':missing.length?'missing':'complete';
  return {...i,id,rule,values,sources,candidates,missing,state,locked:closed||assigned.some(t=>Number(t.progress_stage||0)>=5),same_design:config.same_design===true,task_ids:assigned.map(t=>t.id)};
 });
 const complete=result.filter(i=>i.state==='complete').length;
 const missing=result.flatMap(i=>i.missing.map((f:string)=>`${result.length>1?`Item ${result.indexOf(i)+1}: `:''}${detailLabels[f]}`));
 const status=stale||result.some(i=>i.state==='review')||!result.length?'review':complete===result.length?'complete':'missing';
 const deadline=saved.deadline||null,deadlineTime=time(deadline),placed=time(o.created_at||o.placed_at);
 const firstAt=Number.isFinite(placed)?new Date(placed+30*60000).toISOString():null;
 const follow=saved.followup||{},waiting=!!follow.sent_at&&follow.revision===JSON.stringify(bindings.map(b=>[b.id,b.revision]));
 const stage=locked?'locked':status==='complete'?'ready':Number.isFinite(deadlineTime)&&now>=deadlineTime?'deadline':waiting?'waiting':firstAt&&now>=time(firstAt)?'followup_due':'grace';
 return {status,label:status==='complete'?'Detail lengkap':status==='missing'?'Belum lengkap':'Perlu semakan',complete,total:result.length,items:result,missing,warnings,
  signature,locked,stage,deadline,first_followup_at:firstAt,followup:follow,bindings,evidence,media:context.media||[],truncated,
  revision:JSON.stringify(bindings.map(b=>[b.id,b.revision])),checked_at:new Date(now).toISOString(),internal_order_id:o.internal_order_id||null,
  clickup_linked:tasks.length>0,session_linked:sessionKnown,source_note:o.order_note||'',source_fingerprint:o.source_fingerprint};
}
export function validateDetailCheck(input:Data,o:Data,context:Data={}){
 const old=o.state?.data?.detail_check||{},out:Data={signature:itemSignature(o.items||[]),items:{},bindings:[],checked_at:new Date().toISOString()};
 if(input.signature!==out.signature)throw Error('SOURCE_CHANGED: Item order berubah. Muat semula.');
 const allowed=new Map((o.items||[]).map((i:Data,n:number)=>[text(i.id||i.line_no||n),i]));
 for(const [id,x] of Object.entries(input.items||{}) as [string,Data][]){if(!allowed.has(id)||!detailRules.includes(x.rule))throw Error('Invalid item / detail rule');
  const values:Data={};for(const f of ['name','age','wording','image']){const v=text(x.values?.[f]);if(v.length>2000)throw Error('Detail terlalu panjang');if(f==='age'&&v&&!/^\d{1,3}$/.test(v))throw Error('Umur mesti nombor');if(f==='image'&&v&&!/^https:\/\//i.test(v))throw Error('URL gambar mesti HTTPS');if(v)values[f]=v;}
  out.items[id]={rule:x.rule,values,same_design:x.same_design===true};
  const current=o.detail_collection?.items?.find((i:Data)=>i.id===id);
  if(current?.locked&&(x.rule!==current.rule||['name','age','wording','image'].some(f=>text(values[f])!==text(current.values[f]))||out.items[id].same_design!==current.same_design))throw Error('Item ini sudah production; perubahan perlu disemak melalui task asal.');
 }
 if(Object.keys(out.items).length!==allowed.size)throw Error('Semua item order perlu disertakan semasa simpan detail');
 if(!Array.isArray(input.bindings)||input.bindings.length>4)throw Error('Maksimum 4 chat per session order');
 const candidates=new Map((context.candidates||[]).map((c:Data)=>[c.id,c]));
 for(const b of input.bindings){const c:Data|undefined=candidates.get(b.conversation_id) as Data|undefined;if(!c||c.ambiguous)throw Error('Chat tidak mempunyai padanan identiti yang jelas');
  const start=time(b.start_at),end=b.end_at?time(b.end_at):null;
  if(!Number.isFinite(start)||start>Date.now()+300000||start<time(c.boundary_at||'2020-01-01')||(end!=null&&(!Number.isFinite(end)||end<start)))throw Error('Semak sempadan session chat');
  out.bindings.push({conversation_id:c.id,start_at:new Date(start).toISOString(),end_at:end!=null?new Date(end).toISOString():null});
 }
 if(input.deadline){const d=time(input.deadline);if(!Number.isFinite(d)||d<time('2020-01-01')||d>time('2100-01-01'))throw Error('Deadline tidak sah');out.deadline=new Date(d).toISOString();}else out.deadline=null;
 // Save an external follow-up observation; it is never a claim that the system sent a message.
 out.followup=old.followup||{};
 if(input.mark_followup===true)out.followup={sent_at:new Date().toISOString(),source:'manual_external',revision:context.revision||'',note:text(input.followup_note).slice(0,500)};
 if(input.clear_followup===true)out.followup={};
 if(o.detail_collection?.locked&&JSON.stringify({items:out.items,bindings:out.bindings})!==JSON.stringify({items:old.items||{},bindings:old.bindings||[]}))throw Error('Production sudah bermula; semak perubahan melalui task asal.');
 return out;
}
