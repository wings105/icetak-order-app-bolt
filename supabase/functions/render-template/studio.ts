import {imageMeta,fontMetadata} from './studio-core.js';
import {resolveValues} from './render-fields.js';
type Obj=Record<string,any>;
const BASE=Deno.env.get('SUPABASE_URL')||'',KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',ROOT=BASE+'/storage/v1/object/public/render-templates/';
export async function readAsset(path:string){
 const r=await fetch(ROOT+path,{redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!r.ok||Number(r.headers.get('content-length')||0)>6*1024*1024)throw Error('Asset tidak tersedia / maksimum 6 MB');
 const reader=r.body!.getReader(),chunks:Uint8Array[]=[];let size=0;
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>6*1024*1024){await reader.cancel();throw Error('Asset maksimum 6 MB');}chunks.push(value);}
 const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}return bytes;
}
export async function copyFont(sku:string,font:Obj){
 const ext=font.path.split('.').at(-1),path=sku+'/fonts/'+font.id+'.'+ext;
 const present=await fetch(ROOT+path,{method:'HEAD',signal:AbortSignal.timeout(10000)});if(present.ok)return path;
 const bytes=await readAsset(font.path),r=await fetch(BASE+'/storage/v1/object/render-templates/'+path,{method:'POST',headers:{apikey:KEY,authorization:'Bearer '+KEY,'content-type':ext==='ttf'?'font/ttf':'font/otf'},body:bytes,signal:AbortSignal.timeout(25000)});
 if(!r.ok){const check=await fetch(ROOT+path,{method:'HEAD',signal:AbortSignal.timeout(10000)});if(!check.ok)throw Error('Font gagal disalin');}return path;
}
export async function studio(b:Obj,a:Obj,h:Obj){
 const rpc=(action:string,s='',data:Obj={},revision=0)=>h.rest('rpc/icetak_render_studio',{p_action:action,p_sku:s,p_actor:a.username,p_data:data,p_revision:revision});
 const action=b.action;
 if(action==='studio-list')return await rpc('list','',{q:String(b.q||'').slice(0,100),status:String(b.status||''),offset:Number(b.offset)||0});
 if(action==='studio-fonts'){
  let fonts=await rpc('fonts');if(!fonts.length){
   const templates=await h.rest('render_templates?select=font_path,config&limit=200'),paths=[...new Set<string>(templates.flatMap((t:Obj)=>[t.font_path,...(t.config.layers||[]).map((l:Obj)=>l.font_path)]).filter(Boolean))].slice(0,20);
   for(const path of paths){try{const name=fontMetadata(await readAsset(path));if(name)await rpc('font-save','',{name,path,aliases:[]});}catch{}}
   fonts=await rpc('fonts');
  }return {fonts};
 }
 const s=h.sku(b.sku);
 if(action==='studio-get')return await rpc('get',s);
 if(action==='studio-pause')return {template:await rpc('pause',s)};
 if(action==='studio-font-save'){
  const path=h.assetPath(s,b.path,'fonts'),name=String(b.name||'').trim(),aliases=b.aliases||[];
  if(!name||name.length>100||!Array.isArray(aliases)||aliases.length>20||aliases.some((x:any)=>typeof x!=='string'||x.length>100))throw Error('Nama / alias font tidak sah');
  await h.exists(path);return {font:await rpc('font-save',s,{name,aliases,path})};
 }
 if(action==='studio-font-apply'){
  const font=(await rpc('fonts')).find((f:Obj)=>f.id===b.font_id);if(!font)throw Error('Pilih font daripada koleksi');return {path:await copyFont(s,font),name:font.name};
 }
 if(action==='studio-gallery'){
  const pid=String(b.product_id||'');if(!/^[a-f0-9-]{36}$/.test(pid))throw Error('Pilih produk');
  const p=(await h.rest('products?id=eq.'+pid+'&select=id,main_image_url,parent_sku&limit=1'))[0];if(!p)throw Error('Produk tidak ditemui');
  const variants=await h.rest('product_variants?product_id=eq.'+pid+'&select=sku');if(![p.parent_sku,...variants.map((v:Obj)=>v.sku)].some(x=>String(x||'').trim().toUpperCase()===s))throw Error('SKU tidak sepadan dengan produk');
  const images=await h.rest('product_images?product_id=eq.'+pid+'&select=public_url,source_url&order=position&limit=100');
  if(![p.main_image_url,...images.flatMap((i:Obj)=>[i.public_url,i.source_url])].filter(Boolean).includes(b.image_url))throw Error('Pilih gambar daripada galeri produk');
  const source=new URL(b.image_url);if(source.protocol!=='https:'||!['cf.shopee.com.my','cf.shopee.com.sg','down-my.img.susercontent.com','down-sg.img.susercontent.com',new URL(BASE).hostname].includes(source.hostname))throw Error('Sumber ini perlu dipaste atau upload');
  const r=await fetch(source,{redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok||Number(r.headers.get('content-length')||0)>6*1024*1024)throw Error('Gambar tidak tersedia');
  const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length>6*1024*1024)throw Error('Gambar maksimum 6 MB');const meta=imageMeta(bytes),ext=meta.mime==='image/png'?'png':meta.mime==='image/jpeg'?'jpg':'webp',path=s+'/images/'+crypto.randomUUID()+'.'+ext;
  const saved=await fetch(BASE+'/storage/v1/object/render-templates/'+path,{method:'POST',headers:{apikey:KEY,authorization:'Bearer '+KEY,'content-type':meta.mime},body:bytes,signal:AbortSignal.timeout(25000)});if(!saved.ok)throw Error('Gambar gagal disimpan');return {path,...meta};
 }
 if(action==='studio-save'){
  const i=b.data;if(!i||typeof i!=='object'||Array.isArray(i))throw Error('Draft tidak sah');
  const data:Obj={product_id:i.product_id||null,variant_id:i.variant_id||null,raw_path:i.raw_path||'',reference_path:i.reference_path||'',instructions:String(i.instructions||'').slice(0,4000),font_hint:String(i.font_hint||'').slice(0,500)};
  if(i.analysis)data.analysis={summary:String(i.analysis.summary||'').slice(0,2000),warnings:(i.analysis.warnings||[]).slice(0,12),unresolved_fonts:(i.analysis.unresolved_fonts||[]).slice(0,12),confidence:Number(i.analysis.confidence)||0,origin:i.analysis.origin==='ai'?'ai':'manual',review_required:true};
  if(i.preview_path){data.preview_path=h.assetPath(s,i.preview_path,'images');await h.exists(data.preview_path);}
  if(data.raw_path){h.assetPath(s,data.raw_path,'images');const raw=imageMeta(await readAsset(data.raw_path));data.raw_size={width:raw.width,height:raw.height};data.config=h.config(i.config,s);if(data.config.width!==raw.width||data.config.height!==raw.height)throw Error('Canvas mesti sama dengan raw');data.config.automation=data.config.automation||{enabled:false,inputs:{}};data.values=resolveValues(data.config,i.values||{},{strict:true});}
  if(data.reference_path){h.assetPath(s,data.reference_path,'images');const ref=imageMeta(await readAsset(data.reference_path));data.reference_size={width:ref.width,height:ref.height};}
  return {draft:await rpc('save',s,data,Number(b.revision))};
 }
 if(action==='studio-queue'){
  const d=(await rpc('get',s)).draft;if(!d||d.revision!==b.revision)throw Error('DRAFT_CHANGED: Reload draft');const raw=d.data.raw_size,ref=d.data.reference_size;
  if(!raw||!ref||raw.width!==ref.width||raw.height!==ref.height)throw Error('Raw dan contoh siap mesti menggunakan dimensi canvas yang sama');return {job:await rpc('queue',s,{retry:b.retry===true},b.revision)};
 }
 if(action==='studio-publish'){
  if(b.confirmed!==true)throw Error('Tick pengesahan template dahulu');const d=(await rpc('get',s)).draft;if(!d||d.revision!==b.revision)throw Error('DRAFT_CHANGED: Reload draft');
  if(d.data.config?.automation?.enabled!==true)throw Error('Simpan pengesahan mapping sebelum Activate');const c=h.config(d.data.config,s);
  if((d.data.analysis?.unresolved_fonts||[]).length)throw Error('Selesaikan pilihan font dahulu');
  const raw=imageMeta(await readAsset(h.assetPath(s,d.data.raw_path,'images')));if(raw.width!==c.width||raw.height!==c.height)throw Error('Canvas berubah; semak semula');
  if(!d.data.reference_path&&d.base_version===0)throw Error('Masukkan contoh siap sebelum confirm template baru');
  if(d.data.reference_path){const ref=imageMeta(await readAsset(h.assetPath(s,d.data.reference_path,'images')));if(ref.width!==raw.width||ref.height!==raw.height)throw Error('Saiz contoh siap tidak sama dengan raw');}
  resolveValues(c,d.data.values||{},{required:true,strict:true});await Promise.all(c.layers.filter((l:Obj)=>l.font_path).map((l:Obj)=>h.exists(l.font_path)));
  return {template:await rpc('publish',s,{confirmed:true},b.revision)};
 }
 throw Error('Studio action tidak sah');
}
