// Activepieces Code step. Map secrets from AP connections/secret inputs, never literals.
// Set this flow's concurrency to 1. Fields may be an object or a JSON string.
type Inputs={sku:string;fields:Record<string,string>|string;renderer_key:string;clickup_token:string;task_id:string};
export const code=async(inputs:Inputs)=>{
 const {sku,task_id}=inputs;
 if(!/^[A-Z0-9_-]{1,40}$/i.test(sku)||!/^\w+$/.test(task_id))throw new Error('SKU / ClickUp task ID tidak sah');
 const fields=typeof inputs.fields==='string'?JSON.parse(inputs.fields):inputs.fields;
 const png=await fetch('https://shop.decocake.my/render-test/output.png',{method:'POST',headers:{Authorization:'Bearer '+inputs.renderer_key,'Content-Type':'application/json'},body:JSON.stringify({sku,fields}),signal:AbortSignal.timeout(90000)});
 if(!png.ok)throw new Error('Renderer '+png.status+': '+((await png.json()).error||'Request gagal'));
 if(!png.headers.get('content-type')?.startsWith('image/png'))throw new Error('Renderer tidak pulangkan PNG');
 const renderId=png.headers.get('x-render-id');if(!renderId||!/^[a-f0-9]{64}$/.test(renderId))throw new Error('Render ID tiada');
 const bytes=new Uint8Array(await png.arrayBuffer());if(bytes.length>16*1024*1024||bytes.slice(0,8).join(',')!=='137,80,78,71,13,10,26,10')throw new Error('Fail PNG tidak sah');
 const filename=sku.toUpperCase()+'-'+renderId+'.png',marker='[icetak-render:'+renderId+']';
 const base='https://api.clickup.com/api/v2';
 async function clickup(path:string,options:RequestInit={}){
  const response=await fetch(base+path,{...options,headers:{Authorization:inputs.clickup_token,...options.headers},signal:AbortSignal.timeout(45000)});
  const data=await response.json();if(!response.ok)throw new Error('ClickUp '+response.status+': '+(data.err||data.error||'Request gagal'));return data;
 }
 const task=await clickup('/task/'+task_id);
 let attachment=(task.attachments||[]).find((a:{title?:string;name?:string})=>a.title===filename||a.name===filename),attachmentReused=!!attachment;
 if(!attachment){const form=new FormData();form.append('attachment',new Blob([bytes],{type:'image/png'}),filename);attachment=await clickup('/task/'+task_id+'/attachment',{method:'POST',body:form});}
 if(!attachment.url)throw new Error('ClickUp attachment URL tiada. Semak task sebelum retry.');
 let comment=null,cursor='';
 for(let page=0;page<20;page++){
  const result=await clickup('/task/'+task_id+'/comment'+cursor);
  const comments=result.comments||[];
  comment=comments.find((c:{comment_text?:string;comment?:{text?:string}[]})=>(c.comment_text||c.comment?.map(p=>p.text||'').join('')||'').includes(marker));
  if(comment||comments.length<25)break;
  const last=comments[comments.length-1];cursor='?'+new URLSearchParams({start:String(last.date),start_id:String(last.id)});
  if(page===19)throw new Error('Comment history terlalu panjang. Attachment sudah ada; semak comment sebelum retry.');
 }
 const commentReused=!!comment;
 if(!comment)comment=await clickup('/task/'+task_id+'/comment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({comment_text:['Auto render '+sku.toUpperCase(),...Object.entries(fields).map(([key,value])=>key+': '+value),'PNG: '+attachment.url,marker].join('\n'),notify_all:false})});
 return {ok:true,task_id,render_id:renderId,filename,width:Number(png.headers.get('x-render-width')),height:Number(png.headers.get('x-render-height')),attachment_url:attachment.url,comment_id:comment.id,attachment_reused:attachmentReused,comment_reused:commentReused};
};
