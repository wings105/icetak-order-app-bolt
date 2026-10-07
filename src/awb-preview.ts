import './awb-preview.css';
import {printAwbPdf} from './awb-pdf-print';
type Item={task_id:string;title:string;customize_name?:string;awb_url?:string;set:number|null;images:{url:string;name:string}[]};
type Preview={order_id:string;items:Item[];updated_at:string};
const root=document.getElementById('app')!;
const orderId=(new URLSearchParams(location.search).get('awbpreview')||'').trim();
const env=(import.meta as any).env||{};
const base=env.VITE_SUPABASE_URL||'https://buivecgahhmrhlmfujgt.supabase.co';
let generation=0;
let printingAwb=false;
let copyFeedbackTimer:ReturnType<typeof setTimeout>;
document.body.classList.add('awb-preview-page');
document.title=`Reference Order ${orderId}`;
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function toolbar(message:string){
 root.innerHTML=`<div class="awb-toolbar"><div><strong>Reference Order · ${escape(orderId)}</strong><small>A4 · 4 × 4 · 16 task setiap halaman</small><small id="awb-status" role="status">${escape(message)}</small><small id="awb-link-status">Memuat AWB…</small></div><div class="awb-actions"><button id="awb-refresh" type="button">Refresh</button><span id="awb-links"></span><button id="awb-print" type="button" disabled>Print / Save PDF</button></div></div><div class="awb-copy-feedback" role="status" aria-live="polite" hidden></div><div id="awb-content"></div>`;
 root.querySelector('#awb-refresh')!.addEventListener('click',()=>void load());
 root.querySelector('#awb-print')!.addEventListener('click',()=>window.print());
}
const copyNameIcon='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M15 5V3H3v12h2"/></svg>';
async function copyTaskName(title:string,button:HTMLButtonElement){
 if(button.disabled)return;
 button.disabled=true;
 let message='Disalin ✓';
 try{
  if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');
  await navigator.clipboard.writeText(title);
 }catch{message='Copy gagal. Cuba semula atau salin nama secara manual.';}
 finally{button.disabled=false;}
 if(!button.isConnected)return;
 const feedback=root.querySelector<HTMLElement>('.awb-copy-feedback')!;
 clearTimeout(copyFeedbackTimer);feedback.textContent=message;feedback.hidden=false;
 copyFeedbackTimer=setTimeout(()=>{feedback.hidden=true;},2200);
}
function safeImageUrl(url:string){try{const u=new URL(url);return u.protocol==='https:'&&(u.hostname.endsWith('.clickup-attachments.com')||u.hostname==='attachments.clickup.com')?u.href:''}catch{return ''}}
function renderAwbLinks(items:Item[]){
 const unique=new Map<string,Item>();
 for(const item of items){try{const u=new URL(item.awb_url||'');if(u.protocol==='https:'&&!u.username&&!u.password&&!unique.has(u.href))unique.set(u.href,item);}catch{}}
 const awbs=Array.from(unique.values());
 root.querySelector('#awb-links')!.innerHTML=awbs.map((_,i)=>`<button class="awb-link" data-awb-index="${i}" type="button">Print AWB${awbs.length>1?` ${i+1}`:''}</button>`).join('');
 root.querySelector('#awb-link-status')!.textContent=awbs.length?'Print AWB: terus buka popup print untuk AWB.':'AWB link belum tersedia dalam task.';
 for(const button of root.querySelectorAll<HTMLButtonElement>('[data-awb-index]'))button.addEventListener('click',()=>void printAwb(awbs[Number(button.dataset.awbIndex)],button));
}
async function printAwb(item:Item,button:HTMLButtonElement){
 if(printingAwb)return;printingAwb=true;
 const current=generation,label=button.textContent;
 const controls=Array.from(root.querySelectorAll<HTMLButtonElement>('[data-awb-index],#awb-refresh'));
 controls.forEach(control=>control.disabled=true);button.textContent='Memuat AWB…';
 const status=root.querySelector<HTMLElement>('#awb-link-status')!;status.textContent='Memuat PDF AWB untuk cetak…';
 try{await printAwbPdf(base,orderId,item.task_id);if(current===generation)status.textContent='Popup print AWB dibuka.';}
 catch(error){if(current===generation){status.textContent=error instanceof Error?error.message:'Print AWB gagal. Cuba semula.';const link=document.createElement('a');link.href=item.awb_url!;link.target='_blank';link.rel='noopener noreferrer';link.textContent=' Buka PDF';status.append(link);}}
 finally{printingAwb=false;if(current===generation){controls.forEach(control=>control.disabled=false);button.textContent=label;}}
}
async function load(){
 const current=++generation; toolbar('Memuat preview…');
 const content=root.querySelector<HTMLElement>('#awb-content')!;
 try{
  const response=await fetch(`${base}/functions/v1/awb-preview?order_id=${encodeURIComponent(orderId)}&v=${Date.now()}`,{cache:'no-store',signal:AbortSignal.timeout(20000)});
  const data:Preview & {error?:string}=await response.json();
  if(current!==generation)return;
  if(!response.ok)throw new Error(data.error||'Preview gagal dimuat.');
  if(!Array.isArray(data.items)||!data.items.length)throw new Error('Tiada item untuk order ini.');
  renderAwbLinks(data.items);
  const pages:string[]=[];
  for(let offset=0;offset<data.items.length;offset+=16){
   pages.push(`<main class="awb-sheet" aria-label="Halaman ${pages.length+1}">${data.items.slice(offset,offset+16).map((item,index)=>{
    const images=item.images.map(image=>({...image,url:safeImageUrl(image.url)})).filter(image=>image.url);
    return `<section class="awb-item"><div class="awb-item-heading"><h1><button class="awb-copy-name" type="button" data-copy-index="${offset+index}" aria-label="Copy task name" title="Copy task name">${copyNameIcon}</button>${escape(item.title)}</h1>${item.customize_name?.trim()?`<p class="awb-customize-name">${escape(item.customize_name)}</p>`:''}</div><div class="awb-images ${images.length>1?'awb-multiple':''}" style="--image-rows:${Math.ceil(images.length/2)}">${images.length?images.map(image=>`<div class="awb-image-slot"><img src="${escape(image.url)}" alt="${escape(item.title)}" loading="eager"><span class="awb-image-failure" hidden>Gambar gagal dimuat.<br>Tekan Refresh.</span></div>`).join(''):'<span class="awb-missing">Preview belum ada</span>'}</div></section>`;
   }).join('')}</main>`);
  }
  content.innerHTML=pages.join('');
  for(const button of content.querySelectorAll<HTMLButtonElement>('[data-copy-index]'))button.addEventListener('click',()=>void copyTaskName(data.items[Number(button.dataset.copyIndex)].title,button));
  const images=Array.from(content.querySelectorAll<HTMLImageElement>('img'));
  const statuses=await Promise.all(images.map(img=>new Promise<boolean>(resolve=>{
   let timer:ReturnType<typeof setTimeout>;
   const done=(ok:boolean)=>{clearTimeout(timer);img.onload=null;img.onerror=null;if(!ok){img.hidden=true;(img.nextElementSibling as HTMLElement).hidden=false;}resolve(ok)};
   img.onload=()=>done(true);img.onerror=()=>done(false);
   timer=setTimeout(()=>done(false),30000);
   if(img.complete)done(img.naturalWidth>0);
  })));
  if(current!==generation)return;
  const failed=statuses.filter(ok=>!ok).length;
  const ready=data.items.filter(item=>item.images.length).length;
  root.querySelector('#awb-status')!.textContent=`${ready}/${data.items.length} item ada preview${failed?` · ${failed} gambar gagal dimuat`:''}`;
  (root.querySelector('#awb-print') as HTMLButtonElement).disabled=failed>0||ready===0;
 }catch(error){
  if(current!==generation)return;
  root.querySelector('#awb-status')!.textContent='Preview belum tersedia';
  root.querySelector('#awb-link-status')!.textContent='';
  content.innerHTML=`<div class="awb-message" role="alert">${escape(error instanceof Error?error.message:'Preview gagal dimuat. Cuba Refresh.')}</div>`;
 }
}
void load();
