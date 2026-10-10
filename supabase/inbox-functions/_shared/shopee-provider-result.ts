export function providerResult(httpStatus:number,body:Record<string,any>) {
 const error=body.error || body.error_code || (body.success===false ? body.message || 'Rejected' : null);
 const id=String(body.provider_message_id || body.message_id || body.data?.message_id || body.response?.message_id || '').trim();
 if(httpStatus>=500) return {status:'unknown',id,error:'Provider belum mengesahkan penghantaran. Semak Shopee asal sebelum cuba semula.'};
 if(httpStatus<200||httpStatus>=300||error||body.ok===false) return {status:'failed',id,error:'Provider menolak mesej Shopee.'};
 if(!id) return {status:'unknown',id,error:'Tiada ID mesej daripada Shopee. Semak Shopee asal sebelum cuba semula.'};
 return {status:'sent',id,error:null};
}
