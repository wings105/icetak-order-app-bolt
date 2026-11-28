import './awb-preview.css';
import './awb-bulk.css';
import {prepareCombined} from './awb-combined-print';

const base='https://buivecgahhmrhlmfujgt.supabase.co';
const publicKey='sb_publishable_0ObnGfl4fOoi10FcBb3g-A_h4nvwkyd';
const key=location.hash.slice(1)||localStorage.getItem('awb-office-key')||'';
type QueueOrder={order_reference:string;task_ids:string[]};
type Item={task_id:string;awb_url:string;title:string;customize_name:string;images:{url:string}[]};
type Order={row:QueueOrder;box:HTMLInputElement;status:HTMLElement;sheets:HTMLElement[];requests:Map<string,string>;done:Set<string>;ready:boolean};
const orders:Order[]=[];
let batch:Set<Order>|undefined;
let busy=true;
const root=document.querySelector<HTMLElement>('#app')!;
document.body.classList.add('awb-preview-page','awb-bulk');
document.title='Bulk Print AWB · iCetak';
root.innerHTML='<header class="batch-bar"><h1>Bulk Print AWB</h1><button id="refresh">Muat semula</button><button id="print" disabled>Print</button><button id="complete" disabled>Complete batch</button><p role="status"></p></header><section id="orders"></section><div id="pages"></div>';
const btn=(id:string)=>root.querySelector<HTMLButtonElement>('#'+id)!;
const message=root.querySelector('p')!;
function update(){
 const selected=orders.filter(o=>o.ready&&o.box.checked);
 for(const o of orders){
  o.box.disabled=busy||!o.ready||Boolean(batch&&!batch.has(o));
  for(const page of o.sheets)page.hidden=!o.box.checked;
 }
 btn('print').disabled=busy||!selected.length;
 btn('print').textContent='Print '+selected.reduce((n,o)=>n+o.sheets.length,0)+' muka A4';
 btn('complete').disabled=busy||!batch||!selected.length;
 btn('complete').textContent='Complete '+(batch?selected.length:0)+' order';
 btn('refresh').disabled=busy;
}
async function json(url:string,options:RequestInit={}){
 const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(70000),...options});
 const data=await r.json();
 if(!r.ok||data.ok===false)throw Error(data.error||data.message||'Permintaan gagal.');
 return data;
}
function queue():Promise<QueueOrder[]>{
 return json(base+'/rest/v1/rpc/awb_office_queue',{method:'POST',headers:{apikey:publicKey,'Content-Type':'application/json'},body:JSON.stringify({p_key:key})});
}
const preview=(ref:string)=>json(base+'/functions/v1/awb-preview?order_id='+encodeURIComponent(ref));
function element(tag:string,cls:string,value=''){const e=document.createElement(tag);e.className=cls;e.textContent=value;return e;}
function card(item:Item){
 const node=element('section','awb-item'),heading=element('div','awb-item-heading'),images=element('div','awb-images');
 heading.append(element('h1','',item.title));
 if(item.customize_name)heading.append(element('p','awb-customize-name',item.customize_name));
 if(!item.images.length)throw Error('Gambar reference belum tersedia.');
 if(item.images.length>1){images.classList.add('awb-multiple');images.style.setProperty('--image-rows',String(Math.ceil(item.images.length/2)));}
 for(const image of item.images){
  const u=new URL(image.url);
  if(u.protocol!=='https:'||!(u.hostname.endsWith('.clickup-attachments.com')||u.hostname==='attachments.clickup.com'))throw Error('Pautan gambar tidak sah.');
  const img=document.createElement('img');img.src=u.href;const slot=element('div','awb-image-slot');slot.append(img);images.append(slot);
 }
 node.append(heading,images);return node;
}
async function prepare(row:QueueOrder){
 const box=document.createElement('input');box.type='checkbox';box.disabled=true;
 const status=element('span','', 'Memuat…'),label=element('label','');
 label.append(box,document.createTextNode(row.order_reference||'Order ID kosong'),status);root.querySelector('#orders')!.append(label);
 const o:Order={row,box,status,sheets:[],requests:new Map(),done:new Set(),ready:false};orders.push(o);
 box.onchange=update;
 try{
  const data=await preview(row.order_reference);
  const items:Item[]=data.items.filter((i:Item)=>row.task_ids.includes(i.task_id));
  if(items.length!==row.task_ids.length)throw Error('Reference task belum lengkap.');
  const labels=new Map<string,Item[]>();
  for(const item of items)if(item.awb_url&&!labels.has(item.awb_url))labels.set(item.awb_url,[]);
  if(!labels.size)throw Error('AWB belum tersedia.');
  for(const item of items){
   const group=labels.get(item.awb_url)||(labels.size===1?[...labels.values()][0]:null);
   if(!group)throw Error('Task belum dipadankan dengan AWB.');group.push(item);
  }
  for(const [url,group] of labels){
   const owner=group.find(i=>i.awb_url===url)!;
   const page=await prepareCombined(base,row.order_reference,owner.task_id,group.map(card));
   root.querySelector('#pages')!.append(page);o.sheets.push(page);
  }
  o.ready=true;box.checked=true;status.textContent=o.sheets.length+' muka A4';
 }catch(e){for(const page of o.sheets)page.remove();o.sheets=[];status.textContent=(e as Error).message;}
}
btn('print').onclick=()=>{
 const selected=orders.filter(o=>o.ready&&o.box.checked);
 if(!selected.length)return;
 window.print();batch=new Set(selected);message.textContent='Semak kertas. Untick order yang perlu dicetak semula sebelum Complete.';update();
};
btn('complete').onclick=async()=>{
 if(!batch||busy)return;
 busy=true;update();
 try{
  const latest=await queue();
  for(const o of batch){
   if(!o.box.checked||!o.ready)continue;
   try{
    const active=latest.find(r=>r.order_reference===o.row.order_reference);
    const pending=o.row.task_ids.filter(id=>!o.done.has(id));
    if(!active||pending.some(id=>!active.task_ids.includes(id)))throw Error('Status task sudah berubah. Semak semula order.');
    const data=await preview(o.row.order_reference);
    if(!data.actions?.token)throw Error('Tindakan ClickUp belum tersedia.');
    for(const id of pending){
     if(!o.requests.has(id))o.requests.set(id,crypto.randomUUID());
     await json(base+'/functions/v1/awb-preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({order_id:o.row.order_reference,buton:3,task_id_clickup:id,request_id:o.requests.get(id),action_token:data.actions.token})});
     o.done.add(id);
    }
    o.status.textContent='Complete ✓';o.ready=false;o.box.checked=false;
   }catch(e){o.status.textContent=o.done.size+'/'+o.row.task_ids.length+' complete · '+(e as Error).message;}
  }
  message.textContent='Semakan batch selesai. Muat semula untuk batch seterusnya.';
 }catch(e){message.textContent=(e as Error).message;}finally{busy=false;update();}
};
btn('refresh').onclick=()=>location.reload();
async function init(){
 try{
  if(!key)throw Error('Buka pautan khas PC pejabat untuk akses kali pertama.');
  const rows=await queue();
  localStorage.setItem('awb-office-key',key);
  if(location.hash)history.replaceState(null,'',location.pathname+location.search);
  message.textContent='Menyediakan preview untuk '+rows.length+' order…';
  let next=0;await Promise.all(Array.from({length:Math.min(3,rows.length)},async()=>{while(next<rows.length)await prepare(rows[next++]);}));
  message.textContent=rows.length?orders.filter(o=>o.ready).length+' daripada '+rows.length+' order sedia. Untick order untuk keluarkan daripada cetakan.':'Belum ada order dalam status Print Alamat.';
 }catch(e){message.textContent=(e as Error).message;}finally{busy=false;update();}
}
void init();
