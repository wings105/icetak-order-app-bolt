export const BUILTIN_FONTS=['Impact','Arial','Arial Black','Georgia','Times New Roman','Verdana','Trebuchet MS','Courier New'];
const fontKey=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g,'');
export function matchFont(name,fonts){
 const key=fontKey(name);if(!key)return null;
 const found=fonts.filter(f=>[f.name,...(f.aliases||[])].some(n=>fontKey(n)===key));
 if(found.length>1)return null;
 if(found.length===1)return {path:found[0].path,name:found[0].name};
 const builtin=BUILTIN_FONTS.find(n=>fontKey(n)===key);return builtin?{path:null,name:builtin}:null;
}
export function imageMeta(b){
 const v=new DataView(b.buffer,b.byteOffset,b.byteLength);let width=0,height=0,mime='';
 const ascii=(a,n)=>String.fromCharCode(...b.slice(a,a+n));
 if(b.length>=24&&b.slice(0,8).join(',')==='137,80,78,71,13,10,26,10'){width=v.getUint32(16);height=v.getUint32(20);mime='image/png';}
 else if(b.length>12&&b[0]===255&&b[1]===216){let i=2;while(i+10<b.length){if(b[i]!==255){i++;continue;}const m=b[i+1];if(m===217||m===218)break;if(m===0||m===255){i++;continue;}const len=v.getUint16(i+2);if(len<2||i+2+len>b.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(m)){height=v.getUint16(i+5);width=v.getUint16(i+7);mime='image/jpeg';break;}i+=len+2;}}
 else if(b.length>=30&&ascii(0,4)==='RIFF'&&ascii(8,4)==='WEBP'){mime='image/webp';const kind=ascii(12,4);if(kind==='VP8X'){width=1+b[24]+(b[25]<<8)+(b[26]<<16);height=1+b[27]+(b[28]<<8)+(b[29]<<16);}else if(kind==='VP8 '&&b[23]===157&&b[24]===1&&b[25]===42){width=v.getUint16(26,true)&16383;height=v.getUint16(28,true)&16383;}else if(kind==='VP8L'&&b[20]===47){width=1+b[21]+((b[22]&63)<<8);height=1+(b[22]>>6)+(b[23]<<2)+((b[24]&15)<<10);}}
 if(!width||!height||width>8000||height>8000||width*height>24000000)throw Error('Dimensi gambar tidak sah / maksimum 24 megapixel');
 return {width,height,mime};
}
export function fontMetadata(b){
 try{const v=new DataView(b.buffer,b.byteOffset,b.byteLength),count=v.getUint16(4);let at=0;
 for(let i=0;i<count;i++){const p=12+i*16;if(p+16>b.length)break;if(String.fromCharCode(...b.slice(p,p+4))==='name'){at=v.getUint32(p+8);break;}}
 if(!at||at+6>b.length)return '';const n=v.getUint16(at+2),base=at+v.getUint16(at+4),names=[];
 for(let i=0;i<n;i++){const p=at+6+i*12;if(p+12>b.length)break;const platform=v.getUint16(p),lang=v.getUint16(p+4),id=v.getUint16(p+6),len=v.getUint16(p+8),off=base+v.getUint16(p+10);if(![1,4,16].includes(id)||off+len>b.length)continue;let text='';const bytes=b.slice(off,off+len);if(platform===0||platform===3){for(let a=0;a+1<bytes.length;a+=2)text+=String.fromCharCode((bytes[a]<<8)|bytes[a+1]);}else text=new TextDecoder().decode(bytes);text=text.replace(/\0/g,'').trim();if(text&&text.length<=100)names.push({text,score:(id===16?6:id===1?4:0)+(lang===1033?2:0)});}
 return names.sort((a,b)=>b.score-a.score)[0]?.text||'';}catch{return '';}
}
export function aiDraft(result,fonts,width,height){
 if(!result||!Array.isArray(result.layers)||result.layers.length<1||result.layers.length>12)throw Error('AI_LAYER_COUNT');
 const unresolved=[],values=Object.create(null),inputs=Object.create(null),labels=new Map();
 const layers=result.layers.map((l,i)=>{
  if(!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(l.field)||['sku','constructor','prototype','__proto__','version','expires','sig'].includes(l.field))throw Error('AI_FIELD_INVALID');
  if(!['greeting','name','age','name_age','wording','date','literal'].includes(l.source)||typeof l.required!=='boolean'||typeof l.default!=='string'||l.default.length>200)throw Error('AI_MAPPING_INVALID');
  if(typeof l.label!=='string'||!l.label.trim()||l.label.length>60||typeof l.example!=='string'||l.example.length>200)throw Error('AI_LABEL_INVALID');
  const rule={source:l.source,required:l.required,default:['greeting','literal'].includes(l.source)?l.default:''};
  if(inputs[l.field]&&(JSON.stringify(inputs[l.field])!==JSON.stringify(rule)||labels.get(l.field)!==l.label.trim()||values[l.field]!==l.example))throw Error('AI_FIELD_CONFLICT');
  inputs[l.field]=rule;labels.set(l.field,l.label.trim());values[l.field]=l.example;
  const id='text_'+(i+1),font=matchFont(l.font_name,fonts);if(!font)unresolved.push({id,name:String(l.font_name||'Unknown').slice(0,100)});
  return {id,field:l.field,label:l.label.trim(),font_path:font?.path||null,text:{...l.text,fontFamily:font?.path?'Arial':font?.name||'Arial',autoFit:true,letterCase:'input'}};
 });
 if(Object.keys(inputs).length>8)throw Error('AI_TOO_MANY_FIELDS');
 return {config:{width,height,layers,automation:{enabled:false,inputs}},values,analysis:{summary:String(result.summary||'').slice(0,2000),warnings:(result.warnings||[]).filter(x=>typeof x==='string').slice(0,12).map(x=>x.slice(0,250)),unresolved_fonts:unresolved,confidence:Math.max(0,Math.min(100,Number(result.confidence)||0)),origin:'ai',review_required:true}};
}
