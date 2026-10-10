import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {syncMarketplace} from '../_shared/marketplace-inbox-sync.ts';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
Deno.serve(async(req:Request)=>{
  if(req.method!=='POST') return json({ok:false,error:'POST required'},405);
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const {data:credential}=await db.from('private_runtime_settings').select('setting_value').eq('setting_key','admin_window_bridge_token').single();
  if(!credential?.setting_value || req.headers.get('x-order-sync-token')!==credential.setting_value) return json({ok:false,error:'Unauthorized'},401);
  try {
    const body=await req.json();
    if(body.action==='credential_presence')return json({ok:true,openai_key_present:!!Deno.env.get('OPENAI_API_KEY')?.trim().startsWith('sk-')});
    if(!Array.isArray(body.order_ids)||!body.order_ids.length||body.order_ids.length>100) return json({ok:false,error:'1–100 order IDs required'},400);
    if(body.source==='marketplace') return await syncMarketplace(new Request(req.url,{method:'POST',headers:{Authorization:`Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`},body:JSON.stringify(body)}));
    if(body.source!=='direct') return json({ok:false,error:'Unknown source'},400);
    const [summaries,orders,items]=await Promise.all([
      db.from('active_order_summary').select('*').in('order_system_order_id',body.order_ids),
      db.from('orders').select('*').in('id',body.order_ids),
      db.from('order_items').select('*').in('order_id',body.order_ids).order('sort_index')
    ]);
    for(const result of [summaries,orders,items]) if(result.error) return json({ok:false,error:result.error.message},500);
    const payloads=(summaries.data||[]).map(row=>{
      const order=orders.data?.find(o=>o.id===row.order_system_order_id);
      const orderItems=(items.data||[]).filter(i=>i.order_id===row.order_system_order_id).map(i=>({title:i.title,product_type:i.product_type,quantity:i.qty,unit_price:i.price,variation_name:[i.size,i.style].filter(Boolean).join(' · '),wording:i.wording,design_preview_url:i.design_preview_url,customization:i.customization}));
      return {...row,source_channel:'whatsapp',items:orderItems,item_count:orderItems.reduce((n,i)=>n+(i.quantity||0),0),order_updated_at:order?.updated_at,source_payload_version:'direct-order-v1',payment_total:order?.total,paid_amount:order?.payment_status==='paid'?Number(order.total):null,balance_amount:order?.payment_status==='paid'?0:null,delivery_address:order?.delivery_address||null,metadata:{...row.metadata,order_source:order?.source,provisional:false,paid_amount_basis:'order_payment_status',customer_detail_status:row.metadata?.customer_confirmed?'confirmed':'unverified'},public_order_url:row.public_order_url?new URL(row.public_order_url,'https://shop.decocake.my').href:null};
    });
    if(!payloads.length) return json({ok:true,pulled:0});
    const result=await fetch('https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/inbox-order-sync',{method:'POST',headers:{'Content-Type':'application/json','x-order-sync-token':credential.setting_value},body:JSON.stringify({orders:payloads}),signal:AbortSignal.timeout(55000)});
    const data=await result.json();
    return json({ok:result.ok&&data.ok===true,pulled:payloads.length,inbox_result:data},result.ok&&data.ok===true?200:502);
  } catch {return json({ok:false,error:'Order sync worker failed; retry queued'},502);}
});
