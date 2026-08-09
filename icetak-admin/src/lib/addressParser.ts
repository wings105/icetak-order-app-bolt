export type ParsedMalaysiaAddress = {
  name:string;
  phone:string;
  addressLine1:string;
  addressLine2:string;
  postcode:string;
  city:string;
  state:string;
  missing:string[];
};

const STATES:Array<{canonical:string;aliases:string[]}>= [
  {canonical:'Negeri Sembilan',aliases:['Negeri Sembilan','N. Sembilan','N Sembilan']},
  {canonical:'Kuala Lumpur',aliases:['Wilayah Persekutuan Kuala Lumpur','W.P. Kuala Lumpur','WP Kuala Lumpur','Kuala Lumpur']},
  {canonical:'Pulau Pinang',aliases:['Pulau Pinang','Penang']},
  {canonical:'Putrajaya',aliases:['Wilayah Persekutuan Putrajaya','W.P. Putrajaya','WP Putrajaya','Putrajaya']},
  {canonical:'Labuan',aliases:['Wilayah Persekutuan Labuan','W.P. Labuan','WP Labuan','Labuan']},
  {canonical:'Johor',aliases:['Johor']},{canonical:'Kedah',aliases:['Kedah']},
  {canonical:'Kelantan',aliases:['Kelantan']},{canonical:'Melaka',aliases:['Melaka','Malacca']},
  {canonical:'Pahang',aliases:['Pahang']},{canonical:'Perak',aliases:['Perak']},
  {canonical:'Perlis',aliases:['Perlis']},{canonical:'Sabah',aliases:['Sabah']},
  {canonical:'Sarawak',aliases:['Sarawak']},{canonical:'Selangor',aliases:['Selangor']},
  {canonical:'Terengganu',aliases:['Terengganu']},
];
const ADDRESS_START=/\b(?:no\.?|lot|pt|blok|block|tingkat|level|unit|rumah|kampung|kg\.?|jalan|jln\.?|lorong|lrng\.?|taman|perumahan|apartment|apartmen|pangsapuri|flat|kondominium|condo)\b/i;
const PHONE_PATTERN=/(?:\+?6?0?1\d(?:[\s-]?\d){7,9})/g;

const esc=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const tidy=(value:string)=>value.replace(/\s+/g,' ').replace(/\s*,\s*/g,', ').replace(/\s*\.\s*/g,'. ').replace(/(?:,\s*){2,}/g,', ').trim().replace(/^[,.;\s]+|[,.;\s]+$/g,'');

function normalizedPhone(value:string){
  let digits=value.replace(/\D/g,'');
  if(digits.startsWith('01'))digits=`6${digits}`;
  else if(digits.startsWith('1'))digits=`60${digits}`;
  return digits.startsWith('60')?`+${digits}`:value.trim();
}

function stateMatch(value:string){
  for(const entry of STATES){
    for(const alias of [...entry.aliases].sort((a,b)=>b.length-a.length)){
      const match=new RegExp(`\\b${esc(alias).replace(/\\ /g,'\\s+')}\\b`,'i').exec(value);
      if(match)return {state:entry.canonical,index:match.index,length:match[0].length};
    }
  }
  return {state:'',index:-1,length:0};
}

function probableName(value:string,lines:string[]){
  const first=lines[0]||'';
  if(lines.length>1&&!/\d{5}|\+?6?0?1\d/i.test(first)&&!ADDRESS_START.test(first)&&!stateMatch(first).state)return tidy(first);
  const marker=ADDRESS_START.exec(value);
  if(marker&&marker.index>1){
    const candidate=tidy(value.slice(0,marker.index));
    if(candidate.split(/\s+/).length<=8&&!/\d/.test(candidate))return candidate;
  }
  const comma=value.split(',')[0];
  if(comma&&comma.split(/\s+/).length<=8&&!/\d/.test(comma)&&!ADDRESS_START.test(comma))return tidy(comma);
  return '';
}

export function parseMalaysiaAddress(raw:string):ParsedMalaysiaAddress{
  const lines=raw.split(/\r?\n/).map(tidy).filter(Boolean);
  const compact=tidy(raw.replace(/[\r\n\t]+/g,' '));
  const phones=[...compact.matchAll(PHONE_PATTERN)];
  const phoneMatch=phones.at(-1);
  const phone=phoneMatch?normalizedPhone(phoneMatch[0]):'';
  let working=phoneMatch?tidy(`${compact.slice(0,phoneMatch.index)} ${compact.slice((phoneMatch.index||0)+phoneMatch[0].length)}`):compact;
  const name=probableName(working,lines);
  if(name&&working.toLowerCase().startsWith(name.toLowerCase()))working=tidy(working.slice(name.length));

  const postcodeMatch=/\b\d{5}\b/.exec(working);
  const postcode=postcodeMatch?.[0]||'';
  const stateFound=stateMatch(working);
  let city='';
  if(postcodeMatch){
    let after=tidy(working.slice(postcodeMatch.index+postcode.length));
    const afterState=stateMatch(after);
    if(afterState.index>=0)after=tidy(`${after.slice(0,afterState.index)} ${after.slice(afterState.index+afterState.length)}`);
    city=tidy(after.split(/[,.]/)[0]||'');
  }
  if(!city&&stateFound.index>0){
    const before=tidy(working.slice(0,stateFound.index));
    city=tidy(before.split(/[,.]/).at(-1)||'');
  }

  const cutPoints=[postcodeMatch?.index??-1,stateFound.index].filter((index)=>index>=0);
  let addressLine1=tidy(working.slice(0,cutPoints.length?Math.min(...cutPoints):working.length));
  if(city){
    const trailingCity=new RegExp(`(?:,|\\s)${esc(city)}$`,'i');
    addressLine1=tidy(addressLine1.replace(trailingCity,''));
  }
  if(!addressLine1&&lines.length>1)addressLine1=tidy(lines.slice(name?1:0).join(', '));

  const result={name,phone,addressLine1,addressLine2:'',postcode,city,state:stateFound.state,missing:[] as string[]};
  if(!result.name)result.missing.push('name');
  if(!result.phone)result.missing.push('phone');
  if(!result.addressLine1)result.missing.push('line1');
  if(!result.postcode)result.missing.push('postcode');
  if(!result.city)result.missing.push('city');
  if(!result.state)result.missing.push('state');
  return result;
}
