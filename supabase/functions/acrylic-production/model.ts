import { previewItem } from '../awb-preview/preview.ts';

export type SourceRow = {
 task_id:string; title:string; status:string; order_reference:string; jobs:string[]; sets:string[];
 sku:string; due_date:string|null; updated_at:string; colour_field?:string; size_field?:string;
 quantity_field?:string; attachments?:unknown[]; comment_images?:unknown[]; db_items?:Array<{colour:string|null;size:string|null;qty:number|null}>;
};
// Longest phrases are consumed first: Rose Gold must never become ordinary Gold.
const colours:Array<[string,string]>= [
 ['mirror rose gold|rose gold|rosegold','Rose Gold'],['gold glitter|glitter gold','Gold Glitter'],
 ['silver glitter|glitter silver','Silver Glitter'],['mirror pink|mirror pnk','Mirror Pink'],
 ['mirror blue','Mirror Blue'],['mirror green','Mirror Green'],['dark blue','Dark Blue'],['light blue','Light Blue'],
 ['mirror gold|gold|emas','Gold'],['mirror silver|silver|perak','Silver'],['black|hitam','Black'],
 ['white|putih','White'],['clear transparent|clear|transparent','Clear / Transparent'],['bronze','Bronze'],
 ['pink','Pink'],['red|merah','Red'],['blue|biru','Blue'],['green|hijau','Green'],['yellow|kuning','Yellow'],
 ['orange|oren','Orange'],['purple|ungu','Purple'],
];
export function colourFrom(value:string):{colour:string|null;ambiguous:boolean} {
 let rest=value.toLowerCase().replace(/[^a-z0-9]+/g,' '); const found=new Set<string>();
 for(const [pattern,label] of colours) rest=rest.replace(new RegExp(`\\b(?:${pattern})\\b`,'g'),()=>{found.add(label);return ' ';});
 return {colour:found.size===1?[...found][0]:null,ambiguous:found.size>1};
}
function unique<T>(values:T[]):T|null {const items=[...new Set(values.filter(v=>v!=null&&v!==''))];return items.length===1?items[0]:null;}
function sizeFrom(value:string):string|null {
 const paper=[...new Set((value.match(/\bA[3-7]\b/gi)||[]).map(v=>v.toUpperCase()))];
 if(paper.length>1)return null;
 if(paper.length===1){const dimensions=value.match(/\(([^)]*(?:inch|cm|mm|["″])[^)]*)\)/i);return paper[0]+(dimensions?` (${dimensions[1]})`:'');}
 const dimensions=value.match(/\b\d+(?:\.\d+)?\s*(?:x|×)\s*\d+(?:\.\d+)?\s*(?:inch|cm|mm|["″])/i);
 return dimensions?.[0]||null;
}
export function productionItem(row:SourceRow) {
 const jobs=row.jobs.map(v=>v.trim().toLowerCase());
 const acrylic=jobs.includes('acrylic cake topper'), artpaper=jobs.includes('artpaper');
 if(!acrylic&&!artpaper)return null;
 const stage=row.status.trim().toLowerCase();
 if(!['acrylic','artpaper','review','cake topper - printing'].includes(stage))return null;
 const explicit=colourFrom(row.colour_field||''); const title=colourFrom(row.title); const sku=colourFrom(row.sku||'');
 // A populated but unsupported explicit field must not fall back to an old Gold title.
 if(row.colour_field?.trim()&&!explicit.colour)explicit.ambiguous=true;
 const db=row.db_items||[];
 let colour:string|null=null,colour_source='',ambiguous=false;
 for(const [value,source] of [[explicit,'CF ClickUp'],[title,'Nama task ClickUp'],[sku,'SKU ClickUp']] as const){
  if(value.ambiguous){ambiguous=true;break;}
  if(value.colour){colour=value.colour;colour_source=source;break;}
 }
 if(!colour&&!ambiguous){colour=unique(db.map(v=>v.colour).filter((v):v is string=>!!v));if(colour)colour_source='Item order DB';}
 const size=row.size_field?.trim()||sizeFrom(row.title)||sizeFrom(row.sku||'')||unique(db.map(v=>v.size?sizeFrom(v.size)||v.size:null).filter((v):v is string=>!!v));
 const prefix=row.title.match(/^\s*(\d+)\s*[x×]\s*/i);
 const parsedQuantity=Number(row.quantity_field||prefix?.[1]|| (db.length===1?db[0].qty:0));
 const quantity=Number.isSafeInteger(parsedQuantity)&&parsedQuantity>0?parsedQuantity:null;
 const material=acrylic&&artpaper?'Semak material':acrylic?'Acrylic':'Artpaper';
 const issues=[...(!colour?[ambiguous?'Beberapa warna pada task':'Warna belum ditentukan']:[]),...(!size?['Saiz belum ditentukan']:[]),...(!quantity?['Kuantiti belum ditentukan']:[]),...(acrylic&&artpaper?['Dua jenis material dalam CF job']:[])];
 const date=Number(row.due_date);const due_at=row.due_date&&date>0&&!Number.isNaN(new Date(date).getTime())?new Date(date).toISOString():null;
 return {task_id:row.task_id,title:row.title,order_reference:row.order_reference,status:stage,
  stage:stage==='cake topper - printing'?'production':stage==='review'?'review':'design',
  material,colour:colour||'Belum ditentukan',colour_source,size:size||'Belum ditentukan',quantity,
  sets:row.sets||[],sku:row.sku||'',due_at,updated_at:row.updated_at,issues,
  images:previewItem({...row,set_position:999}).images,
  task_url:`https://app.clickup.com/t/${encodeURIComponent(row.task_id)}`};
}
