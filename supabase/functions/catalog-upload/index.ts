import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
const cors={'access-control-allow-origin':'*','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type,x-client-info,x-admin-window-token'};
const response=(v:unknown,status=200)=>Response.json(v,{status,headers:{...cors,'cache-control':'no-store'}});
const digest=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return response({ok:false,error:'POST_REQUIRED'},405);
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 try{
  if((req.headers.get('content-type')||'').includes('application/json')){
   const b=await req.json();
   if(b.action==='cleanup'){
    const {data:s}=await db.from('private_runtime_settings').select('setting_value').eq('setting_key','admin_window_bridge_token').single();
    if(!s?.setting_value||req.headers.get('x-admin-window-token')!==s.setting_value)return response({ok:false,error:'UNAUTHORIZED'},401);
    const {data:rows,error}=await db.from('catalog_customer_uploads').select('id,storage_path').is('order_id',null).lt('expires_at',new Date().toISOString()).limit(100);if(error)throw error;
    if(rows?.length){const {error:e}=await db.storage.from('catalog-customer-files').remove(rows.map(x=>x.storage_path));if(e)throw e;await db.from('catalog_customer_uploads').delete().in('id',rows.map(x=>x.id)).is('order_id',null);}
    await db.from('catalog_upload_limits').delete().lt('expires_at',new Date().toISOString());return response({ok:true,removed:rows?.length||0});
   }
   if(b.action!=='preview'||!/^[a-f0-9]{64}$/.test(String(b.token||'')))throw Error('INVALID_UPLOAD_REFERENCE');
   const {data:u}=await db.from('catalog_customer_uploads').select('*').eq('id',b.id).eq('ready',true).maybeSingle();
   // SQL receipt stores a SHA-256 token; no raw capability is retained server-side.
   if(!u||u.token_hash!==await digest(b.token)||new Date(u.expires_at)<new Date())return response({ok:false,error:'FILE_UNAVAILABLE'},404);
   const {data,error}=await db.storage.from('catalog-customer-files').createSignedUrl(u.storage_path,300);if(error)throw error;return response({ok:true,url:data.signedUrl});
  }
  const reader=req.body?.getReader();if(!reader)throw Error('FILE_REQUIRED');let length=0;const parts:Uint8Array[]=[];
  for(;;){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>8*1024*1024+65536){await reader.cancel();return response({ok:false,error:'MAX_8_MB'},413);}parts.push(value);}
  const data=await new Response(new Blob(parts),{headers:{'content-type':req.headers.get('content-type')||''}}).formData();const file=data.get('file'),product=String(data.get('product_id')||'');
  if(!(file instanceof File)||file.size<1||file.size>8388608)throw Error('MAX_8_MB');
  const bytes=new Uint8Array(await file.arrayBuffer());let mime='',ext='';
  if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff){mime='image/jpeg';ext='jpg';}
  else if(bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10'){mime='image/png';ext='png';}
  else if(new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP'){mime='image/webp';ext='webp';}
  else throw Error('JPEG_PNG_WEBP_ONLY');
  const client=await digest((req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')?.split(',')[0]||'unknown')+Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  const {data:allowed,error:gateError}=await db.rpc('icetak_catalog_upload_gate',{p_product:product,p_client:client});if(gateError||!allowed)return response({ok:false,error:'UPLOAD_NOT_AVAILABLE_OR_LIMIT'},429);
  const id=crypto.randomUUID(),token=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(x=>x.toString(16).padStart(2,'0')).join(''),path=`originals/${id}.${ext}`,name=file.name.replace(/[\x00-\x1f\\/]/g,'_').slice(0,120)||`gambar.${ext}`;
  const {error:insert}=await db.from('catalog_customer_uploads').insert({id,product_id:product,storage_path:path,original_name:name,mime_type:mime,bytes:file.size,token_hash:await digest(token)});if(insert)throw insert;
  const {error:upload}=await db.storage.from('catalog-customer-files').upload(path,bytes,{contentType:mime,upsert:false});if(upload){await db.from('catalog_customer_uploads').delete().eq('id',id);throw upload;}
  const {error:ready}=await db.from('catalog_customer_uploads').update({ready:true}).eq('id',id);if(ready)throw ready;
  return response({ok:true,file:{id,token,name,mime,bytes:file.size}});
 }catch(e){return response({ok:false,error:String((e as Error).message).slice(0,160)},400);}
});
