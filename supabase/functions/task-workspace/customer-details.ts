type Data=Record<string,any>;
const text=(v:unknown)=>String(v??'').trim();
const norm=(v:unknown)=>text(v).toLocaleLowerCase().replace(/\s+/g,' ');
const operational=/\b(?:shipping|courier|tracking|parcel|alamat|postcode|poskod|sampai|hantar|delivery|pickup|ambil|bayar|paid|payment|resit|receipt|transfer|bank|harga|price|berapa|stok|stock|checkout|tempah|beli|order|rm\s*\d+(?:\.\d+)?|\d{6}[a-z0-9]{8})\b/i;
const ack=/^(?:ok(?:ay|ey|ie)?|ok\s*(?:sis|boss|tq)|baik|baiklah|ya|yes|no|tak|boleh|done|dah|sudah|tq|thanks?|thank you|terima kasih|noted|hi|hai|hello|salam|assalamualaikum|👍|🙏|❤️)[\s.!?,]*$/i;
const uncertain=/\b(?:tak\s*pasti|belum\s*(?:pasti|confirm)|not\s*sure|mana\s*satu|which\s*one|atau|either|jangan\s*(?:buat|print|cetak)\s*dulu|tunggu\s*dulu|nanti\s*(?:saya|sy)\s*(?:bagi|confirm))\b/i;
const correction=/\b(?:tukar|ganti|betulkan|change|replace|correction|yang\s*betul|final)\b/i;
const directive=/\b(?:font|saiz|size|warna|colou?r|material|bahan|bentuk|shape|background|latar|buang|remove|crop|cut|potong|susun|layout|bulat|petak|curve|straight|tanpa|jangan|contoh|reference|gambar|image|photo|design|print|cetak|guna|use|line|baris|tukar|letak|nama|wording|text|tulis)\b/i;
export function customerText(raw:unknown,trusted=false):Data{
 const value=text(raw);if(!value||value.length>2000||ack.test(value)||/^(?:boleh|ok(?:ay|ey)?|baik|ya|yes)(?:\s+(?:sis|boss|ya|tq|dah))*[.!?]*$/i.test(value)||/^\d+\s*(?:pcs?|pieces?|unit|inch|in|cm|mm|ringgit)$/i.test(value)||/^(?:yang\s*ni|nak\s*(?:ini|ni)|bila|nak\s*tanya)[.!?]*$/i.test(value))return {};
 const out:Data={};
 const name=value.match(/(?:^|\n)\s*(?:nama|name)(?:\s+(?:dia|anak|untuk\s+topper))?\s*[:=\-]\s*([^\n]+)/i)||value.match(/^(?:(?:nak|letak|tulis|guna|untuk)\s+)?(?:nama|name)(?:\s+(?:dia|anak))?\s+(.+?)[?.!]*$/i);
 const age=value.match(/(?:^|\n)\s*(?:umur|age)\s*[:=\-]?\s*(\d{1,3})(?:\b|$)/i)||value.match(/^(\d{1,3})\s*(?:tahun|years?(?:\s*old)?|y\/?o)?[.!]*$/i);
 const wording=value.match(/(?:^|\n)\s*(?:wording|tulisan|text)(?:\s+(?:on|for|atas|pada)\s+(?:the\s+)?(?:cake\s+)?topper)?\s*[:=\-]\s*([\s\S]+)/i)||value.match(/^(?:tukar|ganti|betulkan|change|replace)\s+(?:(?:nama|name|wording|tulisan|text)\s*)?(?:(?:kepada|ke|jadi|to)\s+)?([\s\S]+)$/i)||value.match(/^(?:letak|tulis)\s+(?:wording|tulisan|text)\s+([\s\S]+)$/i);
 if(name&&!operational.test(name[1]))out.name=name[1].trim();if(age)out.age=age[1];
 if(wording){const v=wording[1].split(/\n\s*(?:(?:saiz|size|warna|colou?r|font|material|qty|kuantiti)\s*[:=])/i)[0].trim();if(v&&!operational.test(v)&&!/^(?:warna|colou?r|saiz|size|font|bentuk|shape|background|material)\b/i.test(v))out.wording=v;}
 const bare=value.match(/^([\p{L}][\p{L}\p{M}\s.'’&❤️♥-]{1,100}?)\s*\n?\s*(\d{1,3})\s*(?:tahun|years?(?:\s*old)?|y\/?o)?[.!]*$/iu);
 if(bare&&!operational.test(value)&&!directive.test(value)){out.name=bare[1].trim();out.age=bare[2];}
 if(!out.name&&!out.age&&!out.wording&&!operational.test(value)){
  if(trusted||/^(?:happy\b|selamat\b|the\s+wedding\b|tahniah\b|congratulations\b|good\s*luck\b)/i.test(value))out.wording=value;
  else if(/^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$/.test(value))out.wording=value;
  else if(!directive.test(value)&&!/[?]/.test(value)&&!/^(?:saya|sy|aku|nak|mau|mahu|utk|untuk|boleh|ada|itu|ini|ni|yg|yang|bila|mcm|macam|kenapa|tolong|buat|dah|sudah|belum|nanti|sekarang|esok|semua|teruskan|setuju)(?:\s|$)/i.test(value)&&!/\b(?:cake|kek|topper|edible|acrylic|wafer|paper|pcs|unit)\b/i.test(value)&&/^[\p{L}\p{M}][\p{L}\p{M}\d\s.'’&,!()❤️♥-]{0,179}$/u.test(value))out.name=value;
 }
 if(Object.keys(out).length&&uncertain.test(value))out.uncertain=true;
 if(directive.test(value)&&!operational.test(value))out.instructions=value;
 return out;
}
// One incoming design image is itself the customer's instruction. A caption is optional.
// Known payment/receipt evidence stays outside artwork; multiple unselected images remain uncertain.
export function customerContent(order:Data|null,context:Data,allow:boolean,seed:Data[]=[]){
 const candidates:Data[]=[...seed],evidence:Data[]=[],warnings:string[]=[];
 const scopedMessages:Data[]=(context.messages||[]).filter((m:Data)=>!m.is_history&&(context.bindings||[]).some((b:Data)=>b.usable===true&&b.id===m.conversation_id&&(!b.start_at||Date.parse(m.created_at)>=Date.parse(b.start_at))&&(!b.end_at||Date.parse(m.created_at)<Date.parse(b.end_at))));
 const messages=scopedMessages.filter((m:Data)=>m.direction==='inbound').sort((a:Data,b:Data)=>text(a.created_at).localeCompare(text(b.created_at))||text(a.id).localeCompare(text(b.id)));
 const add=(data:Data,source:string,at?:string,id?:string)=>{if(Object.keys(data).length){candidates.push({data,source,at,id});if(id)evidence.push({id,text:data.evidence||'',at});}};
 if(allow){
  const note=customerText(order?.order_note);add(note,'Note checkout',order?.created_at);
  for(const m of context.ambiguous||context.truncated?[]:messages){const raw=text(m.text_content||m.caption),data=customerText(raw);if(Object.keys(data).length){data.evidence=raw;data.correction=correction.test(raw);add(data,`${m.channel||'Chat'} · ${m.id}`,m.created_at,m.id);}}
 }
 const values:Data={},sources:Data={},conflicts:Data[]=[];
 const instructions=candidates.filter(c=>c.data.instructions).map(c=>text(c.data.instructions));
 if(instructions.length){values.instructions=[...new Set(instructions)].join('\n\n');sources.instructions={source:'Arahan customer · note / chat'};}
 for(const c of candidates){
  if(c.data.uncertain)warnings.push('Customer masih memberi pilihan / belum memastikan wording.');
  if(c.data.correction&&c.data.wording){delete values.name;delete values.age;delete sources.name;delete sources.age;}
  for(const field of ['name','age','wording'])if(text(c.data[field])){
   const value=text(c.data[field]);
   if(values[field]&&norm(values[field])!==norm(value)&&!c.data.correction)conflicts.push({field,label:field==='age'?'Umur':field==='name'?'Nama':'Wording tepat',value,source:c.source});
   if(!values[field]||c.data.correction){values[field]=value;sources[field]={source:c.source,at:c.at};if(c.data.correction){for(let n=conflicts.length-1;n>=0;n--)if(conflicts[n].field===field)conflicts.splice(n,1);}}
  }
 }
 // A complete wording may contain the name/age supplied separately; this is complementary detail.
 if(values.wording&&values.name&&!norm(values.wording).includes(norm(values.name)))conflicts.push({field:'wording',label:'Wording tepat',value:values.name,source:sources.name.source});
 if(!values.wording&&(values.name||values.age)){values.wording=[values.name,values.age].filter(Boolean).join('\n');sources.wording=sources.name||sources.age;}
 const images:Data[]=[];
 if(allow&&!context.ambiguous&&!context.truncated)for(const m of messages){
  if(m.message_type!=='image'||!text(m.media_url)||!/^https:\/\/|^wasapflow-media:\/\/\d+$/.test(m.media_url))continue;
  const caption=text(m.text_content||m.caption);
  const previous=scopedMessages.filter((p:Data)=>p.conversation_id===m.conversation_id&&p.created_at<m.created_at&&Date.parse(m.created_at)-Date.parse(p.created_at)<10*60000&&text(p.text_content||p.caption)).sort((a:Data,b:Data)=>text(b.created_at).localeCompare(text(a.created_at)))[0];
  if(/resit|receipt|payment|bayar|transfer|bank|order\s*(?:id|no)|screenshot\s*(?:order|checkout)/i.test(caption)||!caption&&/resit|receipt|bukti\s*(?:bayar|payment)|(?:dah|sudah)\s*(?:bayar|transfer)/i.test(text(previous?.text_content||previous?.caption)))continue;
  images.push({...m,selected:/(?:guna|use|print|cetak)\s+(?:gambar|image|photo)?\s*(?:ini|ni|this)|(?:this|final)\s+(?:image|photo|artwork)|yang\s*(?:ini|ni)\b/i.test(caption)});
 }
 const unique=[...new Map(images.map(m=>[m.media_url,m])).values()],chosen=unique.filter(m=>m.selected).at(-1)||(unique.length===1?unique[0]:null);
 if(chosen){values.artwork=chosen.media_url;sources.artwork={source:`${chosen.channel||'Chat'} · ${chosen.id}`,at:chosen.created_at};evidence.push({id:chosen.id,text:text(chosen.caption||chosen.text_content)||'Gambar customer diterima untuk design / cetakan.',at:chosen.created_at});}
 else if(unique.length>1)warnings.push('Beberapa gambar diterima; belum jelas gambar mana atau sama ada semuanya perlu digunakan.');
 for(const m of allow?messages:[]){const v=text(m.text_content||m.caption);if(uncertain.test(v)&&!ack.test(v)&&!operational.test(v))warnings.push('Customer ada arahan / pilihan yang belum pasti.');}
 return {values,sources,conflicts,warnings:[...new Set(warnings)],evidence};
}
