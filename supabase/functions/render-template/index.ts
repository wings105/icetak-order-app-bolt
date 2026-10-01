import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {getInputFields,validatePatterns,resolveValues} from './render-fields.js';
const url=Deno.env.get('SUPABASE_URL')||'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const bucket='render-templates', maxBytes=6*1024*1024;
const cors={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type,x-client-info'};
const out=(body:unknown,status=200)=>Response.json(body,{status,headers:{...cors,'cache-control':'no-store'}});
async function rest(path:string,body?:unknown){
 const r=await fetch(url+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',headers:{apikey:key,authorization:'Bearer '+key,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const data=await r.json();if(!r.ok)throw new Error(data.message||'Database unavailable');return data;
}
async function admin(req:Request){
 const auth=req.headers.get('authorization')||'';if(!auth.startsWith('Bearer '))return null;
 const r=await fetch(url+'/auth/v1/user',{headers:{apikey:key,authorization:auth},signal:AbortSignal.timeout(10000)});
 if(!r.ok)return null;const user=await r.json();
 const rows=await rest('admin_users?auth_user_id=eq.'+encodeURIComponent(user.id)+'&is_active=eq.true&select=username,role&limit=1');
 if(!rows[0])return null;
 const ps=await rest('admin_permissions?username=eq.'+encodeURIComponent(rows[0].username)+'&select=permissions&limit=1');
 return {...rows[0],allowed:rows[0].role==='owner'||(ps[0]?.permissions||[]).includes('manage_admins')};
}
function sku(value:unknown){const s=String(value||'').trim().toUpperCase();if(!/^[A-Z0-9_-]{1,40}$/.test(s))throw new Error('SKU tidak sah');return s;}
function textStyle(t:any){
 if(!t)throw new Error('Tetapan tulisan diperlukan');const style:any={};
 for(const [k,min,max,defaultValue] of [['x',0,100,null],['y',0,100,null],['boxWidth',1,100,null],['boxHeight',1,100,null],['fontSize',1,2000,null],['strokeWidth',0,100,null],['curve',-140,140,0],['rotation',-180,180,0],['tracking',-20,100,0],['scaleX',10,300,100],['scaleY',10,300,100]] as const){
  const n=Number(t[k]??defaultValue);if(!Number.isFinite(n)||n<min||n>max)throw new Error('Tetapan '+k+' tidak sah');style[k]=n;
 }
 for(const k of ['fill','stroke']){if(!/^#[a-f0-9]{6}$/i.test(t[k]||''))throw new Error('Warna tidak sah');style[k]=t[k];}
 if(!['Impact','Arial','Arial Black','Georgia','Times New Roman','Verdana','Trebuchet MS','Courier New'].includes(t.fontFamily))throw new Error('Font tidak sah');
 if(!['400','700','900'].includes(String(t.fontWeight)))throw new Error('Font weight tidak sah');
 if(!['left','center','right'].includes(t.align)||!['input','upper','lower'].includes(t.letterCase))throw new Error('Alignment / huruf tidak sah');
 Object.assign(style,{fontFamily:t.fontFamily,fontWeight:String(t.fontWeight),align:t.align,letterCase:t.letterCase,autoFit:t.autoFit!==false});
 const bw=style.boxWidth/2,bh=style.boxHeight/2;
 if(style.x-bw<0||style.x+bw>100||style.y-bh<0||style.y+bh>100)throw new Error('Kawasan tulisan mesti berada dalam gambar');return style;
}
function config(value:any,s:string){
 const c:any={width:Number(value?.width),height:Number(value?.height)};
 if(!Number.isInteger(c.width)||!Number.isInteger(c.height)||c.width<1||c.height<1||c.width>8000||c.height>8000||c.width*c.height>24000000)throw new Error('Gambar maksimum 8000px / 24 megapixel');
 // Keep the legacy response shape for older hosted editors.
 if(!Array.isArray(value.layers)){c.text=textStyle(value?.text);return c;}
 if(!value.layers.length||value.layers.length>12)throw new Error('Gunakan 1 hingga 12 text layer');
 const ids=new Set(),fields=new Set();
 c.layers=value.layers.map((l:any)=>{
  if(!l||!/^[a-zA-Z0-9_-]{1,40}$/.test(l.id)||ids.has(l.id)||!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(l.field)||typeof l.label!=='string'||!l.label.trim()||l.label.length>60)throw new Error('ID layer / field tidak sah');
  if(['sku','__proto__','constructor','prototype'].includes(l.field))throw new Error('Nama field tidak sah');ids.add(l.id);fields.add(l.field);
  return {id:l.id,field:l.field,label:l.label.trim(),font_path:assetPath(s,l.font_path,'fonts',true),text:textStyle(l.text),...(l.pattern!==undefined?{pattern:l.pattern}:{}),...(l.field_labels?{field_labels:l.field_labels}:{}),...(l.legacy_full_wording===true?{legacy_full_wording:true}:{})};
 });
 if(fields.size>8)throw new Error('Maksimum 8 input field');
 const labels=new Map();for(const l of c.layers){if(labels.has(l.field)&&labels.get(l.field)!==l.label)throw new Error('Label input yang sama mesti sepadan');labels.set(l.field,l.label);}
 validatePatterns(c);return c;
}
function assetPath(s:string,path:unknown,kind:string,optional=false){
 if(optional&&!path)return null;
 const p=String(path||''),prefix=s+'/'+kind+'/';
 if(!p.startsWith(prefix)||!/^([A-Z0-9_-]+)\/(images|fonts)\/[a-f0-9-]+\.(png|jpg|webp|ttf|otf)$/.test(p)||(kind==='images'?!/\.(png|jpg|webp)$/.test(p):!/\.(ttf|otf)$/.test(p)))throw new Error('Asset template tidak sah');
 return p;
}
async function exists(path:string){
 const r=await fetch(url+'/storage/v1/object/public/'+bucket+'/'+path,{signal:AbortSignal.timeout(15000)});
 await r.body?.cancel();if(!r.ok)throw new Error('Asset gagal load. Upload semula sebelum Save.');
}
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes)).map(b=>b.toString(16).padStart(2,'0')).join('');
async function automationAuth(req:Request){
 const auth=req.headers.get('authorization')||'',token=auth.replace(/^Bearer /,'');
 if(/^rk_[a-f0-9]{64}$/.test(token)){
  const hash=hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)));
  const check=await rest('rpc/icetak_render_key_authorize',{p_hash:hash});
  if(!check.allowed)throw Object.assign(new Error(check.error||'API key tidak sah'),{status:check.status||401});
  return {username:check.actor};
 }
 const a=await admin(req);if(!a)throw Object.assign(new Error('API key / admin login diperlukan'),{status:401});
 if(!a.allowed)throw Object.assign(new Error('Akses Owner / Manage Admins diperlukan'),{status:403});return a;
}
async function signedKey(){return crypto.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
function signedPayload(s:string,fields:Record<string,string>,version:number,expires:number){return new TextEncoder().encode(JSON.stringify({sku:s,fields:Object.entries(fields).sort(([a],[b])=>a.localeCompare(b)),version,expires}));}
async function automation(req:Request,b:any){
 const s=sku(b.sku);
 if(b.action==='automation-template'&&b.sig){
  const expires=Number(b.expires),version=Number(b.version);
  if(!Number.isInteger(expires)||expires<Math.floor(Date.now()/1000)||expires>Math.floor(Date.now()/1000)+1805||!Number.isInteger(version)||!/^([a-f0-9]{64})$/.test(b.sig))throw Object.assign(new Error('Link output tamat tempoh / tidak sah'),{status:401});
  const fields=resolveValues({layers:[]} as any,b.fields);
  const signature=Uint8Array.from(b.sig.match(/../g), (v:string)=>parseInt(v,16));
  if(!await crypto.subtle.verify('HMAC',await signedKey(),signature,signedPayload(s,fields,version,expires)))throw Object.assign(new Error('Link output tidak sah'),{status:401});
 }else await automationAuth(req);
 const rows=await rest('render_templates?sku=eq.'+encodeURIComponent(s)+'&select=sku,image_path,font_path,config,version&limit=1');
 if(!rows[0])throw Object.assign(new Error('Template '+s+' belum disimpan'),{status:404});
 const template=rows[0];
 if(b.version!==undefined&&Number(b.version)!==template.version)throw Object.assign(new Error('Template berubah. Jana link output baru.'),{status:409});
 const c=Array.isArray(template.config.layers)?template.config:{...template.config,layers:[{field:'name',label:'Wording',text:template.config.text}]};
 const fields=resolveValues(c,b.fields,{required:true,strict:true});
 if(b.action==='automation-template')return out({ok:true,template});
 const expires=Math.floor(Date.now()/1000)+1800,version=template.version;
 const sig=hex(await crypto.subtle.sign('HMAC',await signedKey(),signedPayload(s,fields,version,expires)));
 const query={sku:s,...fields,version:String(version),expires:String(expires),sig};
 return out({ok:true,query,expires,fields:getInputFields(c),version});
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 try{
  if(req.method==='GET'){
   const s=sku(new URL(req.url).searchParams.get('sku'));
   const rows=await rest('render_templates?sku=eq.'+encodeURIComponent(s)+'&select=sku,image_path,font_path,config,version&limit=1');
   return rows[0]?out({ok:true,template:rows[0]}):out({ok:false,error:'Template '+s+' belum disimpan. Upload melalui Admin Render Templates dahulu.'},404);
  }
  if(req.method!=='POST')return out({ok:false,error:'Method not allowed'},405);
  const multipart=(req.headers.get('content-type')||'').startsWith('multipart/form-data');
  if(!multipart&&Number(req.headers.get('content-length')||0)>65536)return out({ok:false,error:'Request terlalu besar'},413);
  const b=multipart?null:await req.json();
  if(b?.action==='automation-template'||b?.action==='automation-link')return await automation(req,b);
  const a=await admin(req);if(!a)return out({ok:false,error:'Sila log masuk sebagai admin'},401);
  if(!a.allowed)return out({ok:false,error:'Akses Owner / Manage Admins diperlukan'},403);
  if(Number(req.headers.get('content-length')||0)>maxBytes+65536)return out({ok:false,error:'Fail maksimum 6 MB'},413);
  if((req.headers.get('content-type')||'').startsWith('multipart/form-data')){
   const form=await req.formData(),s=sku(form.get('sku')),kind=String(form.get('kind')||''),file=form.get('file');
   if(!(file instanceof File)||!file.size||file.size>maxBytes||!['images','fonts'].includes(kind))throw new Error('Pilih fail sah, maksimum 6 MB');
   const bytes=new Uint8Array(await file.arrayBuffer()),sig=Array.from(bytes.slice(0,8)).join(','),ascii=new TextDecoder().decode(bytes.slice(0,12));
   let ext='',mime='';
   if(kind==='images'){
    if(sig==='137,80,78,71,13,10,26,10'){ext='png';mime='image/png';}
    else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255){ext='jpg';mime='image/jpeg';}
    else if(ascii.startsWith('RIFF')&&ascii.slice(8,12)==='WEBP'){ext='webp';mime='image/webp';}
   }else{
    if(bytes[0]===0&&bytes[1]===1&&bytes[2]===0&&bytes[3]===0){ext='ttf';mime='font/ttf';}
    else if(ascii.startsWith('OTTO')){ext='otf';mime='font/otf';}
   }
   if(!ext)throw new Error(kind==='images'?'Gunakan PNG, JPG atau WebP asal':'Gunakan font TTF atau OTF');
   const path=s+'/'+kind+'/'+crypto.randomUUID()+'.'+ext;
   const r=await fetch(url+'/storage/v1/object/'+bucket+'/'+path,{method:'POST',headers:{apikey:key,authorization:'Bearer '+key,'content-type':mime,'cache-control':'max-age=31536000'},body:bytes,signal:AbortSignal.timeout(30000)});
   if(!r.ok)throw new Error('Upload gagal ('+r.status+')');
   return out({ok:true,path});
  }
  if(b.action==='automation-key'){
   const token='rk_'+hex(crypto.getRandomValues(new Uint8Array(32)).buffer),hash=hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)));
   await rest('rpc/icetak_render_key_rotate',{p_actor:a.username,p_hash:hash});
   return out({ok:true,token,message:'Simpan key dalam AP. Key lama bagi admin ini dibatalkan.'});
  }
  if(b.action==='automation-revoke'){await rest('rpc/icetak_render_key_revoke',{p_actor:a.username});return out({ok:true});}
  if(b.action==='list')return out({ok:true,templates:await rest('render_templates?select=sku,image_path,font_path,config,version,updated_at&order=sku&limit=200')});
  if(b.action!=='save')throw new Error('Action tidak sah');
  const s=sku(b.sku),image=assetPath(s,b.image_path,'images')!,font=assetPath(s,b.font_path,'fonts',true),c=config(b.config,s);
  if(!Number.isInteger(b.expected_version)||b.expected_version<0)throw new Error('Version diperlukan');
  const paths=new Set<string>([image]);if(font)paths.add(font);for(const l of c.layers||[])if(l.font_path)paths.add(l.font_path);await Promise.all([...paths].map(exists));
  const template=await rest('rpc/icetak_render_template_save',{p_actor:a.username,p_sku:s,p_image_path:image,p_font_path:font,p_config:c,p_expected_version:b.expected_version});
  return out({ok:true,template});
 }catch(e){const error=e instanceof Error?e.message:'Request failed';return out({ok:false,error},(e as any)?.status||(error.includes('TEMPLATE_CHANGED')?409:400));}
});
