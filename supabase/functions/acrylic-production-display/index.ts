import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {productionItem,type SourceRow} from '../acrylic-production/model.ts';

// Owner-authorized, no-login cutting display. Admin gateway remains JWT protected.
const url=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const cors={'access-control-allow-origin':'*','access-control-allow-methods':'GET,OPTIONS'};
const out=(body:unknown,status=200)=>Response.json(body,{status,headers:{...cors,'cache-control':'no-store','x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow, noarchive'}});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(req.method!=='GET')return out({ok:false,error:'READ_ONLY'},405);
 try{
  const response=await fetch(`${url}/rest/v1/rpc/icetak_acrylic_production_snapshot`,{method:'POST',headers:{apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('READ_FAILED');
  const source=await response.json();
  const items=(source.rows||[]).flatMap((row:SourceRow)=>{
   const i=productionItem(row);if(!i)return [];
   // Explicit display allowlist: no raw fields, prices, contacts, payments or admin grants.
   return [{task_id:i.task_id,title:i.title,order_reference:i.order_reference,stage:i.stage,status:i.status,
    material:i.material,colour:i.colour,colour_source:'',size:i.size,quantity:i.quantity,sets:i.sets,
    sku:'',due_at:i.due_at,updated_at:i.updated_at,issues:i.issues,images:i.images,task_url:i.task_url}];
  });
  return out({ok:true,items,truncated:source.truncated===true,read_at:new Date().toISOString()});
 }catch{return out({ok:false,error:'Data production gagal dimuat. Cuba refresh.'},503);}
});
