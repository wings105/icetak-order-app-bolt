import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const U=Deno.env.get('SUPABASE_URL')||'';
const K=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const H={'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'content-type'};
const out=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:H});
const text=(value:unknown)=>String(value??'').trim();

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:H});
  if(req.method!=='POST')return out({ok:false,error:'POST required'},405);
  if(!U||!K)return out({ok:false,error:'Supabase runtime missing'},500);
  const db=createClient(U,K,{auth:{persistSession:false}});
  try{
    const body=await req.json().catch(()=>({}));
    const tokenRow=await db.from('private_runtime_settings').select('setting_value').eq('setting_key','draft_followup_scheduler_token').maybeSingle();
    if(tokenRow.error)throw tokenRow.error;
    if(!text(tokenRow.data?.setting_value)||text(body.token)!==text(tokenRow.data?.setting_value))return out({ok:false,error:'Unauthorized'},401);
    const settings=await db.from('draft_followup_settings').select('*').eq('singleton',true).maybeSingle();
    if(settings.error)throw settings.error;
    if(!settings.data?.enabled)return out({ok:true,enabled:false,checked:0,queued:0,cancelled:0});
    const limit=Math.min(Math.max(Number(body.limit)||50,1),100);
    const due=await db.from('qrpay_order_drafts').select('id,customer_phone,conversation_id,customer_link_sent_at,working_draft,evidence').lte('next_followup_at',new Date().toISOString()).eq('followup_enabled',true).is('followup_paused_at',null).is('order_id',null).eq('payment_mode','prepaid').neq('status','confirmed').neq('status','rejected').limit(limit);
    if(due.error)throw due.error;
    const setting=await db.from('whatsapp_settings').select('text_value').eq('key','unified_inbox_24h_url').maybeSingle();
    if(setting.error)throw setting.error;
    const windowUrl=text(setting.data?.text_value);
    if(!windowUrl)return out({ok:false,error:'Unified Inbox 24H URL missing'},503);
    let responded=0;
    for(const draft of due.data||[]){
      const identity=(draft.working_draft as any)?.whatsapp_identity||(draft.evidence as any)?.whatsapp_identity||{};
      const response=await fetch(windowUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phone:draft.customer_phone||identity.phone||null,bsuid:identity.bsuid||null,conversation_id:draft.conversation_id||null})});
      const window=await response.json().catch(()=>({}));
      if(!response.ok||window.ok===false)return out({ok:false,error:`24H check failed for draft ${draft.id}`},503);
      const inbound=Date.parse(text(window.last_customer_message_at));
      const sent=Date.parse(text(draft.customer_link_sent_at));
      if(Number.isFinite(inbound)&&Number.isFinite(sent)&&inbound>sent){
        const update=await db.from('qrpay_order_drafts').update({customer_responded_at:new Date(inbound).toISOString(),followup_enabled:false,followup_paused_at:new Date().toISOString(),next_followup_at:null,updated_at:new Date().toISOString()}).eq('id',draft.id);
        if(update.error)throw update.error;
        await db.from('draft_followup_events').insert({draft_id:draft.id,event_type:'customer_responded',actor:'automation',metadata:{last_customer_message_at:window.last_customer_message_at}});
        responded+=1;
      }
    }
    const scheduled=await db.rpc('icetak_schedule_due_draft_followups',{p_limit:limit,p_force:false});
    if(scheduled.error)throw scheduled.error;
    return out({ok:true,enabled:true,checked:(due.data||[]).length,responded,...scheduled.data});
  }catch(error){return out({ok:false,error:error instanceof Error?error.message:String(error)},500)}
});
