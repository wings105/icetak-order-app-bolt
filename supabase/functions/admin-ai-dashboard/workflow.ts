import { confirmedOrder } from './case.ts';
import { orderOperation, operationalOrders } from './operations.ts';
type Data = Record<string, any>;
const norm = (v: unknown) => String(v || '').trim().toLowerCase().replace(/\s+/g, '_');
const time = (v: unknown) => Date.parse(String(v || '')) || 0;
export const activeDrafts = (ctx: Data) => (ctx.drafts || []).filter((d: Data) => !d.order_id && !d.order_no && !['confirmed', 'rejected', 'cancelled', 'converted', 'completed'].includes(norm(d.status)));

export function workflow(c: Data, ctx: Data, intent: string, now: number) {
 const facts: string[] = [];
 const order = confirmedOrder(c, ctx);
 const drafts = ctx.identity_status === 'ambiguous' ? [] : activeDrafts(ctx);
 const due = drafts.filter((d: Data) => d.followup_enabled === true && time(d.next_followup_at) > 0 && time(d.next_followup_at) <= now && !time(d.customer_responded_at) && Math.max(time(d.last_followup_at), time(d.customer_link_sent_at)) > 0 && time(c.last_inbound_at) <= Math.max(time(d.last_followup_at), time(d.customer_link_sent_at)));
 const result: Data = { facts, orders: operationalOrders(ctx, now).map(o => ({id:o.id,kind:o.kind,reference:o.reference,work:o.work})), checked_at: ctx.workflow_checked_at || null, followup_due: due.length > 0, followup_at: due.length ? Math.max(...due.map((d: Data) => time(d.next_followup_at))) : null };
 for (const d of drafts) {
  facts.push(`Draft: ${d.status} · Bayaran: ${d.payment_status || 'belum diketahui'}`);
  if (d.followup_enabled && d.next_followup_at) facts.push(`Follow-up dijadualkan: ${d.next_followup_at}`);
 }
 if (order) {
  const status = norm(order.current_status || order.status);
  const stage = norm(order.fulfillment_stage || order.fulfillment_status);
  const operation = orderOperation(order, now);
  result.operation = operation;
  const closed = ['completed', 'customer_collected', 'cancelled', 'canceled', 'returned', 'refunded'].includes(status) || stage === 'collected';
  const reviews = (order.production_reviews || []).filter((r: Data) => r.review_required === true);
  for (const state of [...new Set(reviews.map((r: Data) => r.review_status))]) facts.push(`Review artwork: ${state}`);
  if (operation.shipped && ['shipping', 'followup'].includes(intent)) {
   Object.assign(result, { title: 'Semak tracking penghantaran', next: 'Order sudah dihantar. Semak tracking terkini untuk menjawab pertanyaan pelanggan.', decision: true });
  } else if (!operation.shipped && !closed && reviews.some((r: Data) => Number(r.progress_stage || 0) < 5 && ['pending', 'edit_requested', 'changes_requested', 'rejected'].includes(norm(r.review_status)))) {
   Object.assign(result, { title: 'Semak review artwork', next: 'Buka order dan semak artwork yang belum diluluskan.', decision: true });
  } else if (!operation.shipped && !closed && reviews.some((r: Data) => Number(r.progress_stage || 0) < 5 && norm(r.review_status) === 'waiting_customer_review')) {
   Object.assign(result, { title: 'Semak kelulusan pelanggan', next: 'Artwork menunggu review pelanggan. Semak mesej terkini sebelum follow-up.', decision: true });
  } else if (!operation.shipped && !closed && !operation.cod && ['unpaid', 'pending', 'pending_review'].includes(norm(order.payment_status))) {
   Object.assign(result, { title: 'Semak bayaran tertunggak', next: 'Semak rekod bayaran dahulu; jangan minta bayaran semula jika sudah diterima.', decision: true });
  } else if (!operation.shipped && !closed && (status === 'ready_for_pickup' || stage === 'ready_for_pickup')) {
   Object.assign(result, { title: 'Order sedia untuk pickup', next: 'Semak aturan pickup dan sama ada pelanggan sudah dimaklumkan.', decision: true });
  } else if (['shipping', 'followup'].includes(intent)) {
   if (['shipped', 'out_for_delivery', 'to_confirm_receive'].includes(status)) Object.assign(result, { title: 'Semak tracking penghantaran', next: 'Order sudah dihantar. Semak tracking terkini sebelum menjawab.', decision: true });
   else if (closed) Object.assign(result, { title: 'Semak pertanyaan selepas order', next: 'Order telah ditutup / dikutip. Semak pertanyaan pelanggan yang masih terbuka.', decision: true });
  }
  if (operation.tasks.length) {
   for (const task of operation.tasks) facts.push(`${task.set_labels?.join(' / ') || task.title || 'Task'}: ${task.status || task.stage || 'Belum jelas'}`);
   if (operation.completed_actions.length) facts.push(`Kerja asal selesai: ${operation.completed_actions.join(' · ')}`);
   // A customer request remains separate. Never replace a new correction with a finished old task.
   if (!result.title && !operation.closed && !operation.shipped && ['shipping','followup','other'].includes(intent)) Object.assign(result,{title:operation.title,next:operation.next,decision:true});
  }
 }
 if (!order && drafts.length) Object.assign(result, { title: 'Semak draft aktif', next: 'Sambung draft dalam session ini; semak status dan bayaran sebelum buat order baharu.', decision: true, target: 'draft' });
 if (due.length) Object.assign(result, { title: 'Follow-up sudah tiba', next: 'Semak draft dan chat terbaru sebelum membuat follow-up.', decision: true, target: 'draft' });
 // A complaint remains the primary action even when an order has another pending task.
 if (intent === 'complaint') { delete result.title; delete result.next; delete result.target; }
 return result;
}
