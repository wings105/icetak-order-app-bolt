import {supabase} from './supabase';
export type DetailData=Record<string,any>;
export async function detailRequest(body:DetailData){
 const {data,error}=await supabase.functions.invoke('admin-ai-dashboard',{body});
 if(error){const context=(error as any).context;let message=error.message;try{if(context instanceof Response)message=(await context.json()).error||message;}catch{/* preserve original failure */}throw Error(message);}
 if(!data?.ok)throw Error(data?.error||'Semakan detail gagal');return data;
}
export const detailDate=(v:unknown)=>v?new Date(String(v)).toLocaleString('ms-MY',{timeZone:'Asia/Kuala_Lumpur',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'Belum ditetapkan';
export const detailStage:DetailData={ready:'Ready design',locked:'Production / order dikunci',waiting:'Menunggu balasan',deadline:'Deadline detail tiba',followup_due:'Perlu follow-up',grace:'Tunggu 30 minit / semak detail'};
