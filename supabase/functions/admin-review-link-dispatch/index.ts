// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const U=Deno.env.get('SUPABASE_URL')||'',K=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const db=createClient(U,K,{auth:{persistSession:false}});
const H={'content-type':'application/json','cache-control':'no-store'};
const out=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const t=(v:any)=>v==null?'':String(v).trim();
const digits=(v:any)=>t(v).replace(/\D/g,'');
async function pset(k:string){const {data}=await db.from('private_runtime_settings').select('setting_value').eq('setting_key',k).maybeSingle();return t(data?.setting_value)}
async function wset(k:string){const {data}=await db.from('whatsapp_settings').select('text_value,secret_value').eq('key',k).maybeSingle();return t(data?.secret_value||data?.text_value)}
async function auth(req:Request){const x=req.headers.get('x-admin-order-token')||'';return!!x&&x===await pset('qrpay_ai_worker_token')}
async function provider(to:string,text:string){const base=await wset('base_url')||'https://officialapi.wasapflow.com/bridge/v1',partner=await wset('partner_key'),waba=await wset('waba_id');if(!partner||!waba)throw Error('WasapFlow credentials incomplete');const r=await fetch(`${base}/messages/send`,{method:'POST',headers:{'content-type':'application/json','x-partner-key':partner,'x-waba-id':waba},body:JSON.stringify({to:digits(to),text,preview_url:false})});const j=await r.json().catch(()=>({}));if(!r.ok||j.success===false)throw Error(j?.error?.message||j?.message||`HTTP ${r.status}`);return j}
async function adminPhone(){return await wset('admin_order_notify_phone')||'60129554732'}
function methodLabel(v:any){const s=t(v).toLowerCase();return s==='pickup'?'Pickup':s==='spx'?'SPX':s==='jnt'?'J&T':s==='ninja'?'Ninja Van':s?String(v):'Not set'}
async function sendDraft(draftId:string){
  const {data:d,error}=await db.from('qrpay_order_drafts').select('*').eq('id',draftId).maybeSingle();if(error)throw error;if(!d)throw Error('draft_not_found');
  const {data:r}=await db.from('admin_order_reviews').select('id,review_code,status').eq('draft_id',d.id).maybeSingle();
  if(!d.review_token||!/^qrd_[a-f0-9]{32}$/i.test(d.review_token))throw Error('draft_review_token_invalid');
  const p=d.working_draft||{},items=Array.isArray(p.items)?p.items:[];
  const link=`https://icetak.bolt.host/qrpay-draft.html?token=${encodeURIComponent(d.review_token)}`;
  const lines=items.map((x:any,i:number)=>`${i+1}. ${x.title||x.k||'Item'} x${Number(x.qty||1)} | RM${Number(x.price||0).toFixed(2)}${x.size?` | ${x.size}`:''}${x.wording?`\n   ${String(x.wording).replace(/\n/g,' / ')}`:''}`).join('\n');
  const itemSubtotal=items.reduce((s:number,x:any)=>s+(Number(x.price||0)*Math.max(1,Number(x.qty||1))),0);
  const shippingFee=Number(p.delivery_fee??d.shipping_fee??0);
  const total=itemSubtotal+shippingFee;
  const payment=Number(d.payment_amount||0);
  const diff=total-payment;
  const delivery=methodLabel(p.delivery);
  const msg=[
    '🟡 QRPay AI DRAFT — ADMIN CHECK',
    `Tx: ${d.transaction_id}`,
    `Customer: ${d.customer_name||'-'}`,
    `AI match: ${Math.round(Number(d.match_score||0)*100)}%`,
    `Date Need: ${p.date_need||'-'}`,
    '',
    'ORDER',
    lines||'Item belum cukup',
    '',
    `Shipping: ${delivery} | RM${shippingFee.toFixed(2)}`,
    `Item Subtotal: RM${itemSubtotal.toFixed(2)}`,
    `TOTAL: RM${total.toFixed(2)}`,
    `Payment Received: RM${payment.toFixed(2)}`,
    `Difference: ${diff>=0?'+':''}RM${diff.toFixed(2)}`,
    '',
    'Buka draft untuk edit / remove / add item / shipping / Date Need dan Confirm:',
    link,
    '',
    '⚠️ Draft ini BELUM jadi order dan BELUM create ClickUp.'
  ].join('\n');
  const sent=await provider(await adminPhone(),msg);
  const now=new Date().toISOString();
  await Promise.all([
    db.from('qrpay_order_drafts').update({admin_link_sent_at:now,updated_at:now}).eq('id',d.id),
    db.from('admin_order_reviews').update({fallback_notified_at:now,last_notified_at:now,updated_at:now}).eq('draft_id',d.id)
  ]);
  return{sent:true,draft_id:d.id,review_code:r?.review_code||null,public_link:link,message_id:sent?.message_id||sent?.id||null};
}
async function legacySweep(){
  const {data:rows,error}=await db.from('admin_order_reviews').select('id,review_token,source_type,transaction_id,source_key,amount,candidate_name,status,draft_id').in('status',['pending_admin','awaiting_admin_detail']).is('fallback_notified_at',null).order('updated_at',{ascending:true}).limit(10);if(error)throw error;
  const results=[];for(const r of rows||[]){try{if(r.source_type==='qrpay_draft'&&r.draft_id){results.push(await sendDraft(r.draft_id));continue}const link=`${U}/functions/v1/admin-order-review?token=${encodeURIComponent(r.review_token)}`,label=r.source_type==='qrpay'?'QRPay':'Pickup',msg=`🔗 Admin Review fallback\n${label}: ${r.transaction_id||r.source_key}\n${r.amount!=null?'RM: '+Number(r.amount).toFixed(2)+'\n':''}${r.candidate_name?'Customer: '+r.candidate_name+'\n':''}\nBuka review:\n${link}`;const sent=await provider(await adminPhone(),msg);await db.from('admin_order_reviews').update({fallback_notified_at:new Date().toISOString()}).eq('id',r.id);results.push({id:r.id,sent:true,message_id:sent?.message_id||sent?.id||null})}catch(e){results.push({id:r.id,sent:false,error:String(e)})}}
  return results;
}
Deno.serve(async req=>{if(req.method!=='POST')return out({ok:false,error:'POST required'},405);if(!await auth(req))return out({ok:false,error:'Unauthorized'},401);try{const b=await req.json().catch(()=>({}));if(b.action==='send_draft_link'&&b.draft_id)return out({ok:true,result:await sendDraft(String(b.draft_id))});const rs=await legacySweep();return out({ok:true,count:rs.length,results:rs})}catch(e){console.error('admin-review-link-dispatch',e);return out({ok:false,error:e instanceof Error?e.message:String(e)},500)}});
