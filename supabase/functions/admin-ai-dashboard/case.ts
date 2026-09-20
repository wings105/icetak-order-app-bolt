type Data=Record<string,any>;
export const sessionKey=(ctx:Data)=>[ctx.session?.session_id||'',ctx.session?.boundary_at||'',ctx.session?.session_status||''].join('|');
export function caseOrders(ctx:Data){return [...(ctx.orders||[]).map((o:Data)=>({...o,kind:'icetak',reference:o.order_no})),...(ctx.marketplace_orders||[]).map((o:Data)=>({...o,kind:'shopee',reference:o.order_sn}))];}
export function confirmedOrder(c:Data,ctx:Data){
 const b=ctx.case_order;if(!b||ctx.identity_status==='ambiguous'||b.inbound_revision!==c.inbound_revision||b.session_key!==sessionKey(ctx))return null;
 return caseOrders(ctx).find(o=>o.id===b.order_id&&o.kind===b.order_kind)||null;
}
export function caseSummary(c:Data,ctx:Data,intent:string,quote:string){
 const order=confirmedOrder(c,ctx);const facts:string[]=[],missing:string[]=[];
 const labels:Data={complaint:'Selesaikan aduan',shipping:'Semak parcel',design:'Semak design / saiz',payment:'Semak bayaran / pautan',new_order:'Susun order baharu',enquiry:'Jawab pertanyaan',followup:'Semak perkembangan',other:'Baca & tentukan tindakan'};
 const next:Data={complaint:'Semak isu dan bukti pelanggan sebelum beri penyelesaian.',shipping:'Semak production dan status courier sebelum beri tarikh penghantaran.',design:'Semak ukuran, wording, kuantiti dan tarikh perlu.',payment:'Semak bayaran sebenar sebelum kongsi pautan atau minta bayar semula.',new_order:'Semak draft aktif dahulu; lengkapkan produk, ukuran, kuantiti dan tarikh perlu.',enquiry:'Jawab soalan berdasarkan produk dan SOP yang disahkan.',followup:'Semak perkembangan order yang dimaksudkan.',other:'Baca mesej terkini dan tentukan keperluan pelanggan.'};
 if(order){facts.push(`Order ${order.reference} disahkan admin`);facts.push(`Order: ${order.current_status||order.status||'Belum diketahui'}`);facts.push(`Bayaran${order.kind==='shopee'?' platform':''}: ${order.payment_status||'Belum diketahui'}`);
  const logistics=[order.shipment_status,order.fulfillment_status,order.fulfillment_stage,...(order.shipments||[]).map((s:Data)=>s.shipment_status||s.fulfillment_status)].filter(Boolean);
  if(logistics.length)facts.push(`Penghantaran / fulfillment: ${[...new Set(logistics)].join(' · ')}`);
  if((order.financials||[]).some((f:Data)=>/cash|cod/i.test(f.payment_method||''))||/cash|cod/i.test(order.payment_method||''))missing.push('COD / tunai: sahkan penerimaan wang secara berasingan.');
  if(intent==='shipping'&&!logistics.length)missing.push('Status courier belum tersedia.');
  if(intent==='payment'&&!order.payment_status)missing.push('Status bayaran belum diketahui.');
 }else missing.push(ctx.case_order?.order_id?'Pengesahan order perlu diperbaharui selepas mesej/session berubah.':'Order untuk kes ini belum disahkan admin.');
 if(ctx.identity_status==='ambiguous')missing.push('Identiti bertindih; semak CRM dahulu.');
 if(intent==='design')missing.push('Kesesuaian ukuran dan artwork perlu semakan manusia.');
 if(c.channel==='shopee')missing.push('Semak balasan automation luar dalam chat asal.');
 const activeDrafts=(ctx.drafts||[]).filter((d:Data)=>!d.order_no&&!['confirmed','rejected','cancelled','converted','completed'].includes(String(d.status).toLowerCase()));
 if(activeDrafts.length)facts.push(`${activeDrafts.length} draft dalam session ini — semak sebelum buat baharu`);
 return {title:labels[intent],request:quote||'Media / teks tidak mencukupi untuk diringkaskan.',facts,missing,next:next[intent],order:order?{id:order.id,kind:order.kind,reference:order.reference}:null,binding_current:!!order,session_key:sessionKey(ctx),active_draft_count:activeDrafts.length};
}
