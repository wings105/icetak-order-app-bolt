type Data = Record<string, any>;
const norm = (v: unknown) => String(v || '').trim().toLowerCase().replace(/\s+/g, '_');
const dayFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur'});
const day = (v: number) => dayFormatter.format(v);
export function orderOperation(o: Data, now = Date.now()) {
 const status = norm(o.current_status || o.status), stage = norm(o.fulfillment_stage || o.fulfillment_status);
 const tasks: Data[] = o.production_tasks || [];
 const signals = [o.shipment_status, stage, ...(o.logistics || []).flatMap((s: Data) => [s.status, s.status_group, s.normalized_status])].map(norm);
 const delivered = signals.some(s => ['delivered','logistics_delivery_done','parcel_has_been_received'].includes(s)) || (o.logistics || []).some((s: Data) => !!s.delivered_at);
 const shipped = delivered || ['shipped','out_for_delivery','to_confirm_receive'].includes(status) || signals.some(s => ['shipped','in_transit','logistics_pickup_done','out_for_delivery'].includes(s)) || (o.logistics || []).some((s: Data) => !!s.shipped_at);
 const closed = ['completed','customer_collected','cancelled','canceled','returned','refunded'].includes(status) || stage === 'collected';
 const cod = /\bcod\b|cash|tunai/i.test(o.payment_method || '') || (o.financials || []).some((f: Data) => /\bcod\b|cash/i.test(f.payment_method || ''));
 const paid = ['paid','verified','completed'].includes(norm(o.payment_status)) && !cod;
 const result: Data = { key: 'unknown', title: 'Semak status production', next: 'Semak task / semua item sebelum menentukan tindakan.', priority: 45,
  shipped, delivered, closed, paid, cod, tasks, completed_actions: [], active: true, coverage: tasks.length ? 'Task / komponen dipadankan' : 'Belum ada task dipadankan' };
 if (paid) result.completed_actions.push('Permintaan bayaran');
 const shippingIssue = !closed && signals.some(s => ['logistics_delivery_failed','delivery_failed','exception','return_to_sender'].includes(s));
 const correction = tasks.some(t => !!t.change_requested_at);
 if (shippingIssue) {
  Object.assign(result, { key: 'issue', title: 'Semak masalah penghantaran', next: 'Buka tracking dan semak tindakan courier.', priority: 90 });
 } else if (correction) {
  Object.assign(result, { key: 'review', title: 'Semak pembetulan selepas production', next: 'Review bertukar kepada request editing selepas kerja bergerak. Semak pembetulan dan kesan kepada order / parcel.', priority: 85 });
 } else if (shipped || closed) {
  result.key = 'done'; result.active = false; result.priority = 0;
  result.title = shipped ? 'Penghantaran sudah bergerak' : 'Order telah ditutup';
  result.next = 'Tindakan production / pos lama selesai. Soalan atau aduan pelanggan masih dinilai dalam chat.';
  result.completed_actions.push('Sediakan design asal', 'Production asal', 'Pos order');
 } else if (['unpaid','pending','pending_review'].includes(norm(o.payment_status)) && !cod) {
  Object.assign(result, { key: 'payment', title: 'Semak bayaran tertunggak', next: 'Semak rekod bayaran dahulu; jangan minta semula jika sudah diterima.', priority: 65 });
 } else if (status === 'ready_for_pickup' || stage === 'ready_for_pickup') {
  Object.assign(result, { key: 'pickup', title: 'Order sedia untuk pickup', next: 'Semak aturan pickup dan sama ada pelanggan sudah dimaklumkan.', priority: 55 });
  result.completed_actions.push('Sediakan design asal', 'Production asal');
 } else if (tasks.length) {
  const pending = tasks.filter(t => Number(t.progress_stage || 0) < 7);
  const unknown = tasks.some(t => t.rule_matched === false || t.progress_stage == null);
  const reviews = pending.filter(t => Number(t.progress_stage || 0) < 5 && ['pending','waiting_customer_review','edit_requested','changes_requested','rejected'].includes(norm(t.review_status)));
  if (unknown) Object.assign(result, { key: 'unknown', next: 'Ada status / komponen belum dipastikan. Semak ClickUp sebelum memberi janji siap.' });
  else if (reviews.length) Object.assign(result, { key: 'review', title: reviews.some(t => norm(t.review_status) !== 'waiting_customer_review') ? 'Semak review artwork' : 'Semak kelulusan pelanggan', next: 'Semak set yang belum diluluskan dan mesej customer terkini.', priority: 70 });
  else if (!pending.length) Object.assign(result, { key: /pickup/i.test(o.delivery_method || '') ? 'pickup' : 'ready', title: 'Semak packing / penghantaran', next: 'Task dipadankan selesai. Sahkan semua item / set sebelum packing, pos atau maklum pickup.', priority: 75 });
  else if (pending.some(t => Number(t.progress_stage) < 5)) Object.assign(result, { key: 'design', title: 'Sambung design yang belum siap', next: 'Buka set / komponen yang masih design; set yang telah printing tidak perlu dibuat semula.', priority: 60 });
  else Object.assign(result, { key: 'production', title: 'Pantau printing / production', next: 'Kerja design asal telah bergerak. Pantau set yang belum complete.', priority: 50 });
  if (tasks.every(t => Number(t.progress_stage) >= 5)) result.completed_actions.push('Sediakan design asal');
  if (tasks.every(t => Number(t.progress_stage) >= 7)) result.completed_actions.push('Production task dipadankan');
 }
 const deadline = Date.parse(o.deadline || o.ship_by_at || o.date_need || '');
 result.due = result.active && Number.isFinite(deadline) && deadline > Date.parse('2020-01-01') && day(deadline) <= day(now);
 if (result.due) result.priority += 30;
 result.fingerprint = JSON.stringify([status, stage, o.payment_status, tasks.map(t => [t.id,t.status,t.review_status,t.progress_stage,t.source_updated_at]), result.key]);
 return result;
}

export function operationalOrders(ctx: Data, now = Date.now()) {
 if (ctx.identity_status === 'ambiguous') return [];
 return [...(ctx.orders || []).map((o: Data) => ({ ...o, kind: 'icetak', reference: o.order_no })),
  ...(ctx.marketplace_orders || []).map((o: Data) => ({ ...o, kind: 'shopee', reference: o.order_sn }))]
  .map(o => ({ ...o, work: orderOperation(o, now) }));
}

