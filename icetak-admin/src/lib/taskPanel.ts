import type {ClickUpOptions} from './taskDashboard';
export type ReviewOption={id:string;name:string;color:string;orderindex?:number};
export type PanelAttachment={id:string;name:string;url:string;thumbnail:string;mime:string;is_image:boolean;size:number;at:string;source:string;cursor?:{date:string;id:string}};
export type PanelFields={title:string;order_reference:string;phone:string;username:string;sku:string;wording:string;products:string[];sets:string[];due_date:string|null;due_date_time:boolean};
export type PanelOptions=ClickUpOptions&{review?:{id:string;available:boolean;value:string|null;options:ReviewOption[]};fields?:PanelFields;attachments?:PanelAttachment[]};
export async function panelOriginal(taskId:string,asset:PanelAttachment):Promise<Blob>{
 const {supabase}=await import('./supabase');
 const {data,error}=await supabase.functions.invoke('task-clickup',{body:{action:'asset',task_id:taskId,asset_id:asset.id,...(asset.cursor?{cursor:asset.cursor}:{})}});
 if(error||!(data instanceof Blob))throw Error('Original gagal dimuat. Refresh attachment dan cuba semula.');
 const bytes=new Uint8Array(await data.slice(0,12).arrayBuffer()),prefix=new TextDecoder().decode(bytes);
 const mime=bytes[0]===137&&bytes[1]===80?'image/png':bytes[0]===255&&bytes[1]===216?'image/jpeg':prefix.startsWith('RIFF')&&prefix.slice(8)==='WEBP'?'image/webp':prefix.startsWith('GIF8')?'image/gif':prefix.startsWith('BM')?'image/bmp':prefix.startsWith('%PDF-')?'application/pdf':'application/octet-stream';
 return new Blob([data],{type:mime});
}
export async function copyOriginalImage(original:Promise<Blob>){
 if(!navigator.clipboard?.write||typeof ClipboardItem==='undefined')throw Error('Copy gambar tidak disokong. Gunakan Download original.');
 const png=original.then(async blob=>{
  if(!blob.type.startsWith('image/'))throw Error('Fail ini perlu dimuat turun sebagai original.');
  if(blob.type==='image/png')return blob;
  const image=await createImageBitmap(blob);
  try{if(image.width*image.height>40000000)throw Error('Gambar terlalu besar untuk clipboard. Download original.');
   const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
   const context=canvas.getContext('2d');if(!context)throw Error('Copy gambar gagal.');context.drawImage(image,0,0);
   return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Copy gambar gagal.')),'image/png'));
  }finally{image.close();}
 });
 await navigator.clipboard.write([new ClipboardItem({'image/png':png})]);
}
