import {taskInvoke} from './taskTransport.ts';
export type TaskFile={id:string;name:string;mime:string;url:string;uploaded_by:string;created_at:string};
export type BriefForm={values:Record<string,string>;same_design:boolean;final_file_id:string;artwork_qc:boolean;customer_approved:boolean};
export type TaskReadiness={status:'ready'|'review'|'missing';label:string;completeness:number;confidence:'high'|'medium'|'low';confidence_reason:string;values:Record<string,string>;previous_values?:Record<string,string>|null;sources:Record<string,{source:string;at?:string}>;required:string[];missing:{key:string;label:string}[];conflicts:{field:string;label:string;value:string;source:string}[];warnings:string[];evidence:{id:string;text:string;at:string}[];fingerprint:string;version:number;expired:boolean;confirmed_by:string|null;confirmed_at:string|null;can_confirm:boolean;print_ready:boolean;print_missing:string[];review_required:boolean;form:BriefForm;chat_linked:boolean;checked_at:string;asset_warning?:string|null;artwork_url?:string};
export type TaskAsset={id:string;name:string;url:string|null;available:boolean;can_load?:boolean;kind:string;mime?:string;message_id?:string;channel?:string;direction?:string;purpose?:string;at?:string;selected?:boolean};
export type TaskMessage={id:string;channel:string;direction:'inbound'|'outbound';type:string;text:string;caption:string;at:string;asset_id:string|null;important:boolean;text_limited:boolean};
export type TaskDossier={checked_at:string;unavailable:boolean;ambiguous:boolean;truncated:boolean;multi_item:boolean;order_note:string;task_wording:string;task_note:string;sources:Record<string,{source:string;at:string|null;message_id:string|null}>;channels:{channel:string;status:string}[];messages:TaskMessage[];assets:TaskAsset[];product:{name:string;sku:string}|null};
export type WorkTask={dossier?:TaskDossier;readiness?:TaskReadiness;task_id:string;title:string;order_reference:string;order_id:string|null;marketplace_order_id:string|null;component_id:string|null;mapping_status:string;source_status:string;source_updated_at:string;observed_at:string;status:string;native_status:boolean;version:number;assignee:string;note:string;sets:string[];phone:string;customer:string;courier:string;payment_status:string;fulfillment_status:string;source:string;wording:string;sku:string;due_date:string|null;needed_at:string|null;ship_by_at:string|null;review_status:string;images:{url:string;name:string}[];files:TaskFile[];file_count:number;history?:{actor:string;at:string;stage?:string;note?:string;kind:string}[]};
export type TaskSnapshot={ok:boolean;items:WorkTask[];staff:{username:string;name:string}[];actor:string;can_edit:boolean;can_confirm?:boolean;read_at:string;last_webhook_at:string|null;truncated:boolean;error?:string};
export const workStatuses=[
 ['new custom','New custom','#698dcf'],['design editing -topper','Design editing – topper','#20bdeb'],
 ['design edible image','Design edible image','#eac344'],['acrylic','Acrylic','#f79b4d'],['wafer paper','Wafer paper','#bda0ed'],
 ['review','Review','#a991e9'],['cake topper - printing','Cake topper – printing','#54db9c'],
 ['edible image -printing','Edible image – printing','#63d5c4'],['wafer - printing','Wafer – printing','#71cbb4'],
 ['print alamat','Print alamat','#91b5e4'],['ready stock','Ready stock','#8ae9b4'],['complete','Complete','#99a7ad'],
] as const;
export function dueAt(task:WorkTask){const n=Number(task.due_date);return (n>0&&Number.isFinite(n)&&!Number.isNaN(new Date(n).getTime())?new Date(n).toISOString():null)||task.ship_by_at;}
export function workMatches(task:WorkTask,view:string,query:string,actor:string){
 if(view==='designer'&&!['new custom','design editing -topper','design edible image','acrylic','wafer paper','review'].includes(task.status))return false;
 if(view==='printing'&&!['cake topper - printing','edible image -printing','wafer - printing','print alamat','ready stock'].includes(task.status))return false;
 if(view==='acrylic'&&!/acrylic|artpaper/i.test(task.source_status+' '+task.title))return false;
 if(view==='mine'&&task.assignee!==actor)return false;
 return [task.title,task.order_reference,task.phone,task.wording,task.sku,task.customer,task.assignee,...(task.sets||[])].join(' ').toLowerCase().includes(query.toLowerCase().trim());
}
export async function taskRequest(payload:Record<string,unknown>|FormData):Promise<TaskSnapshot>{
 const {data,error}=await taskInvoke('task-workspace',payload);
 if(error){const response=(error as {context?:Response}).context;const detail=response?await response.json().catch(()=>null):null;throw Error(detail?.error||'Task gagal dimuat. Cuba semula.');}
 if(!data?.ok)throw Error(data?.error||'Task gagal dimuat.');return data;
}

export async function taskAsset(taskId:string,assetId:string):Promise<Blob>{
 const {data,error}=await taskInvoke('task-workspace',{action:'asset',task_id:taskId,asset_id:assetId});
 if(error||!(data instanceof Blob))throw Error('Original belum dapat dimuat. Semak semula sumber atau buka fail asal.');
 const bytes=new Uint8Array(await data.slice(0,12).arrayBuffer());const prefix=new TextDecoder().decode(bytes);
 const mime=bytes[0]===0x89&&bytes[1]===0x50?'image/png':bytes[0]===0xff&&bytes[1]===0xd8?'image/jpeg':prefix.startsWith('RIFF')?'image/webp':prefix.startsWith('GIF8')?'image/gif':prefix.startsWith('%PDF-')?'application/pdf':'';
 if(!mime)throw Error('Format original tidak disokong.');return new Blob([data],{type:mime});
}
