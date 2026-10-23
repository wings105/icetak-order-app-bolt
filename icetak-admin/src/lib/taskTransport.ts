let stationToken='';
export function configureTaskStation(token:string){if(!/^tw_[a-f0-9]{64}$/.test(token))throw Error('Pautan Task Workspace tidak lengkap.');stationToken=token;}
export function isTaskStation(){return !!stationToken;}
// Admin continues to use its existing session. The standalone entry carries
// only the scoped workstation capability, never an admin session/API key.
export async function taskInvoke(name:'task-workspace'|'task-clickup',body:Record<string,unknown>|FormData){
 if(!stationToken){const {supabase}=await import('./supabase');return supabase.functions.invoke(name,{body});}
 const base=import.meta.env.VITE_SUPABASE_URL||'https://buivecgahhmrhlmfujgt.supabase.co';
 const multipart=body instanceof FormData;
 try{
  const response=await fetch(base+'/functions/v1/task-workspace-station',{method:'POST',credentials:'omit',cache:'no-store',headers:{authorization:'Bearer '+stationToken,'x-task-service':name==='task-workspace'?'workspace':'clickup',...(!multipart?{'content-type':'application/json'}:{})},body:multipart?body:JSON.stringify(body)});
  if(!response.ok)return {data:null,error:{context:response}};
  const data=response.headers.get('content-type')?.includes('application/json')?await response.json():await response.blob();
  return {data,error:null};
 }catch{return {data:null,error:{context:Response.json({error:'Sambungan Task Workspace terganggu. Cuba semula.'})}};}
}
