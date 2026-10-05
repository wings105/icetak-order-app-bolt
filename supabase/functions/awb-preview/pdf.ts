const MAX_PDF_BYTES=10*1024*1024;
export function safeAwbPdfUrl(value:unknown):string {
 try {
  const u=new URL(String(value||''));
  const allowed=u.hostname==='icetak-awb.s3.us-east-1.amazonaws.com'||u.hostname==='attachments.clickup.com'||u.hostname.endsWith('.clickup-attachments.com');
  return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&allowed?u.href:'';
 } catch { return ''; }
}
export async function fetchAwbPdf(value:unknown,fetcher:typeof fetch=fetch):Promise<Uint8Array> {
 const url=safeAwbPdfUrl(value);
 if(!url)throw new Error('AWB PDF source is not supported');
 const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok||!response.body)throw new Error('AWB PDF is unavailable');
 if(Number(response.headers.get('content-length')||0)>MAX_PDF_BYTES)throw new Error('AWB PDF exceeds 10 MB');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try {
  for(;;){const {value:chunk,done}=await reader.read();if(done)break;size+=chunk.length;if(size>MAX_PDF_BYTES)throw new Error('AWB PDF exceeds 10 MB');chunks.push(chunk);}
 } catch(error){await reader.cancel().catch(()=>{});throw error;} finally {reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 if(new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')throw new Error('AWB is not a PDF document');
 return bytes;
}
