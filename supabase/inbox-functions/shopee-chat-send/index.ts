import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {sendShopee} from '../_shared/shopee-send.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 let result:Response;
 if(req.method!=='POST')result=Response.json({error:'POST required'},{status:405});
 else try{
  const url=Deno.env.get('SUPABASE_URL')!;
  const userClient=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:req.headers.get('Authorization')||''}},auth:{persistSession:false}});
  const {data,error}=await userClient.auth.getUser();
  if(error||!data.user)result=Response.json({error:'Sila log masuk sebagai staf.'},{status:401});
  else{
   const db=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
   const {data:member}=await db.from('workspace_members').select('display_name,role,active').eq('auth_user_id',data.user.id).maybeSingle();
   if(!member||member.active!==true||!['owner','admin','staff','agent'].includes(member.role))result=Response.json({error:'Akses staf aktif diperlukan.'},{status:403});
   else result=await sendShopee(db,await req.json(),{id:data.user.id,label:member.display_name});
  }
 }catch{result=Response.json({error:'Penghantaran tidak dapat diproses.'},{status:500});}
 return new Response(result.body,{status:result.status,headers:{...cors,'Content-Type':'application/json'}});
});
