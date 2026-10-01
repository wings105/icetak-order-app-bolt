export const STORAGE_BASE='https://buivecgahhmrhlmfujgt.supabase.co/storage/v1/object/public/render-templates/';
export const API='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/render-template';
export const DEFAULT_TEXT={x:50,y:40,boxWidth:60,boxHeight:12,fontFamily:'Impact',fontWeight:'900',fontSize:86,fill:'#ffe600',stroke:'#0645d8',strokeWidth:8,align:'center',letterCase:'upper',autoFit:true,curve:0,rotation:0,tracking:0,scaleX:100,scaleY:100};
const images=new Map(),fonts=new Map();
export function loadImage(src){
 if(images.has(src))return images.get(src);
 const p=new Promise((resolve,reject)=>{
  const img=new Image();img.crossOrigin='anonymous';img.decoding='async';
  const timer=setTimeout(()=>{img.src='';reject(new Error('Template mengambil terlalu lama untuk load. Cuba semula.'));},20000);
  img.onerror=()=>{clearTimeout(timer);reject(new Error('Template gagal dimuatkan. Cuba semula atau upload semula dalam admin.'));};
  img.onload=async()=>{try{await img.decode();clearTimeout(timer);if(!img.naturalWidth||!img.naturalHeight)throw new Error('Gambar kosong');resolve(img);}catch{clearTimeout(timer);reject(new Error('Fail gambar tidak dapat dibaca. Upload PNG/JPG asal.'));}};
  img.src=src;
 });images.set(src,p);p.catch(()=>images.delete(src));return p;
}
export async function readImageFile(file){
 if(!file||!file.size||file.size>6*1024*1024)throw new Error('Fail gambar maksimum 6 MB');
 const blob=URL.createObjectURL(file);
 try{
  const img=await loadImage(blob),width=img.naturalWidth,height=img.naturalHeight;
  if(width>8000||height>8000||width*height>24000000)throw new Error('Gambar maksimum 8000px / 24 megapixel');
  return {width,height};
 }finally{images.delete(blob);URL.revokeObjectURL(blob);}
}
export async function loadFont(path,weight='400'){
 if(!path)return null;
 const id=path.replace(/[^a-z0-9]/gi,''),family='RenderFont'+id;
 const cacheKey=family+weight;
 if(!fonts.has(cacheKey)){
  const face=new FontFace(family,'url("'+STORAGE_BASE+path+'")',{weight:String(weight)});
  let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Font gagal dimuatkan. Upload semula font.')),20000);});
  const p=Promise.race([face.load(),timeout]).then(f=>{document.fonts.add(f);return family;}).finally(()=>clearTimeout(timer));
  fonts.set(cacheKey,p);p.catch(()=>fonts.delete(cacheKey));
 }
 return fonts.get(cacheKey);
}
// Legacy records stay readable without rewriting database rows.
export function normalizeConfig(c,fontPath=null){
 return {width:c?.width,height:c?.height,layers:Array.isArray(c?.layers)?c.layers.map(l=>({...l,text:{...DEFAULT_TEXT,...l.text}})):[{id:'wording',field:'name',label:'Wording',font_path:fontPath,text:{...DEFAULT_TEXT,...c?.text}}]};
}
export function getFields(c){
 return getInputFields(normalizeConfig(c));
}
export function validateConfig(c){
 if(!Number.isInteger(c.width)||!Number.isInteger(c.height)||c.width<1||c.height<1||c.width>8000||c.height>8000||c.width*c.height>24000000)throw new Error('Dimensi template tidak sah');
 const layers=normalizeConfig(c).layers;
 validatePatterns({...c,layers});
 if(!layers.length||layers.length>12)throw new Error('Gunakan 1 hingga 12 text layer');
 const ids=new Set();
 for(const l of layers){
  if(!/^[a-zA-Z0-9_-]{1,40}$/.test(l.id)||ids.has(l.id)||!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(l.field)||typeof l.label!=='string'||!l.label.trim()||l.label.length>60)throw new Error('ID layer / field tidak sah');if(['sku','constructor','prototype','__proto__'].includes(l.field))throw new Error('Nama field tidak sah');ids.add(l.id);
  const t=l.text;
  for(const [k,min,max] of [['x',0,100],['y',0,100],['boxWidth',1,100],['boxHeight',1,100],['fontSize',1,2000],['strokeWidth',0,100],['curve',-140,140],['rotation',-180,180],['tracking',-20,100],['scaleX',10,300],['scaleY',10,300]]){
   if(!Number.isFinite(t[k])||t[k]<min||t[k]>max)throw new Error(l.label+': tetapan '+k+' tidak sah');
  }
  if(!['Impact','Arial','Arial Black','Georgia','Times New Roman','Verdana','Trebuchet MS','Courier New'].includes(t.fontFamily)||!['400','700','900'].includes(String(t.fontWeight))||!['left','center','right'].includes(t.align)||!['input','upper','lower'].includes(t.letterCase)||!/^#[a-f0-9]{6}$/i.test(t.fill)||!/^#[a-f0-9]{6}$/i.test(t.stroke))throw new Error(l.label+': gaya tulisan tidak sah');
  if(t.x-t.boxWidth/2<0||t.x+t.boxWidth/2>100||t.y-t.boxHeight/2<0||t.y+t.boxHeight/2>100)throw new Error(l.label+': kawasan tulisan mesti berada dalam gambar');
 }
 if(getFields(c).length>8)throw new Error('Maksimum 8 input field');
}
// Measure the actual transformed ink, including outline, rather than just text advance.
function layoutText(ctx,text,t,size){
 const angle=t.curve*Math.PI/180,rot=t.rotation*Math.PI/180,sx=t.scaleX/100,sy=t.scaleY/100;
 const parts=[];
 if(!angle&&!t.tracking)parts.push({text,x:0,y:0,angle:0});
 else{
  const chars=typeof Intl.Segmenter==='function'?[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].map(x=>x.segment):Array.from(text);
  const widths=chars.map(ch=>ctx.measureText(ch).width),advances=widths.map((v,i)=>i===widths.length-1?v:Math.max(0.1,v+t.tracking));
  const total=advances.reduce((a,b)=>a+b,0),radius=angle?total/Math.abs(angle):0;let cursor=-total/2;
  chars.forEach((ch,i)=>{const pos=cursor+widths[i]/2,theta=angle?pos/radius:0,sign=Math.sign(angle);parts.push({text:ch,x:angle?radius*Math.sin(theta):pos,y:angle?sign*radius*(1-Math.cos(theta)):0,angle:sign*theta});cursor+=advances[i];});
 }
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const p of parts){
  const m=ctx.measureText(p.text),pad=t.strokeWidth/2;
  const a=Number.isFinite(m.actualBoundingBoxAscent)?m.actualBoundingBoxAscent:size*.8,d=Number.isFinite(m.actualBoundingBoxDescent)?m.actualBoundingBoxDescent:size*.2;
  const left=Number.isFinite(m.actualBoundingBoxLeft)?m.actualBoundingBoxLeft:m.width/2,right=Number.isFinite(m.actualBoundingBoxRight)?m.actualBoundingBoxRight:m.width/2;
  for(const [x,y] of [[-left-pad,-a-pad],[right+pad,-a-pad],[-left-pad,d+pad],[right+pad,d+pad]]){
   const gx=(p.x+x*Math.cos(p.angle)-y*Math.sin(p.angle))*sx,gy=(p.y+x*Math.sin(p.angle)+y*Math.cos(p.angle))*sy;
   const tx=gx*Math.cos(rot)-gy*Math.sin(rot),ty=gx*Math.sin(rot)+gy*Math.cos(rot);
   minX=Math.min(minX,tx);maxX=Math.max(maxX,tx);minY=Math.min(minY,ty);maxY=Math.max(maxY,ty);
  }
 }
 return {parts,minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY,rot,sx,sy};
}
export async function prepareRender(template,wording,{guides=false,selectedLayer=null}={}){
 const c=normalizeConfig(template.config,template.font_path);validateConfig(c);
 const values=resolveValues(c,typeof wording==='string'?{[c.layers[0].field]:wording}:wording||{});
 for(const f of getFields(c))if(String(values[f.key]??'').length>200)throw new Error(f.label+': maksimum 200 aksara');
 const [img,customFonts]=await Promise.all([loadImage(STORAGE_BASE+template.image_path),Promise.all(c.layers.map(l=>loadFont(l.font_path,l.text.fontWeight)))]);
 if(img.naturalWidth!==c.width||img.naturalHeight!==c.height)throw new Error('Dimensi template tidak sepadan. Upload dan Save semula template.');
 const canvas=document.createElement('canvas');canvas.width=c.width;canvas.height=c.height;
 const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const results=[];
 for(let index=0;index<c.layers.length;index++){
  const l=c.layers[index],t=l.text,raw=resolveLayerText(l,values);
  const text=(t.letterCase==='upper'?raw.toUpperCase():t.letterCase==='lower'?raw.toLowerCase():raw).trim();
  const x=c.width*t.x/100,y=c.height*t.y/100,w=c.width*t.boxWidth/100,h=c.height*t.boxHeight/100,family=customFonts[index]||t.fontFamily;
  await document.fonts.load(t.fontWeight+' '+t.fontSize+'px "'+family+'", sans-serif',text||'A');
  ctx.textAlign='center';ctx.textBaseline='alphabetic';
  const measure=n=>{ctx.font=t.fontWeight+' '+n+'px "'+family+'", sans-serif';return layoutText(ctx,text,t,n);};
  let size=t.fontSize;
  if(text){
   const fits=n=>{const m=measure(n);return m.width<=w&&m.height<=h;};
   if(t.autoFit){if(!fits(1))throw new Error(l.label+': ruang terlalu kecil untuk wording / outline');if(!fits(size)){let low=1,high=size;for(let i=0;i<20;i++){const mid=(low+high)/2;if(fits(mid))low=mid;else high=mid;}size=Math.floor(low*10)/10;}}
   const m=measure(size);
   if(m.width>w+.01||m.height>h+.01)throw new Error(l.label+': tulisan melebihi ruang. Aktifkan auto-fit atau besarkan kawasan.');
   const tx=t.align==='left'?x-w/2-m.minX:t.align==='right'?x+w/2-m.maxX:x-(m.minX+m.maxX)/2,ty=y-(m.minY+m.maxY)/2;
   ctx.save();ctx.translate(tx,ty);ctx.rotate(m.rot);ctx.scale(m.sx,m.sy);ctx.lineJoin='round';ctx.miterLimit=2;ctx.lineWidth=t.strokeWidth;ctx.strokeStyle=t.stroke;ctx.fillStyle=t.fill;
   // All strokes precede fills so close-spaced letters do not erase neighbouring fills.
   for(const stroke of t.strokeWidth>0?[true,false]:[false])for(const p of m.parts){ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.angle);if(stroke)ctx.strokeText(p.text,0,0);else ctx.fillText(p.text,0,0);ctx.restore();}
   ctx.restore();
  }
  results.push({id:l.id,label:l.label,text,fontSize:size});
 }
 if(guides)for(const l of c.layers){const t=l.text,x=c.width*t.x/100,y=c.height*t.y/100,w=c.width*t.boxWidth/100,h=c.height*t.boxHeight/100;ctx.save();ctx.strokeStyle=!selectedLayer||l.id===selectedLayer?'#10b981':'#94a3b8';ctx.lineWidth=Math.max(1,c.width/600);ctx.setLineDash([c.width/100,c.width/150]);ctx.strokeRect(x-w/2,y-h/2,w,h);ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(x-10,y);ctx.lineTo(x+10,y);ctx.moveTo(x,y-10);ctx.lineTo(x,y+10);ctx.stroke();ctx.restore();}
 return {canvas,fontSize:results[0].fontSize,text:results[0].text,layers:results};
}
export function displayRender(target,result){
 target.width=result.canvas.width;target.height=result.canvas.height;
 target.getContext('2d').drawImage(result.canvas,0,0);
}
export async function downloadCanvas(canvas,filename){
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
 if(!blob)throw new Error('PNG gagal dijana');
 const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000);
}
import {getInputFields,validatePatterns,resolveValues,resolveLayerText} from './fields.js';
