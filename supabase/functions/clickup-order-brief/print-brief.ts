import {briefAction} from "./lifecycle.ts";

type Data = Record<string, any>;
type Deps = {
 resolveGroup?: (input:Data,bridge:string)=>Promise<Data>;
 db: (path:string, body?:unknown) => Promise<any>;
 clickup: (token:string, path:string, method?:string, body?:unknown, multipart?:boolean) => Promise<any>;
 digest: (value:string) => Promise<string>;
 safeDownload: (url:string, inbox:boolean) => Promise<{bytes:Uint8Array<ArrayBuffer>;mime:string}>;
 allowedHost: (host:string) => boolean;
 clock: (date:unknown) => string;
 summarize: (detail:Data,note:string,asset?:Data) => Promise<Data>;
 rich: (text:string) => Data[];
 inbox: string;
};

const version = "edible-wafer-v1";
const aiCheckOption = "d84d57b3-41f3-473d-b502-4e7bf45ace0c";
const text = (v:unknown,n=1600) => typeof v==="string" ? v.trim().slice(0,n) : "";
const norm = (v:unknown) => text(v).toLowerCase().replace(/[″“”"]/g," inch").replace(/\s+/g," ");
const cf = (t:Data,name:string) => (t.custom_fields||[]).find((f:Data)=>norm(f.name)===norm(name));
const checked = (v:unknown) => [true,"true",1,"1"].includes(v as string);
const enc = (v:string) => encodeURIComponent(v);
const exactId = (v:unknown) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(text(v));
const mediaId = (v:unknown) => text(v).match(/^wasapflow-media:\/\/(\d{1,40})$/)?.[1];
const mediaText = (m:Data) => text(m.caption || m.text_content);
const messageTime = (m:Data) => Date.parse(m.sent_at||m.created_at);
const unitSize = (v:unknown) => text(v).toLowerCase()
 .match(/\b\d+(?:\.\d+)?\s*(?:["″]\s*)?[×x]\s*\d+(?:\.\d+)?|\b\d+(?:\.\d+)?\s*(?:inch|inci|in\b|["″])|\ba[456]\b/g)
 ?.map(x=>x.replace(/[×\s"″]/g,c=>c==="×"?"x":"").replace(/(?:inch|inci|in)$/,"")) || [];

export function matchPrintItem(items:Data[], targetSize:string, profile:string):Data|null {
 const exact = (v:string) => norm(v).replace(/[^a-z0-9.×]+/g,"");
 const matches = items.flatMap(row => {
  const variation = text(row.variation_name);
  const title = text(row.title);
  if (row.provider_item_id==="22163856881") {
   const layers=variation.split(",").map(x=>x.trim());
   return layers.length===2 && exact(layers[profile==="wafer"?1:0])===exact(targetSize) ?
    [{...row,variation_name:layers[profile==="wafer"?1:0],layer:profile==="wafer"?"atas":"bawah"}] : [];
  }
  // Unknown bundle layouts stay in review until their catalogue mapping is verified.
  if (/burn[ -]*away/i.test(title) && /wafer/i.test(title) && /edible|icing/i.test(title)) return [];
  const compatible=profile==="wafer"?/wafer/i.test(title):/edible|icing|sugar sheet/i.test(title);
  return compatible && variation && exact(variation)===exact(targetSize) ? [row] : [];
 });
 return matches.length===1?matches[0]:null;
}

function layerFor(t:string) {
 const wafer=/\b(?:wafer|atas|top layer)\b/i.test(t);
 const edible=/\b(?:edible|icing|bawah|bottom layer)\b/i.test(t);
 return wafer===edible?"":wafer?"wafer":"edible";
}
const explicitSelection = /\b(?:guna|gna|pakai|use|print|cetak|yg ni|yang ni|this one|mcm ni|macam ni|ikut|nak)\b/i;
const reference = /\b(?:contoh|sample|inspiration|mcm\s*ni|macam\s*ni|seperti\s*ini)\b/i;
const wordingLabel = /(?:^|\n)\s*(?:tulis(?:kan)?|wording|custom(?:ize)? name|tulisan|wording atas)\s*[:\-]?\s*([^\n]+(?:\n[^\n]+){0,3})/i;
const orderRefs = (m:Data) => mediaText(m).toUpperCase().match(/\b[0-9]{6}[A-Z0-9]{6,18}\b/g) || [];
const repeatArtwork = (value:string) => {
 const v=norm(value).replace(/\b(?:dua2|2[- ]?2)\b/g,"dua-dua");
 if (/\?|\b(?:jangan|bukan|tidak|tak|not|berbeza|berlainan|different|lain)\b/.test(v)) return false;
 return /\b(?:dua[ -]?dua|kedua[ -]?dua|both)\b.{0,32}\b(?:sama|same)\b/.test(v)
  || /\b(?:2|dua|two)\s+(?:gambar|gmbr|image[s]?|design[s]?|keping|pcs|unit|cop(?:y|ies))\s+(?:yang\s+)?(?:sama|same)\b/.test(v)
  || /\b(?:gambar|gmbr|design|image|artwork)\s+(?:yang\s+)?sama\b.{0,32}\b(?:2|dua|both)\b/.test(v)
  || /\bsame\s+(?:image|design|artwork)\b.{0,32}\b(?:both|2|two)\b/.test(v);
};
const calendar = /\b(?:calendar|calender|kalendar)\b/i;
const month = /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|januari|februari|mac|mei|jun|julai|ogos|oktober|disember)\b/i;

export function printRules(scope:Data, ctx:Data):Data {
 const t=scope.target;
 const messages:Data[]=(ctx.messages||[]).filter((m:Data)=>m.direction==="inbound" && !m.is_history && exactId(m.id) && mediaText(m)!=="[unsupported]")
  .sort((a:Data,b:Data)=>messageTime(a)-messageTime(b));
 const isImage=(m:Data)=>m.message_type==="image";
 const media=messages.filter(isImage), selected:Data[]=[], proof=new Set<string>();
 let copiesPerArtwork=1;
 let scoped = messages;
 if (t.layer) {
  let active="";
  const assignments=new Map<string,string>();
  for (const m of messages) {
   const k=layerFor(mediaText(m));
   if (k) active=k;
   assignments.set(m.id,active);
  }
  for (const m of media) {
   const position=messages.indexOf(m), neighbor=messages[position+1];
   const reply=messages.find((r:Data)=>r.reply_to_provider_message_id&&r.reply_to_provider_message_id===m.provider_message_id&&layerFor(mediaText(r)));
   const next=neighbor && !isImage(neighbor) && messageTime(neighbor)-messageTime(m)<=90000 && layerFor(mediaText(neighbor)) &&
    (explicitSelection.test(mediaText(neighbor)) || /^(?:atas|bawah)$/i.test(mediaText(neighbor))) ? neighbor : null;
   const cited=reply||next;
   const previous=messages[position-1];
   const preceding=previous&&!isImage(previous)&&messageTime(m)-messageTime(previous)<=90000?layerFor(mediaText(previous)):"";
   const k=layerFor(mediaText(m)) || (cited && layerFor(mediaText(cited))) || preceding || (reference.test(mediaText(m))?assignments.get(m.id):"");
   if(k===t.profile) {
    selected.push({...m,role:reference.test(mediaText(m))||calendar.test(mediaText(m))?"Contoh design":"Gambar dipilih"});
    if(cited)proof.add(cited.id);
   }
  }
  scoped=messages.filter((m:Data)=>!isImage(m)&&assignments.get(m.id)===t.profile);
 } else if (scope.single_item_scope || scope.print_line) {
  const orderNo=text(scope.order_no).toUpperCase();
  const eligibleMedia=orderNo ? media.filter(m=>orderRefs(m).every(ref=>ref===orderNo)) : media;
  const tagged=orderNo ? eligibleMedia.filter(m=>orderRefs(m).includes(orderNo)) : [];
  // A caption can be on the last image in a WhatsApp batch. Scope the batch
  // by conversation and the exact provider timestamp, independent of UUID order.
  const taggedWhatsapp=tagged.filter(m=>m.channel==="whatsapp");
  const competingWhatsappOrder=messages.some(m=>m.channel==="whatsapp"&&orderRefs(m).some(ref=>ref!==orderNo));
  const orderMedia=competingWhatsappOrder?eligibleMedia.filter(m=>m.channel!=="whatsapp"||
   taggedWhatsapp.some(a=>a.id===m.id||!!a.conversation_id&&a.conversation_id===m.conversation_id&&
    messageTime(a)===messageTime(m))):eligibleMedia;
  const distinctMedia=[...new Map(orderMedia.map(m=>[text(m.media_url)||m.id,m])).values()];
  const staffImage=tagged.length&&distinctMedia.find(m=>m.id===scope.staff_artwork_message_id);
  if(scope.print_line) {
   const matchesSize=(m:Data)=>unitSize(mediaText(m)).some(
    size=>scope.print_line.sizes.includes(size)&&!(scope.other_sizes||[]).includes(size));
   scoped=messages.filter(matchesSize);
   const labelled=distinctMedia.filter(matchesSize);
   if(labelled.length) selected.push(...labelled);
   else if(!distinctMedia.some(m=>unitSize(mediaText(m)).length)&&distinctMedia.length===scope.print_line.total)
    selected.push(...distinctMedia.slice(scope.print_line.offset,scope.print_line.offset+t.quantity));
  } else if (t.quantity===1&&staffImage) {
   selected.push(staffImage,...distinctMedia.filter(m=>m.id!==staffImage.id).map(m=>({...m,role:"Contoh hasil pada kek"})));
  } else {
   selected.push(...distinctMedia);
   const repeatEvidence=messages.findLast(m=>orderRefs(m).every(ref=>ref===orderNo)&&repeatArtwork(mediaText(m)));
   if(t.quantity===2&&selected.length===1&&(repeatEvidence||repeatArtwork(text(scope.note)))) {
    copiesPerArtwork=2;
    if(repeatEvidence)proof.add(repeatEvidence.id);
   }
  }
  for(const m of tagged)proof.add(m.id);
 } else {
  const identity=new Set([...unitSize(t.purchased_size),...unitSize(t.wording)]);
  const unique = (m:Data) => {
   const sizes=unitSize(mediaText(m));
   return sizes.some(s=>identity.has(s)&&!(scope.other_sizes||[]).includes(s));
  };
  scoped=messages.filter(unique);
  selected.push(...scoped.filter(isImage));
 }

 const allText=scoped.map((m:Data)=>mediaText(m)).filter(x=>x&&!/^\[[^\]]+\]$/.test(x));
 const note=scope.single_item_scope&&!t.layer?text(scope.note):"";
 const orderText=text(t.wording);
 const combined=[...allText,note,orderText].filter(Boolean).join("\n");
 const cal=calendar.test(combined);
 const monthEvidence=scoped.findLast((m:Data)=>month.test(mediaText(m)));
 const dateEvidence=scoped.findLast((m:Data)=>/\b(?:tarikh|date|hari)\s*\d{1,2}\b/i.test(mediaText(m)));
 const calDate=cal ? [...new Set([monthEvidence,dateEvidence].filter((m):m is Data=>!!m))].map(m=>mediaText(m)).join("\n") : "";
 const custom= /\bcustom\b|any size/i.test(t.purchased_size+" "+t.style);
 const dimensions=(text(orderText)+"\n"+selected.map(mediaText).join("\n")+"\n"+allText.join("\n")).match(/\b(\d+(?:\.\d+)?)\s*(?:["″]\s*)?[x×]\s*(\d+(?:\.\d+)?)(?:\s*["″]|\s*in(?:ch|ci)?\b)/i);
 const smaller=selected.map(mediaText).join("\n").match(/\b(?:saiz|size)\s*(\d+(?:\.\d+)?)(?:\s*["″]|\s*in(?:ch|ci)?\b)/i);
 const purchase=unitSize(t.purchased_size).map((s:string)=>Number(s)).find(Number.isFinite);
 const printSize=dimensions?dimensions[1]+" × "+dimensions[2]+" inci":smaller?smaller[1]+" inci":custom&&!/\bfull\s*a4\b/i.test(combined)?"":t.purchased_size;
 const mode=cal?"CREATE_FROM_REFERENCE":/print\s*only|no review/i.test(t.title)?"PRINT_AS_IS":
  /edit\s*(?:&|and)\s*review/i.test(t.title)?"EDIT_ARTWORK": selected.some(m=>reference.test(mediaText(m)))||reference.test(combined)?"CREATE_FROM_REFERENCE":selected.length?"EDIT_ARTWORK":"REVIEW";
 const foundWording=[note,...allText].map(value=>value.match(wordingLabel)?.[1]?.trim().replace(/^\*|\*$/g,"")).filter(Boolean).at(-1)||"";
 const dimensionOnly=/^\s*\d+(?:\.\d+)?["″]?\s*[x×]\s*\d+(?:\.\d+)?["″]?\s*$/;
 const wording=foundWording || (orderText && !dimensionOnly.test(orderText) && !/\b(?:edible|wafer|saiz|size|logo)\b/i.test(orderText)?orderText:"");
 const missing:string[]=[], flags:string[]=[];
 const artworkCount=selected.filter(m=>m.role!=="Contoh hasil pada kek").length;
 const reviewArtworkCount=artworkCount>0&&artworkCount*copiesPerArtwork!==t.quantity;
 if(reviewArtworkCount)flags.push(t.quantity===1?
  "Lebih daripada satu gambar untuk 1 unit. Admin perlu pilih artwork.":
  "Semak padanan "+artworkCount+" gambar untuk "+t.quantity+" unit.");
 if(!printSize)missing.push("Saiz cetak sebenar");
 if(!selected.length&&!cal)missing.push("Artwork atau gambar rujukan yang dipadankan");
 if(cal&&(!monthEvidence||!(/\b20\d{2}\b/.test(calDate))||!(/\b(?:tarikh|date|hari)\s*\d{1,2}\b|\b(?:november|december|january|february|march|april|may|june|july|august|september|october)\s+\d{1,2}\b(?!\s*\d)/i.test(calDate))))missing.push("Bulan, tahun atau tarikh kalendar");
 if(ctx.ambiguous||ctx.truncated)flags.push("Sempadan chat memerlukan semakan");
 if(dimensions && (/\bA4\b/i.test(t.purchased_size) && (Math.min(+dimensions[1],+dimensions[2])>7.5||Math.max(+dimensions[1],+dimensions[2])>11) ||
   /\bA5\b/i.test(t.purchased_size) && (Math.min(+dimensions[1],+dimensions[2])>5.5||Math.max(+dimensions[1],+dimensions[2])>7.5))) flags.push("Saiz cetak melebihi tier");
 if(smaller&&purchase&&+smaller[1]>purchase)flags.push("Saiz diminta melebihi saiz dibeli");
 const requestedReview=messages.some((m:Data)=>/\b(?:review|semak|tengok)\b.{0,40}\b(?:dulu|dlu|sebelum|before|pos|print)\b/i.test(mediaText(m)));
 const review=t.review_required||requestedReview;
 for(const m of [...selected,monthEvidence,dateEvidence].filter((m):m is Data=>!!m))proof.add(m.id);
 return {mode,wording,wording_mode:wording?"exact":mode==="PRINT_AS_IS"?"embedded_in_artwork":"pending",print_size:printSize,review_requested:review,
  instruction:cal?["Buat kalendar",calDate].filter(Boolean).join("\n"):[text(orderText&&!wording&&!dimensionOnly.test(orderText)?orderText:""),
   ...allText.filter(x=>/\b(?:boleh|tolong)\b.{0,40}\b(?:squeeze|stretch|compress|mampatkan)\b/i.test(x)).slice(-1)].filter(Boolean).join("\n"),
  missing,flags,selected:ctx.ambiguous||ctx.truncated?[]:selected.map((m,index)=>({...m,
   role:m.role||(reviewArtworkCount?"Gambar untuk semakan "+(index+1):copiesPerArtwork>1?"Artwork yang sama untuk "+copiesPerArtwork+" unit":
    artworkCount>1?"Artwork unit "+(index+1):mode==="PRINT_AS_IS"?"Artwork untuk cetak":mode==="CREATE_FROM_REFERENCE"?"Contoh design":"Gambar pelanggan")})),
  proof:messages.filter((m:Data)=>proof.has(m.id)||scoped.includes(m)&&!isImage(m)&&!/^(?:tq|ok|ya|baik|terima kasih)$/i.test(mediaText(m))).slice(-15),
  source_unavailable:scope.provider==="shopee"?!scope.phone&&!note&&!messages.some(m=>
   isImage(m)||!!mediaText(m)&&!/^\[[^\]]+\]$/.test(mediaText(m))&&mediaText(m).toUpperCase()!==text(scope.order_no).toUpperCase()
  ):!!ctx.unavailable};
}

async function bridgeRequest(d:Deps,bridge:string,body:Data,ms=18000) {
 const r=await fetch(d.inbox+"/functions/v1/task-brief-media",{method:"POST",
  headers:{"content-type":"application/json","x-admin-window-token":bridge},body:JSON.stringify(body),signal:AbortSignal.timeout(ms)});
 const payload=await r.json();
 if(!r.ok||!payload.ok)throw Error("INBOX_BRIDGE_UNAVAILABLE");
 return payload;
}

export function taskPhone(task:Data) {
 const digits=text(cf(task,"phone")?.value,40).replace(/\D/g,"");
 const value=digits.startsWith("0")?"6"+digits:digits;
 return /^\d{9,15}$/.test(value)?value:"";
}

export async function loadPrintContext(scope:Data,bridge:string,d:Deps):Promise<Data> {
 try {
  const action=scope.provider==="shopee"?"print_shopee_context":"direct_context";
  const result=await bridgeRequest(d,bridge,{action,scope});
  if(result.context?.order_id!==scope.order_id)throw Error("CONTEXT_SCOPE_MISMATCH");
  const ctx=result.context;
  return {...ctx,channels:ctx.channels||{whatsapp:ctx.ambiguous?"ambiguous":ctx.unavailable?"identity_unavailable":ctx.messages?.length?"matched":"checked_no_relevant_message"}};
 } catch {
  return {unavailable:true,channels:scope.provider==="shopee"?{shopee:"source_unavailable",whatsapp:"source_unavailable"}:{whatsapp:"source_unavailable"},messages:[]};
 }
}

async function loadScope(s:Data,task:Data,profile:string,d:Deps):Promise<Data> {
 const purchased=text(cf(task,"SKU")?.value,240)||text(task.name,240).replace(/^\d+\s*x\s*/i,"");
 const phone=taskPhone(task);
 if(exactId(s.marketplace_order_id)) {
  const base=s.marketplace_order_id;
  const [orders,items]=await Promise.all([
   d.db("marketplace_orders?id=eq."+base+"&select=id,provider,order_sn,placed_at,shop_id,buyer_user_id,current_status,buyer_message,detail_complete&limit=1"),
   d.db("marketplace_order_items?order_id=eq."+base+"&is_current=eq.true&select=line_no,title,quantity,variation_name,provider_item_id,provider_variation_id&order=line_no.asc&limit=31")
  ]);
  const o=orders?.[0];
  if(o?.provider!=="shopee"||!["READY_TO_SHIP","PROCESSED","RETRY_SHIP"].includes(o.current_status))throw Error("ORDER_NOT_FULFILLABLE");
  if(o.order_sn!==s.order_reference || text(cf(task,"ORDER ID / customer name")?.value)!==o.order_sn)throw Error("ORDER_REFERENCE_MISMATCH");
  const row=items?.length<31?matchPrintItem(items,purchased,profile):null;
  if(!row)throw Error("EXACT_PRINT_VARIANT_REQUIRED");
  const lineIndex=items.findIndex((item:Data)=>item.line_no===row.line_no);
  const uniquePrintLines=items.length>1&&profile==="edible"&&items.every((item:Data)=>
   Number.isInteger(item.line_no)&&Number.isInteger(Number(item.quantity))&&Number(item.quantity)>0&&
   !!matchPrintItem(items,text(item.variation_name),"edible")&&item.title===row.title&&!/burn[ -]*away/i.test(item.title));
  const printLine=uniquePrintLines&&lineIndex>=0?{
   total:items.reduce((n:number,item:Data)=>n+Number(item.quantity),0),
   offset:items.slice(0,lineIndex).reduce((n:number,item:Data)=>n+Number(item.quantity),0),
   sizes:unitSize(row.variation_name)
  }:null;
  let allowWhatsappPhoneFallback=false;
  if(phone&&o.shop_id&&o.buyer_user_id) {
   const malaysiaDay=new Date(Date.parse(o.placed_at)+8*3600000).toISOString().slice(0,10);
   const start=Date.parse(malaysiaDay+"T00:00:00+08:00");
   const siblings=await d.db("marketplace_orders?provider=eq.shopee&shop_id=eq."+enc(o.shop_id)+
    "&buyer_user_id=eq."+enc(o.buyer_user_id)+"&placed_at=gte."+enc(new Date(start).toISOString())+
    "&placed_at=lt."+enc(new Date(start+86400000).toISOString())+"&select=id&limit=2");
   allowWhatsappPhoneFallback=siblings?.length===1&&siblings[0].id===o.id;
  }
  return {eligible:true,provider:"shopee",order_id:o.id,order_no:o.order_sn,placed_at:o.placed_at,buyer_user_id:o.buyer_user_id,
   phone,allow_whatsapp_phone_fallback:allowWhatsappPhoneFallback,print_line:printLine,
   note:text(o.buyer_message),note_unverified:!o.detail_complete,single_item_scope:items.length===1,
   other_sizes:items.filter((x:Data)=>x.provider_variation_id!==row.provider_variation_id).flatMap((x:Data)=>unitSize(x.variation_name)),
   target:{profile,purchased_size:row.variation_name,title:row.title,quantity:Number(row.quantity),layer:row.layer||null}};
 }
 if(!exactId(s.order_id))throw Error("ORDER_LINK_REQUIRED");
 const scope=await d.db("rpc/icetak_print_brief_direct_scope",{p_order_id:s.order_id,p_task_id:s.task_id});
 if(!scope?.eligible)throw Error(scope?.reason||"DIRECT_SCOPE_UNAVAILABLE");
 if(!["paid","cash_counter"].includes(scope.payment_status))throw Error("PAYMENT_NOT_ELIGIBLE");
 const [items,components]=await Promise.all([
  d.db("order_items?order_id=eq."+s.order_id+"&select=id,product_type,title,size,style,qty,wording,custom_text,review_required&limit=31"),
  d.db("production_components?order_id=eq."+s.order_id+"&clickup_task_id=eq."+enc(s.task_id)+"&select=component_type,metadata&limit=2")
 ]);
 const i=items?.find((x:Data)=>x.id===scope.target_item_id),component=components?.[0];
 if(!i||items.length>=31||components.length!==1||component.component_type!==profile)throw Error("EXACT_PRINT_COMPONENT_REQUIRED");
 const layer=i.product_type==="burnaway"?(profile==="wafer"?"atas":"bawah"):null;
 const layerSize=layer?text(component.metadata?.size)||purchased:"";
 return {...scope,provider:"whatsapp",phone:scope.phone||phone,single_item_scope:items.length===1,
  other_sizes:items.filter((x:Data)=>x.id!==i.id).flatMap((x:Data)=>[...unitSize(x.size),...unitSize(x.custom_text)]),
  target:{profile,purchased_size:layerSize||text(i.size),style:text(i.style),title:text(i.title),quantity:Number(i.qty),layer,
   wording:text(i.custom_text||i.wording),review_required:!!i.review_required}};
}

function safeSource(url:string,d:Deps) {
 try {const u=new URL(url);return u.protocol==="https:"&&!u.username&&!u.password&&!u.port&&d.allowedHost(u.hostname)?u.href:"";} catch {return "";}
}

async function deliverMedia(m:Data,task:Data,token:string,bridge:string,d:Deps,preview:boolean):Promise<Data> {
 const providerId=mediaId(m.media_url);
 let link=safeSource(text(m.media_url),d), download=link;
 const filename="icetak-proof-"+task.id+"-"+m.id;
 let attachment=(task.attachments||[]).find((a:Data)=>text(a.title||a.name).startsWith(filename+"."));
 let available=false;
 try {
  if(providerId) {
   const result=await bridgeRequest(d,bridge,{action:"prepare",ids:[providerId]});
   const asset=result.media?.[m.media_url];
   link=text(asset?.open_url);download=text(asset?.url);
  }
  if(!attachment) {
   if(!download)throw Error("MEDIA_NOT_CACHED");
   const file=await d.safeDownload(download,!!providerId);
   available=true;
   if(!preview) {
    const suffix=file.mime==="image/png"?".png":file.mime==="image/webp"?".webp":".jpg";
    const form=new FormData();
    form.append("attachment",new File([file.bytes],filename+suffix,{type:file.mime}));
    const fresh=await d.clickup(token,"task/"+task.id);
    assertTask(fresh,task.id,task.status.status);
    attachment=(fresh.attachments||[]).find((a:Data)=>text(a.title||a.name).startsWith(filename+"."));
    if(!attachment) {
     const saved=await d.clickup(token,"task/"+task.id+"/attachment","POST",form,true);
     const updated=await d.clickup(token,"task/"+task.id);
     attachment=(updated.attachments||[]).find((a:Data)=>a.id===saved?.id || text(a.title||a.name).startsWith(filename+"."));
     if(!attachment?.id)throw Error("ATTACHMENT_UNCERTAIN");
    }
   }
  }
 }catch(e) {
  return {message_id:m.id,role:m.role,channel:m.channel,link,attachment_id:attachment?.id||null,
   status:attachment?.id?"attached":link?"link_only":"unavailable",error:text((e as Error).message,100)};
 }
 return {message_id:m.id,role:m.role,channel:m.channel,link,backup_image:attachment?.url||attachment?.download_url||null,
  attachment_id:attachment?.id||null,status:attachment?.id?"attached":available?"verified_preview":"unavailable"};
}

function assertTask(task:Data,id:string,initial:string) {
 if(task.id!==id||String(task.list?.id)!=="18375902"||task.archived||norm(task.status?.status)!==initial)throw Error("PRINT_TASK_CHANGED");
}

export async function processPrint(job:Data,s:Data,route:Data,token:string,bridge:string,d:Deps,preview=false):Promise<Data> {
 const id=job.task_id,previous=job.brief||{};
 let brief=previous,receipts=job.media_receipts||[],commentId=job.comment_id||null,state="review",error="";
 try {
  if(briefAction(route,s?.clickup_status,previous)!=="INITIAL_BRIEF"||s.list_id!=="18375902")throw Error("PRINT_TASK_NOT_ELIGIBLE");
  const task=await d.clickup(token,"task/"+id);
  assertTask(task,id,route.initial_status);
  const scope=await loadScope(s,task,route.profile,d);
  if(!scope.target.purchased_size||!Number.isInteger(scope.target.quantity)||scope.target.quantity<1)throw Error("PRINT_SPEC_UNVERIFIED");
  if(scope.provider==="shopee") {
   scope.previous_whatsapp_closed_at=await d.db("rpc/icetak_print_previous_whatsapp_close",{p_order_id:scope.order_id});
   scope.whatsapp_closed_at=previous.whatsapp_closed_at;
   if(exactId(previous.staff_artwork_message_id))scope.staff_artwork_message_id=previous.staff_artwork_message_id;
  }
  let ctx=await loadPrintContext(scope,bridge,d);
  const originalNote=scope.note;
  const grouped=d.resolveGroup?await d.resolveGroup({task_id:id,profile:route.profile,scope,context:ctx,previous},bridge):{grouped:false};
  if(grouped.grouped){ctx=grouped.context;scope.note=grouped.note;}
  let result=printRules(scope,ctx);
  if(grouped.grouped){
   const ai=grouped.analysis,detail=ai?.print;
   const messages=(ctx.messages||[]).filter((m:Data)=>m.direction==="inbound");
   const selected=Array.isArray(detail?.asset_ids)?detail.asset_ids.map((mid:string)=>messages.find((m:Data)=>m.id===mid&&m.message_type==="image")).filter(Boolean):[];
   const valid=ai?.ok&&!ctx.ambiguous&&!ctx.truncated&&detail&&["PRINT_AS_IS","EDIT_ARTWORK","CREATE_FROM_REFERENCE","REVIEW"].includes(detail.mode)&&
    Array.isArray(detail.missing)&&Array.isArray(detail.asset_ids)&&detail.asset_ids.length===selected.length;
   if(valid){
    const counts=new Set(selected.map((m:Data)=>m.id));
    const countMatches=counts.size===scope.target.quantity||
     (counts.size===1&&scope.target.quantity>1&&/\b(?:same|sama|repeat|ulang|copy)\b/i.test([scope.note,...messages.map(mediaText)].join(" ")));
    const flags:string[]=[];
    if(!countMatches&&selected.length)flags.push("Semak padanan artwork dengan kuantiti");
    if(!selected.length&&detail.mode!=="CREATE_FROM_REFERENCE")flags.push("Artwork perlu dipadankan");
    // The purchased physical size stays authoritative. A changed size needs staff review.
    if(norm(detail.print_size)!==norm(scope.target.purchased_size))flags.push("Semak saiz cetak pilihan OpenAI");
    result={mode:detail.mode,wording:text(detail.wording,255),wording_mode:detail.wording?"exact":"embedded_in_artwork",
     print_size:text(detail.print_size)||scope.target.purchased_size,instruction:text(detail.instruction),
     review_requested:detail.review_requested===true||scope.target.review_required===true,
     missing:detail.missing,flags,selected:selected.map((m:Data,i:number)=>({...m,role:"Artwork pilihan OpenAI "+(i+1)})),
     proof:messages,source_unavailable:false};
   }else result={...result,mode:"REVIEW",flags:["Padanan OpenAI perlu semakan"],selected:[]};
  }
  let advisory=previous.advisory, advisoryAt=previous.advisory_at;
  const advisoryKey=await d.digest(JSON.stringify(["summary-json-input-v2",scope.target,scope.note,result.missing,result.flags,
   result.proof.map((m:Data)=>[m.id,mediaText(m)]),result.selected.map((m:Data)=>m.id)]));
  if(!preview&&!ctx.ambiguous&&!ctx.truncated&&result.proof.length&&
    (result.mode==="REVIEW"||result.missing.length||result.flags.length)&&
    (previous.advisory_key!==advisoryKey||!advisory||advisory.mode==="unavailable"&&Date.now()-Date.parse(advisoryAt)>900000)) {
   advisoryAt=new Date().toISOString();
   try {
    advisory=await d.summarize({values:{product:scope.target.profile,size:scope.target.purchased_size,
     customer_evidence:result.proof.map((m:Data)=>mediaText(m)).filter(Boolean)},missing:result.missing,warnings:result.flags},scope.note);
   } catch (e) {
    const reason=e instanceof Error?e.message:"";
    advisory={mode:"unavailable",reason:/^OPENAI_(PROVIDER_[1-5]\d{2}|OUTPUT_TOKEN_LIMIT|INCOMPLETE_RESPONSE|INVALID_SUMMARY)$/.test(reason)
     ?reason:"OPENAI_REQUEST_FAILED"};
   }
  }
  if(previous.advisory_key!==advisoryKey && (preview||(!result.missing.length&&!result.flags.length&&result.mode!=="REVIEW"))) advisory=null;
  const marker="[iCetak-AutoBrief-EdibleWafer:"+id+"]";
  const initialWord=text(cf(task,"Customize Name")?.value);
  if(initialWord&&result.wording&&norm(initialWord)!==norm(result.wording)&&previous.field_receipts?.wording!==initialWord&&norm(initialWord)!==norm(originalNote))result.flags.push("Customize Name sedia ada berbeza");
  receipts=[];
  for (const selected of result.selected) {
   if(!preview&&Date.parse(job.lease_until)<Date.now()+45000) {
    receipts.push({message_id:selected.id,role:selected.role,channel:selected.channel,status:"unavailable",error:"RETRY_LEASE_WINDOW"});
    continue;
   }
   receipts.push(await deliverMedia(selected,task,token,bridge,d,preview));
  }
  const unavailable=receipts.some((m:Data)=>m.status!=="attached"&&m.status!=="verified_preview");
  const status=result.flags.length?"REVIEW_REQUIRED":unavailable?(scope.provider==="shopee"?"REVIEW_REQUIRED":"SOURCE_UNAVAILABLE"):
   result.missing.length?(result.source_unavailable?"SOURCE_UNAVAILABLE":"MISSING_DETAILS"):result.mode==="REVIEW"?"REVIEW_REQUIRED":"BRIEF_READY";
  const comment=[
   marker,"Order ID: "+scope.order_no,
   ...(grouped.grouped?["Padanan OpenAI merentas order/item: "+(grouped.analysis?.reason||ctx.group_error||"Perlu semak")]:[]),
   (route.profile==="wafer"?"Wafer Paper":"Edible Image")+" · "+scope.target.purchased_size+" · "+scope.target.quantity+" unit"+(scope.target.layer?" · Lapisan "+scope.target.layer:""),
   "Saiz cetak: "+(result.print_size||"Perlu semak"),"Mod kerja: "+result.mode,
   "Wording: "+(result.wording||(result.wording_mode==="embedded_in_artwork"?"Dalam artwork":"—")),
   "Arahan: "+(result.instruction||"—"),"Review pelanggan: "+(result.review_requested?"Ya":"Ikut pakej"),
   "AutoBrief: "+status, "Sumber: "+Object.entries(ctx.channels||{}).map(([k,v])=>k+" "+v).join(", "),
   ...receipts.map((m:Data)=>m.role+" ["+m.channel+"]: "+(m.link||m.backup_image||"Buka Unified Inbox")+
    (m.status==="attached"?" · fail dilampirkan":m.status==="verified_preview"?" · fail boleh dibuka":" · attachment belum tersedia")),
   ...result.missing.map((x:string)=>"Kurang: "+x),...result.flags.map((x:string)=>"Semak: "+x),
   ...(advisory?.summary?["Ringkasan AI untuk semakan staf: "+text(advisory.summary,1000)]:[]),
   "Buyer note: "+(scope.note|| (scope.note_unverified?"Belum disahkan":"—")),
   "Bukti mesej:",...result.proof.map((m:Data)=>d.clock(m.sent_at||m.created_at)+" ["+m.channel+"] "+mediaText(m))
  ].join("\n").slice(0,13000);
  const fields={...previous.field_receipts};
  brief={decision_engine:grouped.grouped?"openai_group":"print_rules",confidence:grouped.analysis?.confidence||null,instruction:result.instruction,group_assignment:grouped.analysis||null,actual_buyer_note:originalNote,profile:version,order_no:scope.order_no,status,wording:result.wording,review_requested:result.review_requested,
   whatsapp_closed_at:previous.whatsapp_closed_at||(status==="BRIEF_READY"&&scope.provider==="shopee"?ctx.whatsapp_last_at:null),
   staff_artwork_message_id:scope.staff_artwork_message_id,
   specification:scope.target,print_size:result.print_size,mode:result.mode,missing:result.missing,flags:result.flags,
   source_channels:ctx.channels,advisory,advisory_at:advisoryAt,advisory_key:advisoryKey,field_receipts:fields,evidence:result.proof.map((m:Data)=>({id:m.id,channel:m.channel,at:m.created_at})),
   scope:{provider:scope.provider,order_id:scope.order_id,order_no:scope.order_no,session_id:scope.session_id,draft_id:scope.draft_id,
    conversation_id:scope.conversation_id,start_at:scope.start_at,end_at:scope.end_at,placed_at:scope.placed_at}};
  if(preview)return {task_id:id,brief,receipts,comment};
  const fresh=await d.clickup(token,"task/"+id);
  assertTask(fresh,id,route.initial_status);
  const sku=cf(fresh,"SKU"),word=cf(fresh,"Customize Name");
  if(sku?.id&&!text(sku.value)){
   await d.clickup(token,"task/"+id+"/field/"+sku.id,"POST",{value:scope.target.purchased_size});
   fields.sku=scope.target.purchased_size;
  }
  if(status==="BRIEF_READY"&&word?.id&&result.wording&&!checked(cf(fresh,"confirmed")?.value)&&(!text(word.value)||norm(word.value)===norm(originalNote)||fields.wording===text(word.value))) {
   await d.clickup(token,"task/"+id+"/field/"+word.id,"POST",{value:result.wording});
   fields.wording=result.wording;
  }
  const hash=await d.digest(comment);
  if(!commentId) {
   const comments=await d.clickup(token,"task/"+id+"/comment");
   const existing=(comments.comments||[]).find((c:Data)=>JSON.stringify(c.comment||c.comment_text||"").includes(marker));
   commentId=existing?.id?String(existing.id):null;
  }
  if(!commentId||previous.comment_hash!==hash){
   const links=new Set<string>(receipts.map((m:Data)=>m.link||m.backup_image).filter(Boolean));
   const rich=d.rich(comment).flatMap(op=>typeof op.text!=="string"?[op]:op.text.split(/(https:\/\/[^\s]+)/g).filter(Boolean)
    .map((part:string)=>links.has(part)?{text:part,attributes:{link:part}}:{...op,text:part}));
   const body={comment:rich,notify_all:false};
   if(commentId)await d.clickup(token,"comment/"+enc(commentId),"PUT",body);
   else {
    const posted=await d.clickup(token,"task/"+id+"/comment","POST",body);
    if(!posted?.id)throw Error("COMMENT_UNCERTAIN");
    commentId=String(posted.id);
   }
  }
  brief={...brief,comment_id:commentId,comment_hash:hash,checked_message_ids:brief.evidence.map((m:Data)=>m.id)};
  if(status==="BRIEF_READY") {
   const latest=await d.clickup(token,"task/"+id);
   assertTask(latest,id,route.initial_status);
   const review=cf(latest,"Review customer"),confirmed=cf(latest,"confirmed");
   if(!review?.id||!confirmed?.id)throw Error("PRINT_CONFIRM_FIELDS_UNAVAILABLE");
   const value=review.value?.id??review.value;
   const options=review.type_config?.options||[];
   const selected=options.find((option:Data)=>String(option.id)===String(value)||String(option.orderindex)===String(value));
   const isAiCheck=value===aiCheckOption||selected?.id===aiCheckOption;
   if(!isAiCheck&&(value==null||value===""||norm(selected?.name||review.value?.name)==="follow up1")) {
    await d.clickup(token,"task/"+id+"/field/"+review.id,"POST",{value:aiCheckOption});
    fields.review="Ai Check";
   }
   if(!checked(confirmed.value)) {
    await d.clickup(token,"task/"+id+"/field/"+confirmed.id,"POST",{value:true});
    fields.confirmed=true;
   }
   brief.confirmed=true;
   brief.confirmed_at=new Date().toISOString();
  }
  state=status==="BRIEF_READY"?"completed":"review";
 } catch(e) {
  error=text((e as Error).message,150);
  if(preview)return {task_id:id,eligible:false,error};
  state=/^(?:DB_|CLICKUP_|COMMENT_UNCERTAIN)/.test(error)?"failed":"review";
 }
 const saved=await d.db("rpc/icetak_record_order_brief",{p_task_id:id,p_fingerprint:job.source_fingerprint,p_state:state,
  p_brief:brief,p_media:receipts,p_comment_id:commentId,p_error:error});
 return {task_id:id,state,status:brief.status,comment_id:commentId,attachments:receipts.filter((m:Data)=>m.attachment_id).length,
  error:saved?error:"WRITEBACK_FAILED"};
}
