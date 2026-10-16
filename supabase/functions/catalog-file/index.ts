import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
Deno.serve(async req=>{
 const headers={'cache-control':'private,no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'};
 if(req.method!=='GET')return new Response('GET required',{status:405,headers});
 try{
  const url=new URL(req.url),order=url.searchParams.get('order')||'',id=url.searchParams.get('file')||'';
  if(!/^o_[a-zA-Z0-9]{20,64}$/.test(order)||!/^[a-f0-9-]{36}$/.test(id))return new Response('Not found',{status:404,headers});
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const {data:o}=await db.from('orders').select('id').eq('public_token',order).maybeSingle();
  if(!o)return new Response('Not found',{status:404,headers});
  const {data:u}=await db.from('catalog_customer_uploads').select('storage_path').eq('id',id).eq('order_id',o.id).eq('ready',true).maybeSingle();
  if(!u)return new Response('Not found',{status:404,headers});
  const {data,error}=await db.storage.from('catalog-customer-files').createSignedUrl(u.storage_path,300);if(error)throw error;
  return new Response(null,{status:302,headers:{...headers,location:data.signedUrl}});
 }catch{return new Response('Not found',{status:404,headers});}
});
