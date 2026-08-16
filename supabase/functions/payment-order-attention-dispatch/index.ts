// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false}});
const H={'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'content-type,x-payment-order-alert-token','cache-control':'no-store'};
const out=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const t=(v:any)=>String(v??'').trim();
const digits=(v:any)=>{let d=t(v).replace(/\D/g,'');if(!d)return'';if(d[0]==='0')d=`60${d.slice(1)}`;else if(d[0]==='1')d=`60${d}`;else if(!d.startsWith('60'))d=`60${d}`;return d};
async function secret(k:string){const {data}=await db.from('private_runtime_settings').select('setting_value').eq('setting_key',k).maybeSingle();return t(data?.setting_value)}
async function setting(k:string){const {data}=await db.from('whatsapp_settings').select('text_value,secret_value').eq('key',k).maybeSingle();return t(data?.secret_value||data?.text_value)}
async function sha(v:string){return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))}
async function safeEqual(a:string,b:string){if(!a||!b)return false;const [x,y]=await Promise.all([sha(a),sha(b)]);let diff=x.length^y.length;for(let i=0;i<Math.max(x.length,y.length);i++)diff|=(x[i]??0)^(y[i]??0);return diff===0}
async function auth(req:Request){return safeEqual(req.headers.get('x-payment-order-alert-token')||'',await secret('qrpay_ai_worker_token'))}
async function send(to:string,text:string){const base=await setting('base_url')||'https://officialapi.wasapflow.com/bridge/v1',partner=await setting('partner_key'),waba=await setting('waba_id');if(!partner||!waba)throw new Error('WasapFlow credential belum lengkap');const r=await fetch(`${base}/messages/send`,{method:'POST',headers:{'content-type':'application/json','x-partner-key':partner,'x-waba-id':waba},body:JSON.stringify({to:digits(to),text,preview_url:true})});const j=await r.json().catch(()=>({}));if(!r.ok||j.success===false)throw new Error(j?.error?.message||j?.message||`WasapFlow ${r.status}`);return j}
function money(v:any){return `RM${Number(v||0).toFixed(2)}`}
function localDate(iso:any){try{return new Intl.DateTimeFormat('ms-MY',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kuala_Lumpur'}).format(new Date(iso))}catch{return t(iso)}}
function ageMins(iso:any){return Math.max(0,Math.floor((Date.now()-new Date(iso).getTime())/60000))}
async function retry(ids:string[],err:any){if(!ids.length)return;const {data}=await db.from('payment_order_attention_alerts').select('id,attempts').in('id',ids);for(const row of data||[]){const attempts=Number(row.attempts||1),terminal=attempts>=5,mins=[5,15,60,240,240][Math.min(Math.max(attempts-1,0),4)];await db.from('payment_order_attention_alerts').update({status:terminal?'failed':'retry',locked_at:null,scheduled_at:terminal?new Date().toISOString():new Date(Date.now()+mins*60000).toISOString(),last_error:String(err).slice(0,1800),updated_at:new Date().toISOString()}).eq('id',row.id).eq('status','sending')}}

Deno.serve(async (req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:H});
  if(req.method!=='POST')return out({ok:false,error:'POST required'},405);
  if(!await auth(req))return out({ok:false,error:'Unauthorized'},401);
  const b=await req.json().catch(()=>({}));
  const ids=Array.isArray(b.alert_ids)?b.alert_ids.map(t).filter(Boolean).slice(0,10):[];
  if(!ids.length)return out({ok:true,processed:0});
  try{
    await db.rpc('icetak_scan_payment_order_attention');
    const {data:alerts,error:ae}=await db.from('payment_order_attention_alerts').select('*').in('id',ids).eq('status','sending').order('detected_at',{ascending:true});
    if(ae)throw ae;
    if(!alerts?.length)return out({ok:true,processed:0,reason:'alerts_resolved_before_send'});
    const txids=[...new Set(alerts.map((x:any)=>x.transaction_id).filter(Boolean))];
    const {data:payments,error:pe}=await db.from('payment_transactions').select('transaction_id,amount,paid_at,created_at,sender_name,provider,raw_payload,order_id').in('transaction_id',txids);
    if(pe)throw pe;
    const still=(payments||[]).filter((p:any)=>!p.order_id);
    const stillIds=new Set(still.map((p:any)=>p.transaction_id));
    const stale=alerts.filter((a:any)=>!stillIds.has(a.transaction_id));
    if(stale.length){const now=new Date().toISOString();await db.from('payment_order_attention_alerts').update({status:'resolved',resolved_at:now,locked_at:null,updated_at:now}).in('id',stale.map((x:any)=>x.id)).eq('status','sending')}
    const active=alerts.filter((a:any)=>stillIds.has(a.transaction_id));
    if(!active.length)return out({ok:true,processed:0,reason:'linked_before_send'});

    const {data:drafts}=await db.from('qrpay_order_drafts').select('id,review_token,customer_review_token,customer_name,customer_phone,status,customer_status,payment_status,draft_total,transaction_id').in('transaction_id',active.map((x:any)=>x.transaction_id));
    const pm=new Map(still.map((x:any)=>[x.transaction_id,x]));
    const dm=new Map((drafts||[]).map((x:any)=>[x.transaction_id,x]));
    const app=(await setting('customer_app_base_url')||'https://shop.decocake.my').replace(/\/$/,'');
    const lines=active.map((a:any,i:number)=>{const p:any=pm.get(a.transaction_id)||{},d:any=dm.get(a.transaction_id)||{};const phone=digits(d.customer_phone||p?.raw_payload?.matched_phone||p?.raw_payload?.phone||'');const paidAt=p.paid_at||p.created_at;const mins=ageMins(paidAt);const draftState=[t(d.status),t(d.customer_status)].filter(Boolean).join(' / ');const review=t(d.review_token)?`${app}/qrpay-draft.html?token=${encodeURIComponent(t(d.review_token))}`:'';return [`${i+1}. *${money(p.amount)} · ${a.transaction_id}*`,phone?`Phone: ${phone}`:'Phone: belum jumpa',`Paid: ${localDate(paidAt)} · ${mins} minit lalu`,draftState?`Draft: ${draftState}`:'Draft: belum jumpa',review?`Admin draft: ${review}`:''].filter(Boolean).join('\n')}).join('\n\n');
    const msg=[`🚨 *PAYMENT PAID — ORDER BELUM TERBINA*`,`Admin attention diperlukan: ${active.length} transaksi sudah >15 minit tetapi masih tiada Order ID.`,``,lines,``,`Semak QRPay: ${app}/?admin=v2&view=qrpay-summary`,``,`Alert ini dihantar sekali. Bila Order ID berjaya linked, status auto-resolve.`].join('\n');
    const admin=await setting('admin_order_notify_phone')||'60129554732';
    const sent=await send(admin,msg);
    const now=new Date().toISOString();
    await db.from('payment_order_attention_alerts').update({status:'sent',sent_at:now,locked_at:null,provider_message_id:sent?.message_id||sent?.id||sent?.data?.message_id||null,last_error:null,updated_at:now}).in('id',active.map((x:any)=>x.id)).eq('status','sending');
    return out({ok:true,processed:active.length,message_id:sent?.message_id||sent?.id||sent?.data?.message_id||null});
  }catch(e){console.error('payment-order-attention-dispatch',e);await retry(ids,e instanceof Error?e.message:String(e));return out({ok:false,error:e instanceof Error?e.message:String(e)},500)}
});
