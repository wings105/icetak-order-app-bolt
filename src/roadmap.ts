import { supabase } from './appdeploy-client';
import './roadmap.css';

type Status = 'idea'|'planned'|'building'|'testing'|'completed'|'on_hold';
type Item = {id:string;title:string;summary:string;category:string;status:Status;priority:string;progress:number;target_date:string|null;reference_url:string|null;highlights:string[];acceptance_criteria:string[];is_public:boolean;created_at:string;updated_at:string;completed_at:string|null};
type Event = {id:string;item_id:string;body:string;kind:string;is_public:boolean;created_at:string};
type Release = {id:string;line:number;date:string|null;heading:string;stage:string;summary:string;feature_codes:string[];category:string;source_url:string};
const CATS:Record<string,string>={general:'General',orders:'Orders',inbox:'Inbox',automation:'Automation',production:'Production',finance:'Finance',shopee:'Shopee',design:'Design',infrastructure:'Infrastructure'};
const STAT:Record<Status,string>={idea:'Idea',planned:'Planned',building:'Building Now',testing:'Testing / QA',completed:'Completed',on_hold:'On Hold'};
const GROUPS:{key:string;title:string;states:Status[]}[]=[{key:'idea',title:'Under Consideration',states:['idea','on_hold']},{key:'planned',title:'Planned',states:['planned']},{key:'building',title:'Building Now',states:['building','testing']},{key:'completed',title:'Completed',states:['completed']}];
const root=document.querySelector<HTMLElement>('#app');
const esc=(val:unknown):string=>String(val??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));
const date=(d:string|null)=>d?new Intl.DateTimeFormat('ms-MY',{day:'numeric',month:'short',year:'numeric'}).format(new Date(d)):'';
const safeReference=(raw:string|null|undefined)=>{try{const parsed=new URL(raw||'');return parsed.protocol==='https:'?parsed.href:'';}catch{return '';}};
const targetDate=(d:string|null)=>d?new Intl.DateTimeFormat('ms-MY',{month:'short',year:'numeric'}).format(new Date(d+'T12:00:00')):'';
let owner=false,manage=false,tab:'roadmap'|'changelog'='roadmap',category='all',search='',items:Item[]=[],events:Event[]=[];
let modalId:string|null=null,editId:string|null=null,loading=true,notice='',failure='';
let releases:Release[]=[],releaseCount=35,releaseError='';
const featureCode=(i:Item)=>i.reference_url?.match(/#(ic-\d{3})$/i)?.[1]?.toUpperCase()||'';
const bulletList=(items:unknown,max=12)=>Array.isArray(items)?items.filter((s):s is string=>typeof s==='string'&&s.trim().length>0).slice(0,max):[];
const bulletHtml=(items:string[])=>'<ul class="rm-bullets">'+items.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul>';

function relevant():Item[]{return items.filter(i=>(manage||i.is_public)&&(category==='all'||i.category===category)&&(!search||(i.title+' '+i.summary+' '+i.category).toLowerCase().includes(search.toLowerCase())));}
function card(i:Item):string{
 const details=(i.progress>0?i.progress+'% siap':targetDate(i.target_date)||'Belum dijadual');
 return '<button type="button" class="rm-card" data-view="'+esc(i.id)+'"><span class="rm-tags"><span class="rm-tag">'+esc(CATS[i.category]||i.category)+'</span>'+
 (manage&&!i.is_public?'<span class="rm-tag rm-private">Private</span>':'')+'<span class="rm-prio">'+esc(i.priority.toUpperCase())+'</span></span>'+
 '<strong>'+esc(i.title)+'</strong><span class="rm-desc">'+esc(i.summary)+'</span><small>'+esc(STAT[i.status])+' · '+esc(details)+'</small>'+
 (i.progress?'<span class="rm-bar"><i style="width:'+i.progress+'%"></i></span>':'')+'</button>';
}
function board():string{
 const visible=relevant();
 return '<div class="rm-board">'+GROUPS.map(g=>{
  const matching=visible.filter(i=>g.states.includes(i.status)).sort((a,b)=>a.priority.localeCompare(b.priority)||b.updated_at.localeCompare(a.updated_at));
  return '<section class="rm-col"><header class="rm-col-head"><span class="rm-dot '+g.key+'"></span><h2>'+g.title+'</h2><span class="rm-col-count">'+matching.length+'</span></header><div class="rm-cards">'+
    (matching.length?matching.map(card).join(''):'<div class="rm-empty">Tiada feature</div>')+'</div></section>';
 }).join('')+'</div>';
}
function changelog():string{
 const index=new Map(items.map(i=>[i.id,i]));
 const records=releases.filter(r=>(category==='all'||r.category===category)&&
   (!search||(r.summary+' '+r.heading+' '+r.stage).toLowerCase().includes(search.toLowerCase())));
 const logs=events.filter(e=>(manage||e.is_public)&&(manage||index.get(e.item_id)?.is_public)&&
   (category==='all'||index.get(e.item_id)?.category===category)&&(!search||(e.body+' '+(index.get(e.item_id)?.title||'')).toLowerCase().includes(search.toLowerCase())));
 const latest=records.slice(0,releaseCount);
 const source='<div class="rm-source-head"><div><h3>Release History · GitHub</h3><p>Dijana daripada CHANGELOG.md setiap production build. Bukti release tidak mengubah status feature secara automatik.</p></div><a href="https://github.com/wings105/icetak-order-app-bolt/blob/production/CHANGELOG.md" target="_blank" rel="noopener noreferrer">Buka CHANGELOG asal ↗</a></div>';
 const releasesHtml=latest.map(e=>'<article class="rm-event"><small>'+esc(e.date||'Tiada tarikh')+' · '+esc(e.stage)+'</small>'+
 '<h3>'+esc(e.heading)+'</h3><p>'+esc(e.summary)+'</p><a href="'+esc(safeReference(e.source_url))+'" target="_blank" rel="noopener noreferrer">Baca bukti asal ↗</a></article>').join('');
 const more=records.length>releaseCount?'<div class="rm-more"><button type="button" class="rm-cancel" data-more>Tambah lagi '+Math.min(35,records.length-releaseCount)+' rekod</button></div>':'';
 const manual=logs.map(e=>'<article class="rm-event"><small>'+date(e.created_at)+' · '+esc(e.kind.toUpperCase())+'</small>'+
 '<h3>'+esc(index.get(e.item_id)?.title||'Roadmap update')+'</h3><p>'+esc(e.body)+'</p><button type="button" data-view="'+esc(e.item_id)+'">Lihat feature →</button></article>').join('');
 return source+(releaseError?'<div class="rm-error">'+esc(releaseError)+'</div>':'')+
   '<div class="rm-log">'+(releasesHtml||'<div class="rm-empty">Tiada release mengikut filter ini.</div>')+'</div>'+more+
   '<div class="rm-source-head"><div><h3>Roadmap Progress Notes</h3><p>Nota planning/status yang disimpan dalam Supabase.</p></div></div>'+
   '<div class="rm-log">'+(manual||'<div class="rm-empty">Tiada nota progression.</div>')+'</div>';
}
function itemDetails(i:Item):string{
 const logs=events.filter(e=>e.item_id===i.id&&(manage||e.is_public));
 const code=featureCode(i), related=code?releases.filter(e=>e.feature_codes.includes(code)).slice(0,5):[];
 const highlights=bulletList(i.highlights),criteria=bulletList(i.acceptance_criteria);
 return '<div class="rm-dialog-header"><div><span class="rm-tag">'+esc(CATS[i.category]||i.category)+'</span><h2>'+esc(i.title)+'</h2><small>'+esc(STAT[i.status])+' · '+esc(i.priority.toUpperCase())+(i.target_date?' · Sasaran '+esc(targetDate(i.target_date)):'')+'</small></div><button type="button" class="rm-x" data-close>×</button></div>'+
 '<div class="rm-dialog-body"><p>'+esc(i.summary||'Belum ada penerangan.')+'</p>'+
 (highlights.length?'<h3>Ringkasan & skop</h3>'+bulletHtml(highlights):'')+
 (criteria.length?'<h3>Checklist / Definition of Done</h3>'+bulletHtml(criteria):'')+
 '<div class="rm-progress-label"><span>Anggaran tahap kerja</span><span>'+i.progress+'%</span></div><div class="rm-bar"><i style="width:'+i.progress+'%"></i></div>'+
 '<p class="rm-muted">Status dan peratus ialah rekod perancangan; bukan jaminan feature telah diluluskan operator.</p>'+
 (safeReference(i.reference_url)?'<p><a href="'+esc(safeReference(i.reference_url))+'" target="_blank" rel="noopener noreferrer" style="color:#6650be;font-weight:700">📄 Buka dokumen rujukan (Markdown) ↗</a></p>':'')+
 (related.length?'<h3>Release berkaitan</h3><div class="rm-history">'+related.map(e=>'<section><small>'+esc(e.date||'Release')+' · '+esc(e.stage)+'</small><p>'+esc(e.heading)+': '+esc(e.summary.slice(0,260))+'</p><a href="'+esc(safeReference(e.source_url))+'" target="_blank" rel="noopener noreferrer">Changelog ↗</a></section>').join('')+'</div>':'')+
 '<h3>Sejarah kemas kini</h3><div class="rm-history">'+(logs.length?logs.map(e=>'<section><small>'+date(e.created_at)+'</small><p>'+esc(e.body)+'</p></section>').join(''):'<section><p>Belum ada catatan.</p></section>')+'</div>'+
 (manage?'<button class="rm-btn" data-edit="'+esc(i.id)+'">Edit feature</button>':'')+'</div>';
}
function optionMap(values:Record<string,string>,chosen:string):string{return Object.entries(values).map(([k,v])=>'<option value="'+esc(k)+'"'+(k===chosen?' selected':'')+'>'+esc(v)+'</option>').join('');}
function itemEditor(i:Item|null):string{
 const r=i||{title:'',summary:'',category:'general',status:'idea' as Status,priority:'p2',progress:0,target_date:null,reference_url:null,highlights:[],acceptance_criteria:[],is_public:false};
 const prior={p0:'P0 · Urgent',p1:'P1 · High',p2:'P2 · Normal',p3:'P3 · Later'};
 return '<div class="rm-dialog-header"><div><span class="rm-tag">Owner mode</span><h2>'+(i?'Edit feature':'Tambah planning')+'</h2></div><button type="button" class="rm-x" data-close>×</button></div>'+
 '<form class="rm-form" id="rmForm"><label>Nama feature<input name="title" maxlength="160" minlength="3" required placeholder="Contoh: Shopee Keyword Intelligence" value="'+esc(r.title)+'"></label>'+
 '<label>Penerangan<textarea name="summary" rows="3" maxlength="4000" placeholder="Tujuan dan hasil yang dijangka">'+esc(r.summary)+'</textarea></label>'+
 '<div class="rm-form-grid"><label>Kategori<select name="category">'+optionMap(CATS,r.category)+'</select></label>'+
 '<label>Status<select name="status">'+optionMap(STAT,r.status)+'</select></label>'+
 '<label>Priority<select name="priority">'+optionMap(prior,r.priority)+'</select></label>'+
 '<label>Progress (%)<input name="progress" type="number" min="0" max="100" value="'+r.progress+'"></label>'+
 '<label>Sasaran tarikh<input name="target_date" type="date" value="'+(r.target_date||'')+'"></label>'+
 '<label class="rm-checkbox"><input type="checkbox" name="is_public"'+(r.is_public?' checked':'')+'> Papar kepada umum</label></div>'+
 '<label>Pautan dokumen rujukan (HTTPS)<input name="reference_url" type="url" maxlength="1024" placeholder="https://github.com/.../docs/roadmap/..." value="'+esc(r.reference_url||'')+'"></label>'+ 
 '<label>Ringkasan penting (satu poin setiap baris)<textarea name="highlights" rows="4" maxlength="4000" placeholder="Skop ringkas / bukti kemajuan">'+esc(bulletList(r.highlights).join('\n'))+'</textarea></label>'+ 
 '<label>Checklist siap (satu kriteria setiap baris)<textarea name="acceptance_criteria" rows="4" maxlength="4000" placeholder="Syarat sebelum Completed">'+esc(bulletList(r.acceptance_criteria).join('\n'))+'</textarea></label>'+ 
 '<label>Nota perkembangan (optional)<textarea name="update_note" maxlength="1000" rows="2" placeholder="Contoh: API selesai diuji."></textarea></label>'+
 '<div class="rm-form-foot"><button type="button" class="rm-cancel" data-close>Batal</button><button type="submit" class="rm-btn">Simpan</button></div><div class="rm-form-error" id="rmFormError" role="alert"></div></form>';
}
function modal():void{
 const pane=document.querySelector<HTMLElement>('#rmModal');
 if(!pane)return;
 const i=items.find(x=>x.id===(editId||modalId))||null;
 if(editId===null&&modalId===null){pane.hidden=true;pane.innerHTML='';return;}
 pane.hidden=false;pane.innerHTML='<div class="rm-dialog" role="dialog" aria-modal="true">'+(editId!==null?itemEditor(i):i?itemDetails(i):'')+'</div>';
}
function render():void{
 if(!root)return;
 root.innerHTML='<main class="roadmap-app"><header class="rm-head"><a class="rm-brand" href="/"><span class="rm-logo">i</span><span>iCetak <small style="font-size:11px;color:#9698a7;font-weight:500"> / Roadmap</small></span></a>'+
 '<nav class="rm-headlinks"><a href="/?admin=v2">Admin ERP</a>'+(owner?'<a href="'+(manage?'/roadmap':'/roadmap?manage=1')+'">'+(manage?'Public View':'Urus Roadmap')+'</a>':'')+'</nav></header>'+
 '<div class="rm-main"><div class="rm-intro"><div><div class="rm-eyebrow">iCetak · Product development</div><h1>Roadmap & Progress</h1><p>Idea, perancangan, pembangunan dan update sistem iCetak dalam satu tempat.</p></div>'+
 (manage?'<button class="rm-btn" data-add>+ Tambah Planning</button>':'')+'</div>'+
 '<nav class="rm-tabs"><button class="'+(tab==='roadmap'?'on':'')+'" data-tab="roadmap">Roadmap</button><button class="'+(tab==='changelog'?'on':'')+'" data-tab="changelog">Changelog</button></nav>'+
 '<div class="rm-filters"><input class="rm-search" id="rmSearch" type="search" placeholder="Cari feature..." aria-label="Cari feature" value="'+esc(search)+'">'+
 '<select class="rm-filter" id="rmCategory" aria-label="Kategori"><option value="all">Semua kategori</option>'+optionMap(CATS,category)+'</select><span class="rm-counts">'+relevant().length+' feature'+(manage?' · owner / private view':'')+'</span></div>'+
 (notice?'<div class="rm-note" role="status">'+esc(notice)+'</div>':'')+(failure?'<div class="rm-error" role="alert">'+esc(failure)+'</div>':'')+
 (loading?'<div class="rm-coming">Memuatkan roadmap...</div>':tab==='roadmap'?board():changelog())+
 '<footer class="rm-footer"><span>iCetak Roadmap · Dikemas kini oleh pasukan</span><a href="/">Kembali ke DecoCake</a></footer></div></main>'+
 '<div class="rm-overlay" id="rmModal" hidden></div>';modal();
}
function close():void{editId=null;modalId=null;render();}
async function reload():Promise<void>{
 loading=true;failure='';render();
 const [a,b,c]=await Promise.all([
  supabase.from('icetak_roadmap_items').select('id,title,summary,category,status,priority,progress,target_date,reference_url,highlights,acceptance_criteria,is_public,created_at,updated_at,completed_at').order('updated_at',{ascending:false}).limit(400),
  supabase.from('icetak_roadmap_updates').select('id,item_id,body,kind,is_public,created_at').order('created_at',{ascending:false}).limit(600),
  fetch('/roadmap-changelog.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}).catch(e=>({error:String(e),releases:[]}))
 ]);
 if(a.error||b.error)failure='Tidak dapat membaca roadmap: '+(a.error?.message||b.error?.message);
 items=(a.data||[]) as Item[];events=(b.data||[]) as Event[];
 releases=Array.isArray(c?.releases)?c.releases as Release[]:[];releaseError=c?.error?'Release feed belum dapat dimuatkan: '+c.error:'';
 loading=false;render();
}
async function save(form:HTMLFormElement):Promise<void>{
 if(!manage||!owner)return;
 const field=new FormData(form),read=(k:string)=>String(field.get(k)||'').trim();
 const status=read('status') as Status;
 const record={title:read('title'),summary:read('summary'),category:read('category')||'general',status,priority:read('priority')||'p2',
 progress:status==='completed'?100:Math.max(0,Math.min(100,Number(field.get('progress'))||0)),
 target_date:read('target_date')||null,reference_url:read('reference_url')||null,
 highlights:read('highlights').split(/\r?\n/).map(s=>s.trim()).filter(Boolean).slice(0,12),
 acceptance_criteria:read('acceptance_criteria').split(/\r?\n/).map(s=>s.trim()).filter(Boolean).slice(0,15),
 is_public:field.get('is_public')==='on'};
 const old=items.find(i=>i.id===editId);
 const button=form.querySelector<HTMLButtonElement>('button[type=submit]');
 if(button){button.disabled=true;button.textContent='Menyimpan...';}
 const result=old?await supabase.from('icetak_roadmap_items').update(record).eq('id',old.id).select('id').single():
   await supabase.from('icetak_roadmap_items').insert(record).select('id').single();
 if(result.error){const el=form.querySelector<HTMLElement>('#rmFormError');if(el)el.textContent=result.error.message;if(button){button.disabled=false;button.textContent='Simpan';}return;}
 const note=read('update_note'),changed=old?.status!==status;
 const message=note||(!old?'Planning baharu direkodkan.':changed?'Status dikemas kini kepada '+STAT[status]+'.':'');
 if(message){
  const r=await supabase.from('icetak_roadmap_updates').insert({item_id:result.data.id,body:message,kind:status==='completed'?'release':old?'progress':'created',is_public:record.is_public});
  notice=r.error?'Planning disimpan tetapi catatan progress gagal disimpan.':'Roadmap berjaya disimpan.';
 }else notice='Roadmap berjaya disimpan.';
 editId=null;modalId=null;await reload();
}
async function init():Promise<void>{
 document.title='iCetak Roadmap | DecoCake';
 try{
  const {data}=await supabase.auth.getSession();
  if(data.session){const check=await supabase.rpc('icetak_roadmap_can_edit');owner=check.data===true&&!check.error;}
 }catch{owner=false;}
 manage=owner&&new URLSearchParams(location.search).get('manage')==='1';
 if(root){
  root.addEventListener('click',e=>{
   const el=e.target as HTMLElement;
   if(el.closest('[data-close]')||el.id==='rmModal'){close();return;}
   const v=el.closest<HTMLElement>('[data-view]');if(v){modalId=v.dataset.view||'';editId=null;render();return;}
   const d=el.closest<HTMLElement>('[data-edit]');if(d&&manage){editId=d.dataset.edit||'';modalId=null;render();return;}
   if(el.closest('[data-more]')){releaseCount+=35;render();return;}
   if(el.closest('[data-add]')&&manage){editId='';modalId=null;render();return;}
   const t=el.closest<HTMLElement>('[data-tab]');if(t){tab=t.dataset.tab==='changelog'?'changelog':'roadmap';notice='';render();}
  });
  root.addEventListener('input',e=>{
   const el=e.target as HTMLInputElement;if(el.id!=='rmSearch')return;
   search=el.value;const pos=el.selectionStart;render();const next=root.querySelector<HTMLInputElement>('#rmSearch');
   next?.focus();if(pos!==null)next?.setSelectionRange(pos,pos);
  });
  root.addEventListener('change',e=>{const el=e.target as HTMLSelectElement;if(el.id==='rmCategory'){category=el.value;render();}});
  root.addEventListener('submit',e=>{const form=e.target as HTMLFormElement;if(form.id==='rmForm'){e.preventDefault();void save(form);}});
 }
 render();await reload();
}
void init();
