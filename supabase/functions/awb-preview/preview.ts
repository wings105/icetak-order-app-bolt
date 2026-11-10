// No image recognition: keep every image in the latest image comment, in comment order.
export function previewItem(row: any) {
 const safeUrl=(value: unknown): string => {
  try { const u=new URL(String(value||'')); return u.protocol==='https:' &&
   (u.hostname.endsWith('.clickup-attachments.com') || u.hostname==='attachments.clickup.com') ? u.href : ''; }
  catch { return ''; }
 };
 const isImage=(a:any)=>/^(image\/(png|jpe?g|webp|gif)|png|jpe?g|webp|gif)$/i.test(String(a.extension||a.type||'')) || /\.(png|jpe?g|webp|gif)(?:\?|$)/i.test(String(a.url||''));
 const comments=Array.isArray(row.comment_images)?row.comment_images:[];
 const attachments=Array.isArray(row.attachments)?row.attachments:[];
 // Current full attachment snapshot prevents showing a subsequently deleted image.
 const present=new Set(attachments.flatMap((a:any)=>[String(a.id||''),safeUrl(a.url)]).filter(Boolean));
 const candidates=comments.length ? comments.filter((a:any)=>present.has(String(a.id||'')) || present.has(safeUrl(a.url))) :
  attachments.filter(isImage).sort((a:any,b:any)=>Number(b.date||0)-Number(a.date||0)).slice(0,1);
 const seen=new Set<string>();
 const images=candidates.flatMap((a:any)=>{
  const url=safeUrl(a.url); if(!url || seen.has(url))return []; seen.add(url);
  return [{url,name:String(a.title||a.name||'Preview')}];
 });
 let awb_url='';
 try { const u=new URL(String(row.awb_url||'')); if(u.protocol==='https:'&&!u.username&&!u.password)awb_url=u.href; } catch {}
 return {task_id:row.task_id,title:row.title,customize_name:String(row.customize_name||''),sku:typeof row.sku==='string'?row.sku:'',set:row.set_position===999?null:row.set_position,images,awb_url};
}
