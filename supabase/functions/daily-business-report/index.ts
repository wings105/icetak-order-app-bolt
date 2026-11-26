import { sendAdminWhatsApp } from '../_shared/admin-whatsapp.ts';
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
const url=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const headers={'content-type':'application/json',apikey:key,authorization:`Bearer ${key}`};
async function rest(path:string,body?:unknown){const res=await fetch(`${url}/rest/v1/${path}`,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(90000)});const data=await res.json().catch(()=>null);if(!res.ok)throw new Error(data?.message||`Database HTTP ${res.status}`);return data;}
const rpc=(name:string,body:unknown={})=>rest(`rpc/${name}`,body);
async function setting(table:string,k:string){const rows=await rest(table==='private_runtime_settings'?`${table}?setting_key=eq.${k}&select=setting_value`:`${table}?key=eq.${k}&select=text_value,secret_value`);return String(rows?.[0]?.setting_value||rows?.[0]?.secret_value||rows?.[0]?.text_value||'');}
import {message} from './report-message.ts';
export {message};
Deno.serve(async req=>{
 const json=(d:unknown,status=200)=>new Response(JSON.stringify(d),{status,headers:{'content-type':'application/json'}});
 if(req.method!=='POST')return json({error:'POST required'},405);
 try{
  const expected=await setting('private_runtime_settings','daily_business_report_token');const received=req.headers.get('x-business-report-token')||'';
  if(!received||!expected||received!==expected)return json({error:'Unauthorized'},401);
  const runs=await rpc('finance_business_claim');const results=[];
  for(const r of runs){let snapshot:any=null,text='',acceptedId:string|null=null;
   try{snapshot=await rpc('finance_business_snapshot',{p_date:r.report_date});text=message(snapshot);acceptedId=(await sendAdminWhatsApp('admin_daily_business_report',text,`business-report:${r.id}`)).message_id;await rpc('finance_business_finish',{p_id:r.id,p_status:'sent',p_snapshot:snapshot,p_message:text,p_provider_id:acceptedId});results.push({id:r.id,status:'accepted',provider_message_id:acceptedId});}
   catch(e){const error=e instanceof Error?e.message:String(e);const status=acceptedId||error.startsWith('UNCERTAIN:')?'uncertain':'retry';await rpc('finance_business_finish',{p_id:r.id,p_status:status,p_snapshot:snapshot,p_message:text,p_provider_id:acceptedId,p_error:error});results.push({id:r.id,status,error});}
  }return json({success:true,results});
 }catch(e){return json({error:e instanceof Error?e.message:String(e)},500);}
});
