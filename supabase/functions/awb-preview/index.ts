import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.51.0';
import { previewItem } from './preview.ts';
const headers = {
 'content-type': 'application/json; charset=utf-8',
 'access-control-allow-origin': '*',
 'access-control-allow-methods': 'GET,OPTIONS',
 'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info',
 'cache-control': 'no-store',
 'x-content-type-options': 'nosniff',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status,headers});
// Public by owner request: exact order-reference lookup, print fields only.
Deno.serve(async req => {
 if(req.method==='OPTIONS') return new Response(null,{status:204,headers});
 if(req.method!=='GET') return json({error:'method_not_allowed'},405);
 const orderId = (new URL(req.url).searchParams.get('order_id') || '').trim();
 if(!/^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/.test(orderId)) return json({error:'Order ID tidak sah.'},400);
 try {
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const {data,error}=await db.from('clickup_awb_preview_tasks')
   .select('task_id,title,set_position,attachments,comment_images,comment_at,received_at')
   .eq('order_reference',orderId).order('set_position').order('task_id').limit(201);
  if(error) throw error;
  if(!data?.length) return json({error:'Order ID belum ditemui dalam data ClickUp.',order_id:orderId},404);
  if(data.length>200) return json({error:'Terlalu banyak item untuk satu preview.'},422);
  return json({order_id:orderId,items:data.map(previewItem),updated_at:data.reduce((a,r)=>a>r.received_at?a:r.received_at,'')});
 } catch(error) { console.error('awb-preview lookup failed',error); return json({error:'Preview gagal dimuat. Cuba refresh.'},500); }
});
