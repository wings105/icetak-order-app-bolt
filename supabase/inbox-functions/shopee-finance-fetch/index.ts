import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { shopeeRequest, tokenExpired, sha256 } from '../_shared/shopee-direct.ts';
const out=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
function clean(value:any,depth=0):any {
 if(depth>18)return null;if(Array.isArray(value))return value.map(x=>clean(x,depth+1));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!/secret|password|api.?key|access.?token|refresh.?token|authorization|signature|^token$/i.test(k)).map(([k,v])=>[k,clean(v,depth+1)]));
 return value;
}
Deno.serve(async req=>{
 if(req.method!=='POST')return out({ok:false,error:'POST_REQUIRED'},405);
 try{
  if(!req.headers.get('x-admin-window-token'))return out({ok:false,error:'UNAUTHORIZED'},401);
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const {data:settings,error:authError}=await db.from('private_runtime_settings').select('setting_value').eq('setting_key','admin_window_bridge_token').limit(1);
  const expected=settings?.[0]?.setting_value,supplied=req.headers.get('x-admin-window-token')||'';
  if(authError||!expected||!supplied||await sha256(expected)!==await sha256(supplied))return out({ok:false,error:'UNAUTHORIZED'},401);
  const raw=await req.text();if(raw.length>8000)return out({ok:false,error:'PAYLOAD_TOO_LARGE'},413);
  const b=JSON.parse(raw);const shop=String(b.shop_id||'');if(!/^[1-9][0-9]{0,14}$/.test(shop))return out({ok:false,error:'SHOP_REQUIRED'},400);
  const {data:c,error}=await db.rpc('icetak_shopee_chat_config',{p_action:'get',p_body:{shop_id:shop}});
  if(error||!c?.shop_id||String(c.shop_id)!==shop||!c.partner_key||!c.access_token)return out({ok:false,error:'SHOP_CREDENTIALS_REQUIRED'},409);
  if(!c.enabled)return out({ok:false,error:'SHOP_DISABLED'},409);
  if(tokenExpired(c))return out({ok:false,error:'TOKEN_EXPIRED'},409);
  let path:any,params:Record<string,unknown>;
  if(b.action==='escrow'){
   const sn=String(b.order_sn||'').toUpperCase();if(!/^[A-Z0-9-]{6,64}$/.test(sn))return out({ok:false,error:'ORDER_REQUIRED'},400);
   path='/api/v2/payment/get_escrow_detail';params={order_sn:sn};
  }else if(b.action==='releases'){
   const from=Math.floor(Number(b.from)),to=Math.floor(Number(b.to)),page=Math.floor(Number(b.page)||1);
   if(!Number.isFinite(from)||!Number.isFinite(to)||from<=0||to<from||to-from>604800||page<1||page>100)return out({ok:false,error:'INVALID_RELEASE_WINDOW'},400);
   path='/api/v2/payment/get_escrow_list';params={release_time_from:from,release_time_to:to,page_size:100,page_no:page};
  }else if(b.action==='return'){
   const sn=String(b.return_sn||'');if(!/^[A-Za-z0-9-]{6,64}$/.test(sn))return out({ok:false,error:'RETURN_REQUIRED'},400);
   path='/api/v2/returns/get_return_detail';params={return_sn:sn};
  }else return out({ok:false,error:'INVALID_ACTION'},400);
  const response=await shopeeRequest(c,path,params,'GET');const body=await response.json().catch(()=>({}));
  if(!response.ok||body.error){const code=String(body.error||`HTTP_${response.status}`);return out({ok:false,error:/^[A-Za-z0-9_.-]{1,80}$/.test(code)?`SHOPEE_${code}`:'SHOPEE_REJECTED',retryable:response.status===429||response.status>=500},response.status===429?429:502);}
  const data=body.response||body.data;if(!data||typeof data!=='object')return out({ok:false,error:'SHOPEE_RESPONSE_MISSING'},502);
  return out({ok:true,shop_id:shop,action:b.action,response:clean(data)});
 }catch{return out({ok:false,error:'FINANCE_READ_FAILED',retryable:true},503);}
});
