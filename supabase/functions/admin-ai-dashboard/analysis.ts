import { workflow } from './workflow.ts';
import { confirmedOrder, caseSummary } from './case.ts';
export type RecordData=Record<string,any>;
const content=(m:RecordData)=>String(m.text_content||m.caption||'').trim();
const at=(m:RecordData)=>Date.parse(m.created_at||'')||0;
export const intentLabels:Record<string,string>={complaint:'Aduan / perlu semakan',shipping:'Parcel / penghantaran',design:'Design / saiz / wording',payment:'Bayaran / pautan',new_order:'Mahu buat order',enquiry:'Pertanyaan produk',followup:'Follow-up',other:'Perlu dibaca'};
export function identity(c:RecordData){
 const own=(c.identities||[]).filter((i:RecordData)=>i.channel===c.channel);
 const phones=[...new Set(own.map((i:RecordData)=>String(i.phone||'').replace(/\D/g,'')).filter(Boolean))];
 return {id:c.id,master_id:c.master_id||null,phone:phones.length===1?phones[0]:null,
  shopee_user_id:c.channel==='shopee'?c.external_customer_id:null};
}
export function effectiveStatus(review:RecordData|null,c:RecordData,now=Date.now()){
 if(!review||review.inbound_revision!==c.inbound_revision)return 'needs_review';
 if(review.status==='snoozed'&&(!Number.isFinite(Date.parse(review.snoozed_until||''))||Date.parse(review.snoozed_until)<=now))return 'needs_review';
 return review.status||'needs_review';
}
export function analyze(c:RecordData,ctx:RecordData,semantic:RecordData|null=null,now=Date.now()){
 const all=[...(c.messages||[])].sort((a,b)=>at(a)-at(b)) as RecordData[];
 const boundary=Date.parse(ctx.session?.boundary_at||'')||0;
 const opened=Date.parse(ctx.session?.opened_at||'')||boundary;
 const draftMessages=all.filter(m=>at(m)>=Math.max(boundary,opened));
 // A closed order does not close after-sales questions. Only draft extraction uses the strict boundary.
 let recent=all.slice(-30);for(let i=recent.length-1;i>0;i--){if(at(recent[i])-at(recent[i-1])>48*3600000){recent=recent.slice(i);break;}}
 const inbound=recent.filter(m=>m.direction==='inbound');
 const evidence=inbound.slice(-5);const text=evidence.map(content).join('\n');
 const matches:Array<{intent:string;pattern:RegExp}>=[
  {intent:'complaint',pattern:/refund|rosak|salah barang|kecewa|complaint|tak reply|x reply|tak balas|x balas|cancel|batal/i},
  {intent:'shipping',pattern:/tracking|parcel|courier|penghantaran|bila.{0,20}(sampai|pos|ship)|(?:dah|dh|belum).{0,12}(pos|ship)|barang.{0,12}(mana|sampai)/i},
  {intent:'design',pattern:/design|desain|font|huruf|initial|intial|wording|tulisan|saiz|size|ukuran|diameter|gambar|tiramisu/i},
  {intent:'payment',pattern:/bayar|payment|transfer|resit|receipt|qr\b|akaun|pautan|\blink\b/i},
  {intent:'new_order',pattern:/(nak|mahu|want|boleh).{0,18}(order|tempah|beli)|order.{0,12}(macam|mcm|how)/i},
  {intent:'enquiry',pattern:/harga|price|berapa|brpa|brp|tanya|boleh|available|stok|stock/i},
  {intent:'followup',pattern:/update|follow.?up|siap|mcm mana|macam mana/i}
 ];
 // Prefer the newest meaningful customer request; generic automation never resolves it.
 const lastInbound=evidence[evidence.length-1];
 const acknowledgement=!!lastInbound&&lastInbound.message_type==='text'&&content(lastInbound).length<100&&/^(?:(?:ok(?:ay|ey)?|baik|terima kasih|tq+|thanks?|thank you|ya|ye)[\s,.!🙏👍😊]*)+$/i.test(content(lastInbound));
 const newest=acknowledgement?lastInbound:[...evidence].reverse().find(m=>matches.some(x=>x.pattern.test(content(m))));
 const intentText=newest?content(newest):text;
 const intents=matches.filter(x=>x.pattern.test(intentText)).map(x=>x.intent);
 let intent=intents[0]||'other';
 const review=ctx.review;const currentReview=review?.inbound_revision===c.inbound_revision;
 if(currentReview&&intentLabels[review.intent_override])intent=review.intent_override;
 let basis=intents.length?'Isyarat dalam mesej pelanggan':'Semakan admin diperlukan';
 const semanticMap:Record<string,string>={new_enquiry:'enquiry',ready_to_order:'new_order',design_work:'design',shipping_followup:'shipping'};
 const ranked=semantic?.matches||[];const hint=semanticMap[ranked[0]?.semantic_key];
 if(!acknowledgement&&intent==='other'&&hint&&Number(ranked[0]?.similarity)>=0.82&&Number(ranked[0]?.similarity)-Number(ranked[1]?.similarity||0)>=0.025){intent=hint;basis='Cadangan semantik gte-small; perlu semakan admin';}
 const orders=[...(ctx.orders||[]).map((o:RecordData)=>({...o,reference:o.order_no,kind:'icetak'})),...(ctx.marketplace_orders||[]).map((o:RecordData)=>({...o,reference:o.order_sn,kind:'shopee'}))];
 const references=orders.filter(o=>o.reference&&text.toUpperCase().includes(String(o.reference).toUpperCase()));
 const manual=confirmedOrder(c,ctx);
 const linked=manual||(ctx.identity_status!=='ambiguous'&&references.length===1?references[0]:null);
 const urgencyText=intentText.replace(/(?:tak|tidak|x|not|no)\s+(?:urgent|rush|rushing)/gi,'');
 const urgent=/\burgent\b|\basap\b|segera|esok|hari ini|harini|today|tomorrow|sempat|smpt/i.test(urgencyText);
 const age=Math.max(0,(now-(Date.parse(c.last_inbound_at||'')||now))/3600000);
 const priority=Math.min(100,(intent==='complaint'?80:intent==='shipping'?65:intent==='payment'?60:intent==='design'?50:40)+(urgent?20:0)+Math.min(15,Math.floor(age/12)));
 const warnings:string[]=[];
 if(ctx.identity_status==='ambiguous')warnings.push('Identiti bertindih. Order dan penerima mesti disemak dalam CRM.');
 if(c.channel==='shopee')warnings.push('Balasan automation luar mungkin tiada dalam DB. Semak chat asal sebelum membalas.');
 if(!linked&&orders.length)warnings.push('Order berkaitan dipaparkan sebagai rujukan; order untuk pertanyaan ini belum dipastikan.');
 if(!orders.length)warnings.push('Tiada order dipadankan dalam data tersedia; ini bukan bukti pelanggan belum pernah membeli.');
 if(all.some(m=>m.message_type!=='text'&&m.message_type!=='system'))warnings.push('Gambar / audio / dokumen perlu semakan admin; kandungannya belum ditafsir.');
 if(all.length>=100)warnings.push('Konteks terhad kepada 100 mesej terkini.');
 if(!draftMessages.length)warnings.push('Tiada mesej selepas sempadan session. Jangan guna chat lama untuk draft baharu.');
 const cod=linked?.kind==='shopee'&&(linked.financials||[]).some((f:RecordData)=>/cash|cod/i.test(f.payment_method||''));
 if(cod)warnings.push('Order COD: status platform bukan pengesahan tunai telah diterima.');
 let suggestion='';
 if(evidence.length&&!acknowledgement){
  if(intent==='design')suggestion='Untuk cadangan saiz, boleh bagi ukuran lebar tempat nak letak topper dan kuantiti yang diperlukan? Boleh sertakan juga wording serta tarikh nak guna supaya saya boleh semak sekali.';
  else if(intent==='shipping')suggestion=linked?`Saya semak penghantaran untuk order ${linked.reference} dahulu ya. Saya akan maklumkan selepas semakan.`:'Boleh bagi nombor order yang nak disemak? Saya semak status parcel dahulu ya.';
  else if(intent==='payment')suggestion=linked?`Saya semak bayaran dan jumlah untuk order ${linked.reference} dahulu ya.`:'Boleh bagi nombor order atau detail tempahan? Saya semak jumlah dan pautan bayaran yang betul dahulu ya.';
  else if(intent==='complaint')suggestion='Maaf atas kesulitan. Boleh bagi nombor order dan detail masalah yang berlaku supaya saya boleh semak dan bantu?';
  else if(intent==='new_order')suggestion='Boleh bagi produk yang nak ditempah, saiz, kuantiti, wording dan tarikh nak guna? Nak pickup atau penghantaran ya?';
  else if(intent==='enquiry')suggestion='Nak tanya produk yang mana ya? Boleh bagi contoh, saiz dan kuantiti supaya saya boleh semak pilihan serta harga yang sesuai.';
  else if(intent==='followup')suggestion='Saya semak perkembangan tempahan dahulu ya. Boleh sahkan nombor order yang dimaksudkan?';
 }
 const textEvidence=evidence.filter(m=>content(m));
 const caseInfo=caseSummary(c,ctx,intent,content(newest||textEvidence[textEvidence.length-1]||{}).slice(0,240));
 const work=workflow(c,ctx,intent,now);
 caseInfo.facts.push(...work.facts);
 if(acknowledgement&&!work.decision){caseInfo.title='Semak penutup perbualan';caseInfo.next='Pelanggan memberi pengakuan ringkas. Semak tiada isu tertinggal sebelum tandakan selesai.';}
 if(work.title){caseInfo.title=work.title;caseInfo.next=work.next;}
 return {workflow:work,acknowledgement,case:caseInfo,action_label:caseInfo.title,intent,intent_label:intentLabels[intent],intents,priority,urgent,
  confidence:ctx.identity_status==='ambiguous'||!textEvidence.length?'rendah':intents.length?'sederhana':'rendah',
  confidence_reasons:[textEvidence.length?`${textEvidence.length} mesej pelanggan digunakan`:'Tiada bukti teks',ctx.identity_status==='matched'?'Identiti CRM dipadankan':'Identiti CRM perlu semakan',linked?manual?`Order ${linked.reference} disahkan admin`:`Order ${linked.reference} disebut dalam chat`:'Order khusus belum dipastikan',intents.length===1?'Satu kategori utama dikenal pasti':intents.length>1?'Beberapa kehendak bercampur':'Kategori belum jelas'],
  confidence_note:'Tahap bukti untuk semakan, bukan kebarangkalian ketepatan atau izin auto-send.',
  summary:textEvidence.length?textEvidence.slice(-2).map(content).join(' · ').slice(0,420):'Mesej media atau konteks belum mencukupi. Buka bukti chat.',
  suggestion,basis,engine:semantic?.model?'gte-small + SOP rules v1':'SOP rules v1',
  evidence:evidence.map(m=>({id:m.id,text:content(m),at:m.created_at,type:m.message_type})),warnings,
  referenced_order:linked?{id:linked.id,reference:linked.reference,kind:linked.kind}:null,
  draft_message_count:draftMessages.length,session_boundary:ctx.session?.boundary_at||null,
  status:effectiveStatus(review,c,now)==='waiting_customer'&&work.followup_due&&work.followup_at>(Date.parse(review?.updated_at||'')||0)?'needs_review':effectiveStatus(review,c,now),reopened:!!review&&!currentReview,
  response_text:currentReview?review.response_text||suggestion:suggestion};
}
