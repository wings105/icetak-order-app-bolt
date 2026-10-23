import {printAwbPdf} from '../../../src/awb-pdf-print';
import referenceCss from '../../../src/awb-preview.css?inline';
type ReferenceItem={task_id:string;title:string;customize_name?:string;images:{url:string;name:string}[];awb_url?:string};
const escape=(v:string)=>String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const safeImage=(v:string)=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&(u.hostname==='attachments.clickup.com'||u.hostname.endsWith('.clickup-attachments.com'))?u.href:'';}catch{return '';}};
let active:HTMLIFrameElement|null=null;
const base=()=>((import.meta as any).env?.VITE_SUPABASE_URL||'https://buivecgahhmrhlmfujgt.supabase.co');
async function reference(orderId:string){
 const r=await fetch(`${base()}/functions/v1/awb-preview?${new URLSearchParams({order_id:orderId,v:String(Date.now())})}`,{cache:'no-store',signal:AbortSignal.timeout(25000)});
 const data=await r.json();if(!r.ok||!Array.isArray(data.items)||!data.items.length)throw Error(data.error||'Reference order belum tersedia.');
 return data.items as ReferenceItem[];
}
export async function printPanelAwb(orderId:string,selectedTask:string){
 const items=await reference(orderId),awbs=[...new Map(items.filter(i=>i.awb_url).map(i=>[i.awb_url,i])).values()];
 if(!awbs.length)throw Error('AWB link belum tersedia untuk order ini.');
 const selected=awbs.find(i=>i.task_id===selectedTask)||awbs[0];
 // One popup per unique AWB; shared task links never create duplicate prints.
 await printAwbPdf(base(),orderId,selected.task_id);
 return awbs.filter(i=>i.task_id!==selected.task_id);
}
export async function printOtherAwb(orderId:string,taskId:string){await printAwbPdf(base(),orderId,taskId);}
export async function printPanelReference(orderId:string){
 const items=await reference(orderId),pages:string[]=[];
 for(let offset=0;offset<items.length;offset+=16)pages.push(`<main class="awb-sheet">${items.slice(offset,offset+16).map(item=>{
  const images=item.images.map(i=>({...i,url:safeImage(i.url)})).filter(i=>i.url);
  return `<section class="awb-item"><div class="awb-item-heading"><h1>${escape(item.title)}</h1>${item.customize_name?.trim()?`<p class="awb-customize-name">${escape(item.customize_name)}</p>`:''}</div><div class="awb-images ${images.length>1?'awb-multiple':''}" style="--image-rows:${Math.ceil(images.length/2)}">${images.length?images.map(i=>`<div class="awb-image-slot"><img src="${escape(i.url)}" alt="${escape(item.title)}"></div>`).join(''):'<span class="awb-missing">Preview belum ada</span>'}</div></section>`;
 }).join('')}</main>`);
 if(!items.some(i=>i.images.some(img=>safeImage(img.url))))throw Error('Belum ada gambar untuk reference order ini.');
 active?.remove();const frame=document.createElement('iframe');active=frame;frame.title='Print Reference Order '+orderId;frame.setAttribute('aria-hidden','true');frame.style.cssText='position:fixed;left:-10000px;top:0;width:1000px;height:1200px;border:0';
 try{
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Reference order mengambil masa terlalu lama.')),30000);frame.onload=()=>{clearTimeout(timer);resolve();};frame.onerror=()=>{clearTimeout(timer);reject(Error('Reference order gagal dibuka.'));};frame.srcdoc=`<!doctype html><html><head><meta charset="utf-8"><title>Reference Order ${escape(orderId)}</title><style>${referenceCss}</style></head><body class="awb-preview-page"><div id="app">${pages.join('')}</div></body></html>`;document.body.append(frame);});
  const doc=frame.contentDocument,win=frame.contentWindow;if(!doc||!win)throw Error('Browser tidak dapat membuka reference order.');
  const results=await Promise.all(Array.from(doc.images).map(img=>new Promise<boolean>(resolve=>{if(img.complete)return resolve(img.naturalWidth>0);const timer=setTimeout(()=>resolve(false),15000);img.onload=()=>{clearTimeout(timer);resolve(true);};img.onerror=()=>{clearTimeout(timer);resolve(false);};})));
  if(results.some(ok=>!ok))throw Error('Ada gambar gagal dimuat. Cuba Print Reference Order semula.');
  win.addEventListener('afterprint',()=>{frame.remove();if(active===frame)active=null;},{once:true});win.focus();win.print();
 }catch(e){frame.remove();if(active===frame)active=null;throw e;}
}
