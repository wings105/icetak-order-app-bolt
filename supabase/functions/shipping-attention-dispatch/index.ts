// @ts-nocheck
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false}});
const H={'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'content-type,x-shipping-alert-token'};
const out=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const t=(v:any)=>String(v??'').trim();
const digits=(v:any)=>{let d=t(v).replace(/\D/g,'');if(!d)return'';if(d[0]==='0')d=`60${d.slice(1)}`;else if(d[0]==='1')d=`60${d}`;else if(!d.startsWith('60'))d=`60${d}`;return d};
async function secret(k:string){const {data}=await db.from('private_runtime_settings').select('setting_value').eq('setting_key',k).maybeSingle();return t(data?.setting_value)}
async function setting(k:string){const {data}=await db.from('whatsapp_settings').select('text_value,secret_value').eq('key',k).maybeSingle();return t(data?.secret_value||data?.text_value)}
async function auth(req:Request){const k=req.headers.get('x-shipping-alert-token')||'';return Boolean(k&&k===await secret('qrpay_ai_worker_token'))}
async function send(to:string,text:string){const base=await setting('base_url')||'https://officialapi.wasapflow.com/bridge/v1',partner=await setting('partner_key'),waba=await setting('waba_id');if(!partner||!waba)throw new Error('WasapFlow credential belum lengkap');const r=await fetch(`${base}/messages/send`,{method:'POST',headers:{'content-type':'application/json','x-partner-key':partner,'x-waba-id':waba},body:JSON.stringify({to:digits(to),text,preview_url:true})});const j=await r.json().catch(()=>({}));if(!r.ok||j.success===false)throw new Error(j?.error?.message||j?.message||`WasapFlow ${r.status}`);return j}
function ageLabel(iso:string){const hours=Math.max(0,(Date.now()-new Date(iso).getTime())/3600000);const d=Math.floor(hours/24),h=Math.floor(hours%24);return d>0?`${d} hari ${h} jam`:`${Math.floor(hours)} jam`}
function localDate(iso:string){try{return new Intl.DateTimeFormat('ms-MY',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kuala_Lumpur'}).format(new Date(iso))}catch{return iso}}
async function retry(ids:string[],err:any){if(!ids.length)return;const {data}=await db.from('shipment_attention_alerts').select('id,attempts').in('id',ids);for(const row of data||[]){const attempts=Number(row.attempts||1),terminal=attempts>=5,mins=[5,15,60,240,240][Math.min(Math.max(attempts-1,0),4)];await db.from('shipment_attention_alerts').update({status:terminal?'failed':'retry',locked_at:null,scheduled_at:terminal?new Date().toISOString():new Date(Date.now()+mins*60000).toISOString(),last_error:String(err).slice(0,1800),updated_at:new Date().toISOString()}).eq('id',row.id).eq('status','sending')}}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:H});
  if(req.method!=='POST')return out({ok:false,error:'POST required'},405);
  if(!await auth(req))return out({ok:false,error:'Unauthorized'},401);
  const b=await req.json().catch(()=>({}));
  const ids=Array.isArray(b.alert_ids)?b.alert_ids.map(t).filter(Boolean).slice(0,15):[];
  if(!ids.length)return out({ok:true,processed:0});
  try{
    await db.rpc('icetak_scan_stuck_shipments');
    const {data:alerts,error:ae}=await db.from('shipment_attention_alerts').select('*').in('id',ids).eq('status','sending').order('last_movement_at',{ascending:true});
    if(ae)throw ae;
    if(!alerts?.length)return out({ok:true,processed:0,reason:'alerts_resolved_before_send'});
    const shipmentIds=[...new Set(alerts.map((x:any)=>x.shipment_id))];
    const {data:shipments,error:se}=await db.from('shipments').select('id,order_id,tracking_no,tracking_link,courier,status,normalized_status,recipient_name,recipient_phone').in('id',shipmentIds);
    if(se)throw se;
    const orderIds=[...new Set((shipments||[]).map((x:any)=>x.order_id).filter(Boolean))];
    const {data:orders}=orderIds.length?await db.from('orders').select('id,order_no,public_token').in('id',orderIds):{data:[]};
    const sm=new Map((shipments||[]).map((x:any)=>[x.id,x])),om=new Map((orders||[]).map((x:any)=>[x.id,x]));
    const lines=alerts.map((a:any,i:number)=>{const s=sm.get(a.shipment_id)||{},o=om.get(s.order_id)||{};return [`${i+1}. *${s.recipient_name||'Customer'}*`,`${String(s.courier||'-').toUpperCase()} · ${s.tracking_no||'-'}`,`Status: ${s.status||s.normalized_status||'-'}`,`Tiada movement: ${ageLabel(a.last_movement_at)}`,`Last update: ${localDate(a.last_movement_at)}`,o.order_no?`Order: ${o.order_no}`:'',s.tracking_link?`Track: ${s.tracking_link}`:''].filter(Boolean).join('\n')}).join('\n\n');
    const app=(await setting('customer_app_base_url')||'https://shop.decocake.my').replace(/\/$/,'');
    const msg=[`🚨 *PARCEL STUCK > 2 HARI*`,`Admin attention diperlukan: ${alerts.length} parcel.`,``,lines,``,`Buka Shipping: ${app}/?admin=v2`,``,`Alert dihantar sekali untuk setiap stuck episode. Bila tracking bergerak semula, alert auto-resolve.`].join('\n');
    const admin=await setting('admin_order_notify_phone')||'60129554732';
    const sent=await send(admin,msg);
    const now=new Date().toISOString();
    await db.from('shipment_attention_alerts').update({status:'sent',sent_at:now,locked_at:null,provider_message_id:sent?.message_id||sent?.id||null,last_error:null,updated_at:now}).in('id',alerts.map((x:any)=>x.id)).eq('status','sending');
    return out({ok:true,processed:alerts.length,message_id:sent?.message_id||sent?.id||null});
  }catch(e){console.error('shipping-attention-dispatch',e);await retry(ids,e instanceof Error?e.message:String(e));return out({ok:false,error:e instanceof Error?e.message:String(e)},500)}
});
