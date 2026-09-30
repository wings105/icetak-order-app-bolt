import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { API, DEFAULT_TEXT, displayRender, downloadCanvas, loadFont, prepareRender, readImageFile, validateConfig } from '../../../public/render-test/renderer.js';
import type { RenderConfig, RenderTemplate, TextConfig } from '../../../public/render-test/renderer.js';
import './RenderTemplates.css';

const freshConfig=():RenderConfig=>({width:1447,height:2048,text:{...DEFAULT_TEXT}});
const message=(e:unknown)=>e instanceof Error?e.message:'Permintaan gagal';
async function request(body:Record<string,unknown>|FormData){
 const {data}=await supabase.auth.getSession();
 if(!data.session)throw new Error('Sila log masuk semula');
 const multipart=body instanceof FormData;
 const r=await fetch(API,{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token,...(multipart?{}:{'Content-Type':'application/json'})},body:multipart?body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
 const result=await r.json();if(!r.ok||!result.ok)throw new Error(result.error||'Permintaan gagal');return result;
}
export default function RenderTemplates(){
 const [templates,setTemplates]=useState<RenderTemplate[]>([]);
 const [sku,setSku]=useState('YS0184'),[imagePath,setImagePath]=useState(''),[fontPath,setFontPath]=useState<string|null>(null);
 const [config,setConfig]=useState<RenderConfig>(freshConfig),[version,setVersion]=useState(0);
 const [wording,setWording]=useState('Jayna turns 4'),[guides,setGuides]=useState(true);
 const [busy,setBusy]=useState(true),[notice,setNotice]=useState(''),[error,setError]=useState(''),[ready,setReady]=useState(false),[size,setSize]=useState(0),[saved,setSaved]=useState(false);
 const canvas=useRef<HTMLCanvasElement>(null),sequence=useRef(0);
 const template:RenderTemplate={sku,image_path:imagePath,font_path:fontPath,config,version};
 function apply(t?:RenderTemplate,s='YS0184'){
  sequence.current++;setReady(false);setSku(t?.sku||s);setImagePath(t?.image_path||'');setFontPath(t?.font_path||null);setConfig(t?.config||freshConfig());setVersion(t?.version||0);setSaved(!!t);setError('');setNotice(t?'Template dimuatkan.':'Template baru: upload gambar kosong dahulu.');
 }
 useEffect(()=>{
  let active=true;
  request({action:'list'}).then(r=>{if(active){setTemplates(r.templates);const t=r.templates.find((x:RenderTemplate)=>x.sku==='YS0184');if(t)apply(t);}}).catch(e=>{if(active)setNotice(message(e));}).finally(()=>{if(active)setBusy(false);});
  return()=>{active=false;};
 },[]);
 useEffect(()=>{
  const ticket=++sequence.current;setReady(false);setError('');
  if(!imagePath)return;
  const timer=window.setTimeout(()=>{
   prepareRender({sku,image_path:imagePath,font_path:fontPath,config,version},wording,{guides}).then(result=>{
    if(sequence.current===ticket&&canvas.current){displayRender(canvas.current,result);setReady(true);setSize(result.fontSize);}
   }).catch(e=>{if(sequence.current===ticket)setError(message(e));});
  },80);
  return()=>{window.clearTimeout(timer);sequence.current++;};
 },[imagePath,fontPath,config,wording,guides,sku,version]);
 function text<K extends keyof TextConfig>(key:K,value:TextConfig[K]){setReady(false);setSaved(false);setConfig(c=>({...c,text:{...c.text,[key]:value}}));}
 async function upload(file:File|undefined,kind:'images'|'fonts'){
  if(!file)return;
  setBusy(true);setReady(false);setNotice('Mengupload…');
  try{
   if(!/^[A-Z0-9_-]{1,40}$/.test(sku))throw new Error('Isi SKU dahulu');
   const dimensions=kind==='images'?await readImageFile(file):null;
   const body=new FormData();body.set('sku',sku);body.set('kind',kind);body.set('file',file);
   const r=await request(body);
   if(dimensions){setImagePath(r.path);setConfig(c=>({...c,...dimensions,text:{...c.text,fontSize:Math.round(dimensions.width*0.06)}}));}
   else{await loadFont(r.path,config.text.fontWeight);setFontPath(r.path);}
   setSaved(false);setNotice('Upload berjaya. Adjust tulisan kemudian Save Template.');
  }catch(e){setNotice(message(e));}finally{setBusy(false);}
 }
 async function save(){
  setBusy(true);setNotice('Menyimpan…');
  try{
   if(!ready||!imagePath)throw new Error('Tunggu preview lengkap sebelum Save');
   validateConfig(config);
   const r=await request({action:'save',sku,image_path:imagePath,font_path:fontPath,config,expected_version:version});
   setVersion(r.template.version);setTemplates(ts=>[...ts.filter(t=>t.sku!==sku),r.template].sort((a,b)=>a.sku.localeCompare(b.sku)));setSaved(true);setNotice('Template '+sku+' disimpan. Boleh buka Render Test.');
  }catch(e){setNotice(message(e));}finally{setBusy(false);}
 }
 async function download(){
  setBusy(true);
  try{const result=await prepareRender(template,wording);await downloadCanvas(result.canvas,sku+'-preview.png');setNotice('PNG tanpa garisan panduan didownload.');}catch(e){setNotice(message(e));}finally{setBusy(false);}
 }
 const testUrl='/render-test/?'+new URLSearchParams({sku,name:wording}).toString();
 return <div className="rt">
  <div className="rt-header"><div><h2>Render Templates</h2><p>Satu SKU · satu template · satu kawasan tulisan</p></div><a href={testUrl} target="_blank" rel="noreferrer">Buka Render Test ↗</a></div>
  <div className="rt-grid">
   <section className="rt-card">
    <fieldset disabled={busy}>
     <h3>1. Template kosong</h3>
     <label>Template tersimpan<select aria-label="Template tersimpan" value={templates.some(t=>t.sku===sku)?sku:''} onChange={e=>apply(templates.find(t=>t.sku===e.target.value),e.target.value||'YS0184')}><option value="">Template baru</option>{templates.map(t=><option key={t.sku} value={t.sku}>{t.sku}</option>)}</select></label>
     <label>SKU<input aria-label="SKU" value={sku} maxLength={40} onChange={e=>apply(undefined,e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g,''))}/></label>
     <button type="button" className="rt-secondary" onClick={async()=>{setBusy(true);try{const r=await request({action:'list'});setTemplates(r.templates);apply(r.templates.find((t:RenderTemplate)=>t.sku===sku),sku);}catch(e){setNotice(message(e));}finally{setBusy(false);}}}>Load SKU / Reload</button>
     <label>Upload template kosong<input aria-label="Upload template kosong" type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{void upload(e.target.files?.[0],'images');e.target.value='';}}/></label>
     <small>PNG / JPG / WebP · maksimum 6 MB. Gunakan gambar asal tanpa wording.</small>
     {imagePath&&<p className="rt-info">{config.width} × {config.height} px · saiz asal dikekalkan</p>}
     <h3>2. Gaya tulisan</h3>
     <div className="rt-two">
      <label>Font<select aria-label="Font" value={config.text.fontFamily} onChange={e=>{setFontPath(null);text('fontFamily',e.target.value);}}>{['Impact','Arial','Arial Black','Georgia','Times New Roman','Verdana','Trebuchet MS','Courier New'].map(f=><option key={f}>{f}</option>)}</select></label>
      <label>Ketebalan<select aria-label="Ketebalan" value={config.text.fontWeight} onChange={e=>text('fontWeight',e.target.value)}><option value="400">Normal</option><option value="700">Bold</option><option value="900">Heavy</option></select></label>
     </div>
     <label>Upload font sendiri<input aria-label="Upload font sendiri" type="file" accept=".ttf,.otf" onChange={e=>{void upload(e.target.files?.[0],'fonts');e.target.value='';}}/></label>
     {fontPath&&<p className="rt-info">Font custom aktif <button type="button" className="rt-link" onClick={()=>{setFontPath(null);setSaved(false);}}>Guna font pilihan</button></p>}
     <div className="rt-two">
      <label>Warna tulisan<input aria-label="Warna tulisan" type="color" value={config.text.fill} onChange={e=>text('fill',e.target.value)}/></label>
      <label>Warna outline<input aria-label="Warna outline" type="color" value={config.text.stroke} onChange={e=>text('stroke',e.target.value)}/></label>
      <label>Saiz maksimum (px)<input aria-label="Saiz maksimum" type="number" min="1" max="2000" value={config.text.fontSize} onChange={e=>text('fontSize',Number(e.target.value))}/></label>
      <label>Outline (px)<input aria-label="Outline" type="number" min="0" max="100" value={config.text.strokeWidth} onChange={e=>text('strokeWidth',Number(e.target.value))}/></label>
      <label>Alignment<select aria-label="Alignment" value={config.text.align} onChange={e=>text('align',e.target.value as TextConfig['align'])}><option value="left">Kiri</option><option value="center">Tengah</option><option value="right">Kanan</option></select></label>
      <label>Huruf<select aria-label="Huruf" value={config.text.letterCase} onChange={e=>text('letterCase',e.target.value as TextConfig['letterCase'])}><option value="input">Ikut input</option><option value="upper">SEMUA BESAR</option><option value="lower">semua kecil</option></select></label>
     </div>
     <label className="rt-check"><input type="checkbox" checked={config.text.autoFit} onChange={e=>text('autoFit',e.target.checked)}/>Auto-kecil tulisan supaya muat</label>
     <h3>3. Kawasan tulisan</h3><small>Klik pada preview untuk pindahkan pusat tulisan. Ukuran posisi / kawasan dalam % gambar.</small>
     <div className="rt-two">{(['x','y','boxWidth','boxHeight'] as const).map((k,i)=><label key={k}>{['Posisi X (%)','Posisi Y (%)','Lebar kawasan (%)','Tinggi kawasan (%)'][i]}<input aria-label={['Posisi X','Posisi Y','Lebar kawasan','Tinggi kawasan'][i]} type="number" min={i<2?0:1} max="100" step="0.1" value={config.text[k]} onChange={e=>text(k,Number(e.target.value))}/></label>)}</div>
     <div className="rt-actions"><button type="button" disabled={!ready||!imagePath||busy} onClick={()=>void save()}>{busy?'Sila tunggu…':'Save Template'}</button><span className={saved?'rt-saved':'rt-unsaved'}>{saved?'Disimpan':'Belum disimpan'}</span></div>
    </fieldset>
    <p role="status" className="rt-notice">{notice}</p>
   </section>
   <section className="rt-card rt-preview">
    <h3>Preview</h3><label>Wording test<input aria-label="Wording test" value={wording} maxLength={200} disabled={busy} onChange={e=>{setReady(false);setWording(e.target.value);}}/></label>
    <label className="rt-check"><input type="checkbox" checked={guides} onChange={e=>setGuides(e.target.checked)}/>Tunjuk kawasan tulisan</label>
    <div className="rt-canvas">{!imagePath?<div className="rt-empty">Upload template kosong untuk mula preview.</div>:<><canvas aria-label="Preview template" ref={canvas} style={{visibility:ready?'visible':'hidden'}} onClick={e=>{if(busy||!ready)return;const r=e.currentTarget.getBoundingClientRect(),t=config.text;setSaved(false);setConfig(c=>({...c,text:{...c.text,x:Math.round(Math.max(t.boxWidth/2,Math.min(100-t.boxWidth/2,(e.clientX-r.left)/r.width*100))*10)/10,y:Math.round(Math.max(t.boxHeight/2,Math.min(100-t.boxHeight/2,(e.clientY-r.top)/r.height*100))*10)/10}}));}}/>{!ready&&<div className="rt-loading">{error||'Memuatkan preview…'}</div>}</>}</div>
    <p className="rt-info">{ready?'Saiz tulisan digunakan: '+size.toFixed(1)+' px · PNG ikut resolusi asal':error}</p>
    <div className="rt-actions"><button type="button" disabled={!ready||busy} onClick={()=>void download()}>Download PNG</button><a href={testUrl} target="_blank" rel="noreferrer">Test template tersimpan ↗</a></div>
    <small>Garisan panduan tidak masuk dalam PNG. Save dahulu sebelum buka link test.</small>
   </section>
  </div>
 </div>;
}
