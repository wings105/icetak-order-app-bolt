import {clickupConfirmed,orderDetails} from '../admin-ai-dashboard/order-details.ts';
type Data=Record<string,any>;
const text=(v:unknown)=>String(v??'').trim();
export const briefLabels:Record<string,string>={product:'Produk',quantity:'Kuantiti',size:'Saiz',shape:'Bentuk',material:'Material',colour:'Warna',mode:'Keperluan design',name:'Nama',age:'Umur',wording:'Wording tepat',artwork:'Gambar dipilih (URL)',template:'Kod / template',instructions:'Arahan designer'};
export const briefModes=['wording','name_age','image','image_wording','template','standard'];
export const briefProducts=['edible','topper','acrylic','wafer'];
const stable=(v:any):string=>JSON.stringify(v&&typeof v==='object'?Array.isArray(v)?v.map(x=>JSON.parse(stable(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable(v[k]))])):v??null);
export async function briefFingerprint(v:unknown){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stable(v))))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function requirement(values:Data){
 const required=['product','quantity','size','mode'];
 if(['edible','wafer'].includes(values.product))required.push('shape');
 if(['acrylic','topper'].includes(values.product))required.push('material');
 if(values.product==='acrylic')required.push('colour');
 if(values.mode==='wording'||values.mode==='image_wording')required.push('wording');
 if(values.mode==='name_age')required.push('name','age');
 if(values.mode==='image'||values.mode==='image_wording')required.push('artwork');
 if(values.mode==='template'||values.mode==='standard')required.push('template');
 return required;
}
export function validateBrief(input:Data){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['values','same_design','final_file_id','artwork_qc','customer_approved'].includes(k)))throw Error('INVALID_BRIEF');
 const values:Data={};
 for(const [k,v] of Object.entries(input.values||{})){
  if(!(k in briefLabels)||typeof v!=='string'||v.length>(k==='instructions'?3000:2000))throw Error('INVALID_BRIEF_FIELD');
  values[k]=text(v);
 }
 if(values.product&&!briefProducts.includes(values.product)||values.mode&&!briefModes.includes(values.mode))throw Error('INVALID_BRIEF_RULE');
 if(values.quantity&&!/^[1-9]\d{0,4}$/.test(values.quantity)||values.age&&!/^\d{1,3}$/.test(values.age))throw Error('INVALID_BRIEF_NUMBER');
 if(values.artwork&&!/^https:\/\//i.test(values.artwork)&&!/^wasapflow-media:\/\/\d+$/.test(values.artwork)&&!/^task-file:\/\/[a-f0-9-]{36}$/i.test(values.artwork))throw Error('INVALID_ARTWORK_URL');
 if(input.final_file_id&&!/^[a-f0-9-]{36}$/i.test(input.final_file_id))throw Error('INVALID_FINAL_FILE');
 return {values,same_design:input.same_design===true,final_file_id:text(input.final_file_id),artwork_qc:input.artwork_qc===true,customer_approved:input.customer_approved===true};
}
// Inputs are server-owned exact task/order/session records, never browser claims.
export async function taskReadiness(source:Data,order:Data|null,context:Data={},saved:Data|null=null,proposal?:Data){
 const fingerprint=await briefFingerprint({rules_version:'task-brief-v2',source,order:order?{items:order.items,source_fingerprint:order.source_fingerprint,state:order.state?.data?.detail_check,tasks:order.production_tasks}:null,
  chat:{ambiguous:!!context.ambiguous,truncated:!!context.truncated,unavailable:!!context.unavailable,bindings:context.bindings||[],messages:context.messages||[],media_access:Object.fromEntries(Object.entries(context.media_access||{}).map(([k,v]:[string,any])=>[k,v.available===true]))}});
 const current=!!saved&&saved.source_fingerprint===fingerprint,expired=!!saved&&!current;
 const config=proposal||current&&saved?.data||{};
 const values:Data={},sources:Data={},conflicts:Data[]=[];
 const add=(field:string,value:unknown,label:string)=>{const v=text(value);if(!v||/^(?:-|–|—|none|null|n\/a)$/i.test(v))return;
  if(values[field]&&values[field]!==v)conflicts.push({field,label:briefLabels[field],value:v,source:label});else {values[field]=v;sources[field]={source:label};}};
 const fields=source.fields||{},item=source.item||{},title=text(source.title),spec=`${title} ${item.title||''} ${item.size||''} ${item.style||''}`;
 const warnings:string[]=[];
 const detail=order?orderDetails(order,context):null;
 const specEvidence:Data[]=[];
 const matched=detail?.items.filter((i:Data)=>i.task_ids.includes(source.task_id))||[];
 const exact=matched.length===1?matched[0]:null;
 const raw=text(fields['customize name']||fields['customise name']);
 const type=text(item.product_type||source.component?.type)+' '+source.status+' '+spec+' '+text(exact?.title);
 add('product',/wafer/i.test(type)?'wafer':/acrylic/i.test(type)?'acrylic':/edible|burn.?away/i.test(type)?'edible':/topper|artpaper|mirror gold/i.test(type)?'topper':'','Task / komponen');
 // A dimension such as 5 × 5 inch is not a quantity prefix.
 const qty=title.match(/^\s*(\d+)\s*[x×](?!\s*\d)/i)||(/round|bulat|square/i.test(title)?title.match(/^\s*(\d+)\s*x(?=\s*\d+(?:\.\d+)?\s*(?:inch|in\b|cm|mm))/i):null)||title.match(/\b[x×]\s*(\d+)\s*(?:pcs?|pieces?)\b/i)||title.match(/\b(\d+)\s*(?:pcs?|pieces?)\b/i);
 add('quantity',qty?.[1]||(exact?exact.quantity:null),'Task / item tepat');
 const sizeTitle=qty?.index===0&&/^\s*\d+\s*[x×]/i.test(qty[0])?title.slice(qty[0].length).trim():title;
 const size=sizeTitle.match(/\bA[3-7]\b(?:\s*\([^)]*\))?/i)||sizeTitle.match(/\b\d+(?:\.\d+)?\s*(?:[x×]\s*\d+(?:\.\d+)?\s*)?(?:inch|in\b|cm|mm)/i)||sizeTitle.match(/\b\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?\s*(?:inch|in\b|cm|mm)/i);
 add('size',item.size||exact?.size||size?.[0],'Item / saiz task');
 add('shape',/round|bulat/i.test(spec)?'Bulat':/square|segi\s*empat\s*sama/i.test(spec)?'Segi empat sama':/rectangle|segi\s*empat\s*tepat/i.test(spec)?'Segi empat tepat':/\bA[3-7]\b/i.test(spec)&&values.product!=='acrylic'?'Helaian':'','Spesifikasi task');
 add('material',values.product==='acrylic'?'Acrylic':/artpaper|art paper/i.test(spec)?'Art paper':/mirror gold/i.test(spec)?'Mirror gold':/wafer/i.test(spec)?'Wafer paper':'','Spesifikasi task');
 const colour=spec.match(/\b(?:rose\s*gold|gold|silver|white|black|pink|blue|red|putih|hitam|emas|perak)\b/i);add('colour',colour?.[0],'Spesifikasi task');
 if(exact){
  for(const f of ['name','age','wording','image'])add(f==='image'?'artwork':f,exact.values[f],exact.sources[f]?.source||'Detail order');
  for(const [f,entries] of Object.entries(exact.candidates||{}) as [string,Data[]][])for(const c of entries)conflicts.push({field:f==='image'?'artwork':f,label:briefLabels[f==='image'?'artwork':f],...c});
  if(exact.rule!=='review')add('mode',exact.rule==='name'?'wording':exact.rule,'Detail order');
  if(exact.rule==='name'&&exact.values.name&&!exact.values.wording)add('wording',exact.values.name,exact.sources.name?.source||'Detail order');
 }
 add('wording',item.wording,'Order iCetak');
 if(raw)add('wording',raw,`Customize Name · ${source.task_id}`);
 if(values.mode==='image'&&values.wording){values.mode='image_wording';sources.mode={source:'Gambar + customization task'};}
 const code=text(fields.sku||item.sku).match(/\b(?:EI|CN|WF|WP)\d{3,6}\b/i)||spec.match(/\b(?:EI|CN|WF|WP)\d{3,6}\b/i);
 if(code)add('template',code[0],'SKU / kod task');
 if(!values.mode){
  if(values.artwork)add('mode',values.wording?'image_wording':'image','Detail order');
  else if(values.wording)add('mode','wording','Customize task');
  else if(code&&/no wording|tanpa wording/i.test(spec))add('mode','template','Variasi tanpa wording');
 }
 add('instructions',fields.noted,'Noted task');
 // Explicit labelled specifications may fill a single exactly assigned item/session.
 // Unlabelled guesses and generic multi-item conversations remain excluded.
 if(exact&&order?.items?.length===1&&!context.ambiguous&&!context.truncated){
  const specFields:Record<string,string>={size:'saiz|size',quantity:'kuantiti|quantity|qty',colour:'warna|colou?r',material:'material|bahan',shape:'bentuk|shape'};
  for(const m of context.messages||[]){
   if(m.direction!=='inbound'||m.is_history||!(context.bindings||[]).some((b:Data)=>b.usable&&b.id===m.conversation_id))continue;
   const content=text(m.text_content||m.caption);let used=false;
   for(const [field,names] of Object.entries(specFields)){
    let value=content.match(new RegExp(`(?:^|\\n)\\s*(?:${names})\\s*[:=]\\s*([^\\n]+)`,'i'))?.[1]?.trim();
    if(!value||value.length>120)continue;
    if(field==='quantity'){value=value.match(/^([1-9]\d{0,4})\s*(?:pcs?|pieces?|unit)?$/i)?.[1];if(!value)continue;}
    if(field==='size'&&!/\bA[3-7]\b|\d\s*(?:inch(?:es)?|in\b|cm|mm)\b/i.test(value))continue;
    add(field,value,`${m.channel||'Chat'} · ${m.id}`);used=true;
   }
   if(used)specEvidence.push({id:m.id,text:content,at:m.created_at});
  }
 }
 if(order&&!exact&&!item.id&&order.items?.length>1)warnings.push('Item order belum dipadankan tepat dengan task ini; semak skop item / set.');
 if(source.mapping_status==='conflict')warnings.push('Pautan order / komponen bercanggah; baiki padanan dahulu.');
 if(context.unavailable)warnings.push('Chat atau data order tidak dapat disemak. Cuba semula sebelum sahkan.');
 if(context.ambiguous)warnings.push('Session chat mempunyai padanan order yang tidak jelas.');
 if(context.truncated)warnings.push('Chat melebihi had bacaan; semak baki mesej sebelum sahkan.');
 if((context.messages||[]).some((m:Data)=>m.direction==='inbound'&&!m.is_history&&Date.parse(m.created_at)>Date.parse(source.source_updated_at)))warnings.push('Ada balasan customer selepas update task; semak perubahan sebelum sambung design.');
 if(expired)warnings.push('Sumber atau balasan customer berubah; pengesahan lama telah dibuka semula.');
 if(detail?.warnings?.some((w:string)=>/Item order berubah/.test(w)))warnings.push('Item berubah sejak semakan detail order terakhir.');
 // Every manual value is an explicit correction tied to this exact source fingerprint.
 for(const [field,value] of Object.entries(config.values||{})){values[field]=text(value);sources[field]={source:proposal?'Semakan admin semasa':current&&saved?.confirmed?'Disahkan admin':'Draf admin',at:saved?.updated_at};}
 const required=requirement(values),missing=required.filter(k=>!values[k]);
 if(values.quantity&&!/^[1-9]\d{0,4}$/.test(values.quantity))missing.push('quantity');
 if(!briefProducts.includes(values.product)&&!missing.includes('product'))missing.push('product');
 if(!briefModes.includes(values.mode)&&!missing.includes('mode'))missing.push('mode');
 const resolved=conflicts.filter(c=>!text(config.values?.[c.field]));
 const sameRequired=Number(values.quantity)>1||(source.sets||[]).length>1;
 if(sameRequired&&config.same_design!==true)missing.push('same_design');
 if(values.artwork?.startsWith('wasapflow-media://')&&context.media_access?.[values.artwork]?.available!==true)missing.push('artwork_access');
 if(values.artwork?.startsWith('task-file://')&&!(source.files||[]).some((f:Data)=>f.id===values.artwork.slice(12)&&f.mime.startsWith('image/')))missing.push('artwork_access');
 if(values.artwork&&!/^(?:https:\/\/|wasapflow-media:\/\/\d+$|task-file:\/\/[a-f0-9-]{36}$)/i.test(values.artwork))missing.push('artwork_access');
 const hard=source.mapping_status==='conflict'||context.unavailable===true;
 const adminConfirmed=current&&saved?.confirmed===true&&!proposal;
 const previousAdmin=!!order?.state?.data?.detail_check?.checked_at&&exact?.state==='complete'&&!detail?.warnings.some((w:string)=>/Item order berubah/.test(w));
 const sourceConfirmed=(clickupConfirmed(fields.confirmed)===true||previousAdmin)&&!expired&&!Object.values(config.values||{}).some(Boolean)&&!proposal;
 const needsAdmin=warnings.length>0||resolved.length>0||(!sourceConfirmed&&!adminConfirmed);
 let status=hard||resolved.length||warnings.length&&!adminConfirmed?'review':missing.length?'missing':needsAdmin?'review':'ready';
 // A deliberate current-source admin check can resolve extraction ambiguity, never unknown required fields or failed reads.
 if(adminConfirmed&&!hard&&!missing.length)status='ready';
 const reviewRequired=source.component?.review_required===true||item.review_required===true;
 const reviewOK=!reviewRequired||/^(approved|approve|accepted)$/i.test(text(source.component?.review_status||source.review_status))||config.customer_approved===true;
 const final=(source.files||[]).find((f:Data)=>f.id===config.final_file_id);
 const printMissing=[...(!final?['Pilih fail final']:[]),...(config.artwork_qc!==true?['QC artwork belum disahkan']:[]),...(!reviewOK?['Kelulusan customer belum direkodkan']:[])];
 const printReady=status==='ready'&&!printMissing.length;
 const total=required.length+(sameRequired?1:0)+(/^(?:wasapflow-media|task-file):\/\//.test(values.artwork||'')?1:0),filled=total-missing.length;
 const confidence=status==='ready'?'high':missing.length||hard||resolved.length?'low':'medium';
 const evidence=[...new Map([...(detail?.evidence||[]),...specEvidence].map((e:Data)=>[e.id,{id:e.id,text:e.text,at:e.at}])).values()].slice(-12);
 const closed=/^(?:shipped|completed|cancelled|canceled|customer_collected|returned|refunded)$/i.test(text(source.order_status));
 if(closed){status='review';warnings.push('Order telah dihantar atau ditutup; semak arahan sebelum buat kerja baharu.');}
 return {status,label:closed?'Perlu semakan admin':printReady?'Confirmed · Ready print / cut':status==='ready'?'Confirmed · Ready designer':status==='missing'?'Info belum cukup':'Perlu semakan admin',
  completeness:Math.max(0,Math.round(filled/total*100)),confidence:closed?'low':confidence,confidence_reason:status==='ready'?(adminConfirmed?'Admin semak sumber semasa':previousAdmin?'Semakan detail order sedia ada + semua detail wajib cukup':'Confirmed pada task asal + semua detail wajib cukup'):'Detail atau pengesahan masih memerlukan semakan',
  values,sources,required,missing:missing.map(k=>({key:k,label:briefLabels[k]||(k==='artwork_access'?'Gambar belum boleh dibuka; upload gambar asal ke task':'Sahkan semua unit / set guna design yang sama')})),conflicts,warnings,evidence,
  fingerprint,version:saved?.version||0,expired,previous_values:expired?saved?.data?.values||{}:null,confirmed_by:status!=='ready'?null:adminConfirmed?saved?.updated_by:sourceConfirmed?(previousAdmin?'Disahkan admin · detail order':'Confirmed task asal'):null,confirmed_at:status==='ready'&&adminConfirmed?saved?.updated_at:null,
  can_confirm:!hard&&!closed&&!missing.length,print_ready:!closed&&printReady,print_missing:printMissing,review_required:reviewRequired,
  form:{values,same_design:config.same_design===true,final_file_id:config.final_file_id||'',artwork_qc:config.artwork_qc===true,customer_approved:config.customer_approved===true},
  chat_linked:(context.bindings||[]).some((b:Data)=>b.usable),artwork_url:context.media_access?.[values.artwork]?.url||null,source_token:source.source_token,checked_at:new Date().toISOString()};
}
