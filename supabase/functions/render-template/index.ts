import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
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
function config(value:any){
 const t=value?.text;if(!t)throw new Error('Tetapan tulisan diperlukan');
 const c:any={width:Number(value.width),height:Number(value.height),text:{}};
 if(!Number.isInteger(c.width)||!Number.isInteger(c.height)||c.width<1||c.height<1||c.width>8000||c.height>8000||c.width*c.height>24000000)throw new Error('Gambar maksimum 8000px / 24 megapixel');
 for(const [k,min,max] of [['x',0,100],['y',0,100],['boxWidth',1,100],['boxHeight',1,100],['fontSize',1,2000],['strokeWidth',0,100]] as const){
  const n=Number(t[k]);if(!Number.isFinite(n)||n<min||n>max)throw new Error('Tetapan '+k+' tidak sah');c.text[k]=n;
 }
 for(const k of ['fill','stroke']){if(!/^#[a-f0-9]{6}$/i.test(t[k]||''))throw new Error('Warna tidak sah');c.text[k]=t[k];}
 if(!['Impact','Arial','Arial Black','Georgia','Times New Roman','Verdana','Trebuchet MS','Courier New'].includes(t.fontFamily))throw new Error('Font tidak sah');
 if(!['400','700','900'].includes(String(t.fontWeight)))throw new Error('Font weight tidak sah');
 if(!['left','center','right'].includes(t.align)||!['input','upper','lower'].includes(t.letterCase))throw new Error('Alignment / huruf tidak sah');
 Object.assign(c.text,{fontFamily:t.fontFamily,fontWeight:String(t.fontWeight),align:t.align,letterCase:t.letterCase,autoFit:t.autoFit!==false});
 const bw=c.text.boxWidth/2,bh=c.text.boxHeight/2;
 if(c.text.x-bw<0||c.text.x+bw>100||c.text.y-bh<0||c.text.y+bh>100)throw new Error('Kawasan tulisan mesti berada dalam gambar');
 return c;
}
function assetPath(s:string,path:unknown,kind:string,optional=false){
 if(optional&&!path)return null;
 const p=String(path||''),prefix=s+'/'+kind+'/';
 if(!p.startsWith(prefix)||!/^([A-Z0-9_-]+)\/(images|fonts)\/[a-f0-9-]+\.(png|jpg|webp|ttf|otf)$/.test(p))throw new Error('Asset template tidak sah');
 return p;
}
async function exists(path:string){
 const r=await fetch(url+'/storage/v1/object/public/'+bucket+'/'+path,{signal:AbortSignal.timeout(15000)});
 await r.body?.cancel();if(!r.ok)throw new Error('Asset gagal load. Upload semula sebelum Save.');
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
  const b=await req.json();
  if(b.action==='list')return out({ok:true,templates:await rest('render_templates?select=sku,image_path,font_path,config,version,updated_at&order=sku&limit=200')});
  if(b.action!=='save')throw new Error('Action tidak sah');
  const s=sku(b.sku),c=config(b.config),image=assetPath(s,b.image_path,'images')!,font=assetPath(s,b.font_path,'fonts',true);
  if(!Number.isInteger(b.expected_version)||b.expected_version<0)throw new Error('Version diperlukan');
  await Promise.all([exists(image),font?exists(font):Promise.resolve()]);
  const template=await rest('rpc/icetak_render_template_save',{p_actor:a.username,p_sku:s,p_image_path:image,p_font_path:font,p_config:c,p_expected_version:b.expected_version});
  return out({ok:true,template});
 }catch(e){const error=e instanceof Error?e.message:'Request failed';return out({ok:false,error},error.includes('TEMPLATE_CHANGED')?409:400);}
});
