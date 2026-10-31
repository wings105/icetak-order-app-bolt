import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {normalize,stable} from '../shopee-finance-ingest/normalize.ts';
import {prepareReleaseCursor,finishReleaseCursor} from './release-cursor.ts';
const U=Deno.env.get('SUPABASE_URL')||'',K=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const out=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
async function db(path:string,body?:unknown){
 const r=await fetch(`${U}/rest/v1/${path}`,{method:body===undefined?'GET':'POST',headers:{apikey:K,authorization:`Bearer ${K}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 const d=await r.json().catch(()=>null);if(!r.ok)throw new Error(`DATABASE_${r.status}`);return d;
}
async function hash(s:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
Deno.serve(async req=>{
 if(req.method==='GET')return out({ok:true,service:'shopee-financial-enrich',mode:'order_lifecycle_v2'});
 if(req.method!=='POST')return out({ok:false,error:'POST_REQUIRED'},405);
 const service=!!K&&req.headers.get('authorization')===`Bearer ${K}`;
 if(!K||(!service&&!req.headers.get('x-admin-window-token')))return out({ok:false,error:'SERVICE_REQUIRED'},401);
 let readCount=0,applied=0;
 try{
  const settings=await db('private_runtime_settings?setting_key=eq.admin_window_bridge_token&select=setting_value&limit=1');
  const token=settings?.[0]?.setting_value;
  if(!token||(!service&&await hash(req.headers.get('x-admin-window-token')||'')!==await hash(token)))return out({ok:false,error:'UNAUTHORIZED'},401);
  const b=await req.json().catch(()=>({}));const maintenance=b.mode==='maintenance';
  async function read(body:unknown){
   readCount++;const r=await fetch('https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/shopee-finance-fetch',{method:'POST',headers:{'content-type':'application/json','x-admin-window-token':token},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
   const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(String(d.error||`FINANCE_HTTP_${r.status}`).replace(/[^A-Za-z0-9_.-]/g,'').slice(0,100));return d.response;
  }
  async function ingest(rows:any[]){
   const events=await Promise.all(rows.slice(0,100).map(async row=>{const e=normalize(row);return {...e,payload_hash:await hash(stable(e))};}));
   if(!events.length)return {applied:0};
   const result=await db('rpc/ingest_shopee_finance',{p_events:events,p_dry_run:false});applied+=Number(result.applied||0);
   if(result.needs_mapping||result.pending_order)throw new Error('FINANCE_NOT_APPLIED');return result;
  }
  if(!maintenance){
   // Claim only the work this invocation can finish. NULL/missing financial rows
   // are incomplete; no optional-chain `undefined !== null` shortcut is allowed.
   await db('rpc/reconcile_marketplace_finance_jobs',{p_limit:200});
   const jobs=await db('rpc/claim_marketplace_finance_jobs',{p_limit:Math.min(3,Math.max(1,Number(b.limit)||3))});
   const results=await Promise.all((jobs||[]).map(async(job:any)=>{
    try{
     const response=await read({action:'escrow',shop_id:job.shop_id,order_sn:job.order_sn});
     if(response.order_sn&&String(response.order_sn)!==job.order_sn)throw new Error('PROVIDER_ORDER_MISMATCH');
     await ingest([{...response,order_sn:job.order_sn,shop_id:job.shop_id,currency:job.currency,source:'direct_shopee_escrow'}]);
     const result=await db('rpc/finish_marketplace_finance_job',{p_job_id:job.job_id,p_lease_id:job.lease_id,p_error:null});
     return {job_id:job.job_id,...result};
    }catch(e){
     const error=e instanceof Error?e.message:'ESCROW_READ_FAILED';
     const result=await db('rpc/finish_marketplace_finance_job',{p_job_id:job.job_id,p_lease_id:job.lease_id,p_error:error});
     return {job_id:job.job_id,...result,error};
    }
   }));
   return out({ok:true,mode:'orders',provider_reads:readCount,applied,results});
  }
  // Release history and refund reads run separately from new-order enrichment.
  // One due shop + one return per invocation keeps even slow API reads bounded.
  if(!await db('rpc/claim_marketplace_finance_maintenance',{}))return out({ok:true,busy:true});
  let lastError:string|null=null;
  try{
   const shops=b.shop_id?[String(b.shop_id)]:((await db('rpc/marketplace_operations',{p_action:'snapshot',p_filter:{},p_actor:null})).shops||[]).map((x:any)=>x.shop_id);
   const cursors=await Promise.all(shops.slice(0,5).map((shop:string)=>db('rpc/marketplace_finance_runtime',{p_action:'cursor',p_body:{shop_id:shop}})));
   const saved=cursors.filter((c:any)=>Date.parse(c.next_at)<=Date.now()).sort((a:any,b:any)=>Date.parse(a.next_at)-Date.parse(b.next_at))[0];
   const tasks:Promise<unknown>[]=[];
   if(saved)tasks.push((async()=>{
    const readAt=Date.now(),cursor=prepareReleaseCursor(saved,readAt);let next={...cursor};
    try{
     const response=await read({action:'releases',shop_id:saved.shop_id,from:Math.floor(Date.parse(cursor.from_at)/1000),to:Math.floor(Date.parse(cursor.to_at)/1000),page:cursor.page});
     const list=Array.isArray(response.escrow_list)?response.escrow_list:[];
     // A released timestamp + amount is evidence of wallet release. COMPLETED
     // or a fresh get_escrow_detail response alone never marks money received.
     const rows=list.filter((x:any)=>x.order_sn&&Number(x.escrow_release_time)>0&&(x.payout_amount!==undefined||x.escrow_amount!==undefined||x.released_amount!==undefined)).map((x:any)=>({order_sn:x.order_sn,shop_id:saved.shop_id,released_amount:x.payout_amount??x.released_amount??x.escrow_amount,released_at:x.escrow_release_time,settlement_status:'released',release_evidence:'shopee_get_escrow_list',provider_response:x}));
     // Unmatched historical releases are retained as pending_order by ingestion.
     if(rows.length){const events=await Promise.all(rows.map(async(row:any)=>{const e=normalize(row);return {...e,payload_hash:await hash(stable(e))};}));const result=await db('rpc/ingest_shopee_finance',{p_events:events,p_dry_run:false});applied+=Number(result.applied||0);if(result.needs_mapping)throw new Error('RELEASE_MAPPING_REQUIRED');}
     next=finishReleaseCursor(cursor,response,list.length,readAt);
    }catch(e){next.error=e instanceof Error?e.message:'RELEASE_READ_FAILED';next.next_at=new Date(Date.now()+900000).toISOString();lastError=next.error;}
    await db('rpc/marketplace_finance_runtime',{p_action:'cursor_save',p_body:{shop_id:saved.shop_id,...next}});
   })());
   const returns=await db('rpc/marketplace_returns_pending',{p_limit:1});
   for(const row of returns||[])tasks.push((async()=>{try{
    // Return decisions and money move independently. Re-read both, even after a
    // previous detail was saved; concurrent bounded reads fit the existing lease.
    const [response,escrow]=await Promise.all([
     read({action:'return',shop_id:row.shop_id,return_sn:row.return_sn}),
     read({action:'escrow',shop_id:row.shop_id,order_sn:row.order_sn})
    ]);
    if(response.return_sn!==row.return_sn||response.order_sn!==row.order_sn||escrow.order_sn!==row.order_sn||response.currency!==row.currency)throw new Error('RETURN_IDENTITY_MISMATCH');
    const event=normalize({...escrow,order_sn:row.order_sn,shop_id:row.shop_id,currency:row.currency,source:'direct_shopee_return_escrow'});
    const result=await db('rpc/marketplace_finance_runtime',{p_action:'return_detail',p_body:{shop_id:row.shop_id,return_sn:row.return_sn,return_solution:response.return_solution,reason:response.reason,refund_amount:response.refund_amount,detail:response,finance_events:[{...event,payload_hash:await hash(stable(event))}]}});
    if(!result.saved||!result.finance_refreshed)throw new Error('RETURN_FINANCE_NOT_APPLIED');
    applied++;
   }catch(e){lastError=e instanceof Error?e.message:'RETURN_READ_FAILED';await db('rpc/marketplace_return_read_failed',{p_return_sn:row.return_sn,p_error:lastError});}})());
   await Promise.all(tasks);
  }finally{await db('rpc/finish_marketplace_finance_maintenance',{p_error:lastError});}
  return out({ok:true,mode:'maintenance',provider_reads:readCount,applied,last_error:lastError});
 }catch(e){return out({ok:false,error:e instanceof Error?e.message:'FINANCE_WORKER_FAILED'},503);}
});
