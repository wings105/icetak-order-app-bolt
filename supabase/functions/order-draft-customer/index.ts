// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const U=Deno.env.get('SUPABASE_URL')||'';
const K=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const db=createClient(U,K,{auth:{persistSession:false}});
const H={'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type','cache-control':'no-store'};
const out=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const t=(v:any)=>String(v??'').trim();
const digits=(v:any)=>t(v).replace(/\D/g,'');
const normPhone=(v:any)=>{let d=digits(v);if(d.startsWith('0'))d='60'+d.slice(1);else if(d.startsWith('1'))d='60'+d;return d;};

async function qrUrl(){const q=await db.from('private_runtime_settings').select('setting_value').eq('setting_key','draft_payment_qr_image_url').maybeSingle();return t(q.data?.setting_value)||null}
async function wset(k:string){const q=await db.from('whatsapp_settings').select('text_value,secret_value').eq('key',k).maybeSingle();return t(q.data?.secret_value||q.data?.text_value)}
async function publicBase(){return (await wset('customer_app_base_url')||'https://shop.decocake.my').replace(/\/$/,'')}
async function sendAdmin(text:string){try{const base=await wset('base_url')||'https://officialapi.wasapflow.com/bridge/v1',partner=await wset('partner_key'),waba=await wset('waba_id'),to=await wset('admin_order_notify_phone');if(!partner||!waba||!to)return{sent:false};const r=await fetch(`${base}/messages/send`,{method:'POST',headers:{'content-type':'application/json','x-partner-key':partner,'x-waba-id':waba},body:JSON.stringify({to:digits(to),text,preview_url:false})}),j=await r.json().catch(()=>({}));return{sent:r.ok&&j.success!==false,message_id:j?.message_id||j?.id||null}}catch{return{sent:false}}}

async function savedAddresses(d:any){
  try{
    const p=normPhone(d?.working_draft?.customer?.phone||d?.customer_phone);
    if(!/^601\d{8,9}$/.test(p))return[];
    const variants=[`+${p}`,p,`0${p.slice(2)}`];
    const cq=await db.from('customers').select('id,customer_master_id,name,phone').in('phone',variants).limit(1);
    const c=cq.data?.[0];
    if(!c)return[];
    let q:any=db.from('customer_addresses').select('id,label,recipient_name,phone,address_line1,address_line2,city,postcode,state,country,is_default,is_verified,last_used_at,source_provider').is('archived_at',null);
    q=c.customer_master_id?q.or(`customer_id.eq.${c.id},customer_master_id.eq.${c.customer_master_id}`):q.eq('customer_id',c.id);
    const a=await q.order('is_default',{ascending:false}).order('last_used_at',{ascending:false,nullsFirst:false}).order('created_at',{ascending:false}).limit(8);
    return a.error?[]:(a.data||[]);
  }catch{return[]}
}

async function load(token:string){
  const q=await db.from('qrpay_order_drafts').select('id,review_token,customer_review_token,source_type,status,customer_status,customer_name,customer_phone,working_draft,draft_total,item_subtotal,shipping_fee,payment_required,payment_status,payment_mode,payment_session_id,admin_approved_at,customer_confirmed_at,order_id,order_no,created_at,updated_at').eq('customer_review_token',token).maybeSingle();
  if(q.error)throw q.error;if(!q.data)throw Error('draft_not_found');
  const d=q.data;let ps:any=null,order:any=null;
  if(d.payment_session_id){const x=await db.from('payment_sessions').select('id,base_amount,expected_amount,discount,status,expires_at,transaction_id,matched_at').eq('id',d.payment_session_id).maybeSingle();ps=x.data}
  if(d.order_id){const x=await db.from('orders').select('id,order_no,public_token,status,payment_status,total,date_need,delivery_method,tracking,tracking_link').eq('id',d.order_id).maybeSingle();order=x.data}
  const [payment_qr_url,saved_addresses]=await Promise.all([qrUrl(),savedAddresses(d)]);
  return{...d,payment_session:ps,order,payment_qr_url,saved_addresses};
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:H});
  try{
    const url=new URL(req.url),body=req.method==='POST'?await req.json().catch(()=>({})):null,token=t(req.method==='GET'?url.searchParams.get('token'):body?.token);
    if(!/^qrc_[a-f0-9]{32}$/i.test(token))return out({ok:false,error:'Invalid customer link'},401);
    if(req.method==='GET')return out({ok:true,draft:await load(token)});
    if(req.method!=='POST')return out({ok:false,error:'Method not allowed'},405);
    const d=await load(token);
    if(body.action==='confirm'){
      if(!d.admin_approved_at)return out({ok:false,error:'Draft belum diluluskan admin'},409);
      const c=body.customer||{},line1=t(c.address_line1),line2=t(c.address_line2),allowed:any={name:t(c.name)||undefined,phone:t(c.phone)||undefined,address_line1:line1?(line2?`${line1}, ${line2}`:line1):undefined,address_line2:line2||undefined,postcode:t(c.postcode)||undefined,city:t(c.city)||undefined,state:t(c.state)||undefined};
      if(Object.prototype.hasOwnProperty.call(c,'address_id'))allowed.address_id=t(c.address_id)||null;
      Object.keys(allowed).forEach(k=>allowed[k]===undefined&&delete allowed[k]);
      const q=await db.rpc('icetak_customer_confirm_draft',{p_customer_token:token,p_customer:allowed,p_actor:'customer-link'});if(q.error)throw q.error;
      let payment=null;if(q.data?.payment_required){const p=await db.rpc('icetak_prepare_draft_payment',{p_customer_token:token,p_force_new:false});if(p.error)throw p.error;payment=p.data}
      return out({ok:true,result:q.data,payment,draft:await load(token)});
    }
    if(body.action==='prepare_payment'){const q=await db.rpc('icetak_prepare_draft_payment',{p_customer_token:token,p_force_new:Boolean(body.force_new)});if(q.error)throw q.error;return out({ok:true,payment:q.data,draft:await load(token)})}
    if(body.action==='request_change'){
      const note=t(body.note);const q=await db.rpc('icetak_customer_request_draft_change',{p_customer_token:token,p_note:note,p_actor:'customer-link'});if(q.error)throw q.error;
      const adminLink=`${await publicBase()}/qrpay-draft.html?token=${encodeURIComponent(d.review_token)}`,notice=await sendAdmin(['🔴 CUSTOMER REQUEST CORRECTION',`Customer: ${d.customer_name||'-'}`,`Draft total: RM${Number(d.draft_total||0).toFixed(2)}`,`Note: ${note||'-'}`,'','Buka draft:',adminLink].join('\n'));
      await db.from('qrpay_order_draft_events').insert({draft_id:d.id,event_type:'admin_notified_customer_change',actor:'system',metadata:notice});return out({ok:true,result:q.data,admin_notified:notice.sent});
    }
    if(body.action==='refresh')return out({ok:true,draft:await load(token)});
    return out({ok:false,error:'Unsupported action'},400);
  }catch(e){console.error('order-draft-customer',e);return out({ok:false,error:e instanceof Error?e.message:String(e)},500)}
});