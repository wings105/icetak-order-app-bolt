// Detail-only work materials. Never expose raw records, unsafe bindings or historical messages.
type Data=Record<string,any>;
const text=(v:unknown)=>String(v??'');
export function safeAssetUrl(value:unknown){
 try{const u=new URL(text(value));const h=u.hostname.toLowerCase();return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&
 (h==='attachments.clickup.com'||h.endsWith('.clickup-attachments.com')||h.endsWith('.supabase.co')||h.endsWith('.susercontent.com')||h.endsWith('.shopee.com.my')||h.endsWith('.shopee.sg'))?u.href:'';}catch{return '';}
}
export function taskDossier(loaded:Data,task:Data,images:Data[],files:Data[],product:Data|null=null){
 const c=loaded?.context||{},r=loaded?.readiness||{},o=loaded?.order,s=loaded?.source||{};
 const bindings=(c.bindings||[]).filter((b:Data)=>b.usable===true);
 const original=(c.messages||[]).filter((m:Data)=>!m.is_history&&bindings.some((b:Data)=>b.id===m.conversation_id&&(!b.start_at||Date.parse(m.created_at)>=Date.parse(b.start_at))&&(!b.end_at||Date.parse(m.created_at)<Date.parse(b.end_at))));
 const messages=[...new Map<string,Data>(original.map((m:Data)=>[text(m.id),m])).values()].sort((a,b)=>text(a.created_at).localeCompare(text(b.created_at))||text(a.id).localeCompare(text(b.id)));
 const assets:Data[]=[],seen=new Set<string>();
 function asset(id:string,name:string,url:unknown,kind:string,more:Data={}){const safe=safeAssetUrl(url);if(seen.has(id))return;seen.add(id);assets.push({id,name,url:safe||null,kind,available:!!safe,...more});}
 for(const m of messages)if(m.message_type==='image'){
  const cache=(c.dossier_media_access||c.media_access)?.[m.media_url];const url=text(m.media_url).startsWith('wasapflow-media://')?cache?.url:m.media_url;
  const caption=text(m.text_content||m.caption);
  const previous=messages.filter(p=>p.conversation_id===m.conversation_id&&p.created_at<m.created_at&&Date.parse(m.created_at)-Date.parse(p.created_at)<600000&&text(p.text_content||p.caption)).at(-1);
  const payment=/resit|receipt|payment|bayar|transfer|bank/i.test(caption)||!caption&&/resit|receipt|bukti\s*(?:bayar|payment)|(?:dah|sudah)\s*(?:bayar|transfer)/i.test(text(previous?.text_content||previous?.caption));
  const orderCapture=/order\s*(?:id|no)|screenshot\s*(?:order|checkout)/i.test(caption);
  asset('message:'+m.id,'Gambar '+(m.direction==='inbound'?'customer':'balasan')+' '+(m.channel||'chat'),url,'chat',{can_load:/^wasapflow-media:\/\/\d{1,40}$/.test(text(m.media_url)),message_id:text(m.id),channel:text(m.channel),at:m.created_at,direction:m.direction,purpose:payment?'payment':orderCapture?'order':'reference',selected:r.values?.artwork===m.media_url});
 }
 if(r.artwork_url||/^https:\/\//.test(r.values?.artwork||'')){
  const url=r.artwork_url||r.values.artwork;
  if(!assets.some(a=>a.url===url))asset('artwork','Gambar dipilih untuk design',url,'selected',{selected:true});
 }
 if(product)asset('product','Contoh produk / template dibeli',product.main_image_url,'product',{sku:product.parent_sku,title:product.name});
 images.forEach((a,i)=>asset('clickup:'+i,a.name||'Attachment task',a.url,'clickup'));
 files.forEach(f=>asset('file:'+f.id,f.name,f.url,'file',{mime:f.mime,at:f.created_at}));
 const used=new Set((r.evidence||[]).map((e:Data)=>e.id));
 const fieldSources=Object.fromEntries(Object.entries(r.sources||{}).map(([k,v]:[string,any])=>[k,{source:text(v.source),at:v.at||null,message_id:messages.find(m=>text(v.source).includes(text(m.id)))?.id||null}]));
 return {checked_at:r.checked_at||new Date().toISOString(),unavailable:c.unavailable===true,ambiguous:c.ambiguous===true,truncated:c.truncated===true,
  multi_item:(o?.items?.length||0)>1,order_note:text(o?.order_note),task_wording:text(s.fields?.['customize name']||s.fields?.['customise name']||s.item?.wording),task_note:text(s.fields?.noted),
  sources:fieldSources,channels:['shopee','whatsapp'].map(channel=>({channel,status:c.unavailable?'unavailable':bindings.some((b:Data)=>b.channel===channel)?'matched':(c.bindings||[]).some((b:Data)=>b.channel===channel)?'ambiguous':'unmatched'})),
  messages:messages.map(m=>({id:text(m.id),channel:text(m.channel),direction:m.direction==='inbound'?'inbound':'outbound',type:text(m.message_type),text:text(m.text_content),caption:text(m.caption),at:m.created_at,
   asset_id:m.message_type==='image'?'message:'+m.id:null,important:used.has(m.id)||m.direction==='inbound'&&m.message_type==='image',text_limited:text(m.text_content).length>=2000||text(m.caption).length>=2000})),
  assets,product:product?{name:product.name,sku:product.parent_sku}:null};
}
export async function readAsset(url:string,fetcher:typeof fetch=fetch){
 let current=safeAssetUrl(url);if(!current)throw Error('INVALID_ASSET_HOST');
 for(let n=0;n<4;n++){
  const response=await fetcher(current,{redirect:'manual',signal:AbortSignal.timeout(20000)});
  if([301,302,303,307,308].includes(response.status)){current=safeAssetUrl(new URL(response.headers.get('location')||'',current).href);if(!current)throw Error('INVALID_ASSET_REDIRECT');continue;}
  if(!response.ok||!response.body)throw Error('ASSET_UNAVAILABLE');
  if(Number(response.headers.get('content-length'))>15728640)throw Error('ASSET_TOO_LARGE');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
  while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>15728640){await reader.cancel();throw Error('ASSET_TOO_LARGE');}chunks.push(part.value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const prefix=new TextDecoder().decode(bytes.slice(0,12));
  const mime=bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47?'image/png':bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff?'image/jpeg':prefix.startsWith('RIFF')&&prefix.slice(8)==='WEBP'?'image/webp':prefix.startsWith('GIF8')?'image/gif':prefix.startsWith('%PDF-')?'application/pdf':'';
  if(!mime)throw Error('INVALID_ASSET_FORMAT');return {bytes,mime};
 }
 throw Error('ASSET_UNAVAILABLE');
}
