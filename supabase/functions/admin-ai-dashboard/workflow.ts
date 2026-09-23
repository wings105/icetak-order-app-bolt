import { confirmedOrder } from './case.ts';
type Data = Record<string, any>;
const norm = (v: unknown) => String(v || '').trim().toLowerCase().replace(/\s+/g, '_');
const time = (v: unknown) => Date.parse(String(v || '')) || 0;
export const activeDrafts = (ctx: Data) => (ctx.drafts || []).filter((d: Data) => !d.order_id && !d.order_no && !['confirmed', 'rejected', 'cancelled', 'converted', 'completed'].includes(norm(d.status)));

export function workflow(c: Data, ctx: Data, intent: string, now: number) {
 const facts: string[] = [];
 const order = confirmedOrder(c, ctx);
 const drafts = ctx.identity_status === 'ambiguous' ? [] : activeDrafts(ctx);
 const due = drafts.filter((d: Data) => d.followup_enabled === true && time(d.next_followup_at) > 0 && time(d.next_followup_at) <= now && !time(d.customer_responded_at) && Math.max(time(d.last_followup_at), time(d.customer_link_sent_at)) > 0 && time(c.last_inbound_at) <= Math.max(time(d.last_followup_at), time(d.customer_link_sent_at)));
 const result: Data = { facts, checked_at: ctx.workflow_checked_at || null, followup_due: due.length > 0, followup_at: due.length ? Math.max(...due.map((d: Data) => time(d.next_followup_at))) : null };
 for (const d of drafts) {
  facts.push(`Draft: ${d.status} · Bayaran: ${d.payment_status || 'belum diketahui'}`);
  if (d.followup_enabled && d.next_followup_at) facts.push(`Follow-up dijadualkan: ${d.next_followup_at}`);
 }
 if (order) {
  const status = norm(order.current_status || order.status);
  const stage = norm(order.fulfillment_stage || order.fulfillment_status);
  const closed = ['completed', 'customer_collected', 'cancelled', 'canceled', 'returned', 'refunded'].includes(status) || stage === 'collected';
  const reviews = (order.production_reviews || []).filter((r: Data) => r.review_required === true);
  for (const state of [...new Set(reviews.map((r: Data) => r.review_status))]) facts.push(`Review artwork: ${state}`);
  if (!closed && reviews.some((r: Data) => ['pending', 'edit_requested', 'changes_requested', 'rejected'].includes(norm(r.review_status)))) {
   Object.assign(result, { title: 'Semak review artwork', next: 'Buka order dan semak artwork yang belum diluluskan.', decision: true });
  } else if (!closed && reviews.some((r: Data) => norm(r.review_status) === 'waiting_customer_review')) {
   Object.assign(result, { title: 'Semak kelulusan pelanggan', next: 'Artwork menunggu review pelanggan. Semak mesej terkini sebelum follow-up.', decision: true });
  } else if (!closed && ['unpaid', 'pending', 'pending_review'].includes(norm(order.payment_status))) {
   Object.assign(result, { title: 'Semak bayaran tertunggak', next: 'Semak rekod bayaran dahulu; jangan minta bayaran semula jika sudah diterima.', decision: true });
  } else if (!closed && !['shipped', 'out_for_delivery', 'to_confirm_receive'].includes(status) && (status === 'ready_for_pickup' || stage === 'ready_for_pickup')) {
   Object.assign(result, { title: 'Order sedia untuk pickup', next: 'Semak aturan pickup dan sama ada pelanggan sudah dimaklumkan.', decision: true });
  } else if (['shipping', 'followup'].includes(intent)) {
   if (['shipped', 'out_for_delivery', 'to_confirm_receive'].includes(status)) Object.assign(result, { title: 'Semak tracking penghantaran', next: 'Order sudah dihantar. Semak tracking terkini sebelum menjawab.', decision: true });
   else if (closed) Object.assign(result, { title: 'Semak pertanyaan selepas order', next: 'Order telah ditutup / dikutip. Semak pertanyaan pelanggan yang masih terbuka.', decision: true });
  }
 }
 if (!order && drafts.length) Object.assign(result, { title: 'Semak draft aktif', next: 'Sambung draft dalam session ini; semak status dan bayaran sebelum buat order baharu.', decision: true, target: 'draft' });
 if (due.length) Object.assign(result, { title: 'Follow-up sudah tiba', next: 'Semak draft dan chat terbaru sebelum membuat follow-up.', decision: true, target: 'draft' });
 // A complaint remains the primary action even when an order has another pending task.
 if (intent === 'complaint') { delete result.title; delete result.next; delete result.target; }
 return result;
}
