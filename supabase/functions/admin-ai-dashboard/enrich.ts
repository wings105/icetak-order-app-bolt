type Data = Record<string, any>;
type Read = (path: string) => Promise<Data[]>;
const uuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));

// Read only IDs already authorized by the identity/session context RPC.
export async function enrichContexts(contexts: Record<string, Data>, read: Read) {
 const values = Object.values(contexts);
 const ids = (key: string) => [...new Set(values.filter(c => c.identity_status !== 'ambiguous').flatMap(c => (c[key] || []).map((r: Data) => r.id)).filter(uuid))];
 async function batches(table: string, column: string, selected: string, keys: string[]) {
  const result: Data[] = [];
  for (let i = 0; i < keys.length; i += 40) {
   // Explicit pagination avoids silently truncating orders with many components.
   for (let offset = 0; ; offset += 500) {
    const page = await read(`${table}?${column}=in.(${keys.slice(i, i + 40).join(',')})&select=${selected}&order=id.asc&limit=500&offset=${offset}`);
    result.push(...page);
    if (page.length < 500) break;
   }
  }
  return result;
 }
 const [components, drafts] = await Promise.all([
  batches('production_components', 'order_id', 'id,order_id,review_required,review_status,updated_at', ids('orders')),
  batches('qrpay_order_drafts', 'id', 'id,order_id,order_no,order_session_id,status,payment_status,updated_at,followup_enabled,followup_count,last_followup_at,next_followup_at,customer_link_sent_at,customer_responded_at', ids('drafts')),
 ]);
 for (const ctx of values) {
  if (ctx.identity_status === 'ambiguous') continue;
  for (const order of ctx.orders || []) order.production_reviews = components.filter(c => c.order_id === order.id);
  ctx.drafts = (ctx.drafts || []).flatMap((draft: Data) => {
   const current = drafts.find(d => d.id === draft.id && d.order_session_id === draft.order_session_id);
   return current ? [{ ...draft, ...current }] : [];
  });
  ctx.workflow_checked_at = new Date().toISOString();
 }
 return contexts;
}
