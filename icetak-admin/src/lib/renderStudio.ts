import {supabase} from './supabase';
import {API} from '../../../public/render-test/renderer.js';
export async function renderRequest(body:Record<string,unknown>|FormData){
 const {data}=await supabase.auth.getSession();if(!data.session)throw Error('Sila log masuk semula');const multipart=body instanceof FormData;
 const r=await fetch(API,{method:'POST',headers:{Authorization:'Bearer '+data.session.access_token,...(multipart?{}:{'Content-Type':'application/json'})},body:multipart?body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
 const result=await r.json();if(!r.ok||!result.ok)throw Error(result.error||'Permintaan gagal');return result;
}
export async function catalogRequest(action:string,payload:Record<string,unknown>={}){const {data,error}=await supabase.functions.invoke('product-admin',{body:{action,payload}});if(error||!data?.ok)throw Error(data?.error||error?.message||'Katalog tidak tersedia');return data.data;}
export type StudioFont={id:string;name:string;aliases:string[];path:string};
export const statusLabels:Record<string,string>={draft:'Draft',analysing:'AI sedang proses',review:'Perlu semakan',ready:'Ready',paused:'Paused'};
