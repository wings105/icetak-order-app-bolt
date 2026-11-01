let stationToken='';
export function configureTaskStation(token:string){if(!/^(?:tw|ap)_[a-f0-9]{64}$/.test(token))throw Error('Pautan Task Workspace tidak lengkap.');stationToken=token;}
export function isTaskStation(){return !!stationToken;}
// Admin continues to use its existing session. The standalone entry carries
// only the scoped workstation capability, never an admin session/API key.
export async function taskInvoke(name:'task-workspace'|'task-clickup',body:Record<string,unknown>|FormData){
 if(!stationToken){const {supabase}=await import('./supabase');return supabase.functions.invoke(name,{body});}
 if(stationToken.startsWith('ap_')&&name!=='task-clickup')return {data:null,error:{context:Response.json({error:'Akses ini hanya untuk tindakan Acrylic / Artpaper.'},{status:403})}};
 const base=import.meta.env.VITE_SUPABASE_URL||'https://buivecgahhmrhlmfujgt.supabase.co';
 const multipart=body instanceof FormData;
 try{
  const response=await fetch(base+'/functions/v1/'+(stationToken.startsWith('ap_')?'acrylic-production-actions':'task-workspace-station'),{method:'POST',credentials:'omit',cache:'no-store',headers:{authorization:'Bearer '+stationToken,'x-task-service':name==='task-workspace'?'workspace':'clickup',...(!multipart?{'content-type':'application/json'}:{})},body:multipart?body:JSON.stringify(body)});
  if(!response.ok)return {data:null,error:{context:response}};
  const data=response.headers.get('content-type')?.includes('application/json')?await response.json():await response.blob();
  return {data,error:null};
 }catch{
  const mutation=stationToken.startsWith('ap_')&&!(body instanceof FormData)&&['field','status'].includes(String(body.action));
  return {data:null,error:{context:Response.json({error:mutation?'Perubahan belum dapat disahkan. Tekan Semak perubahan sebelum cuba lagi.':'Sambungan Task Workspace terganggu. Cuba semula.',...(mutation?{uncertain:true,request_id:body instanceof FormData?'':body.request_id}:{})})}};
 }
}
