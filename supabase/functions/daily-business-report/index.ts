import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
const url=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const headers={'content-type':'application/json',apikey:key,authorization:`Bearer ${key}`};
async function rest(path:string,body?:unknown){const res=await fetch(`${url}/rest/v1/${path}`,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(90000)});const data=await res.json().catch(()=>null);if(!res.ok)throw new Error(data?.message||`Database HTTP ${res.status}`);return data;}
const rpc=(name:string,body:unknown={})=>rest(`rpc/${name}`,body);
async function setting(table:string,k:string){const rows=await rest(table==='private_runtime_settings'?`${table}?setting_key=eq.${k}&select=setting_value`:`${table}?key=eq.${k}&select=text_value,secret_value`);return String(rows?.[0]?.setting_value||rows?.[0]?.secret_value||rows?.[0]?.text_value||'');}
import {message} from './report-message.ts';
export {message};
async function send(phone:string,text:string,cfg:any){
 const master=(await rest('whatsapp_settings?key=eq.enabled&select=value,text_value'))?.[0];
 const enabled=master?.text_value||master?.value;
 if(![true,'true','1','on'].includes(enabled))throw new Error('WhatsApp master switch disabled');
 const checkUrl=await setting('whatsapp_settings','unified_inbox_24h_url');let open=false;
 if(checkUrl){const res=await fetch(checkUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone}),signal:AbortSignal.timeout(10000)});const d=await res.json();open=res.ok&&d.ok!==false&&d.can_send_freeform===true;}
 let path='/messages/send',payload:any={to:phone,text,preview_url:true};
 if(!open){
  if(!cfg.template_name)throw new Error('WINDOW_CLOSED: approved daily report template required; reply to business WhatsApp to reopen window');
  const approved=await rest(`whatsapp_templates?name=eq.${encodeURIComponent(cfg.template_name)}&language=eq.${encodeURIComponent(cfg.template_language)}&status=eq.APPROVED&select=name`);
  if(!approved.length)throw new Error('Daily report template not approved');
  path='/messages/template';payload={to:phone,template:{name:cfg.template_name,language:{code:cfg.template_language},components:[{type:'body',parameters:[{type:'text',text:text.split('\n').filter((line:string)=>/^(Tarikh:|Jumlah:|Jualan produk:|Perubahan:|Unjuran|Baki sebelum overhead:|Liputan kiraan:|🔗)/.test(line)).join(' | ')}]}]}};
 }
 const [base,partner,waba]=await Promise.all(['base_url','partner_key','waba_id'].map(k=>setting('whatsapp_settings',k)));
 if(!partner||!waba)throw new Error('WasapFlow credentials incomplete');
 let res:Response;
 try{res=await fetch(`${base||'https://officialapi.wasapflow.com/bridge/v1'}${path}`,{method:'POST',headers:{'content-type':'application/json','x-partner-key':partner,'x-waba-id':waba},body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)});}catch{throw new Error('UNCERTAIN: provider timeout; verify provider before resend');}
 const d=await res.json().catch(()=>({}));if(!res.ok||d.success===false){if(res.status>=500)throw new Error(`UNCERTAIN: provider HTTP ${res.status}`);throw new Error(d?.error?.message||d?.message||`WasapFlow ${res.status}`);}
 const id=d.message_id||d.id||d.data?.message_id;if(!id)throw new Error('UNCERTAIN: provider response without message id');return String(id);
}
Deno.serve(async req=>{
 const json=(d:unknown,status=200)=>new Response(JSON.stringify(d),{status,headers:{'content-type':'application/json'}});
 if(req.method!=='POST')return json({error:'POST required'},405);
 try{
  const expected=await setting('private_runtime_settings','daily_business_report_token');const received=req.headers.get('x-business-report-token')||'';
  if(!received||!expected||received!==expected)return json({error:'Unauthorized'},401);
  const runs=await rpc('finance_business_claim');const cfg=(await rpc('finance_business_control',{p_action:'read'})).settings;const results=[];
  for(const r of runs){let snapshot:any=null,text='',acceptedId:string|null=null;
   try{snapshot=await rpc('finance_business_snapshot',{p_date:r.report_date});text=message(snapshot);acceptedId=await send(r.recipient_phone,text,cfg);await rpc('finance_business_finish',{p_id:r.id,p_status:'sent',p_snapshot:snapshot,p_message:text,p_provider_id:acceptedId});results.push({id:r.id,status:'accepted',provider_message_id:acceptedId});}
   catch(e){const error=e instanceof Error?e.message:String(e);const status=acceptedId||error.startsWith('UNCERTAIN:')?'uncertain':'retry';await rpc('finance_business_finish',{p_id:r.id,p_status:status,p_snapshot:snapshot,p_message:text,p_provider_id:acceptedId,p_error:error});results.push({id:r.id,status,error});}
  }return json({success:true,results});
 }catch(e){return json({error:e instanceof Error?e.message:String(e)},500);}
});
