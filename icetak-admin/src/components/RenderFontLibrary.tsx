import {useEffect,useState} from 'react';
import {renderRequest} from '../lib/renderStudio';
import type {StudioFont} from '../lib/renderStudio';
export default function RenderFontLibrary({sku='FONTLIB',onApply,currentPath}:{sku?:string;onApply?:(font:StudioFont)=>Promise<void>;currentPath?:string|null}){
 const [fonts,setFonts]=useState<StudioFont[]>([]),[name,setName]=useState(''),[aliases,setAliases]=useState(''),[edit,setEdit]=useState<StudioFont|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const refresh=async()=>{const r=await renderRequest({action:'studio-fonts'});setFonts(r.fonts);};
 useEffect(()=>{let active=true;renderRequest({action:'studio-fonts'}).then(r=>{if(active)setFonts(r.fonts);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
 async function save(file?:File){
  if(!name.trim()){setError('Isi nama font dahulu');return;}setBusy(true);setError('');setNotice('');
  try{let path=edit?.path||currentPath;if(file){const form=new FormData();form.set('sku',sku);form.set('kind','fonts');form.set('file',file);path=(await renderRequest(form)).path;}
   if(!path)throw Error('Pilih fail font TTF / OTF');const r=await renderRequest({action:'studio-font-save',sku:path.split('/')[0],path,name:name.trim(),aliases:aliases.split(',').map(s=>s.trim()).filter(Boolean)});await refresh();setNotice('Font disimpan dalam koleksi.');setEdit(null);if(onApply)await onApply(r.font);
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 return <section className="rs-fonts" aria-label="Koleksi font"><h3>Font Library</h3><p>Tambah TTF / OTF sekali untuk semua SKU. Alias dipisahkan dengan koma.</p><div className="rt-two"><label>Nama font<input aria-label="Nama font koleksi" value={name} disabled={busy} placeholder="Harry P" onChange={e=>setName(e.target.value)}/></label><label>Alias<input aria-label="Alias font" value={aliases} disabled={busy} placeholder="Harry Potter, Harry Portal" onChange={e=>setAliases(e.target.value)}/></label></div>
 <label>Tambah fail font<input aria-label="Tambah fail font koleksi" disabled={busy||!name.trim()} type="file" accept=".ttf,.otf" onChange={e=>{void save(e.target.files?.[0]);e.target.value='';}}/></label>{(edit||currentPath)&&<button type="button" disabled={busy||!name.trim()} onClick={()=>void save()}>{edit?'Simpan nama / alias':'Simpan font layer aktif ke koleksi'}</button>}
 {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}<ul>{fonts.map(f=><li key={f.id}><div><strong>{f.name}</strong><small>{f.aliases.join(', ')}</small></div><div><button type="button" disabled={busy} onClick={()=>{setEdit(f);setName(f.name);setAliases(f.aliases.join(', '));}}>Edit nama / alias</button>{onApply&&<button type="button" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await onApply(f);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Guna pada layer aktif</button>}</div></li>)}</ul>{!fonts.length&&<p>Belum ada font dalam koleksi.</p>}</section>;
}
