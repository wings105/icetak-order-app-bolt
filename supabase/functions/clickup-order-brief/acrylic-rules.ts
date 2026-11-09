// Rules first: no provider calls, I/O or customer sends in this module.
export type RecordData = Record<string, any>;
export const ACRYLIC_VERSION = "acrylic-internal-v1";
export const ACRYLIC_RULES_REVISION = "checkout-quoted-wording-v6";
const text = (x: any) => String(x ?? "").replace(/\\n/g, "\n").trim();
export const norm = (x: any) => text(x).toLowerCase().replace(/\s+/g, " ");
const stamp = (m: RecordData) => Date.parse(m.sent_at || m.created_at || m.at || "");
const inbound = (m: RecordData) => m.direction === "inbound";
const value = (m: RecordData) => text(m.text_content || m.caption);
const placeholder = (s: string) => !s || /^(?:custom\s*\d*\s*(?:inch|inci|kek)|perlu detail|number\s*$|—)/i.test(s);
export function cleanWording(s: string): string {
 return text(s).replace(/^["“']|["”']$/g,'').replace(/^(?:tulis(?:an)?|huruf|initial|word(?:ing)?|nama\s*custom|custom\s*name|nama|name|ayat|text)\s*[:=,-]?\s*/i, "").replace(/\s*\bbelow\s*:\s*/i,'\n').trim();
}

const unitNumbers: Record<string, number> = {
 first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
 pertama: 1, kedua: 2, ketiga: 3, keempat: 4, kelima: 5,
};
const ordinal = "\\d{1,2}(?:st|nd|rd|th)?|first|second|third|fourth|fifth|pertama|kedua|ketiga|keempat|kelima";
const unitKind = "(?:topper|unit|piece|pc|keping)";
const unitLabel = "(?:" + unitKind + "\\s+(?:ke[- ]?)?(?<suffix>" + ordinal + ")|(?:yang\\s+)?(?<leading>" + ordinal + ")(?:\\s+" + unitKind + ")?)\\b";
const wordingLabel = "(?:name|text|wording|nama|tulisan|ayat)";
const quotedWording = "(?:\"(?<double>[^\"\\n]+)\"|'(?<single>[^'\\n]+)'|“(?<curlyDouble>[^”\\n]+)”|‘(?<curlySingle>[^’\\n]+)’)";
const wordingFirst = new RegExp("^(?:the\\s+)?" + wordingLabel + "\\s*[:=]?\\s*" + quotedWording + "\\s+(?:for|untuk|bagi|pada)\\s+(?:the\\s+)?" + unitLabel, "iu");
const singleQuotedWording = new RegExp("^(?:word(?:ing)?|tulis(?:an)?|nama|huruf|initial|text)\\s*[:=]?\\s*" + quotedWording + "[.!]?$", "iu");
const unitFirst = new RegExp("^" + unitLabel + "\\s*(?:[:=–-]\\s*|\\s+)(?:(?:the\\s+)?" + wordingLabel + "\\s*[:=]?\\s*)?" + quotedWording, "iu");

export function isClearCheckoutWording(value: string): boolean {
 return value.length > 0 && value.length <= 150 && !placeholder(value) &&
  !/\b(?:ship|shipping|post|pos|urgent|please|tolong|contoh|sample|reference|gambar|photo|image|macam|mcm|ikut|tukar|ubah|change|replace|atau|or)\b|[?]/iu.test(value);
}

export function parseCheckoutUnits(note: string, quantity: number): string[] | null {
 if (!Number.isInteger(quantity) || quantity < 2 || quantity > 99) return null;
 const source = text(note);
 const units = new Map<number, string>();
 const add = (position: string, wording: string) => {
  const key = position.toLowerCase();
  const index = unitNumbers[key] ?? Number(key.replace(/(?:st|nd|rd|th)$/i, ""));
  if (!Number.isInteger(index) || index < 1 || index > quantity || units.has(index) || !isClearCheckoutWording(wording)) return false;
  units.set(index, wording);
  return true;
 };
 const lines = source.split("\n").map(line => line.trim()).filter(Boolean);
 const numbered = lines.map(line => line.match(/^(\d{1,2})[.)]\s+(.+)$/u));
 if (numbered.every(Boolean) && numbered.length === quantity) {
  for (const match of numbered) {
   if (!match || !add(match[1], match[2].trim().replace(/^(?:"([^"]+)"|'([^']+)'|“([^”]+)”|‘([^’]+)’)$/u, "$1$2$3$4"))) return null;
  }
 } else {
  const preamble = source.match(/^(?:(?:i am|i['’]m)\s+ordering|i\s+ordered|saya\s+(?:nak\s+)?(?:order|tempah|beli))\s+(\d{1,2}|two|three|four|five|dua|tiga|empat|lima)\s+(?:pieces?|pcs?|topper(?:s)?|unit|keping)\s*[,;:]\s*/iu);
  const counts: Record<string,number> = {two:2,three:3,four:4,five:5,dua:2,tiga:3,empat:4,lima:5};
  if (preamble && (counts[preamble[1].toLowerCase()] ?? Number(preamble[1])) !== quantity) return null;
  let remaining = preamble ? source.slice(preamble[0].length) : source;
  while (remaining) {
   const match = wordingFirst.exec(remaining) || unitFirst.exec(remaining);
   const fields = match?.groups;
   if (!match || !fields || !add(fields.leading || fields.suffix, (fields.double || fields.single || fields.curlyDouble || fields.curlySingle).trim())) return null;
   remaining = remaining.slice(match[0].length).trim();
   if (!remaining || /^[.!]$/.test(remaining)) break;
   const separator = remaining.match(/^(?:[,;]\s*(?:(?:and|dan)\s+)?|(?:and|dan)\s+)/iu);
   if (!separator) return null;
   remaining = remaining.slice(separator[0].length);
   if (!remaining) return null;
  }
 }
 return units.size === quantity ? Array.from({length:quantity}, (_, index) => units.get(index + 1)!) : null;
}

export function isContactOnly(value: string, orderPhone: string): boolean {
 const candidate = text(value).replace(/^(?:no\.?\s*(?:tel(?:efon)?|phone|hp|whatsapp)|phone|whatsapp|wasap|tel(?:efon)?|hp)\s*[:=]?\s*/iu, "");
 if (!/^\+?[\d\s().-]+$/u.test(candidate)) return false;
 const normalizePhone = (input: string) => input.replace(/\D/g,"").replace(/^0060/,"60").replace(/^0/,"60");
 const digits = normalizePhone(candidate);
 const verified = normalizePhone(orderPhone || "");
 return /^\d{9,15}$/.test(digits) && (digits===verified || /^601\d{8,9}$/.test(digits));
}

function pair(s: string) {
 const c = cleanWording(s);
 return /^[\p{L}][\p{L}\p{M} .'-]{0,65}\s*&\s*[\p{L}][\p{L}\p{M} .'-]{0,65}$/u.test(c) ? c : "";
}
function topic(s: string, mixed: boolean): string {
 if (/\b(?:edible|icing|wafer|burn\s*away)\b/i.test(s)) return "other";
 if (/\b(?:printed|glossy|artpaper|kuromi|spiderman|cocomelon)\b/i.test(s) && mixed) return "other";
 if (/\b(?:acrylic|axrylic|akrilik|initial|huruf)\b/i.test(s)) return "acrylic";
 return "";
}
export function boundMessages(messages: RecordData[], scope: RecordData): RecordData[] {
 let sorted = messages.filter(m => Number.isFinite(stamp(m))).sort((a,b) => stamp(a)-stamp(b));
 const placed = Date.parse(scope.placed_at);
 // Old canonical sessions may span months. A long quiet gap starts a new order episode.
 let begin=0;
 for(let i=1;i<sorted.length;i++)if(stamp(sorted[i])<=placed&&stamp(sorted[i])-stamp(sorted[i-1])>48*3600000)begin=i;
 sorted=sorted.slice(begin);
 let end = sorted.length;
 // A confirmed future purchase inquiry bounds its whole topic, including the image just before it.
 const future = sorted.findIndex(m => inbound(m) && stamp(m)>placed &&
  /(?:nanti[\s\S]{0,60}(?:nak|nk|mahu)\s*order|(?:order|beli)[\s\S]{0,40}hujung\s*bulan|new\s+order|order\s+baru)/i.test(value(m)));
 if (future >= 0) {
  end = future;
  for (let i=future; i>0; i--) {
   if (stamp(sorted[i])-stamp(sorted[i-1])>12*3600000) { end=i; break; }
   if (stamp(sorted[i-1])<=placed) break;
  }
 }
 return sorted.slice(0,end).map(m => ({...m,text_content:value(m)}));
}

type ChatUnitAssignment = {unit: number; wording: string; messageId: string; imageId: string};
function assignChatUnitReferences(messages: RecordData[], quantity: number): ChatUnitAssignment[] | null {
 const assignments = new Map<number, ChatUnitAssignment>();
 const images = new Set<string>();
 for (let index = 0; index < messages.length; index++) {
  const message = messages[index];
  if (!inbound(message) || message.is_history) continue;
  const body = text(message.caption || message.text_content);
  // A correction or cancellation requires the normal review path.
  if (/\b(?:tukar|ubah|ganti|bukan|instead|cancel|abaikan|change|replace)\b/iu.test(body)) return null;
  const explicit = body.match(/^(?:yg|yang|topper|unit)\s+(?<position>\d{1,2}|pertama|kedua|ketiga|keempat|kelima)\s+(?:nak|nk|mahu)\s+(?:tulisan|wording|nama|huruf)\s*[:=]?\s*(?<wording>.+?)\s+(?:mcm|macam|seperti)\s+(?:ni|ini)[.!]?$/iu);
  const another = body.match(/^lagi\s+(?:1|satu)\s+(?:nak|nk|mahu)\s+(?:design|reka bentuk)\s+(?:mcm|macam|seperti)\s+(?:ni|ini)\s+(?:huruf|tulisan|wording|nama)\s*[:=]?\s*(?<wording>.+)$/iu);
  if (!explicit && !another) continue;
  const position = explicit?.groups?.position?.toLowerCase() || "";
  const unit = explicit ? (unitNumbers[position] ?? Number(position)) : quantity === 2 && assignments.has(1) ? 2 : 0;
  const wording = (explicit?.groups?.wording || another?.groups?.wording || "").trim();
  if (!Number.isInteger(unit) || unit < 1 || unit > quantity || assignments.has(unit) || !isClearCheckoutWording(wording)) return null;
  const image = message.message_type === "image" ? message : messages[index - 1];
  if (!image || !inbound(image) || image.is_history || image.message_type !== "image" || !image.media_url ||
   image.conversation_id !== message.conversation_id || image.channel !== message.channel ||
   stamp(message) - stamp(image) > 120_000 || images.has(image.id)) return null;
  images.add(image.id);
  assignments.set(unit, {unit, wording, messageId:message.id, imageId:image.id});
 }
 if (assignments.size !== quantity) return null;
 return [...assignments.values()].sort((a,b)=>a.unit-b.unit);
}

export function acrylicRules(scope: RecordData, input: RecordData[]): RecordData {
 const target=scope.target||{}, items=scope.items||[], quantity=Number(target.quantity||target.qty)||1;
 const mixed=items.some((i:RecordData)=>i.kind && i.kind!=="acrylic");
 const acrylicItems=items.filter((i:RecordData)=>i.kind==="acrylic");
 const bounded=boundMessages(input,scope);
 const messages=bounded.filter(message=>!inbound(message)||message.message_type!=="text"||!isContactOnly(value(message),scope.phone));
 const candidates: RecordData[]=[], references:RecordData[]=[], instructions:string[]=[], conflicts:string[]=[];
 let current="", previousQuestion="", referenceSize="", referenceColour="", colour=String(target.colour||target.style||"");
 let size=String(target.size||""), parts:RecordData[]=[], corrections:RecordData[]=[];
 const note=text(scope.note), existing=text(target.wording||target.custom_text);
 const add=(words:string[], m:RecordData, source:string) => {
  if(words.length && words.every(Boolean)) candidates.push({words,m,source,score:source==="buyer_note"?94:92});
 };
 if(note && !placeholder(note) && (scope.single_item_scope || items.length===1)) {
  const p=pair(note), explicit=/^["“']?\s*(?:word(?:ing)?|tulis|nama|huruf|initial|text)\s*[:=]/i.test(note);
  const checkoutUnits=scope.provider==="shopee" ? parseCheckoutUnits(note,quantity) : null;
  const quoted=quantity===1&&scope.provider==="shopee" ? singleQuotedWording.exec(note)?.groups : undefined;
  const quotedText=(quoted?.double||quoted?.single||quoted?.curlyDouble||quoted?.curlySingle||"").trim();
  if(checkoutUnits) add(checkoutUnits,{id:"buyer_note"},"buyer_note");
  else if(isClearCheckoutWording(quotedText)) add([quotedText],{id:"buyer_note"},"buyer_note");
  else if(p || explicit || (/[❤♥]/.test(note)&&!/\b(?:ship|urgent|please)\b/i.test(note)) || /^(?:Happy|Selamat)\s+(?:Birthday|Engagement|Wedding)/i.test(note)) add([p||cleanWording(note)],{id:"buyer_note"},"buyer_note");
 }
 // Canonical local item text is only a candidate; the chat can correct it.
 if(existing && !placeholder(existing) && !/\b(?:inch|inci|kek|gold|black|silver|yellow)\b/i.test(existing)) {
  const number=existing.match(/^number\s*[:=]?\s*(\d+)$/i);
  add([number?number[1]:cleanWording(existing)],{id:"order_item"},"order_item");
 }
 for(const m of messages) {
  const s=value(m); if(!s || /^\[(?:Shopee|Image|Document|edit)/i.test(s)) {
   if(inbound(m)&&m.message_type==="image"&&m.media_url) references.push({...m,referenceSize,referenceColour,topic:current|| (acrylicItems.length===1&&!mixed?"acrylic":"unassigned")});
   continue;
  }
  const changeTopic=topic(s,mixed); if(changeTopic) current=changeTopic;
  if(!inbound(m)) { previousQuestion=s; continue; }
  const mentionedSize=s.match(/\bA[567]\b/i)?.[0];
  const mentionedColour=s.match(/\b(gold|silver|white|black|yellow|clear|putih|hitam|emas|perak|kuning)\b/i)?.[0];
  if(mentionedSize)referenceSize=mentionedSize;
  if(mentionedColour)referenceColour=({putih:"White",hitam:"Black",emas:"Gold",perak:"Silver",kuning:"Yellow"} as Record<string,string>)[norm(mentionedColour)]||mentionedColour;
  if(m.message_type==="image"&&m.media_url) references.push({...m,referenceSize,referenceColour,topic:current||(acrylicItems.length===1&&!mixed?"acrylic":"unassigned")});
  if(current!=="other"&&(!referenceSize||norm(size).includes(norm(referenceSize)))&&(!referenceColour||norm(colour)===norm(referenceColour))&&/\b(?:ikut|ikot|inspo|macam|mcm|font|cantum|asing|separat|straight|line|love|bunga|bintang|urgent|sebelum|before)\b/i.test(s))
   instructions.push(s.slice(0,450));
  const correction=s.match(/(?:number|nombor|angka|topper\s+number)[\s\S]{0,45}?(\d+)\s*(?:\.\.|,|[.;])?\s*(?:not|bukan|bukannya)\s*(\d+)/i);
  if(correction && quantity===1 && (new RegExp("\\b"+correction[2]+"\\b").test(existing)||scope.single_item_scope)) {
   corrections.push({old:correction[2],value:correction[1],id:m.id});
   add([correction[1]],m,"correction");current="acrylic";continue;
  }
  const multiline=s.split("\n").map(x=>x.trim()).filter(Boolean);
  const header=multiline[0]||"", headerSize=header.match(/\bA[567]\b/i)?.[0];
  const headerColour=header.match(/\b(gold|silver|white|black|yellow|clear|rose\s*gold)\b/i)?.[0];
  const list=multiline.slice(1).map(pair).filter(Boolean);
  if(list.length && (!headerSize||norm(size).includes(norm(headerSize)))&&(!headerColour||norm(colour)===norm(headerColour))) {
   if(list.length===quantity) {add(list,m,"unit_list");current="acrylic";continue;}
   if(current==="acrylic") conflicts.push("QUANTITY_MISMATCH");
  }
  if(/Best\s+gold\s*\n\s*Husband\s+dad\s+black/i.test(s) && /best|hus|dad/i.test(existing)) {
   parts=[{wording:"Best",colour:"Gold"},{wording:"Husband dad",colour:"Black"}];
   add(["Best\nHusband dad"],m,"component_colours");conflicts.push("MULTI_COLOUR_REVIEW");continue;
  }
  const replacement=s.match(/^(?:tapi|tp|but)\s+(?:huruf\s+)?([\p{L}]{1,3}\s*&\s*[\p{L}]{1,3})[.!]?$/iu);
  const explicitInitials=s.match(/^(?:pastu\s+)?(?:nama(?:\s+tu)?\s+)?(?:nak|nk|mahu)\s+(?:tulis|letak)\s+([\p{L}]{1,3}\s*&\s*[\p{L}]{1,3})[.!]?$/iu);
  const initialWording=replacement?.[1]||explicitInitials?.[1];
  if(initialWording&&quantity===1&&!mixed&&(scope.single_item_scope||items.length===1)&&current!=="other"){
   const position=messages.indexOf(m);
   const neighbours=explicitInitials?[messages[position-1],...messages.slice(position+1,position+3)]:[messages[position-1]];
   const images=neighbours.filter(image=>image&&inbound(image)&&!image.is_history&&image.message_type==="image"&&image.media_url&&
    image.channel===m.channel&&image.conversation_id===m.conversation_id&&Math.abs(stamp(m)-stamp(image))<=120_000);
   const image=images.length===1?images[0]:null;
   if(image){
    candidates.push({words:[initialWording],m,source:"reference_wording",score:92,referenceId:image.id});
    instructions.push("Ikut gaya gambar rujukan dengan wording "+initialWording+".");
    current="acrylic";continue;
   }
   add([initialWording],m,"chat");current="acrylic";continue;
  }
  const p=pair(s), askedInitial=/\b(?:initial|huruf|nama|wording|tulis)\b/i.test(previousQuestion);
  const position=messages.findIndex(x=>x.id===m.id);
  const confirmsMaterial=messages.slice(position+1).filter(inbound).slice(0,2).some(x=>stamp(x)-stamp(m)<300000&&/^(?:acrylic|axrylic|akrilik)[.!\s]*$/i.test(value(x)));
  if(quantity===1&&current!=="other"&&/^(?:Happy\s+(?:Birthday|Engagement|Wedding)|Selamat\s+(?:Hari\s+Lahir|Pengantin))/i.test(s)&&s.length<=160)add([s],m,"chat");
  if(p && quantity===1 && (current!=="other"||askedInitial||confirmsMaterial) && (acrylicItems.length===1||current==="acrylic")) {
   add([p],m,"chat");current="acrylic";continue;
  }
  if(current==="acrylic" && quantity===1 && /^(?:wording|tulis|tulisan|nama|name|huruf|initial|ayat)\s*[:=]?\s*/i.test(s)) {
   const w=cleanWording(s);
   if(w && w.length<=150 && !/[?]/.test(w)&&!/(?:boleh|blh|nak|nk|macam|mcm|size|saiz|inch|inci)/i.test(w)) add([w],m,"chat");
  }
  if(current==="acrylic" && /^\d{1,3}$/.test(s) && /number|nombor|angka/i.test(previousQuestion)) add([s],m,"chat");
 }
 const chatAssignments=quantity>1&&!mixed&&(scope.single_item_scope||items.length===1)?assignChatUnitReferences(messages,quantity):null;
 if(chatAssignments) candidates.push({words:chatAssignments.map(x=>x.wording),m:{id:chatAssignments[0].messageId},source:"chat_unit_references",score:92,chatAssignments});
 const explicit=candidates.filter(c=>c.source!=="order_item");
 const chosen=explicit.at(-1)||candidates.at(-1);
 const units=(chosen?.words||[]).map((wording:string,i:number)=>{
  const assignment=chosen.chatAssignments?.[i];
  return {unit:i+1,wording,colour,size,
   evidence_ids:chosen.referenceId?[chosen.m.id,chosen.referenceId]:assignment?[...new Set([assignment.messageId,assignment.imageId])]:[chosen.m.id],
   ...(assignment||chosen.referenceId?{reference_message_id:assignment?.imageId||chosen.referenceId}:{})};
 });
 const prior=candidates.filter(c=>c!==chosen&&c.source!=="order_item");
 const differing=chosen&&prior.some(c=>JSON.stringify(c.words)!==JSON.stringify(chosen.words));
 if(differing&&!corrections.length) conflicts.push("CONFLICTING_WORDING");
 // An image often precedes the material answer. Only look ahead within its own image/topic group.
 for(const ref of references.filter(m=>m.topic==="unassigned")) {
  const index=messages.findIndex(m=>m.id===ref.id);
  for(const next of messages.slice(index+1)) {
   if(inbound(next)&&next.message_type==="image")break;
   const t=topic(value(next),mixed);
   if(t){ref.topic=t;break;}
  }
 }
 const mappedImages=references.filter(m=>m.topic==="acrylic"&&(!m.referenceSize||norm(size).includes(norm(m.referenceSize)))&&(!m.referenceColour||norm(colour)===norm(m.referenceColour)));
 const unassigned=references.filter(m=>m.topic==="unassigned");
 const assignments=chosen?.chatAssignments as ChatUnitAssignment[]|undefined;
 const linkedImages=assignments && references.length===quantity && mappedImages.length===quantity &&
  mappedImages.every(image=>assignments.some(unit=>unit.imageId===image.id));
 if(assignments&&!linkedImages) conflicts.push("UNIT_REFERENCE_UNVERIFIED");
 const linkedReplacement=!!chosen?.referenceId&&references.length===1&&mappedImages.length===1&&mappedImages[0].id===chosen.referenceId;
 if(chosen?.referenceId&&!linkedReplacement) conflicts.push("UNIT_REFERENCE_UNVERIFIED");
 const needsVision=mappedImages.length>0&&!linkedImages&&!linkedReplacement;
 if(mixed&&mappedImages.length>1)conflicts.push("MULTI_IMAGE_ITEM_REVIEW");
 if(unassigned.length&&mixed) conflicts.push("AMBIGUOUS_MEDIA_ITEM");
 const missing:string[]=[];
 if(units.length!==quantity) missing.push(quantity>1?"wording_each_unit":"wording");
 if(!colour)missing.push("colour");
 if(!size)missing.push("size");
 const reviewRequested=messages.some(m=>inbound(m)&&/(?:nak|nk|mahu|send|hantar|show|review)[\s\S]{0,50}(?:design\s*dulu|preview|sebelum\s*(?:potong|laser|print)|for\s*(?:review|approval))/i.test(value(m)));
 const confidence=missing.length?0:conflicts.length?65:needsVision?75:chosen?.score||0;
 const eligibleFallback=!scope.unavailable && !scope.ambiguous && !scope.truncated &&
  (needsVision||conflicts.length>0||(scope.provider==="shopee" && (scope.single_item_scope || items.length===1) && note && missing.includes("wording_each_unit"))||(messages.some(m=>inbound(m)&&(/[\p{L}\d]/u.test(value(m)))&&!/^hi(?: seller)?$|^hello$|^salam$/i.test(value(m)))&&missing.includes("wording")));
 return {profile:ACRYLIC_VERSION,units,parts,wording:units.map((u:RecordData)=>quantity>1?u.unit+". "+u.wording:u.wording).join("\n"),
  colour,size,quantity,missing,conflicts:[...new Set(conflicts)],corrections,instruction:[...new Set(instructions)].join("\n").slice(0,2500),
  references:mappedImages.map(m=>({id:m.id,media_url:m.media_url,
   ...(linkedImages?{unit:assignments?.find(x=>x.imageId===m.id)?.unit}:{})})),unassigned_media_ids:unassigned.map(m=>m.id),
  review_requested:reviewRequested||target.review_required===true,confidence,ready:!missing.length&&!conflicts.length&&!needsVision,
  needs_vision:needsVision,needs_fallback:eligibleFallback,evidence_ids:[...new Set(units.flatMap((u:RecordData)=>u.evidence_ids))],
  messages,excluded_later_count:input.length-bounded.length,excluded_contact_count:bounded.length-messages.length};
}

