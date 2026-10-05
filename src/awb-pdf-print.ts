let activeFrame:HTMLIFrameElement|null=null;
let activeBlob='';
function cleanup(){activeFrame?.remove();activeFrame=null;if(activeBlob)URL.revokeObjectURL(activeBlob);activeBlob='';}
export async function printAwbPdf(base:string,orderId:string,taskId:string):Promise<void>{
 cleanup();
 const response=await fetch(`${base}/functions/v1/awb-preview?${new URLSearchParams({order_id:orderId,awb_task_id:taskId})}`,{cache:'no-store',signal:AbortSignal.timeout(25000)});
 if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'PDF AWB gagal dimuat.');}
 if(!response.headers.get('content-type')?.includes('application/pdf'))throw new Error('Fail AWB bukan PDF.');
 const blob=await response.blob();
 if(!blob.size||blob.size>10*1024*1024)throw new Error('Saiz PDF AWB tidak sah.');
 const frame=document.createElement('iframe');
 frame.title='Dokumen AWB untuk cetak';frame.setAttribute('aria-hidden','true');
 frame.style.cssText='position:fixed;left:-10000px;top:0;width:1000px;height:1000px;border:0;';
 activeFrame=frame;activeBlob=URL.createObjectURL(blob);
 try {
  await new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('PDF AWB mengambil masa terlalu lama.')),15000);
   frame.onload=()=>{clearTimeout(timer);resolve();};
   frame.onerror=()=>{clearTimeout(timer);reject(new Error('PDF AWB gagal dibuka.'));};
   frame.src=activeBlob;document.body.append(frame);
  });
  frame.onload=null;frame.onerror=null;
  if(!frame.contentWindow)throw new Error('Browser tidak dapat membuka print AWB.');
  frame.contentWindow.addEventListener('afterprint',cleanup,{once:true});
  frame.contentWindow.focus();frame.contentWindow.print();
 }catch(error){cleanup();throw error;}
}
