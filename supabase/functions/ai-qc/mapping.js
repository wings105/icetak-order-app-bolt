import {getInputFields, validatePatterns} from './render-fields.js';

const clean=v=>String(v??'').replace(/\\n/g,'\n').trim();
const compact=v=>clean(v).replace(/\s+/g,' ');
const failure=reason=>({ok:false,reason});

// Deliberately deterministic. Unknown prose/instructions are held, never rewritten by AI.
// Exact spans only: no translation, unit insertion or age rounding.
export function splitAge(value){
 const raw=compact(value);let m=raw.match(/^(turns?)\s+(\d{1,3}(?:st|nd|rd|th)?)$/i);
 if(m)return {age_number:m[2],age_prefix:m[1],age_suffix:''};
 m=raw.match(/^(\d{1,3}(?:st|nd|rd|th)?)(?:\s+(tahun|thn|bulan|months?|years?(?:\s+old)?|yrs?|y\/o))?$/i);
 if(m)return {age_number:m[1],age_prefix:'',age_suffix:m[2]||''};
 return null;
}
const safeName=s=>/^[\p{L}\p{M} .’'-]+$/u.test(s)&&!/[\r\n]/.test(s)&&! /\b(?:happy|birthday|selamat|lahir|umur|age|tahun|years?|turns?|nama|name)\b/i.test(s);
export function parseDetail(input){
 const raw=clean(input).replace(/^(?:wording|tulis|tulisan|ayat)\s*[:=]\s*/i,'');
 if(!raw||raw.length>600)return failure('WORDING_EMPTY_OR_TOO_LONG');
 if(/\b(?:tukar|ubah|jangan|buang|remove|replace|instead|kalau|jika|urgent|pos|shipping)\b/i.test(raw))return failure('INSTRUCTION_NEEDS_REVIEW');
 const marks=[...raw.matchAll(/(?:^|[\s,;])((?:custom\s*name|nama\s*custom|name|nama|umur|usia|age|ucapan|greeting|tarikh|date))\s*[:=]\s*/gi)];
 if(marks.length){
  if(raw.slice(0,marks[0].index).trim())return failure('UNMAPPED_PREFIX');
  const result={ok:true,kind:'labelled',name:'',age:'',greeting:'',date:'',raw};
  for(let i=0;i<marks.length;i++){
   const m=marks[i],key=/umur|usia|age/i.test(m[1])?'age':/ucapan|greeting/i.test(m[1])?'greeting':/tarikh|date/i.test(m[1])?'date':'name';
   const value=compact(raw.slice(m.index+m[0].length,marks[i+1]?.index??raw.length));
   if(!value||result[key]||value.length>160)return failure('AMBIGUOUS_LABELS');
   result[key]=value;
  }
  if(result.age&&!/^turns?\s+\d{1,3}$/i.test(result.age)&&!/^(?:yang\s+)?(?:ke[ -]?)?\d{1,3}(?:st|nd|rd|th)?(?:\s*(?:tahun|thn|bulan|months?|years?(?:\s*old)?|yrs?|y\/o))?$/i.test(result.age))return failure('AMBIGUOUS_AGE');
  return {...result,...(splitAge(result.age)||{})};
 }
 const single=compact(raw),m=single.match(/^(.*?)\s+((?:turns?\s+\d{1,3}(?:st|nd|rd|th)?)|(?:\d{1,3}(?:st|nd|rd|th)?(?:\s+(?:tahun|thn|bulan|months?|years?(?:\s+old)?|yrs?|y\/o))?))$/i);
 if(m&&safeName(m[1])&&splitAge(m[2]))return {ok:true,kind:'labelled',inferred:true,raw,name:m[1],age:m[2],greeting:'',date:'',...splitAge(m[2])};
 const onlyAge=splitAge(single);if(onlyAge)return {ok:true,kind:'labelled',inferred:true,raw,name:'',age:single,greeting:'',date:'',...onlyAge};
 return {ok:true,kind:'verbatim',raw,lines:raw.split(/\n+/).map(s=>s.trim()).filter(Boolean)};
}

export function mapFields(template,brief,taskWording){
 const c=template.config,auto=c?.automation;
 try{validatePatterns(c);}catch{return failure('INVALID_TEMPLATE_MAPPING');}
 if(!auto?.enabled)return failure('TEMPLATE_AUTOMATION_NOT_READY');
 const fields=getInputFields(c),rules=auto.inputs||{};
 if(fields.some(f=>!rules[f.key]?.source))return failure('UNMAPPED_TEMPLATE_FIELD');
 if(brief.instruction||brief.media_count>0||brief.review_requested||brief.pending_change_ids?.length||brief.change_detected>0)return failure('BRIEF_NEEDS_REVIEW');
 const selected=clean(taskWording||brief.wording);let parsed=parseDetail(selected);
 if(!parsed.ok)return parsed;
 if(parsed.inferred&&fields.every(f=>['wording','literal','greeting'].includes(rules[f.key].source)))parsed={ok:true,kind:'verbatim',raw:parsed.raw,lines:parsed.raw.split(/\n+/).map(s=>s.trim()).filter(Boolean)};
 if(parsed.kind==='labelled'&&parsed.age&&fields.some(f=>['age_number','age_prefix','age_suffix'].includes(rules[f.key].source))&&!splitAge(parsed.age))return failure('AGE_LAYOUT_NEEDS_REVIEW');
 const values={};
 if(parsed.kind==='verbatim'){
  // An exact phrase/line is routed intact. Never pick a name/age out of free prose.
  const dynamic=fields.filter(f=>rules[f.key].source!=='literal');
  if(dynamic.length===1)values[dynamic[0].key]=parsed.raw;
  else if(dynamic.filter(f=>rules[f.key].source==='name').length===1&&dynamic.every(f=>['name','age','age_number','age_prefix','age_suffix'].includes(rules[f.key].source))&&safeName(parsed.raw))values[dynamic.find(f=>rules[f.key].source==='name').key]=parsed.raw;
  else if(parsed.lines.length===dynamic.length)dynamic.forEach((f,i)=>values[f.key]=parsed.lines[i]);
  else if(dynamic.length===2&&dynamic.some(f=>rules[f.key].source==='greeting')&&parsed.lines.length===1&&!/\b(?:birthday|selamat|hari\s+lahir|happy|tahniah|anniversary)\b/i.test(parsed.raw)){
   const target=dynamic.find(f=>rules[f.key].source!=='greeting');
   // A single confirmed name is safe; a phrase containing an age/unit needs explicit labels.
   if(!/^[\p{L}\p{M} .’'-]+$/u.test(parsed.raw))return failure('UNLABELLED_WORDING_NEEDS_REVIEW');
   values[target.key]=parsed.raw;
  }else return failure('EXACT_WORDING_LAYER_MISMATCH');
 }
 for(const f of fields){
  const r=rules[f.key];
  if(parsed.kind==='labelled'&&r.source==='name_age'&&!parsed.name)return failure('MISSING_NAME');
  if(parsed.kind==='labelled'&&r.source==='wording')return failure('EXACT_WORDING_REQUIRED');
  if(values[f.key]===undefined){
   if(r.source==='literal')values[f.key]=r.default||'';
   else if(parsed.kind==='labelled')values[f.key]=r.source==='name_age'?[parsed.name,parsed.age].filter(Boolean).join(' '):r.source==='wording'?parsed.raw:parsed[r.source]||'';
   else values[f.key]='';
   // Only an explicitly configured greeting/literal may supply default wording.
   if(!values[f.key]&&r.source==='greeting')values[f.key]=r.default||'';
  }
  if(r.required!==false&&!values[f.key])return failure('MISSING_FIELD:'+f.key);
  if(values[f.key].length>200||/[\r\n]/.test(values[f.key]))return failure('WORDING_CANNOT_FIT_LAYER:'+f.key);
 }
 // Static words in patterns can change the customer's language. Require a verbatim
 // full phrase matching that pattern; labelled name/age is never permission to add TURN.
 for(const l of c.layers||[]){
  if(l.pattern&&compact(l.pattern.replace(/\{\{[a-zA-Z][a-zA-Z0-9_]*\}\}/g,'').replace(/\[\[|\]\]/g,'')))return failure('PATTERN_WORDING_REQUIRES_REVIEW');
 }
 return {ok:true,fields:values,source:selected};
}

export function taskEligible(task,job){
 const value=name=>(task.custom_fields||[]).find(f=>String(f.name).toLowerCase()===name)?.value;
 const confirmed=value('confirmed');
 if(![true,'true',1,'1'].includes(value('paid')))return failure('TASK_NOT_PAID');
 if(![true,'true',1,'1'].includes(confirmed))return failure('TASK_NOT_CONFIRMED');
 if(String(value('sku')||'').trim().toUpperCase()!==job.brief.sku)return failure('TASK_SKU_CHANGED');
 if(String(value('order id / customer name')||'').trim()!==job.order_reference)return failure('TASK_ORDER_CHANGED');
 if(!/^(?:design editing -topper|design editing\s*-\s*topper)$/i.test(task.status?.status||''))return failure('TASK_NOT_IN_DESIGN');
 if(String(task.list?.id)!=='18375902')return failure('TASK_LIST_MISMATCH');
 if((task.tags||[]).some(t=>/cancel/i.test(t.name)))return failure('TASK_CANCELLED');
 const wording=clean(value('customize name'));
 if(!wording)return failure('TASK_WORDING_EMPTY');
 const norm=s=>compact(s).toLocaleLowerCase();
 if(norm(wording)!==norm(job.brief.wording))return failure('TASK_WORDING_CHANGED');
 return {ok:true,wording};
}
