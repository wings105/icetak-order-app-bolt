import JSZip from 'jszip';
import {normalizeExports,type ExportSheet} from '../../../shared/catalog/import';
function xml(s:string){const d=new DOMParser().parseFromString(s,'application/xml');if(d.querySelector('parsererror'))throw Error('XML export rosak');return d;}
export async function parseProductFiles(files:File[]){
 const sheets:ExportSheet[]=[];
 const read=async(buffer:ArrayBuffer|Uint8Array,depth=0):Promise<void>=>{
  if(depth>1)throw Error('ZIP bersarang tidak disokong');const z=await JSZip.loadAsync(buffer);
  const entries=Object.values(z.files);if(entries.length>300)throw Error('Terlalu banyak fail dalam ZIP');
  if(!z.file('xl/workbook.xml')){for(const f of entries.filter(x=>/\.xlsx$/i.test(x.name))){const b=await f.async('uint8array');if(b.length>40000000)throw Error('Fail terlalu besar');await read(b,depth+1);}return;}
  const ss=z.file('xl/sharedStrings.xml');const strings=ss?Array.from(xml(await ss.async('string')).getElementsByTagName('si')).map(si=>Array.from(si.getElementsByTagName('t')).map(x=>x.textContent||'').join('')):[];
  for(const f of entries.filter(x=>/^xl\/worksheets\/sheet\d+\.xml$/.test(x.name))){const raw=await f.async('string');if(raw.length>60000000)throw Error('Sheet terlalu besar');const d=xml(raw);
   const rows=Array.from(d.getElementsByTagName('row')).map(row=>({row:Number(row.getAttribute('r')),cells:Object.fromEntries(Array.from(row.getElementsByTagName('c')).map(c=>{const name=(c.getAttribute('r')||'').replace(/\d/g,'');const v=c.getElementsByTagName('v')[0]?.textContent||'';return [name,c.getAttribute('t')==='s'?strings[Number(v)]||'':c.getAttribute('t')==='inlineStr'?Array.from(c.getElementsByTagName('t')).map(x=>x.textContent||'').join(''):v];}))}));
   sheets.push({name:f.name,rows});
  }
 };
 if(files.length>10||files.some(f=>f.size>40000000))throw Error('Maksimum 10 fail, 40MB setiap fail');
 for(const file of files)await read(await file.arrayBuffer());return normalizeExports(sheets);
}
