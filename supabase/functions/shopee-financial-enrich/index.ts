import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {normalize,stable} from '../shopee-finance-ingest/normalize.ts';
const U=Deno.env.get('SUPABASE_URL')||'',K=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const out=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
async function db(path:string,body?:unknown){const r=await fetch(`${U}/rest/v1/${path}`,{method:body===undefined?'GET':'POST',headers:{apikey:K,authorization:`Bearer ${K}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const d=await r.json().catch(()=>null);if(!r.ok)throw new Error(`DATABASE_${r.status}`);return d;}
async function hash(s:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
Deno.serve(async req=>{
 if(req.method==='GET')return out({ok:true,service:'shopee-financial-enrich',mode:'direct_shopee'});
 if(req.method!=='POST')return out({ok:false,error:'POST_REQUIRED'},405);
 if(!K||req.headers.get('authorization')!==`Bearer ${K}`)return out({ok:false,error:'SERVICE_REQUIRED'},401);
 let readCount=0,applied=0,lastError:string|null=null;
 try{
  const b=await req.json().catch(()=>({}));if(!b.claimed&&!await db('rpc/claim_marketplace_finance_run',{}))return out({ok:true,busy:true});const settings=await db('private_runtime_settings?setting_key=eq.admin_window_bridge_token&select=setting_value&limit=1');const token=settings?.[0]?.setting_value;
  if(!token)throw new Error('BRIDGE_NOT_CONFIGURED');
  async function read(body:unknown){readCount++;const r=await fetch('https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/shopee-finance-fetch',{method:'POST',headers:{'content-type':'application/json','x-admin-window-token':token},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(String(d.error||`FINANCE_HTTP_${r.status}`));return d.response;}
  async function ingest(rows:any[]){const events=await Promise.all(rows.slice(0,100).map(async row=>{const e=normalize(row);return {...e,payload_hash:await hash(stable(e))};}));if(events.length){const result=await db('rpc/ingest_shopee_finance',{p_events:events,p_dry_run:false});applied+=Number(result.applied||0);return result;}}
  const shops=b.shop_id?[String(b.shop_id)]:((await db('rpc/marketplace_operations',{p_action:'snapshot',p_filter:{},p_actor:null})).shops||[]).map((x:any)=>x.shop_id);
  for(const shop of shops.slice(0,5)){
   const cursor=await db('rpc/marketplace_finance_runtime',{p_action:'cursor',p_body:{shop_id:shop}});if(Date.parse(cursor.next_at)>Date.now())continue;
   let next={...cursor};
   try{
    const response=await read({action:'releases',shop_id:shop,from:Math.floor(Date.parse(cursor.from_at)/1000),to:Math.floor(Date.parse(cursor.to_at)/1000),page:cursor.page});
    const list=Array.isArray(response.escrow_list)?response.escrow_list:[];
    await ingest(list.filter((x:any)=>x.order_sn&&Number(x.escrow_release_time)>0&&(x.payout_amount!==undefined||x.escrow_amount!==undefined||x.released_amount!==undefined)).map((x:any)=>({order_sn:x.order_sn,shop_id:shop,released_amount:x.payout_amount??x.released_amount??x.escrow_amount,released_at:x.escrow_release_time,settlement_status:'released',release_evidence:'shopee_get_escrow_list',provider_response:x})));
    if(response.more||response.has_more||list.length===100)next.page=Number(cursor.page)+1;
    else if(Date.parse(cursor.to_at)<Date.now()-60000){next.from_at=cursor.to_at;next.to_at=new Date(Math.min(Date.parse(cursor.to_at)+604800000,Date.now())).toISOString();next.page=1;}
    else {next.from_at=new Date(Date.now()-604800000).toISOString();next.to_at=new Date().toISOString();next.page=1;next.next_at=new Date(Date.now()+21600000).toISOString();}
    next.error=null;
   }catch(e){next.error=e instanceof Error?e.message:'RELEASE_READ_FAILED';next.next_at=new Date(Date.now()+21600000).toISOString();lastError=next.error;}
   await db('rpc/marketplace_finance_runtime',{p_action:'cursor_save',p_body:{shop_id:shop,...next}});
  }
  const jobs=await db('rpc/claim_marketplace_enrichment_jobs',{p_limit:Math.min(20,Math.max(1,Number(b.limit)||10))});
  for(const job of jobs||[]){
   try{
    const f=await db(`marketplace_order_financials?order_id=eq.${job.order_id}&select=released_amount,settlement_status,last_enriched_at,escrow_amount,commission_fee,service_fee,transaction_fee&limit=1`);
    if(job.job_type==='financial_release'&&f?.[0]?.settlement_status==='released'&&f[0].released_amount!==null){await db('rpc/marketplace_finance_runtime',{p_action:'complete_job',p_body:{job_id:job.job_id}});continue;}
    if(job.job_type==='financial_detail'&&f?.[0]?.escrow_amount!==null&&f?.[0]?.commission_fee!==null&&f?.[0]?.service_fee!==null&&f?.[0]?.transaction_fee!==null){await db('rpc/marketplace_finance_runtime',{p_action:'complete_detail',p_body:{job_id:job.job_id}});continue;}
    const response=await read({action:'escrow',shop_id:job.shop_id,order_sn:job.order_sn});
    await ingest([{...response,order_sn:job.order_sn,shop_id:job.shop_id,currency:job.currency,source:'direct_shopee_escrow'}]);
    await db('rpc/marketplace_finance_runtime',{p_action:job.job_type==='financial_detail'?'complete_detail':'defer_job',p_body:{job_id:job.job_id,error:'AWAITING_CONFIRMED_RELEASE',escrow_checked:true}});
   }catch(e){const error=e instanceof Error?e.message:'ESCROW_READ_FAILED';lastError=error;await db('rpc/marketplace_finance_runtime',{p_action:'defer_job',p_body:{job_id:job.job_id,error,blocked:/CREDENTIALS|TOKEN|SHOP_|permission|error_auth|error_sign|scope|invalid_access/i.test(error)}});}
  }
  // Return detail reads are bounded and do not approve/refund a return.
  const returns=await db('rpc/marketplace_returns_pending',{p_limit:3});
  for(const row of returns||[]){try{const response=await read({action:'return',shop_id:row.shop_id,return_sn:row.return_sn});await db('rpc/marketplace_finance_runtime',{p_action:'return_detail',p_body:{shop_id:row.shop_id,return_sn:row.return_sn,return_solution:response.return_solution,reason:response.reason,refund_amount:response.refund_amount,detail:response}});}catch(e){await db('rpc/marketplace_return_read_failed',{p_return_sn:row.return_sn,p_error:e instanceof Error?e.message:'RETURN_READ_FAILED'});}}
  await db('rpc/marketplace_finance_runtime',{p_action:'state',p_body:{error:lastError}});
  return out({ok:true,mode:'direct_shopee',provider_reads:readCount,applied,last_error:lastError});
 }catch(e){lastError=e instanceof Error?e.message:'FINANCE_WORKER_FAILED';await db('rpc/marketplace_finance_runtime',{p_action:'state',p_body:{error:lastError}}).catch(()=>undefined);return out({ok:false,error:lastError},503);}
});
