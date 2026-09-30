export const STORAGE_BASE='https://buivecgahhmrhlmfujgt.supabase.co/storage/v1/object/public/render-templates/';
export const API='https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/render-template';
export const DEFAULT_TEXT={x:50,y:40,boxWidth:60,boxHeight:12,fontFamily:'Impact',fontWeight:'900',fontSize:86,fill:'#ffe600',stroke:'#0645d8',strokeWidth:8,align:'center',letterCase:'upper',autoFit:true};
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
export function validateConfig(c){
 const t=c?.text;
 if(!t||!Number.isInteger(c.width)||!Number.isInteger(c.height)||c.width<1||c.height<1||c.width>8000||c.height>8000||c.width*c.height>24000000)throw new Error('Dimensi template tidak sah');
 for(const [k,min,max] of [['x',0,100],['y',0,100],['boxWidth',1,100],['boxHeight',1,100],['fontSize',1,2000],['strokeWidth',0,100]]){
  if(!Number.isFinite(t[k])||t[k]<min||t[k]>max)throw new Error('Tetapan '+k+' tidak sah');
 }
 if(t.x-t.boxWidth/2<0||t.x+t.boxWidth/2>100||t.y-t.boxHeight/2<0||t.y+t.boxHeight/2>100)throw new Error('Kawasan tulisan mesti berada dalam gambar');
}
export async function prepareRender(template,wording,{guides=false}={}){
 const c=template.config,t=c.text;validateConfig(c);
 if(String(wording).length>200)throw new Error('Wording maksimum 200 aksara');
 const [img,custom]=await Promise.all([loadImage(STORAGE_BASE+template.image_path),loadFont(template.font_path,t.fontWeight)]);
 if(img.naturalWidth!==c.width||img.naturalHeight!==c.height)throw new Error('Dimensi template tidak sepadan. Upload dan Save semula template.');
 const canvas=document.createElement('canvas');canvas.width=c.width;canvas.height=c.height;
 const ctx=canvas.getContext('2d');
 ctx.drawImage(img,0,0);
 const text=(t.letterCase==='upper'?String(wording).toUpperCase():t.letterCase==='lower'?String(wording).toLowerCase():String(wording)).trim();
 const x=c.width*t.x/100,y=c.height*t.y/100,w=c.width*t.boxWidth/100,h=c.height*t.boxHeight/100;
 const family=custom||t.fontFamily;
 const setFont=size=>{ctx.font=t.fontWeight+' '+size+'px "'+family+'"';};
 await document.fonts.load(t.fontWeight+' '+t.fontSize+'px "'+family+'"',text||'A');
 const metrics=size=>{setFont(size);const m=ctx.measureText(text);return {width:Math.max(m.width,m.actualBoundingBoxLeft+m.actualBoundingBoxRight)+t.strokeWidth,height:m.actualBoundingBoxAscent+m.actualBoundingBoxDescent+t.strokeWidth,m};};
 let size=t.fontSize;
 if(text){
  const fits=n=>{const m=metrics(n);return m.width<=w&&m.height<=h;};
  if(t.autoFit){if(!fits(1))throw new Error('Ruang tulisan terlalu kecil untuk wording / outline ini');let low=1,high=size;for(let i=0;i<20;i++){const mid=(low+high)/2;if(fits(mid))low=mid;else high=mid;}size=Math.floor(low*10)/10;}
  const m=metrics(size);
  if(m.width>w||m.height>h)throw new Error('Tulisan melebihi ruang. Aktifkan auto-fit atau besarkan kawasan.');
  ctx.textAlign=t.align;ctx.textBaseline='alphabetic';ctx.lineJoin='round';ctx.miterLimit=2;
  const tx=t.align==='left'?x-w/2+t.strokeWidth/2:t.align==='right'?x+w/2-t.strokeWidth/2:x;
  const ty=y+(m.m.actualBoundingBoxAscent-m.m.actualBoundingBoxDescent)/2;
  if(t.strokeWidth>0){ctx.lineWidth=t.strokeWidth;ctx.strokeStyle=t.stroke;ctx.strokeText(text,tx,ty);}
  ctx.fillStyle=t.fill;ctx.fillText(text,tx,ty);
 }
 if(guides){ctx.save();ctx.strokeStyle='#10b981';ctx.lineWidth=Math.max(1,c.width/600);ctx.setLineDash([c.width/100,c.width/150]);ctx.strokeRect(x-w/2,y-h/2,w,h);ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(x-10,y);ctx.lineTo(x+10,y);ctx.moveTo(x,y-10);ctx.lineTo(x,y+10);ctx.stroke();ctx.restore();}
 return {canvas,fontSize:size,text};
}
export function displayRender(target,result){
 target.width=result.canvas.width;target.height=result.canvas.height;
 target.getContext('2d').drawImage(result.canvas,0,0);
}
export async function downloadCanvas(canvas,filename){
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
 if(!blob)throw new Error('PNG gagal dijana');
 const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);
}
