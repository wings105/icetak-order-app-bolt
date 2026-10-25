export type CheckOutcome = 'running'|'verified'|'partial'|'blocked'|'failed'|'interrupted';
export type CheckRun = {
 id:string;item_id:string;checker:string;scope:string;outcome:CheckOutcome;verification_level:string;
 summary:string;evidence:string[];next_action:string;source_ref:string;
 before_state:Record<string,unknown>;after_state:Record<string,unknown>;
 started_at:string;last_activity_at:string;finished_at:string|null;
};
export type CheckEvent = {id:number;run_id:string;item_id:string;event_kind:string;checker:string;summary:string;evidence:string[];next_action:string;before_state:Record<string,unknown>;after_state:Record<string,unknown>;created_at:string};
export const PRIORITIES:Record<string,string>={p0:'P0 · Kritikal',p1:'P1 · Buat dahulu',p2:'P2 · Seterusnya',p3:'P3 · Kemudian'};
export const WORK_TYPES:Record<string,string>={fix:'Fix / baiki',verify:'Semak / sahkan',build:'Bina feature',improve:'Tambah baik'};
export const OUTCOMES:Record<CheckOutcome,string>={running:'Sedang disemak',verified:'Disemak · disahkan',partial:'Disemak · belum lengkap',blocked:'Terhalang',failed:'Ujian gagal',interrupted:'Dihentikan / perlu sambung'};
export const LEVELS:Record<string,string>={not_checked:'Belum diperiksa',source:'Source / dokumen sahaja',controlled:'Ujian terkawal',production:'Ujian production'};
export const RULES_URL='https://github.com/wings105/icetak-order-app-bolt/blob/production/docs/roadmap/AI_CHECKER_README.md';
export const isStale=(run:CheckRun,now=Date.now())=>run.outcome==='running'&&now-new Date(run.last_activity_at).getTime()>2*60*60*1000;
type QueueItem={id:string;title:string;priority:string;priority_rank:number;work_type:string;status:string;updated_at:string};
export function comparePriority(a:QueueItem,b:QueueItem):number{
 return Number(a.status==='completed')-Number(b.status==='completed')||a.priority.localeCompare(b.priority)||a.priority_rank-b.priority_rank||
  ['fix','verify','build','improve'].indexOf(a.work_type)-['fix','verify','build','improve'].indexOf(b.work_type)||a.title.localeCompare(b.title);
}
export function latestRun(runs:CheckRun[],id:string):CheckRun|undefined{return runs.find(r=>r.item_id===id);}
export function checkFilter(item:QueueItem,runs:CheckRun[],filter:string):boolean{
 const run=latestRun(runs,item.id);
 if(filter==='all')return true;
 if(filter==='never')return !run;
 if(filter==='stale')return !!run&&isStale(run);
 if(filter==='needs_action')return !!run&&['partial','blocked','failed','interrupted'].includes(run.outcome);
 return run?.outcome===filter;
}
