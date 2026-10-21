import {dueAt,type WorkTask} from './taskWorkspace';
export const taskCategories=[['all','Semua'],['edible','Edible'],['topper','Topper'],['acrylic','Acrylic'],['wafer','Wafer'],['stock','Ready stock'],['other','Lain-lain']] as const;
export const taskPriorities=[['all','Semua'],['action','Perlu tindakan'],['late','Lewat'],['today','Due today'],['review','Perlu semakan'],['ready','Sedia design'],['waiting','Tunggu customer']] as const;
const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur'});
export const localDay=(value:number)=>day.format(value);
export function category(task:WorkTask){
 const text=[task.status,task.source_status,task.title].join(' ').toLowerCase();
 if(/ready stock/.test(task.status))return 'stock';
 const product=task.readiness?.values.product;
 if(['edible','topper','acrylic','wafer'].includes(product||''))return product;
 if(/wafer/.test(text))return 'wafer';if(/acrylic/.test(text))return 'acrylic';if(/edible|icing/.test(text))return 'edible';
 if(/topper|artpaper|new custom/.test(text))return 'topper';return 'other';
}
export function activeTask(task:WorkTask){return !['complete','closed','cancelled','canceled'].includes(task.status.toLowerCase());}
export function priorityMatch(task:WorkTask,key:string,now=Date.now()){
 const r=task.readiness,waiting=task.status==='review'&&!/edit|reject/i.test(task.review_status),due=dueAt(task),date=due?Date.parse(due):NaN;
 if(key==='all')return true;
 if(key==='today')return Number.isFinite(date)&&date>Date.parse('2020-01-01')&&localDay(date)===localDay(now);
 if(key==='late')return Number.isFinite(date)&&date>Date.parse('2020-01-01')&&localDay(date)<localDay(now);
 if(key==='review')return task.source_status==='review'||!r||r.status==='review'||r.expired;
 if(key==='ready')return !waiting&&r?.status==='ready'&&!/printing|print alamat|ready stock/.test(task.status);
 if(key==='waiting')return waiting||r?.status==='missing';
 return !waiting&&activeTask(task);
}
export function taskSearch(task:WorkTask,query:string){return [task.title,task.order_reference,task.customer,task.phone,task.sku,task.wording,task.readiness?.values.wording,...task.sets].join(' ').toLowerCase().includes(query.trim().toLowerCase());}
export function nextAction(task:WorkTask){
 const r=task.readiness;
 if(r?.label==='Perlu semakan semula')return 'Semak perubahan customer';
 if(task.status==='review')return /edit|reject/i.test(task.review_status)?'Semak pembetulan design':'Semak kelulusan customer';
 if(/printing/.test(task.status))return 'Teruskan print / cut';
 if(/ready stock|print alamat/.test(task.status))return 'Sediakan item dan packing';
 if(r?.status==='missing')return 'Dapatkan '+(r.missing.map(m=>m.label).join(', ')||'maklumat customer');
 return r?.status==='ready'?'Buka bahan dan mula design':'Semak mesej dan arahan customer';
}
export type ClickUpOptions={ok:boolean;configured:boolean;can_manage:boolean;can_edit:boolean;statuses:{status:string;color:string}[];status?:string;updated_at?:string;task_url?:string};
export async function clickupRequest(body:Record<string,unknown>){
 const {supabase}=await import('./supabase');
 const {data,error}=await supabase.functions.invoke('task-clickup',{body});
 if(error){let message='Sambungan ClickUp gagal. Cuba semula.';try{message=(await (error as {context?:Response}).context?.json())?.error||message;}catch{}throw Error(message);}
 if(!data?.ok)throw Error(data?.error||'Tindakan ClickUp gagal.');return data;
}
