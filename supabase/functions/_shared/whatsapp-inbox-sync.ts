type Rest = (path: string, init?: RequestInit) => Promise<any>;
const URL = 'https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/order-whatsapp-outbound';
export async function mirrorWhatsApp(rest: Rest, row: Record<string, any>, fetcher = fetch) {
  if (row.status !== 'sent' || !row.provider_message_id || !['pending','retry'].includes(row.inbox_sync_status)) return false;
  const attempts = Number(row.inbox_sync_attempts || 0) + 1;
  try {
    const settings = await rest('private_runtime_settings?setting_key=eq.admin_window_bridge_token&select=setting_value&limit=1');
    const key = settings?.[0]?.setting_value;
    if (!key) throw new Error('BRIDGE_NOT_CONFIGURED');
    const response = await fetcher(URL, {method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{'content-type':'application/json','x-admin-window-token':key},body:JSON.stringify({
      outbox_id:row.id,phone:row.phone||null,recipient_bsuid:row.recipient_bsuid||null,
      provider_message_id:row.provider_message_id,sent_at:row.sent_at,
      message_type:row.mode==='template'?'template':'text',
      text:row.body||`[Template: ${row.template_name||'WhatsApp'}]`,
      template_name:row.template_name||null,template_components:row.template_components||[],
      event_type:row.event_type,order_no:row.order_no||null,order_db_id:row.order_id||null,
    })});
    const result = await response.json().catch(()=>({}));
    if (!response.ok || result.ok !== true || !result.message_id) throw new Error(`INBOX_HTTP_${response.status}`);
    await rest(`whatsapp_outbox?id=eq.${row.id}`,{method:'PATCH',body:JSON.stringify({inbox_sync_status:'synced',inbox_sync_attempts:attempts,inbox_synced_at:new Date().toISOString(),inbox_sync_error:null,inbox_sync_next_at:null})});
    return true;
  } catch {
    // Logging retries never change delivery status or invoke the provider again.
    await rest(`whatsapp_outbox?id=eq.${row.id}`,{method:'PATCH',body:JSON.stringify({inbox_sync_status:'retry',inbox_sync_attempts:attempts,inbox_sync_error:'INBOX_LOG_PENDING',inbox_sync_next_at:new Date(Date.now()+Math.min(15,attempts)*60000).toISOString()})}).catch(()=>null);
    return false;
  }
}
export async function flushWhatsAppInbox(rest: Rest, limit=20) {
  const rows = await rest(`whatsapp_outbox?status=eq.sent&inbox_sync_status=in.(pending,retry)&or=(inbox_sync_next_at.is.null,inbox_sync_next_at.lte.${encodeURIComponent(new Date().toISOString())})&order=created_at.asc&limit=${Math.max(1,Math.min(limit,30))}`).catch(()=>[]);
  let synced=0;
  for(const row of rows||[]) if(await mirrorWhatsApp(rest,row)) synced++;
  return {processed:rows?.length||0,synced};
}
