const json=(v:unknown,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store'}});
Deno.serve(async req=>{
 if(req.method!=='POST')return json({ok:false},405);
 const authorization=req.headers.get('authorization')||'';
 if(!/^Bearer \S+$/.test(authorization))return json({ok:false},401);
 try{
  const check=await fetch('https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/admin-ai-knowledge',{method:'POST',headers:{authorization,'content-type':'application/json'},body:JSON.stringify({action:'historical_access'}),signal:AbortSignal.timeout(12000)});
  if(!check.ok||!(await check.json()).ok)return json({ok:false,error:'Akses owner diperlukan'},403);
  const b=await req.json();
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const response=await fetch(Deno.env.get('SUPABASE_URL')+'/rest/v1/rpc/admin_read_whatsapp_examples',{method:'POST',headers:{apikey:key,authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({p_search:String(b.search||'').slice(0,100),p_category:String(b.category||'').slice(0,100),p_offset:Math.max(0,Math.min(1000000,Math.floor(Number(b.offset)||0)))}),signal:AbortSignal.timeout(12000)});
  if(!response.ok)return json({ok:false,error:'Gagal membaca sejarah WhatsApp'},502);
  return json({ok:true,...await response.json()});
 }catch{return json({ok:false,error:'Gagal membaca sejarah WhatsApp'},502);}
});