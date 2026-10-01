import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { API, DEFAULT_TEXT, displayRender, downloadCanvas, getFields, loadFont, normalizeConfig, prepareRender, readImageFile, validateConfig } from '../../../public/render-test/renderer.js';
import type { RenderConfig, RenderTemplate, TextConfig, TextLayer } from '../../../public/render-test/renderer.js';
import {patternKeys} from '../../../public/render-test/fields.js';
import './RenderTemplates.css';

const freshConfig=():RenderConfig=>({width:1447,height:2048,layers:[{id:'wording',field:'name',label:'Wording',font_path:null,text:{...DEFAULT_TEXT}}]});
const message=(e:unknown)=>e instanceof Error?e.message:'Permintaan gagal';
const fonts=['Impact','Arial','Arial Black','Georgia','Times New Roman','Verdana','Trebuchet MS','Courier New'];
async function request(body:Record<string,unknown>|FormData){
 const {data}=await supabase.auth.getSession();if(!data.session)throw new Error('Sila log masuk semula');
 const multipart=body instanceof FormData;
 const r=await fetch(API,{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token,...(multipart?{}:{'Content-Type':'application/json'})},body:multipart?body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
 const result=await r.json();if(!r.ok||!result.ok)throw new Error(result.error||'Permintaan gagal');return result;
}
export default function RenderTemplates(){
 const [templates,setTemplates]=useState<RenderTemplate[]>([]),[sku,setSku]=useState('YS0184'),[imagePath,setImagePath]=useState('');
 const [config,setConfig]=useState<RenderConfig>(freshConfig),[version,setVersion]=useState(0),[selected,setSelected]=useState('wording');
 const [values,setValues]=useState<Record<string,string>>({name:'Jayna turns 4'}),[guides,setGuides]=useState(true);
 const [automationKey,setAutomationKey]=useState(''),[outputUrl,setOutputUrl]=useState('');
 const [busy,setBusy]=useState(true),[notice,setNotice]=useState(''),[error,setError]=useState(''),[ready,setReady]=useState(false),[sizes,setSizes]=useState<Record<string,number>>({}),[saved,setSaved]=useState(false);
 const canvas=useRef<HTMLCanvasElement>(null),sequence=useRef(0),drag=useRef<{x:number;y:number}|null>(null);
 const layer=config.layers.find(l=>l.id===selected)||config.layers[0],style=layer.text,fields=getFields(config);
 const template:RenderTemplate={sku,image_path:imagePath,font_path:null,config,version};
 function invalidate(){sequence.current++;setReady(false);setOutputUrl('');}
 function change(update:(c:RenderConfig)=>RenderConfig){invalidate();setSaved(false);setConfig(update);}
 function patchLayer(p:Partial<TextLayer>){change(c=>({...c,layers:c.layers.map(l=>l.id===layer.id?{...l,...p}:l)}));}
 function text<K extends keyof TextConfig>(key:K,value:TextConfig[K]){patchLayer({text:{...style,[key]:value}});}
 function apply(t?:RenderTemplate,s='YS0184'){
  const c=t?normalizeConfig(t.config,t.font_path):freshConfig();invalidate();setSku(t?.sku||s);setImagePath(t?.image_path||'');setConfig(c);setSelected(c.layers[0].id);setValues(Object.fromEntries(getFields(c).map((f,i)=>[f.key,f.key==='age'?'4':i===0?(c.layers.some(l=>l.pattern)?'Jayna':'Jayna turns 4'):''])));setVersion(t?.version||0);setSaved(!!t);setError('');setNotice(t?'Template dimuatkan.' : 'Template baru: upload gambar kosong dahulu.');
 }
 useEffect(()=>{let active=true;request({action:'list'}).then(r=>{if(active){setTemplates(r.templates);const t=r.templates.find((x:RenderTemplate)=>x.sku==='YS0184');if(t)apply(t);}}).catch(e=>{if(active)setNotice(message(e));}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[]);
 useEffect(()=>{
  const ticket=++sequence.current;setReady(false);setError('');if(!imagePath)return;
  const timer=window.setTimeout(()=>{prepareRender({sku,image_path:imagePath,font_path:null,config,version},values,{guides,selectedLayer:selected}).then(result=>{if(sequence.current===ticket&&canvas.current){displayRender(canvas.current,result);setReady(true);setSizes(Object.fromEntries(result.layers.map(l=>[l.id,l.fontSize])));}}).catch(e=>{if(sequence.current===ticket)setError(message(e));});},80);
  return()=>{window.clearTimeout(timer);sequence.current++;};
 },[imagePath,config,values,guides,selected,sku,version]);
 async function upload(file:File|undefined,kind:'images'|'fonts'){
  if(!file)return;setBusy(true);invalidate();setNotice('Mengupload…');
  try{
   if(!/^[A-Z0-9_-]{1,40}$/.test(sku))throw new Error('Isi SKU dahulu');
   const dimensions=kind==='images'?await readImageFile(file):null,body=new FormData();body.set('sku',sku);body.set('kind',kind);body.set('file',file);const r=await request(body);
   if(dimensions){setImagePath(r.path);change(c=>({...c,...dimensions,layers:c.layers.map(l=>({...l,text:{...l.text,fontSize:Math.round(dimensions.width*.06)}}))}));}
   else{await loadFont(r.path,style.fontWeight);patchLayer({font_path:r.path});}
   setNotice('Upload berjaya. Adjust tulisan kemudian Save Template.');
  }catch(e){setNotice(message(e));}finally{setBusy(false);}
 }
 async function save(){
  setBusy(true);setNotice('Menyimpan…');try{if(!ready||!imagePath)throw new Error('Tunggu preview lengkap sebelum Save');validateConfig(config);const r=await request({action:'save',sku,image_path:imagePath,font_path:null,config,expected_version:version});setVersion(r.template.version);setTemplates(ts=>[...ts.filter(t=>t.sku!==sku),r.template].sort((a,b)=>a.sku.localeCompare(b.sku)));setSaved(true);setNotice('Template '+sku+' disimpan. Boleh buka Render Test.');}catch(e){setNotice(message(e));}finally{setBusy(false);}
 }
 async function download(){setBusy(true);try{const result=await prepareRender(template,values);await downloadCanvas(result.canvas,sku+'-preview.png');setNotice('PNG tanpa garisan panduan didownload.');}catch(e){setNotice(message(e));}finally{setBusy(false);}}
 function addLayer(duplicate=false){
  const id='layer_'+crypto.randomUUID().slice(0,8),field=duplicate?layer.field:'field_'+id.slice(6),label=duplicate?layer.label:'Field '+(fields.length+1);
  change(c=>({...c,layers:[...c.layers,{...layer,id,field,label,...(!duplicate?{pattern:undefined,field_labels:undefined,legacy_full_wording:undefined}:{}),text:{...style,y:Math.min(100-style.boxHeight/2,style.y+style.boxHeight)}}]}));setSelected(id);if(!duplicate)setValues(v=>({...v,[field]:'Contoh tulisan'}));
 }
 function position(x:number,y:number){patchLayer({text:{...style,x:Math.max(style.boxWidth/2,Math.min(100-style.boxWidth/2,x)),y:Math.max(style.boxHeight/2,Math.min(100-style.boxHeight/2,y))}});}
 const testParams=new URLSearchParams({sku});for(const f of fields)testParams.set(f.key,values[f.key]||'');const testUrl='/render-test/?'+testParams;
 const number=(key:keyof TextConfig,label:string,min:number,max:number,step=1)=><label>{label}<input aria-label={label} type="number" min={min} max={max} step={step} value={style[key] as number} onChange={e=>text(key,Number(e.target.value))}/></label>;
 return <div className="rt">
  <div className="rt-header"><div><h2>Render Templates</h2><p>Renderer v4 · curve, pola wording dan automation PNG</p></div><a href={testUrl} target="_blank" rel="noreferrer">Buka Render Test ↗</a></div>
  <div className="rt-grid"><section className="rt-card"><fieldset disabled={busy}>
   <h3>1. Template kosong</h3>
   <label>Template tersimpan<select aria-label="Template tersimpan" value={templates.some(t=>t.sku===sku)?sku:''} onChange={e=>apply(templates.find(t=>t.sku===e.target.value),e.target.value||'YS0184')}><option value="">Template baru</option>{templates.map(t=><option key={t.sku}>{t.sku}</option>)}</select></label>
   <label>SKU<input aria-label="SKU" value={sku} maxLength={40} onChange={e=>apply(undefined,e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g,''))}/></label>
   <button type="button" className="rt-secondary" onClick={async()=>{setBusy(true);try{const r=await request({action:'list'});setTemplates(r.templates);apply(r.templates.find((t:RenderTemplate)=>t.sku===sku),sku);}catch(e){setNotice(message(e));}finally{setBusy(false);}}}>Load SKU / Reload</button>
   <label>Upload template kosong<input aria-label="Upload template kosong" type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{void upload(e.target.files?.[0],'images');e.target.value='';}}/></label>
   <small>PNG / JPG / WebP · maksimum 6 MB · resolusi asal dikekalkan.</small>{imagePath&&<p className="rt-info">{config.width} × {config.height} px</p>}
   <h3>2. Text layer & input</h3>
   <label>Layer aktif<select aria-label="Layer aktif" value={layer.id} onChange={e=>{invalidate();setSelected(e.target.value);}}>{config.layers.map((l,i)=><option key={l.id} value={l.id}>{i+1}. {l.label} ({l.field})</option>)}</select></label>
   <div className="rt-actions"><button type="button" disabled={fields.length>=8||config.layers.length>=12} onClick={()=>addLayer()}>+ Field baru</button><button type="button" className="rt-secondary" disabled={config.layers.length>=12} onClick={()=>addLayer(true)}>Duplikat layer</button><button type="button" className="rt-secondary" disabled={config.layers.length===1} onClick={()=>{change(c=>({...c,layers:c.layers.filter(l=>l.id!==layer.id)}));setSelected(config.layers.find(l=>l.id!==layer.id)!.id);}}>Buang layer</button></div>
   <label>Input untuk layer ini<select aria-label="Input untuk layer ini" value={layer.field} onChange={e=>patchLayer({field:e.target.value,label:fields.find(f=>f.key===e.target.value)!.label})}>{fields.map(f=><option key={f.key} value={f.key}>{f.label} ({f.key})</option>)}</select></label>
   <label>Label input<input aria-label="Label input" maxLength={60} value={layer.label} onChange={e=>change(c=>({...c,layers:c.layers.map(l=>l.field===layer.field?{...l,label:e.target.value}:l)}))}/></label>
   <label>Pola wording (optional)<input aria-label="Pola wording" value={layer.pattern||''} maxLength={400} placeholder="{{name}} turns {{age}}" onChange={e=>patchLayer({pattern:e.target.value||undefined})}/></label><small>Gabungkan beberapa input pada satu curve. Kosongkan untuk guna satu input seperti biasa.</small>
   {patternKeys(layer.pattern).map(key=><label key={key}>Label {key}<input aria-label={'Label '+key} maxLength={60} value={layer.field_labels?.[key]||(key===layer.field?layer.label:key)} onChange={e=>patchLayer({field_labels:{...layer.field_labels,[key]:e.target.value}})}/></label>)}
   <small>Duplikat layer untuk wording yang sama di tempat lain. Field baru menambah satu input pada form test. Susunan layer menentukan lapisan depan/belakang.</small>
   <div className="rt-actions">{[-1,1].map(dir=><button key={dir} type="button" className="rt-secondary" disabled={dir<0?config.layers[0].id===layer.id:config.layers.at(-1)!.id===layer.id} onClick={()=>change(c=>{const a=[...c.layers],i=a.findIndex(l=>l.id===layer.id);[a[i],a[i+dir]]=[a[i+dir],a[i]];return {...c,layers:a};})}>{dir<0?'Ke belakang':'Ke depan'}</button>)}</div>
   <h3>3. Gaya tulisan</h3><div className="rt-two">
    <label>Font<select aria-label="Font" value={style.fontFamily} onChange={e=>patchLayer({font_path:null,text:{...style,fontFamily:e.target.value}})}>{fonts.map(f=><option key={f}>{f}</option>)}</select></label>
    <label>Ketebalan<select aria-label="Ketebalan" value={style.fontWeight} onChange={e=>text('fontWeight',e.target.value)}><option value="400">Normal</option><option value="700">Bold</option><option value="900">Heavy</option></select></label>
   </div><label>Upload font untuk layer ini<input aria-label="Upload font sendiri" type="file" accept=".ttf,.otf" onChange={e=>{void upload(e.target.files?.[0],'fonts');e.target.value='';}}/></label>
   {layer.font_path&&<p className="rt-info">Font custom aktif <button type="button" className="rt-link" onClick={()=>patchLayer({font_path:null})}>Guna font pilihan</button></p>}
   <div className="rt-two"><label>Warna tulisan<input aria-label="Warna tulisan" type="color" value={style.fill} onChange={e=>text('fill',e.target.value)}/></label><label>Warna outline<input aria-label="Warna outline" type="color" value={style.stroke} onChange={e=>text('stroke',e.target.value)}/></label>
    {number('fontSize','Saiz maksimum (px)',1,2000)}{number('strokeWidth','Outline (px)',0,100)}
    <label>Alignment<select aria-label="Alignment" value={style.align} onChange={e=>text('align',e.target.value as TextConfig['align'])}><option value="left">Kiri</option><option value="center">Tengah</option><option value="right">Kanan</option></select></label>
    <label>Huruf<select aria-label="Huruf" value={style.letterCase} onChange={e=>text('letterCase',e.target.value as TextConfig['letterCase'])}><option value="input">Ikut input</option><option value="upper">SEMUA BESAR</option><option value="lower">semua kecil</option></select></label>
   </div><label className="rt-check"><input type="checkbox" checked={style.autoFit} onChange={e=>text('autoFit',e.target.checked)}/>Auto-kecil tulisan supaya muat</label>
   <h3>4. Curve & bentuk huruf</h3><label>Bentuk curve<select aria-label="Bentuk curve" value={style.curve===0?'straight':style.curve>0?'up':'down'} onChange={e=>text('curve',e.target.value==='straight'?0:(e.target.value==='up'?1:-1)*(Math.abs(style.curve)||40))}><option value="straight">Straight</option><option value="up">Lengkung atas ∩</option><option value="down">Lengkung bawah ∪</option></select></label>
   <label>Kekuatan curve: {Math.abs(style.curve)}°<input aria-label="Kekuatan curve" type="range" min="1" max="140" disabled={style.curve===0} value={Math.abs(style.curve)||1} onChange={e=>text('curve',(style.curve<0?-1:1)*Number(e.target.value))}/></label>
   <div className="rt-two">{number('rotation','Rotation (°)',-180,180,.1)}{number('tracking','Jarak huruf (px)',-20,100,.1)}{number('scaleX','Lebar huruf (%)',10,300)}{number('scaleY','Tinggi huruf (%)',10,300)}</div><small>100% = bentuk asal. Curve memusingkan huruf mengikut lengkungan. PNG dan preview menggunakan tetapan yang sama.</small>
   <h3>5. Kawasan tulisan</h3><small>Klik untuk pindah pusat atau drag layer aktif. Butang anak panah gerak 1 px pada gambar asal.</small>
   <div className="rt-two">{number('x','Posisi X (%)',0,100,.1)}{number('y','Posisi Y (%)',0,100,.1)}{number('boxWidth','Lebar kawasan (%)',1,100,.1)}{number('boxHeight','Tinggi kawasan (%)',1,100,.1)}</div>
   <div className="rt-actions">{([[-1,0,'←'],[0,-1,'↑'],[0,1,'↓'],[1,0,'→']] as const).map(([dx,dy,label])=><button type="button" className="rt-secondary" key={label} aria-label={'Gerak '+label+' 1 px'} onClick={()=>position(style.x+dx/config.width*100,style.y+dy/config.height*100)}>{label}</button>)}</div>
   <div className="rt-actions"><button type="button" disabled={!ready||!imagePath} onClick={()=>void save()}>Save Template</button><span className={saved?'rt-saved':'rt-unsaved'}>{saved?'Disimpan':'Belum disimpan'}</span></div>
   </fieldset><p role="status" className="rt-notice">{notice}</p>
   <h3>Automation AP</h3><p>Request PNG terus tanpa tekan Download. Field ikut template yang disimpan.</p>
   <code>/render-test/output.png</code><p>{fields.map(f=>f.key).join(', ')}</p>
   <div className="rt-actions"><button type="button" disabled={busy||!saved||!ready} onClick={async()=>{setBusy(true);try{const r=await request({action:'automation-link',sku,fields:Object.fromEntries(fields.map(f=>[f.key,values[f.key]||'']))});setOutputUrl(location.origin+'/render-test/output.png?'+new URLSearchParams(r.query));setNotice('Link PNG sah 30 minit.');}catch(e){setNotice(message(e));}finally{setBusy(false);}}}>Jana link PNG terus</button></div>
   {outputUrl&&<p style={{overflowWrap:'anywhere'}}><a href={outputUrl} target="_blank" rel="noreferrer">Buka PNG terus ↗</a><input aria-label="Link PNG terus" readOnly value={outputUrl} onFocus={e=>e.target.select()}/></p>}
   <div className="rt-actions"><button type="button" disabled={busy} onClick={async()=>{setBusy(true);setAutomationKey('');try{const r=await request({action:'automation-key'});setAutomationKey(r.token);setNotice(r.message);}catch(e){setNotice(message(e));}finally{setBusy(false);}}}>Jana / tukar API key AP</button><button type="button" className="rt-secondary" disabled={busy} onClick={async()=>{setBusy(true);try{await request({action:'automation-revoke'});setAutomationKey('');setNotice('API key admin ini dibatalkan.');}catch(e){setNotice(message(e));}finally{setBusy(false);}}}>Batalkan key</button></div>
   {automationKey&&<label>API key (salin sekali ke AP)<input aria-label="API key AP" type="password" readOnly value={automationKey} onFocus={e=>e.target.select()}/><button type="button" className="rt-secondary" onClick={()=>void navigator.clipboard.writeText(automationKey).then(()=>setNotice('API key disalin.')).catch(()=>setNotice('Pilih dan salin key secara manual.'))}>Copy key</button></label>}
   <small>POST JSON: {'{sku, fields}'} · Authorization: Bearer API_KEY. Key hanya boleh render; tidak boleh edit template.</small>
  </section>
  <section className="rt-card rt-preview"><h3>Preview</h3>{fields.map(f=><label key={f.key}>{f.label}<input aria-label={'Test '+f.label} value={values[f.key]||''} maxLength={200} disabled={busy} onChange={e=>{invalidate();setValues(v=>({...v,[f.key]:e.target.value}));}}/></label>)}
   <label className="rt-check"><input type="checkbox" checked={guides} onChange={e=>{invalidate();setGuides(e.target.checked);}}/>Tunjuk kawasan tulisan</label>
   <div className="rt-canvas">{!imagePath?<div className="rt-empty">Upload template kosong untuk mula preview.</div>:<><canvas aria-label="Preview template" ref={canvas} style={{visibility:ready?'visible':'hidden',touchAction:'none'}} onPointerDown={e=>{if(busy||!ready)return;drag.current={x:e.clientX,y:e.clientY};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerCancel={()=>{drag.current=null;}} onPointerUp={e=>{if(!drag.current||busy||!ready)return;const start=drag.current;drag.current=null;const r=e.currentTarget.getBoundingClientRect(),dx=e.clientX-start.x,dy=e.clientY-start.y;if(Math.hypot(dx,dy)<4)position((e.clientX-r.left)/r.width*100,(e.clientY-r.top)/r.height*100);else position(style.x+dx/r.width*100,style.y+dy/r.height*100);}}/>{!ready&&<div className="rt-loading">{error||'Memuatkan preview…'}</div>}</>}</div>
   <p className="rt-info">{ready?layer.label+': '+(sizes[layer.id]||0).toFixed(1)+' px · '+config.layers.length+' layer · PNG resolusi asal':error}</p>
   <div className="rt-actions"><button type="button" disabled={!ready||busy} onClick={()=>void download()}>Download PNG</button><a href={testUrl} target="_blank" rel="noreferrer">Test template tersimpan ↗</a></div><small>Garisan panduan tidak masuk dalam PNG. Save dahulu sebelum buka link test.</small>
  </section></div>
 </div>;
}
