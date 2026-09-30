import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
const url=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const cors={'access-control-allow-origin':'*','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type,x-client-info'};
const out=(body:unknown,status=200)=>Response.json(body,{status,headers:{...cors,'cache-control':'no-store'}});
async function rest(path:string,body?:unknown){
 const r=await fetch(`${url}/rest/v1/${path}`,{method:body===undefined?'GET':'POST',headers:{apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
 const data=await r.json();if(!r.ok)throw new Error(data?.message||'Database request failed');return data;
}
async function admin(req:Request){
 const auth=req.headers.get('authorization')||'';if(!auth.startsWith('Bearer '))return null;
 const r=await fetch(`${url}/auth/v1/user`,{headers:{apikey:key,authorization:auth},signal:AbortSignal.timeout(10000)});
 if(!r.ok)return null;const user=await r.json();if(!user.id)return null;
 const rows=await rest(`admin_users?auth_user_id=eq.${encodeURIComponent(user.id)}&is_active=eq.true&select=username,role&limit=1`);
 if(!rows[0])return null;
 const ps=await rest(`admin_permissions?username=eq.${encodeURIComponent(rows[0].username)}&select=permissions&limit=1`);
 return {...rows[0],permissions:Array.isArray(ps[0]?.permissions)?ps[0].permissions:[]};
}
function redactFinance(data:any){
 for(const k of ['gmv','payments_received'])delete data.period[k];
 delete data.backlog.unpaid_value;delete data.settlement;delete data.payment_methods;
 data.trend=data.trend.map(({gmv:_,...d}:any)=>d);
 data.opportunities=[];
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return out({ok:false,error:'POST required'},405);
 try{
  const a=await admin(req);if(!a)return out({ok:false,error:'Sila log masuk sebagai admin'},401);
  const owner=a.role==='owner'||a.permissions.includes('manage_admins');
  const finance=owner||a.permissions.includes('view_finance');
  const chat=owner||a.permissions.includes('view_customers')||a.permissions.includes('manage_customers');
  const manageSales=owner||a.permissions.includes('manage_customers');
  const body=await req.json();
  if(body.action==='sales'){
   if(!manageSales)return out({ok:false,error:'Manage Customers diperlukan'},403);
   if(!/^[a-f0-9-]{36}$/i.test(String(body.request_id||'')))return out({ok:false,error:'Request ID required'},400);
   const d=body.data||{};
   if(String(d.note||'').length>2000||String(d.customer_name||'').length>160||String(d.identity_key||'').length>200||String(d.loss_reason||'').length>500)return out({ok:false,error:'Input terlalu panjang'},400);
   if(d.action==='create'){
    const phone=String(d.phone||'').replace(/\D/g,'');d.phone=phone.startsWith('0')?'6'+phone:phone;
    if(d.phone&&!/^[1-9]\d{7,14}$/.test(d.phone))return out({ok:false,error:'Nombor telefon tidak sah'},400);
    if(d.source==='whatsapp'&&!d.phone)return out({ok:false,error:'WhatsApp phone diperlukan'},400);
    if(d.source==='shopee'&&!String(d.identity_key||'').trim())return out({ok:false,error:'Shopee username diperlukan'},400);
   }
   return out(await rest('rpc/icetak_command_center_sales',{p_actor:a.username,p_request_id:body.request_id,p_data:d}));
  }
  if(body.action&&body.action!=='snapshot')return out({ok:false,error:'Invalid action'},400);
  const from=String(body.from||''),to=String(body.to||''),source=String(body.source||'all');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||Date.parse(to)<Date.parse(from)||Date.parse(to)-Date.parse(from)>92*86400000||!['all','icetak','shopee'].includes(source))return out({ok:false,error:'Pilih tempoh sehingga 93 hari'},400);
  const orderPromise=rest('rpc/icetak_command_center_snapshot',{p_from:from,p_to:to,p_source:source});
  const ledgerPromise=finance?rest('rpc/finance_admin_report',{p_from:from,p_to:to}):Promise.resolve(null);
  const inboxPromise=chat?(async()=>{
   const reviewPages=async()=>{const rows:any[]=[];for(let offset=0;offset<10000;offset+=1000){const page=await rest(`ai_dashboard_reviews?select=conversation_id,inbound_revision,status,snoozed_until&order=conversation_id&limit=1000&offset=${offset}`);rows.push(...page);if(page.length<1000)return rows;}throw new Error('Review limit exceeded');};
   const [settings,reviews]=await Promise.all([
    rest('private_runtime_settings?setting_key=eq.admin_window_bridge_token&select=setting_value&limit=1'),
    reviewPages()]);
   if(reviews.length>=10000)throw new Error('Review limit exceeded');
   const token=String(settings[0]?.setting_value||'');if(!token)throw new Error('Bridge missing');
   const r=await fetch('https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/command-center-bridge',{
    method:'POST',headers:{'content-type':'application/json','x-admin-window-token':token},body:JSON.stringify({from,to,source,reviews}),signal:AbortSignal.timeout(30000)});
   const data=await r.json();if(!r.ok||!data.ok)throw new Error('Inbox unavailable');return data;
  })():Promise.resolve(null);
  const [orderResult,inboxResult,ledgerResult]=await Promise.allSettled([orderPromise,inboxPromise,ledgerPromise]);
  if(orderResult.status==='rejected')throw orderResult.reason;
  const order=orderResult.value;
  if(finance)order.ledger=ledgerResult.status==='fulfilled'?ledgerResult.value:null;
  if(!finance)redactFinance(order);
  if(!chat){order.staff_activity=[];order.ai_training=[];order.sales_funnel=[];order.opportunities=[];for(const k of ['new_leads','quotes','won','lost'])delete order.period[k];}
  return out({ok:true,order,inbox:inboxResult.status==='fulfilled'?inboxResult.value:null,
   warnings:[...(inboxResult.status==='rejected'?['Unified Inbox tidak tersedia; angka chat tidak dianggap sifar.']:[]),...(ledgerResult.status==='rejected'?['Finance ledger tidak tersedia.']:[])],
   capabilities:{finance,chat,manage_sales:manageSales},fetched_at:new Date().toISOString(),version:'command-center-v1'});
 }catch(e){const m=e instanceof Error?e.message:'Request failed';return out({ok:false,error:m},/SALES_CHANGED|conflict|immutable/.test(m)?409:/required|Invalid|Confirm|reason/.test(m)?400:500);}
});
