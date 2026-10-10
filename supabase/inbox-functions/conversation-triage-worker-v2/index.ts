import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const model = new Supabase.ai.Session('gte-small');
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, 'Content-Type': 'application/json' },
});
const allowed = new Set([
  'paid','waiting_payment','payment_unclear','order_confirmed','new_enquiry','ready_to_order','just_asking',
  'waiting_design','review','approved','waiting_customer','shipping_followup','completed','urgent','due_today',
  'due_tomorrow','future_date','follow_up','complaint','inactive','ready_to_ship','shipped','delivered',
  'cancelled','returned','refunded'
]);

type Msg = { direction?: string; content?: string; message_at?: string; message_type?: string };
type Triage = {
  payment_status: 'paid'|'waiting_payment'|'unpaid'|'unknown'; intent: string;
  urgency: 'normal'|'medium'|'high'|'critical'; due_date: string|null;
  priority_score: number; tags: string[]; remark: string; confidence: number;
};
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const unique=(v:string[])=>[...new Set(v.filter(x=>allowed.has(x)))];
const klDate=(d=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
function plusDays(text:string,days:number){const d=new Date(`${text}T12:00:00+08:00`);d.setUTCDate(d.getUTCDate()+days);return klDate(d);}

function currentSession(all:Msg[]):Msg[]{
  const m=all.slice(-100);
  if(m.length<=40)return m;
  let start=Math.max(0,m.length-42);
  for(let i=m.length-1;i>Math.max(0,m.length-65);i--){
    const a=Date.parse(m[i]?.message_at??''),b=Date.parse(m[i-1]?.message_at??'');
    if(Number.isFinite(a)&&Number.isFinite(b)&&a-b>96*3600_000&&m.length-i>=8){start=i;break;}
  }
  return m.slice(start);
}

function semanticInput(messages:Msg[]):string{
  let text=messages.slice(-24).reverse().map(m=>`${m.direction==='inbound'?'customer':'seller'}: ${String(m.content??'').slice(0,220)}`).join('\n').toLowerCase();
  const replacements:Array<[RegExp,string]>=[
    [/(dah|dh|sudah|done|already|telah|settle).{0,18}(bayar|payment|transfer)/gi,' customer confirms payment completed '],
    [/(nak|mahu|want|boleh).{0,18}(bayar|payment|transfer)|(send|bagi|bg).{0,12}(qr|account|akaun)/gi,' customer wants to pay now '],
    [/(dah|dh|done|already).{0,18}(order|purchase)|\b26\d{4}[a-z0-9]{6,}\b/gi,' confirmed customer order '],
    [/(harga|price|berapa|quotation|quote|saiz|size)/gi,' product price size enquiry '],
    [/(tracking|dah pos|dh pos|pos belum|parcel mana|status (?:parcel|order|penghantaran)|bila (?:sampai|pos|ship))/gi,' shipment tracking delivery follow up '],
    [/(draft|design|font|tulisan|adjust|ubah|tukar design|custom)/gi,' design draft customization review '],
    [/(bulan depan|next month|lambat lagi|bulan\s+(8|9|10|11|12))/gi,' distant future date low priority ']
  ];
  for(const [r,x] of replacements)text=text.replace(r,x);
  return text.replace(/\s+/g,' ').slice(0,4000);
}

async function semanticHint(db:any,text:string):Promise<{scores:Record<string,number>;hint:string|null;margin:number;model:string}>{
  try{
    const output=await model.run(text||'empty customer conversation',{mean_pool:true,normalize:true});
    const embedding=Array.from(output as number[]);
    const {data,error}=await db.rpc('match_ai_semantic_prototypes',{p_embedding:embedding,p_limit:8});
    if(error)throw error;
    const scores:Record<string,number>={};
    for(const row of data??[])scores[String(row.semantic_key)]=Number(row.similarity);
    const ranked=Object.entries(scores).sort((a,b)=>b[1]-a[1]);
    const margin=(ranked[0]?.[1]??0)-(ranked[1]?.[1]??0);
    const hint=(ranked[0]?.[1]??0)>=0.82&&margin>=0.025?ranked[0][0]:null;
    return {scores,hint,margin,model:'gte-small-hybrid-state-v1'};
  }catch(error){
    console.error('semantic unavailable',error);
    return {scores:{},hint:null,margin:0,model:'rules-state-v3'};
  }
}

function parseDue(text:string,today:string):{date:string|null;tag:string|null;days:number|null}{
  if(/(hari ini|harini|today)/i.test(text))return{date:today,tag:'due_today',days:0};
  if(/(esok|tomorrow)/i.test(text))return{date:plusDays(today,1),tag:'due_tomorrow',days:1};
  const m=text.match(/(?:guna|need|before|sebelum|event|pickup|ambil|hantar|hntr|sampai)[^\n]{0,30}?(\d{1,2})(?:[\/.\-](\d{1,2}))?\s*(?:hb)?/i)
    ||text.match(/\b(\d{1,2})(?:[\/.\-](\d{1,2}))?\s*hb\b/i);
  if(!m)return{date:null,tag:null,days:null};
  const base=new Date(`${today}T12:00:00+08:00`);let day=Number(m[1]),month=m[2]?Number(m[2]):base.getMonth()+1,year=base.getFullYear();
  if(!m[2]&&day<base.getDate()-2)month++;if(month>12){month=1;year++;}
  const date=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const days=Math.round((Date.parse(`${date}T12:00:00+08:00`)-Date.parse(`${today}T12:00:00+08:00`))/86400000);
  return{date,tag:days===0?'due_today':days===1?'due_tomorrow':days>=14?'future_date':null,days};
}

function receiptAfterPaymentPrompt(messages:Msg[]):boolean{
  let prompt=-1;
  for(let i=0;i<messages.length;i++){
    const text=String(messages[i].content??'').toLowerCase();
    if(messages[i].direction==='outbound'&&/(qrpay|qr pay|send qr|total\s*rm|total\s*\d|bayar|payment)/i.test(text))prompt=i;
    if(prompt>=0&&i>prompt&&i-prompt<=7&&messages[i].direction==='inbound'){
      const type=String(messages[i].message_type??'');
      if(type==='document')return true;
      if(type==='image'&&/(qr|total|bayar|payment)/i.test(String(messages[prompt].content??'')))return true;
    }
  }
  return false;
}

import {resolveOrderEvidence,type OrderEvidence} from '../_shared/order-evidence.ts';

function normalizedOrderDate(value: string | null): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const parsed = new Date(timestamp);
  if (parsed.getUTCFullYear() < 2020) return null;
  return klDate(parsed);
}

