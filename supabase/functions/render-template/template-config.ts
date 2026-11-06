import {validatePatterns} from './render-fields.js';
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
export function config(value:any,s:string){
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
 if(value.automation!==undefined)c.automation=value.automation;
 validatePatterns(c);return c;
}
export function assetPath(s:string,path:unknown,kind:string,optional=false){
 if(optional&&!path)return null;
 const p=String(path||''),prefix=s+'/'+kind+'/';
 if(!p.startsWith(prefix)||!/^([A-Z0-9_-]+)\/(images|fonts)\/[a-f0-9-]+\.(png|jpg|webp|ttf|otf)$/.test(p)||(kind==='images'?!/\.(png|jpg|webp)$/.test(p):!/\.(ttf|otf)$/.test(p)))throw new Error('Asset template tidak sah');
 return p;
}
