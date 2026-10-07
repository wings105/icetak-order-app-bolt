export type ActionAvailability={enabled:boolean;token:string|null};
type Delivery={id:string;state:'ready'|'sent'|'retry'|'unknown'|'blocked';error?:string};
// One stable request ID per task/action, including retries after lost responses.
export function bindTaskActions(root:HTMLElement,base:string,orderId:string,taskIds:string[],availability:ActionAvailability|undefined,onBusy:(busy:boolean)=>void){
 const buttons=Array.from(root.querySelectorAll<HTMLButtonElement>('[data-task-action]'));
 const receipts=new Map<string,Delivery>();let busy=false,externallyBusy=false;
 const enabled=Boolean(availability?.enabled&&availability.token);
 const headerStatus=root.querySelector<HTMLElement>('#awb-action-status')!;
 headerStatus.textContent=enabled?'': 'Webhook belum diset. Isi URL di Settings Admin V2.';
 const targets=(button:HTMLButtonElement)=>button.dataset.taskIndex===undefined?[...new Set(taskIds)]:[taskIds[Number(button.dataset.taskIndex)]];
 const receipt=(task:string,buton:number)=>{const key=`${buton}:${task}`;if(!receipts.has(key))receipts.set(key,{id:crypto.randomUUID(),state:'ready'});return receipts.get(key)!;};
 function update(){for(const button of buttons){const rows=targets(button).map(task=>receipt(task,Number(button.dataset.taskAction)));button.disabled=!enabled||busy||externallyBusy||!rows.some(row=>row.state==='ready'||row.state==='retry');}}
 for(const button of buttons)button.addEventListener('click',async()=>{
  if(button.disabled||busy)return;
  const buton=Number(button.dataset.taskAction),tasks=targets(button);
  const status=button.dataset.taskIndex===undefined?headerStatus:button.parentElement!.querySelector<HTMLElement>('[role="status"]')!;
  const label=button.innerHTML;busy=true;onBusy(true);update();button.textContent='Menghantar…';status.textContent='Menghantar ke webhook…';
  try{
   // Bounded fan-out for large orders. Each outgoing webhook still represents one task.
   const pending=tasks.filter(task=>['ready','retry'].includes(receipt(task,buton).state));
   let next=0;
   await Promise.all(Array.from({length:Math.min(3,pending.length)},async()=>{
    while(next<pending.length){
     const task=pending[next++],row=receipt(task,buton);
     try{
      const response=await fetch(`${base}/functions/v1/awb-preview`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({order_id:orderId,buton,task_id_clickup:task,request_id:row.id,action_token:availability!.token}),signal:AbortSignal.timeout(25000)});
      const data=await response.json();
      if(response.ok&&data.ok){row.state='sent';row.error=undefined;}
      else{row.state=data.uncertain?'unknown':data.retryable||response.status>=500?'retry':'blocked';row.error=data.error||'Penghantaran gagal.';}
     }catch{row.state='retry';row.error='Sambungan gagal. Tekan butang untuk cuba semula.';}
    }
   }));
   const rows=tasks.map(task=>receipt(task,buton)),sent=rows.filter(row=>row.state==='sent').length;
   const errors=[...new Set(rows.filter(row=>row.state!=='sent').map(row=>row.error))].join(' ');
   status.textContent=`${sent}/${tasks.length} dihantar${sent===tasks.length?' ✓':''}${errors?` · ${errors}`:''}`;
  }finally{busy=false;button.innerHTML=label;onBusy(false);update();}
 });
 update();return {setBusy(value:boolean){externallyBusy=value;update();}};
}
