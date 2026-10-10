import { chooseKnowledge,styleReply } from '../_shared/reply-knowledge.ts';
const url=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const cors={'access-control-allow-origin':'*','access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'content-type,authorization,apikey,x-client-info','cache-control':'no-store'};
const out=(body:unknown,status=200)=>Response.json(body,{status,headers:cors});
async function db(path:string,body?:unknown){const r=await fetch(`${url}/rest/v1/${path}`,{method:body===undefined?'GET':'POST',headers:{apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const d=await r.json();if(!r.ok)throw Error(d.message||'Database unavailable');return d;}
function draft(value:any){
 if(!value||typeof value!=='object')throw Error('Artikel tidak sah');const d:any={};
 for(const [k,max] of Object.entries({title:200,answer:4000,category:100,keywords:1200,aliases:2000,source:1000,review_note:2000,product_scope:300})){if(typeof value[k]!=='string'||value[k].length>max)throw Error(`Semak ${k}`);d[k]=value[k].trim();}
 if(!d.title||!d.answer||!d.source)throw Error('Isi tajuk, jawapan dan sumber');
 if(!Array.isArray(value.channels)||!value.channels.length||value.channels.some((v:any)=>!['whatsapp','shopee'].includes(v)))throw Error('Pilih saluran');d.channels=[...new Set(value.channels)];return d;
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return out({ok:false},405);
 try{
  const authorization=req.headers.get('authorization')||'';if(!/^Bearer\s+\S+$/i.test(authorization))return out({ok:false,error:'Sila log masuk'},401);
  const auth=await fetch(`${url}/auth/v1/user`,{headers:{apikey:key,authorization},signal:AbortSignal.timeout(10000)});const user=await auth.json();if(!auth.ok||!user.id)return out({ok:false},401);
  const [admin]=await db(`admin_users?auth_user_id=eq.${encodeURIComponent(user.id)}&is_active=eq.true&select=username,role&limit=1`);if(!admin)return out({ok:false},403);
  const [permission]=await db(`admin_permissions?username=eq.${encodeURIComponent(admin.username)}&select=permissions&limit=1`);const permissions=permission?.permissions||[];
  const owner=admin.role==='owner'||permissions.includes('manage_admins');if(!owner&&!permissions.includes('view_customers')&&!permissions.includes('manage_customers'))return out({ok:false},403);
  const b=await req.json(), action=String(b.action||'list');
  if(action==='list'){
   const offset=Math.min(10000,Math.max(0,Number(b.offset)||0));let filter='';
   if(b.status==='published')filter+='&published=not.is.null';if(b.status==='draft')filter+='&published=is.null';
   if(b.search)filter+='&draft->>title=ilike.'+encodeURIComponent('*'+String(b.search).replace(/[*%_]/g,'').slice(0,100)+'*');
   const [rows,styles]=await Promise.all([db(`reply_knowledge?select=*&order=updated_at.desc,id&limit=51&offset=${Math.floor(offset)}${filter}`),db('reply_style?select=*&order=channel')]);
   return out({ok:true,rows:rows.slice(0,50),has_more:rows.length>50,styles,can_manage:owner});
  }
  if(action==='history'){
   if(!/^[0-9a-f-]{36}$/i.test(b.id||''))return out({ok:false},400);
   return out({ok:true,events:await db(`reply_knowledge_events?article_id=eq.${b.id}&select=id,action,actor,version,created_at,snapshot&order=id.desc&limit=10`)});
  }
  if(action==='test'){
   if(typeof b.text!=='string'||!b.text.trim()||b.text.length>1000||!['whatsapp','shopee'].includes(b.channel))return out({ok:false,error:'Semak soalan dan saluran'},400);
   const [articles,profiles]=await Promise.all([db('reply_knowledge?published=not.is.null&select=id,published,published_version&limit=200'),db(`reply_style?channel=eq.${b.channel}&select=*&limit=1`)]);
   const a=chooseKnowledge(b.text,articles,b.channel,String(b.context||'').slice(0,1000));
   return out({ok:true,text:a?styleReply(a.published.answer,profiles[0]):'',sources:a?[{id:a.id,title:a.published.title,version:a.published_version,source:a.published.source}]:[],note:'Ujian FAQ sahaja. Status order diperiksa daripada order sebenar dalam Inbox.'});
  }
  if(!owner)return out({ok:false,error:'Owner diperlukan untuk mengurus Knowledge'},403);
  if(!['save','publish','unpublish','style','reset_style'].includes(action))return out({ok:false},400);
  if(b.id&&!/^[0-9a-f-]{36}$/i.test(b.id))return out({ok:false},400);
  if(b.id&&(!Number.isInteger(b.version)||b.version<1))return out({ok:false},400);
  if(action==='save')b.draft=draft(b.draft);
  if(['style','reset_style'].includes(action)&&(!['whatsapp','shopee'].includes(b.channel)||action==='style'&&typeof b.enabled!=='boolean'))return out({ok:false},400);
  const row=await db('rpc/reply_knowledge_save',{p_action:action,p_actor:admin.username,p_data:b});return out({ok:true,row});
 }catch(e){const message=e instanceof Error?e.message:'Permintaan gagal';return out({ok:false,error:message},message.includes('VERSION_CONFLICT')?409:400);}
});
