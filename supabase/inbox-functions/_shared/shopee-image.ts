import {shopeeRequest} from './shopee-direct.ts';
const supported=new Set(['image/jpeg','image/png','image/gif']);
export async function validateShopeeImage(file:File) {
 if(!supported.has(file.type)||!file.size||file.size>10*1024*1024)return false;
 const bytes=new Uint8Array(await file.slice(0,12).arrayBuffer());
 return file.type==='image/png'?bytes.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v):
 file.type==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:
 new TextDecoder().decode(bytes.slice(0,6)).match(/^GIF8[79]a$/)!==null;
}
export async function uploadShopeeImage(config:any,file:File) {
 const form=new FormData();form.append('file',file,file.name);
 const response=await shopeeRequest(config,'/api/v2/sellerchat/upload_image',form,'POST');
 const body=await response.json().catch(()=>({}));
 if(!response.ok||body.error||body.error_code)throw new Error('UPLOAD_REJECTED');
 const url=String(body.response?.url||'');
 if(!/^https:\/\//.test(url))throw new Error('UPLOAD_URL_MISSING');
 return {url,thumbnail:body.response?.thumbnail||null};
}