function dayDifference(value: string | null, today: string): number | null {
  const date = normalizedOrderDate(value);
  if (!date) return null;
  return Math.round((Date.parse(date + 'T12:00:00+08:00') - Date.parse(today + 'T12:00:00+08:00')) / 86400000);
}

async function classify(db:any,context:any):Promise<{triage:Triage;semantic:any;model:string;order_evidence:OrderEvidence;evidence:any}>{
  const all:Msg[]=Array.isArray(context?.messages)?context.messages:[];
  const messages=currentSession(all);
  const inbound=messages.filter(m=>m.direction==='inbound');
  const outbound=messages.filter(m=>m.direction==='outbound');
  const recentInbound=inbound.slice(-4).map(m=>String(m.content??'')).join(' ');
  const allInbound=inbound.map(m=>String(m.content??'')).join(' ');
  const allOutbound=outbound.map(m=>String(m.content??'')).join(' ');
  const lastText=String(messages.at(-1)?.content??'');
  const semantic=await semanticHint(db,semanticInput(messages));
  const summaries=Array.isArray(context?.order_summaries)?context.order_summaries:[];
  const orderEvidence=resolveOrderEvidence(summaries,allInbound);

  const trustedPaid=orderEvidence.authoritative && !orderEvidence.cod && /^(PAID|SUCCESS|COMPLETED|VERIFIED)$/.test(orderEvidence.payment_status);
  const explicitPaid=/(dah|dh|sudah|done|already|telah|settle).{0,20}(bayar|payment|transfer)/i.test(allInbound);
  const receipt=receiptAfterPaymentPrompt(messages);
  const trackingProvided=/tracking number|track here|\bMY\d{8,}\b|\b632\d{8,}\b/i.test(allOutbound);
  const shippingQuestionPattern=/(?:\b(?:tracking|parcel|shipment|penghantaran)\b.{0,32}\b(?:mana|status|update|bila|sampai|belum|lambat|no|number|nombor)\b|\b(?:mana|status|update|bila|belum)\b.{0,32}\b(?:tracking|parcel|shipment|penghantaran|courier)\b|\b(?:dah|dh|sudah|belum)\s+(?:pos|ship|hantar|pickup)\b|\b(?:pos|ship|hantar)\s+(?:dah|dh|sudah|belum|ke|tak)\b|^\s*tracking\s*\??\s*$)/i;
  const shippingEvidence=inbound.slice(-4)
    .map(m=>({message_id:(m as any).id??null,message_at:m.message_at??null,text:String(m.content??'').slice(0,280)}))
    .find(item=>shippingQuestionPattern.test(item.text))??null;
  const shippingQuestion=Boolean(shippingEvidence);
  const completed=/(dah terima|dh terima|already received|selamat sampai|received the)/i.test(recentInbound);
  const orderId=/\b26\d{4}[a-z0-9]{6,}\b/i.test(allInbound);
  const explicitOrder=/(dah|dh|done|already).{0,20}(order|purchase)/i.test(allInbound);
  const orderConfirmed=orderId||explicitOrder||receipt||trackingProvided||shippingQuestion||completed;
  const wantsPayment=/(nak|mahu|want|boleh).{0,18}(bayar|payment|transfer|order)|(send|bagi|bg).{0,12}(qr|account|akaun)/i.test(recentInbound);
  const enquiry=/(harga|price|berapa|quotation|quote|size apa|saiz apa|boleh ke|can you|nak tanya)/i.test(recentInbound||lastText);
  const urgentText=/(urgent|asap|segera|cepat|sempat|smpt|tak lama lagi|x lama lagi)/i.test(recentInbound);
  const complaint=/(refund|cancel|kecewa|tak reply|x reply|diam je|nak niaga ke|tak sempat|x sempat|kalau saya tak tanya)/i.test(recentInbound);
  const follow=/(update|macam mana|mcm mana|dah siap|dh siap|mana design|follow.?up|takde reply)/i.test(recentInbound);
  const futureText=/(bulan depan|next month|lambat lagi|bulan\s+(8|9|10|11|12))/i.test(recentInbound);
  const approved=/(ok proceed|okay proceed|confirm|onz|betul|boleh proceed|yes proceed|gambar pertama onz|gmbar pertama onz)/i.test(recentInbound);
  const designText=/(draft|design|font|tulisan|adjust|ubah|tukar design|custom)/i.test(recentInbound+' '+allOutbound.slice(-1000));
  const sellerSentDraft=/(draft|design|ni boleh|yg ni ok|yang ni ok|crop jadi|crop jdi)/i.test(allOutbound.slice(-1000));
  const due=parseDue(recentInbound,klDate());
  let effectiveDueDate=due.date;

  let payment:Triage['payment_status']='unknown',intent='unknown',score=0,confidence=0.7;
  let tags:string[]=[];
  const paid=trustedPaid||explicitPaid||receipt||trackingProvided;
  if(paid){payment='paid';tags.push('paid');score+=35;confidence+=0.1;}
  else if(wantsPayment&&!orderConfirmed){payment='waiting_payment';tags.push('waiting_payment');score+=10;}
  else if(enquiry&&!orderConfirmed){payment='unpaid';}

  if(orderConfirmed){tags.push('order_confirmed');intent='ordered';score+=20;}
  else if(wantsPayment){tags.push('ready_to_order');intent='ready_to_order';score+=12;}
  else if(enquiry){tags.push('new_enquiry');intent='new_enquiry';score+=3;}
  else if(semantic.hint==='ready_to_order'){tags.push('ready_to_order');intent='ready_to_order';score+=8;}
  else if(semantic.hint==='new_enquiry'){tags.push('new_enquiry');intent='new_enquiry';}
  else{tags.push('just_asking');intent='just_asking';}

  if(orderConfirmed&&!paid)tags.push('payment_unclear');
  else if(!orderConfirmed&&payment==='unknown')tags.push('payment_unclear');

  if(due.tag){tags.push(due.tag);score+=due.tag==='due_today'?25:due.tag==='due_tomorrow'?15:-20;}
  if(futureText){tags.push('future_date');score-=20;}
  if(urgentText||due.tag==='due_today'||due.tag==='due_tomorrow'){tags.push('urgent');score+=30;}
  if(complaint){tags.push('complaint','urgent');score+=30;}
  if(follow){tags.push('follow_up');score+=12;}

  if(completed){tags.push('completed');score-=50;}
  else if(shippingQuestion||trackingProvided){tags.push('shipping_followup');score+=8;}
  else if(orderConfirmed&&approved){tags.push('approved');score+=8;}
  else if(orderConfirmed&&sellerSentDraft&&context?.conversation?.last_message_sender==='seller'){tags.push('review');score+=7;}
  else if(orderConfirmed&&designText){tags.push('waiting_design');score+=10;}
  else if(!orderConfirmed&&semantic.hint==='design_work'){tags.push('new_enquiry');intent='new_enquiry';}

  if(context?.conversation?.last_message_sender==='seller'&&!context?.conversation?.needs_reply&&!completed)tags.push('waiting_customer');
  tags=unique(tags);
  if(completed)tags=tags.filter(x=>!['urgent','due_today','due_tomorrow','follow_up','shipping_followup','waiting_design','review'].includes(x));
  if(tags.includes('shipping_followup'))tags=tags.filter(x=>!['waiting_payment','ready_to_order','new_enquiry','waiting_design','review','just_asking'].includes(x));
  if(tags.includes('approved'))tags=tags.filter(x=>!['review','waiting_design'].includes(x));
  if(tags.includes('paid'))tags=tags.filter(x=>!['waiting_payment','payment_unclear','new_enquiry','ready_to_order','just_asking'].includes(x));
  if(tags.includes('order_confirmed'))tags=tags.filter(x=>!['new_enquiry','ready_to_order','just_asking'].includes(x));
  if(tags.includes('future_date')&&!urgentText&&(due.days===null||due.days>7))tags=tags.filter(x=>x!=='urgent');

  const lastAt=Date.parse(context?.conversation?.last_message_at??'');
  if(Number.isFinite(lastAt)&&Date.now()-lastAt>7*86400000&&!tags.includes('paid')&&!tags.includes('urgent')){tags.push('inactive');score-=15;}
  tags=unique(tags);score=clamp(Math.round(score),0,100);
  let urgency:Triage['urgency']='normal';
  if(score>=80)urgency='critical';else if(tags.includes('urgent')||score>=55)urgency='high';else if(score>=35)urgency='medium';
  if(completed&&!complaint)urgency='normal';
  confidence=clamp(confidence+(semantic.hint?0.08:0)+(receipt?0.07:0),0.55,0.95);

  const dateText=due.date?` Tarikh perlu: ${due.date.split('-').reverse().join('/')}.`:'';
  let remark='Pertanyaan pelanggan; status order atau bayaran belum jelas.';
  if(completed)remark='Pelanggan mengesahkan order atau parcel telah diterima.';
  else if(complaint)remark=`Aduan/follow-up penting; perlu semakan segera.${dateText}`;
  else if(paid&&tags.includes('urgent'))remark=`Bayaran dikesan; pelanggan perlukan tindakan segera.${dateText}`;
  else if(shippingQuestion&&trackingProvided)remark='Pelanggan bertanya status penghantaran/tracking; seller pernah memberikan nombor tracking.';
  else if(shippingQuestion)remark='Pelanggan bertanya status penghantaran/tracking; pergerakan order belum disahkan oleh sistem.';
  else if(trackingProvided)remark='Seller telah memberikan nombor tracking; menunggu respons pelanggan.';
  else if(tags.includes('approved'))remark=`Design/order telah diluluskan pelanggan dan boleh diteruskan.${dateText}`;
  else if(tags.includes('review'))remark=`Draft/design dihantar dan menunggu semakan pelanggan.${dateText}`;
  else if(tags.includes('waiting_design'))remark=`Order disahkan dan perlu proses design.${dateText}`;
  else if(orderConfirmed)remark=`Order disahkan; status bayaran ${paid?'dikesan':'belum jelas'}.${dateText}`;
  else if(wantsPayment)remark=`Pelanggan bersedia order dan sedang menunggu cara bayaran.${dateText}`;
  else if(tags.includes('new_enquiry'))remark=`Pertanyaan baharu; belum ada bukti order atau bayaran.${dateText}`;
  else if(tags.includes('future_date'))remark=`Pertanyaan untuk tarikh akan datang; keutamaan rendah.${dateText}`;


  // Only an unambiguous canonical order can override message inference. Message inference is only the fallback
  // when the order webhook has not supplied a usable state.
  if (orderEvidence.authoritative && orderEvidence.state !== 'unknown') {
    const state = orderEvidence.state;
    const authoritativePaid = !orderEvidence.cod && /^(PAID|SUCCESS|COMPLETED|VERIFIED)$/.test(orderEvidence.payment_status);
    payment = authoritativePaid ? 'paid' : state === 'unpaid' ? 'unpaid' : payment;
    intent = state;
    confidence = Math.max(confidence, 0.98);

    const remove = new Set([
      'waiting_payment','payment_unclear','new_enquiry','ready_to_order','just_asking',
      'waiting_design','review','approved','waiting_customer','ready_to_ship','shipped',
      'delivered','completed','cancelled','returned','refunded','inactive'
    ]);
    tags = tags.filter(tag => !remove.has(tag));
    if (authoritativePaid) tags.push('paid');
    if (state !== 'unpaid') tags.push('order_confirmed');

    const terminal = ['completed','cancelled','returned','refunded'].includes(state);
    const fulfilled = ['shipped','delivered','completed','cancelled','returned','refunded'].includes(state);
    if (state === 'ready_to_ship') tags.push('ready_to_ship');
    if (state === 'shipped') tags.push('shipped');
    if (state === 'delivered') tags.push('delivered');
    if (state === 'completed') tags.push('completed');
    if (state === 'cancelled') tags.push('cancelled');
    if (state === 'returned') tags.push('returned');
    if (state === 'refunded') tags.push('refunded');
    if (state === 'delivery_failed') tags.push('shipping_followup','urgent');

    const shipDate = state === 'ready_to_ship' ? normalizedOrderDate(orderEvidence.ship_by_at) : null;
    const shipDays = state === 'ready_to_ship' ? dayDifference(shipDate, klDate()) : null;
    effectiveDueDate = shipDate;

    if (fulfilled) {
      tags = tags.filter(tag => !['urgent','due_today','due_tomorrow','future_date','follow_up','waiting_design','review','ready_to_ship'].includes(tag));
      if (shippingQuestion && !terminal) tags.push('shipping_followup');
      score = complaint ? Math.max(score, 60) : state === 'shipped' ? 22 : state === 'delivered' ? 12 : 5;
    } else if (state === 'ready_to_ship') {
      score = Math.max(score, 45);
      if (shipDays !== null && shipDays < 0) { tags.push('urgent'); score = Math.max(score, 90); }
      else if (shipDays === 0) { tags.push('due_today','urgent'); score = Math.max(score, 85); }
      else if (shipDays === 1) { tags.push('due_tomorrow','urgent'); score = Math.max(score, 70); }
      else if (shipDays !== null && shipDays >= 14) tags.push('future_date');
    } else if (state === 'paid') {
      score = Math.max(score, 45);
    } else if (state === 'unpaid') {
      payment = 'unpaid';
      tags.push('waiting_payment');
      score = Math.max(score, 25);
    } else if (state === 'delivery_failed') {
      score = Math.max(score, 80);
    }

    tags = unique(tags);
    score = clamp(Math.round(score), 0, 100);
    urgency = terminal && !complaint ? 'normal'
      : score >= 80 ? 'critical'
      : tags.includes('urgent') || score >= 55 ? 'high'
      : score >= 35 ? 'medium' : 'normal';

    const tracking = orderEvidence.tracking_no ? ` Tracking: ${orderEvidence.tracking_no}.` : '';
    const statusText = [orderEvidence.order_status, orderEvidence.shipment_status].filter(Boolean).join(' / ');
    if (state === 'completed') remark = `${orderEvidence.channel === 'shopee' ? 'Shopee' : 'iCetak'} sah: order selesai (${statusText}).${tracking}`;
    else if (state === 'delivered') remark = `${orderEvidence.channel === 'shopee' ? 'Shopee' : 'iCetak'} sah: parcel telah dihantar; menunggu buyer sahkan penerimaan (${statusText}).${tracking}`;
    else if (state === 'shipped') remark = `${orderEvidence.channel === 'shopee' ? 'Shopee' : 'iCetak'} sah: parcel telah diserahkan kepada courier (${statusText}).${tracking}`;
    else if (state === 'ready_to_ship') remark = `${orderEvidence.channel === 'shopee' ? 'Shopee' : 'iCetak'} sah: order sedia diproses untuk shipment (${statusText}).`;
    else if (state === 'cancelled') remark = `${orderEvidence.channel === 'shopee' ? 'Shopee' : 'iCetak'} sah: order dibatalkan (${statusText}).`;
    else if (state === 'returned') remark = `${orderEvidence.channel === 'shopee' ? 'Shopee' : 'iCetak'} sah: order dalam proses pemulangan (${statusText}).`;
    else if (state === 'refunded') remark = `${orderEvidence.channel === 'shopee' ? 'Shopee' : 'iCetak'} sah: order telah dipulangkan bayaran (${statusText}).`;
    else if (state === 'delivery_failed') remark = `${orderEvidence.channel === 'shopee' ? 'Shopee' : 'iCetak'} sah: penghantaran gagal dan perlu tindakan (${statusText}).${tracking}`;
    else if (state === 'paid') remark = `${orderEvidence.channel === 'shopee' ? 'Shopee' : 'iCetak'} sah: bayaran diterima; status order ${statusText || 'PAID'}.`;
    else if (state === 'unpaid') remark = `${orderEvidence.channel === 'shopee' ? 'Shopee' : 'iCetak'} sah: order masih belum dibayar (${statusText || 'UNPAID'}).`;
  }

  const evidence={
    decision_basis:orderEvidence.authoritative&&orderEvidence.state!=='unknown'?'authoritative_order':'conversation_rules',
    latest_inbound:inbound.slice(-4).map((m:any)=>({
      message_id:m.id??null,
      message_at:m.message_at??null,
      type:m.message_type??'text',
      text:String(m.content??'').slice(0,280)
    })),
    matched_signals:{
      shipping_question:shippingEvidence,
      tracking_provided_by_seller:trackingProvided,
      receipt_after_payment_prompt:receipt,
      trusted_paid_order:trustedPaid,
      explicit_paid_message:explicitPaid,
      explicit_order_message:explicitOrder,
      order_id_in_message:orderId,
      wants_payment:wantsPayment,
      enquiry
    },
    semantic:{hint:semantic.hint,margin:semantic.margin},
    order:orderEvidence
  };
  return {triage:{payment_status:payment,intent,urgency,due_date:effectiveDueDate,priority_score:score,tags,remark:remark.slice(0,300),confidence:Number(confidence.toFixed(4))},semantic,model:semantic.model,order_evidence:orderEvidence,evidence};
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return reply({error:'POST required'},405);
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!key)return reply({error:'Supabase env missing'},500);
  const db=createClient(url,key,{auth:{persistSession:false}});
  let body:any={};try{body=await req.json();}catch{body={};}
  const batch=clamp(Number(body.batch_size??1),1,4);
  let jobs:any[]=[];
  if(body.conversation_id)jobs=[{id:null,conversation_id:body.conversation_id}];
  else{const claimed=await db.rpc('claim_conversation_ai_jobs',{p_limit:batch});if(claimed.error)return reply({error:claimed.error.message},500);jobs=claimed.data??[];}
  const results:any[]=[];
  for(const job of jobs){
    try{
      const context=await db.rpc('get_conversation_ai_context',{p_conversation_id:job.conversation_id,p_limit:120});if(context.error)throw context.error;
      const c=await classify(db,context.data),r=c.triage,messages=Array.isArray(context.data?.messages)?context.data.messages:[];
      const applied=await db.rpc('apply_conversation_ai_analysis',{
        p_conversation_id:job.conversation_id,p_job_id:job.id,p_analysis_version:'triage-v7-evidence',p_model:c.model,
        p_payment_status:r.payment_status,p_intent:r.intent,p_urgency:r.urgency,p_due_date:r.due_date,p_priority_score:r.priority_score,
        p_tags:r.tags,p_remark:r.remark,p_confidence:r.confidence,p_raw_output:{classification:r,semantic:c.semantic,order_evidence:c.order_evidence,evidence:c.evidence},
        p_input_message_count:messages.length,p_input_first_message_at:messages[0]?.message_at??null,p_input_last_message_at:messages.at(-1)?.message_at??null
      });if(applied.error)throw applied.error;
      results.push({conversation_id:job.conversation_id,analysis_id:applied.data,model:c.model,...r});
    }catch(error){if(job.id)await db.rpc('fail_conversation_ai_job',{p_job_id:job.id,p_error:String(error),p_retry_minutes:5});results.push({conversation_id:job.conversation_id,error:String(error)});}
  }
  return reply({processed:results.length,results});
});

