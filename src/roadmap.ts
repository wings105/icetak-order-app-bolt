import { supabase } from './appdeploy-client';
import './roadmap.css';
import {PRIORITIES,WORK_TYPES,OUTCOMES,LEVELS,RULES_URL,comparePriority,latestRun,checkFilter,isStale,type CheckRun,type CheckEvent} from './roadmap-checker';

type Status = 'idea'|'planned'|'building'|'testing'|'completed'|'on_hold';
type Item = {id:string;title:string;summary:string;category:string;status:Status;priority:string;priority_rank:number;priority_reason:string;work_type:string;progress:number;target_date:string|null;reference_url:string|null;highlights:string[];acceptance_criteria:string[];is_public:boolean;created_at:string;updated_at:string;completed_at:string|null};
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
let owner=false,manage=false,tab:'roadmap'|'changelog'|'ai-checker'='roadmap',category='all',search='',items:Item[]=[],events:Event[]=[];
let modalId:string|null=null,editId:string|null=null,loading=true,notice='',failure='';
let releases:Release[]=[],releaseCount=35,releaseError='';
let priority='all',workType='all',sortBy='priority',checkState='all',checkItem='all';
let latestChecks:CheckRun[]=[],checkHistory:CheckRun[]=[],checkEvents:CheckEvent[]=[],checkLimit=40,checkError='',historyLoading=false,historyRequest=0;
let checkerItem:string|null=null,expandedRun:string|null=null,startRequestId:string|null=null;
const timestamp=(value:string)=>new Intl.DateTimeFormat('ms-MY',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kuala_Lumpur'}).format(new Date(value))+' MYT';
const featureCode=(i:Item)=>i.reference_url?.match(/#(ic-\d{3})$/i)?.[1]?.toUpperCase()||'';
const bulletList=(items:unknown,max=12)=>Array.isArray(items)?items.filter((s):s is string=>typeof s==='string'&&s.trim().length>0).slice(0,max):[];
const bulletHtml=(items:string[])=>'<ul class="rm-bullets">'+items.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul>';

function relevant():Item[]{return items.filter(i=>(manage||i.is_public)&&(category==='all'||i.category===category)&&(priority==='all'||i.priority===priority)&&(workType==='all'||i.work_type===workType)&&(!manage||!!checkError||checkFilter(i,latestChecks,checkState))&&(checkItem==='all'||i.id===checkItem)&&(!search||(i.title+' '+i.summary+' '+i.category+' '+featureCode(i)+' '+i.priority_reason).toLowerCase().includes(search.toLowerCase())));}
function ordered(list:Item[]):Item[]{return [...list].sort(sortBy==='recent'?(a,b)=>b.updated_at.localeCompare(a.updated_at):sortBy==='unchecked'?(a,b)=>Number(!!latestRun(latestChecks,a.id))-Number(!!latestRun(latestChecks,b.id))||comparePriority(a,b):comparePriority);}
function checkBadge(i:Item):string{
 if(!manage)return '';
 const r=latestRun(latestChecks,i.id);
 return '<span class="rm-check-badge '+(r?.outcome||'never')+'">'+esc(checkError?'Status semakan tidak tersedia':r?r.scope.toLowerCase().includes('priority sahaja')?'Priority sahaja · belum audit feature':isStale(r)?'Semakan lama · perlu sambung':OUTCOMES[r.outcome]:'Belum disemak AI')+'</span>';
}
function card(i:Item):string{
 const details=(i.progress>0?i.progress+'% siap':targetDate(i.target_date)||'Belum dijadual');
 return '<button type="button" class="rm-card" data-view="'+esc(i.id)+'"><span class="rm-tags"><span class="rm-tag">'+esc(CATS[i.category]||i.category)+'</span>'+
 (manage&&!i.is_public?'<span class="rm-tag rm-private">Private</span>':'')+'<span class="rm-prio '+esc(i.priority)+'">'+esc(PRIORITIES[i.priority]||i.priority)+'</span></span>'+
 '<strong>'+esc(i.title)+'</strong><span class="rm-desc">'+esc(i.summary)+'</span><small>'+esc(STAT[i.status])+' · '+esc(details)+'</small>'+
 (i.progress?'<span class="rm-bar"><i style="width:'+i.progress+'%"></i></span>':'')+'<span class="rm-card-work">'+esc(WORK_TYPES[i.work_type]||'Bina feature')+' · #'+i.priority_rank+'</span>'+checkBadge(i)+'</button>';
}
function board():string{
 const visible=relevant();
 return '<div class="rm-board">'+GROUPS.map(g=>{
  const matching=ordered(visible.filter(i=>g.states.includes(i.status)));
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
 '<div class="rm-dialog-body"><p>'+esc(i.summary||'Belum ada penerangan.')+'</p><div class="rm-tags"><span class="rm-prio '+esc(i.priority)+'">'+esc(PRIORITIES[i.priority])+' · #'+i.priority_rank+'</span><span class="rm-tag">'+esc(WORK_TYPES[i.work_type])+'</span></div>'+
 (i.priority_reason?'<p><strong>Kenapa priority ini:</strong> '+esc(i.priority_reason)+'</p>':'')+
 (manage?'<section class="rm-check-summary">'+checkBadge(i)+(latestRun(latestChecks,i.id)?'<p>'+esc(latestRun(latestChecks,i.id)?.summary||'Semakan baru dimulakan; belum ada keputusan.')+'</p><small>'+timestamp(latestRun(latestChecks,i.id)!.last_activity_at)+'</small>':'<p>Belum ada semakan direkodkan. Buka feature sahaja tidak bermaksud sudah diperiksa.</p>')+'<div class="rm-actions"><button class="rm-btn" data-check="'+esc(i.id)+'">'+(latestRun(latestChecks,i.id)?.outcome==='running'?'Sambung semakan':'Mulakan semakan')+'</button><button class="rm-cancel" data-item-log="'+esc(i.id)+'">Log item ini</button></div></section>':'')+
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
 const r=i||{title:'',summary:'',category:'general',status:'idea' as Status,priority:'p2',priority_rank:100,priority_reason:'',work_type:'build',progress:0,target_date:null,reference_url:null,highlights:[],acceptance_criteria:[],is_public:false};
 return '<div class="rm-dialog-header"><div><span class="rm-tag">Owner mode</span><h2>'+(i?'Edit feature':'Tambah planning')+'</h2></div><button type="button" class="rm-x" data-close>×</button></div>'+
 '<form class="rm-form" id="rmForm"><label>Nama feature<input name="title" maxlength="160" minlength="3" required placeholder="Contoh: Shopee Keyword Intelligence" value="'+esc(r.title)+'"></label>'+
 '<label>Penerangan<textarea name="summary" rows="3" maxlength="4000" placeholder="Tujuan dan hasil yang dijangka">'+esc(r.summary)+'</textarea></label>'+
 '<div class="rm-form-grid"><label>Kategori<select name="category">'+optionMap(CATS,r.category)+'</select></label>'+
 '<label>Status<select name="status">'+optionMap(STAT,r.status)+'</select></label>'+
 '<label>Priority<select name="priority">'+optionMap(PRIORITIES,r.priority)+'</select></label>'+
 '<label>Urutan dalam priority (kecil dahulu)<input name="priority_rank" type="number" min="0" max="9999" value="'+r.priority_rank+'"></label>'+
 '<label>Jenis kerja<select name="work_type">'+optionMap(WORK_TYPES,r.work_type)+'</select></label>'+
 '<label>Progress (%)<input name="progress" type="number" min="0" max="100" value="'+r.progress+'"></label>'+
 '<label>Sasaran tarikh<input name="target_date" type="date" value="'+(r.target_date||'')+'"></label>'+
 '<label class="rm-checkbox"><input type="checkbox" name="is_public"'+(r.is_public?' checked':'')+'> Papar kepada umum</label></div>'+
 '<label>Alasan priority<textarea name="priority_reason" maxlength="1000" rows="2">'+esc(r.priority_reason)+'</textarea></label>'+
 '<label>Pautan dokumen rujukan (HTTPS)<input name="reference_url" type="url" maxlength="1024" placeholder="https://github.com/.../docs/roadmap/..." value="'+esc(r.reference_url||'')+'"></label>'+ 
 '<label>Ringkasan penting (satu poin setiap baris)<textarea name="highlights" rows="4" maxlength="4000" placeholder="Skop ringkas / bukti kemajuan">'+esc(bulletList(r.highlights).join('\n'))+'</textarea></label>'+ 
 '<label>Checklist siap (satu kriteria setiap baris)<textarea name="acceptance_criteria" rows="4" maxlength="4000" placeholder="Syarat sebelum Completed">'+esc(bulletList(r.acceptance_criteria).join('\n'))+'</textarea></label>'+ 
 '<label>Nota perkembangan (optional)<textarea name="update_note" maxlength="1000" rows="2" placeholder="Contoh: API selesai diuji."></textarea></label>'+
 '<div class="rm-form-foot"><button type="button" class="rm-cancel" data-close>Batal</button><button type="submit" class="rm-btn">Simpan</button></div><div class="rm-form-error" id="rmFormError" role="alert"></div></form>';
}
function stateText(s:Record<string,unknown>):string{return String(s.progress??'?')+'% · '+String(s.status??'?')+' · '+String(s.priority??'?').toUpperCase()+' #'+String(s.priority_rank??100);}
function checkLog():string{
 if(!manage)return '<div class="rm-coming"><h3>AI Checker · Owner sahaja</h3><p>Login melalui Admin ERP, kemudian buka Urus Roadmap untuk melihat log dalaman.</p></div>';
 const all=latestChecks,open=all.filter(r=>r.outcome==='running'),checked=all.filter(r=>r.outcome!=='running');
 const doneIds=new Set(all.map(r=>r.item_id));
 const cards=checkHistory.map(r=>{
  const i=items.find(i=>i.id===r.item_id);
  return '<article class="rm-review"><div class="rm-review-head"><div><small>'+esc(featureCode(i!)||r.item_id)+' · '+esc(r.checker)+'</small><h3>'+esc(i?.title||'Roadmap feature')+'</h3></div><span class="rm-check-badge '+esc(r.outcome)+'">'+esc(isStale(r)?'Terhenti? · perlu sambung':OUTCOMES[r.outcome])+'</span></div>'+
   '<p><strong>Skop:</strong> '+esc(r.scope)+'</p><div class="rm-review-times"><span>Mula '+timestamp(r.started_at)+'</span><span>'+(r.finished_at?'Tamat '+timestamp(r.finished_at):'Checkpoint '+timestamp(r.last_activity_at))+'</span></div>'+
   '<p class="rm-snapshot">'+esc(stateText(r.before_state))+' → '+esc(stateText(r.after_state))+'</p><p>'+esc(r.summary||'Log mula disimpan. Keputusan belum direkodkan.')+'</p><small>Tahap bukti: '+esc(LEVELS[r.verification_level]||r.verification_level)+'</small>'+
   (r.evidence.length?'<h4>Bukti diperiksa</h4>'+bulletHtml(r.evidence):'')+(r.source_ref?'<p class="rm-muted">Source / ref: '+esc(r.source_ref)+'</p>':'')+
   (r.next_action?'<p class="rm-next"><strong>Langkah seterusnya:</strong> '+esc(r.next_action)+'</p>':'')+
   '<div class="rm-actions"><button class="rm-cancel" data-view="'+esc(r.item_id)+'">Buka feature</button><button class="rm-cancel" data-run-events="'+esc(r.id)+'">Log mula / checkpoint / tamat</button>'+(r.outcome==='running'?'<button class="rm-btn" data-check="'+esc(r.item_id)+'">Sambung / tutup semakan</button>':'')+'</div>'+
   (expandedRun===r.id?'<div class="rm-history">'+(checkEvents.length?checkEvents.map(e=>'<section><small>'+timestamp(e.created_at)+' · '+esc(e.event_kind.toUpperCase())+'</small><p>'+esc(e.summary)+'</p><p class="rm-muted">'+esc(stateText(e.before_state))+' → '+esc(stateText(e.after_state))+'</p>'+(e.evidence.length?bulletHtml(e.evidence):'')+'<p>'+esc(e.next_action)+'</p></section>').join(''):'<p>Memuatkan log...</p>')+'</div>':'')+'</article>';
 }).join('');
 return '<div class="rm-source-head"><div><h3>AI Checker · Log semakan sebenar</h3><p>Log mula → checkpoint → keputusan. Hanya item yang diuji dengan bukti sesuai boleh disahkan.</p></div><a href="'+RULES_URL+'" target="_blank" rel="noopener noreferrer">README & rules AI ↗</a></div>'+
  '<div class="rm-check-stats"><div><strong>'+(checkError?'?':items.filter(i=>!doneIds.has(i.id)).length)+'</strong><span>Belum disemak</span></div><div><strong>'+(checkError?'?':open.length)+'</strong><span>Semakan aktif</span></div><div><strong>'+(checkError?'?':checked.length)+'</strong><span>Ada keputusan terkini</span></div><div><strong>'+(checkError?'?':open.filter(r=>isStale(r)).length)+'</strong><span>Tiada checkpoint > 2 jam</span></div></div>'+
  '<p class="rm-muted">Ringkasan meliputi semua item owner. Semakan lama kekal terbuka sehingga ditutup dengan alasan. Tiada job AI dijalankan apabila tab ini dibuka.</p>'+
  '<div class="rm-actions"><select class="rm-filter" id="rmCheckItem" aria-label="Item log"><option value="all">Semua item</option>'+items.map(i=>'<option value="'+esc(i.id)+'"'+(checkItem===i.id?' selected':'')+'>'+esc(i.title)+'</option>').join('')+'</select><button class="rm-cancel" data-refresh-checks>Refresh log</button></div>'+
  (checkError?'<div class="rm-error">'+esc(checkError)+'</div>':'')+(historyLoading?'<p role="status">Memuatkan log semakan...</p>':'')+
  '<div class="rm-reviews">'+(cards||'<div class="rm-empty">Tiada semakan mengikut filter ini. Buka feature dan Mulakan semakan sebelum memeriksa sistem.</div>')+'</div>'+
  (checkHistory.length===checkLimit?'<div class="rm-more"><button class="rm-cancel" data-more-checks>Muat 40 semakan lagi</button></div>':'');
}
function checkEditor(i:Item):string{
 const run=latestRun(latestChecks,i.id),active=run?.outcome==='running'?run:null;
 return '<div class="rm-dialog-header"><div><span class="rm-tag">AI Checker · '+(active?'Sambung semakan':'Log sebelum semak')+'</span><h2>'+esc(i.title)+'</h2></div><button class="rm-x" data-close>×</button></div>'+
 '<form class="rm-form" id="rmCheckForm" data-run="'+esc(active?.id||'')+'"><p class="rm-muted">Baca README sebelum semakan. Simpan log mula dahulu; kemudian periksa source/backend/UI yang berkaitan.</p>'+
 (active?'<p class="rm-muted">Run '+esc(active.id)+' · '+timestamp(active.started_at)+'<br>Skop: '+esc(active.scope)+'</p>'+
 '<label>Keputusan<select name="outcome">'+optionMap({checkpoint:'Simpan checkpoint · sambung kemudian',verified:OUTCOMES.verified,partial:OUTCOMES.partial,blocked:OUTCOMES.blocked,failed:OUTCOMES.failed,interrupted:OUTCOMES.interrupted},'checkpoint')+'</select></label>'+
 '<label>Tahap bukti<select name="verification_level">'+optionMap(LEVELS,active.verification_level)+'</select></label>'+
 '<label>Apa telah diperiksa / keputusan<textarea name="summary" minlength="10" maxlength="4000" required rows="3">'+esc(active.summary)+'</textarea></label>'+
 '<label>Bukti (satu rujukan / keputusan ujian setiap baris)<textarea name="evidence" maxlength="20000" rows="4" placeholder="Commit / path / RPC / URL / hasil ujian sebenar">'+esc(active.evidence.join('\n'))+'</textarea></label>'+
 '<label>Langkah seterusnya / halangan<textarea name="next_action" maxlength="2000" rows="3">'+esc(active.next_action)+'</textarea></label>'+
 '<label class="rm-checkbox"><input type="checkbox" name="apply_update"> Kemas kini progress / status / priority bersama keputusan akhir</label>'+
 '<div class="rm-form-grid"><label>Progress (%)<input name="progress" type="number" min="0" max="100" value="'+i.progress+'"></label><label>Status<select name="status">'+optionMap(STAT,i.status)+'</select></label><label>Priority<select name="priority">'+optionMap(PRIORITIES,i.priority)+'</select></label><label>Urutan (kecil dahulu)<input name="priority_rank" type="number" min="0" max="9999" value="'+i.priority_rank+'"></label><label>Jenis kerja<select name="work_type">'+optionMap(WORK_TYPES,i.work_type)+'</select></label></div>'+
 '<label>Alasan priority<textarea name="priority_reason" maxlength="1000" rows="2">'+esc(i.priority_reason)+'</textarea></label>':
 '<label>Checker<input name="checker" value="AI Checker / owner" minlength="2" maxlength="120" required></label><label>Skop semakan<textarea name="scope" minlength="10" maxlength="2000" required rows="3" placeholder="Contoh: Semak penerimaan webhook, audit retry dan UI; jangan hantar mesej customer."></textarea></label>')+
 '<label>Source / branch / ref<input name="source_ref" maxlength="1000" value="'+esc(active?.source_ref||'production')+'"></label>'+
 '<div class="rm-form-foot"><a href="'+RULES_URL+'" target="_blank" rel="noopener noreferrer">README ↗</a><button class="rm-btn" type="submit">'+(active?'Simpan log / keputusan':'Simpan log mula')+'</button></div><div class="rm-form-error" id="rmCheckError" role="alert"></div></form>';
}
async function loadCheckHistory():Promise<void>{
 if(!manage)return;
 const request=++historyRequest,ids=relevant().map(i=>i.id);
 historyLoading=true;render();
 if(!ids.length){checkHistory=[];historyLoading=false;render();return;}
 const r=await supabase.from('icetak_roadmap_ai_runs').select('*').in('item_id',ids).order('started_at',{ascending:false}).range(0,checkLimit-1);
 if(request!==historyRequest)return;
 checkHistory=(r.data||[]) as CheckRun[];historyLoading=false;
 if(r.error)checkError='Log AI belum dapat dibaca: '+r.error.message;
 render();
}
async function saveCheck(form:HTMLFormElement):Promise<void>{
 if(!manage||!owner)return;
 const f=new FormData(form),read=(k:string)=>String(f.get(k)||'').trim(),run=form.dataset.run;
 const outcome=read('outcome'),action=!run?'start':outcome==='checkpoint'?'checkpoint':'finish';
 const payload:Record<string,unknown>=run?{outcome,verification_level:read('verification_level'),summary:read('summary'),evidence:read('evidence').split(/\r?\n/).map(s=>s.trim()).filter(Boolean),next_action:read('next_action'),source_ref:read('source_ref')}:{checker:read('checker'),scope:read('scope'),source_ref:read('source_ref')};
 if(run&&f.get('apply_update')==='on'){
  if(action!=='finish'){form.querySelector('#rmCheckError')!.textContent='Kemas kini roadmap hanya bersama keputusan akhir; checkpoint menyimpan log sahaja.';return;}
  Object.assign(payload,{progress:Number(read('progress')),status:read('status'),priority:read('priority'),priority_rank:Number(read('priority_rank')),priority_reason:read('priority_reason'),work_type:read('work_type')});
 }
 const button=form.querySelector<HTMLButtonElement>('button[type=submit]')!;button.disabled=true;
 if(!startRequestId)startRequestId=crypto.randomUUID();
 const r=await supabase.rpc('icetak_roadmap_ai_check',{p_action:action,p_run_id:run||startRequestId,p_item_id:checkerItem,p_payload:payload});
 if(r.error){form.querySelector('#rmCheckError')!.textContent=r.error.message;button.disabled=false;return;}
 if(r.data?.conflict){form.querySelector('#rmCheckError')!.textContent='Item berubah semasa disemak. Progress tidak ditimpa. Tutup run sebagai interrupted, baca semula dan mulakan run baharu.';button.disabled=false;return;}
 const selected=checkerItem;
 notice=action==='start'?'Log mula disimpan. Periksa sistem dahulu, kemudian rekod bukti dan keputusan.':action==='checkpoint'?'Checkpoint disimpan; semakan kekal terbuka.':'Keputusan dan sebarang kemas kini roadmap disimpan bersama log.';
 checkerItem=null;startRequestId=null;await reload();
 if(action==='start'){checkerItem=selected;modal();}
}
function modal():void{
 const pane=document.querySelector<HTMLElement>('#rmModal');
 if(!pane)return;
 const i=items.find(x=>x.id===(editId||modalId))||null;
 if(editId===null&&modalId===null&&checkerItem===null){pane.hidden=true;pane.innerHTML='';return;}
 pane.hidden=false;pane.innerHTML='<div class="rm-dialog" role="dialog" aria-modal="true">'+(checkerItem!==null?checkEditor(items.find(x=>x.id===checkerItem)!):editId!==null?itemEditor(i):i?itemDetails(i):'')+'</div>';
}
function render():void{
 if(!root)return;
 root.innerHTML='<main class="roadmap-app"><header class="rm-head"><a class="rm-brand" href="/"><span class="rm-logo">i</span><span>iCetak <small style="font-size:11px;color:#9698a7;font-weight:500"> / Roadmap</small></span></a>'+
 '<nav class="rm-headlinks"><a href="/?admin=v2">Admin ERP</a>'+(owner?'<a href="'+(manage?'/roadmap':'/roadmap?manage=1')+'">'+(manage?'Public View':'Urus Roadmap')+'</a>':'')+'</nav></header>'+
 '<div class="rm-main"><div class="rm-intro"><div><div class="rm-eyebrow">iCetak · Product development</div><h1>Roadmap & Progress</h1><p>Idea, perancangan, pembangunan dan update sistem iCetak dalam satu tempat.</p></div>'+
 (manage?'<button class="rm-btn" data-add>+ Tambah Planning</button>':'')+'</div>'+
 '<nav class="rm-tabs"><button class="'+(tab==='roadmap'?'on':'')+'" data-tab="roadmap">Roadmap</button><button class="'+(tab==='changelog'?'on':'')+'" data-tab="changelog">Changelog</button><button class="'+(tab==='ai-checker'?'on':'')+'" data-tab="ai-checker">AI Checker</button><a href="'+RULES_URL+'" target="_blank" rel="noopener noreferrer">README rules ↗</a></nav>'+
 '<div class="rm-filters"><input class="rm-search" id="rmSearch" type="search" placeholder="Cari feature..." aria-label="Cari feature" value="'+esc(search)+'">'+
 '<select class="rm-filter" id="rmCategory" aria-label="Kategori"><option value="all">Semua kategori</option>'+optionMap(CATS,category)+'</select>'+
 '<select class="rm-filter" id="rmPriority" aria-label="Priority"><option value="all">Semua priority</option>'+optionMap(PRIORITIES,priority)+'</select>'+
 '<select class="rm-filter" id="rmWorkType" aria-label="Jenis kerja"><option value="all">Semua jenis kerja</option>'+optionMap(WORK_TYPES,workType)+'</select>'+
 '<select class="rm-filter" id="rmSort" aria-label="Sorting">'+optionMap({priority:'Priority & urutan dahulu',recent:'Kemas kini terbaru',...(manage?{unchecked:'Belum disemak dahulu'}:{})},sortBy)+'</select>'+
 (manage?'<select class="rm-filter" id="rmCheckState" aria-label="Status AI Checker">'+optionMap({all:'Semua status semakan',never:'Belum disemak',running:'Sedang disemak',stale:'Terhenti > 2 jam',needs_action:'Perlu tindakan / sambung',verified:'Disahkan dengan ujian'},checkState)+'</select>':'')+
 '<span class="rm-counts">'+relevant().length+' feature'+(manage?' · owner / private view':'')+'</span></div>'+
 (notice?'<div class="rm-note" role="status">'+esc(notice)+'</div>':'')+(failure?'<div class="rm-error" role="alert">'+esc(failure)+'</div>':'')+
 (loading?'<div class="rm-coming">Memuatkan roadmap...</div>':tab==='roadmap'?(manage?'<section class="rm-queue"><h3>Buat / fix dahulu</h3><p>P0 kritikal → P1 dahulu → P2 seterusnya → P3 kemudian. Nombor urutan kecil didahulukan dalam priority yang sama.</p>'+ordered(relevant().filter(i=>i.status!=='completed')).slice(0,6).map(i=>'<button data-view="'+esc(i.id)+'"><span class="rm-prio '+esc(i.priority)+'">'+esc(i.priority.toUpperCase())+' #'+i.priority_rank+'</span><span><strong>'+esc(i.title)+'</strong><small>'+esc(i.priority_reason||'Alasan priority belum direkodkan; AI perlu semak dahulu.')+'</small></span><span class="rm-tag">'+esc(WORK_TYPES[i.work_type])+'</span></button>').join('')+'</section>':'')+board():tab==='ai-checker'?checkLog():changelog())+
 '<footer class="rm-footer"><span>iCetak Roadmap · Dikemas kini oleh pasukan</span><a href="/">Kembali ke DecoCake</a></footer></div></main>'+
 '<div class="rm-overlay" id="rmModal" hidden></div>';modal();
}
function close():void{editId=null;modalId=null;checkerItem=null;startRequestId=null;render();}
async function reload():Promise<void>{
 loading=true;failure='';render();
 const [a,b,c]=await Promise.all([
  supabase.from('icetak_roadmap_items').select('id,title,summary,category,status,priority,priority_rank,priority_reason,work_type,progress,target_date,reference_url,highlights,acceptance_criteria,is_public,created_at,updated_at,completed_at').order('updated_at',{ascending:false}).limit(400),
  supabase.from('icetak_roadmap_updates').select('id,item_id,body,kind,is_public,created_at').order('created_at',{ascending:false}).limit(600),
  fetch('/roadmap-changelog.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}).catch(e=>({error:String(e),releases:[]}))
 ]);
 if(a.error||b.error)failure='Tidak dapat membaca roadmap: '+(a.error?.message||b.error?.message);
 items=(a.data||[]) as Item[];events=(b.data||[]) as Event[];
 releases=Array.isArray(c?.releases)?c.releases as Release[]:[];releaseError=c?.error?'Release feed belum dapat dimuatkan: '+c.error:'';
 if(manage){const checks=await supabase.rpc('icetak_roadmap_ai_latest');latestChecks=(checks.data||[]) as CheckRun[];checkError=checks.error?'Status AI Checker tidak dapat dibaca: '+checks.error.message:'';}
 loading=false;render();
 if(manage&&tab==='ai-checker')await loadCheckHistory();
}
async function save(form:HTMLFormElement):Promise<void>{
 if(!manage||!owner)return;
 const field=new FormData(form),read=(k:string)=>String(field.get(k)||'').trim();
 const status=read('status') as Status;
 const record={title:read('title'),summary:read('summary'),category:read('category')||'general',status,priority:read('priority')||'p2',priority_rank:Math.max(0,Math.min(9999,Number(read('priority_rank'))||0)),priority_reason:read('priority_reason'),work_type:read('work_type')||'build',
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
 const message=note||(!old?'Planning baharu direkodkan.':changed?'Status dikemas kini kepada '+STAT[status]+'.':old.priority!==record.priority||old.priority_rank!==record.priority_rank?'Priority dikemas kini kepada '+record.priority.toUpperCase()+' #'+record.priority_rank+'. '+record.priority_reason:'');
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
 const params=new URLSearchParams(location.search);
 if(params.get('tab')==='ai-checker')tab='ai-checker';
 if(manage&&params.get('item'))checkItem=params.get('item')!;
 if(root){
  root.addEventListener('click',e=>{
   const el=e.target as HTMLElement;
   if(el.closest('[data-close]')||el.id==='rmModal'){close();return;}
   const c=el.closest<HTMLElement>('[data-check]');if(c&&manage){checkerItem=c.dataset.check!;modalId=null;editId=null;startRequestId=null;modal();return;}
   const il=el.closest<HTMLElement>('[data-item-log]');if(il&&manage){checkerItem=null;modalId=null;editId=null;checkItem=il.dataset.itemLog!;tab='ai-checker';void loadCheckHistory();return;}
   const re=el.closest<HTMLElement>('[data-run-events]');if(re&&manage){expandedRun=re.dataset.runEvents!;checkEvents=[];render();void supabase.from('icetak_roadmap_ai_events').select('*').eq('run_id',expandedRun).order('id',{ascending:true}).then(r=>{if(expandedRun!==re.dataset.runEvents)return;checkEvents=(r.data||[]) as CheckEvent[];if(r.error)checkError=r.error.message;render();});return;}
   if(el.closest('[data-more-checks]')){checkLimit+=40;void loadCheckHistory();return;}
   if(el.closest('[data-refresh-checks]')){void reload();return;}
   const v=el.closest<HTMLElement>('[data-view]');if(v){modalId=v.dataset.view||'';editId=null;render();return;}
   const d=el.closest<HTMLElement>('[data-edit]');if(d&&manage){editId=d.dataset.edit||'';modalId=null;render();return;}
   if(el.closest('[data-more]')){releaseCount+=35;render();return;}
   if(el.closest('[data-add]')&&manage){editId='';modalId=null;render();return;}
   const t=el.closest<HTMLElement>('[data-tab]');if(t){tab=t.dataset.tab==='changelog'?'changelog':t.dataset.tab==='ai-checker'?'ai-checker':'roadmap';notice='';if(tab!=='ai-checker')checkItem='all';render();if(tab==='ai-checker')void loadCheckHistory();}
  });
  root.addEventListener('input',e=>{
   const el=e.target as HTMLInputElement;if(el.id!=='rmSearch')return;
   search=el.value;const pos=el.selectionStart;render();const next=root.querySelector<HTMLInputElement>('#rmSearch');
   next?.focus();if(pos!==null)next?.setSelectionRange(pos,pos);
   if(tab==='ai-checker')void loadCheckHistory();
  });
  root.addEventListener('change',e=>{const el=e.target as HTMLSelectElement;
   if(el.id==='rmCategory')category=el.value;else if(el.id==='rmPriority')priority=el.value;else if(el.id==='rmWorkType')workType=el.value;else if(el.id==='rmSort')sortBy=el.value;else if(el.id==='rmCheckState')checkState=el.value;else if(el.id==='rmCheckItem')checkItem=el.value;else return;
   render();if(tab==='ai-checker')void loadCheckHistory();
  });
  root.addEventListener('submit',e=>{const form=e.target as HTMLFormElement;if(form.id==='rmForm'){e.preventDefault();void save(form);}if(form.id==='rmCheckForm'){e.preventDefault();void saveCheck(form);}});
 }
 render();await reload();
}
void init();
