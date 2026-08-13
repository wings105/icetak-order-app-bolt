// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const U=Deno.env.get('SUPABASE_URL')||'',K=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',db=createClient(U,K,{auth:{persistSession:false}});
const PATH='1783099788321-5d39f5c6-3432-4372-be4b-fb1e15d15072-2b365156-a9ef-4ed3-a2d8-c7fd6f1538b5.jpg';
Deno.serve(async req=>{if(req.method==='OPTIONS')return new Response('ok',{headers:{'access-control-allow-origin':'*'}});if(req.method!=='GET')return new Response('GET required',{status:405});const q=await db.storage.from('snippet-media').download(PATH);if(q.error||!q.data)return new Response('QR unavailable',{status:404});return new Response(await q.data.arrayBuffer(),{headers:{'content-type':q.data.type||'image/jpeg','cache-control':'public,max-age=3600','access-control-allow-origin':'*','x-content-type-options':'nosniff'}})});