import { knowledgeReply } from '../_shared/reply-knowledge.ts';
import { analyze, identity } from '../admin-ai-dashboard/analysis.ts';
import { enrichContexts } from '../admin-ai-dashboard/enrich.ts';
type Data = Record<string, any>;
export async function replySuggestion(c: Data, rpc: (name: string, body: unknown) => Promise<any>, read: (path: string) => Promise<Data[]>, now = Date.now()) {
  const contexts = await rpc('icetak_ai_dashboard_context', { p_identities: [identity(c)] });
  const ctx = contexts[c.id];
  // A missing canonical result is an unavailable dependency, not proof of no orders.
  if (!ctx) throw new Error('CONTEXT_MISSING');
  const bindings = await read(`ai_dashboard_case_orders?conversation_id=eq.${c.id}&select=*&limit=1`);
  if (bindings[0]) ctx.case_order = bindings[0];
  await enrichContexts({ [c.id]: ctx }, read);
  const analysis = analyze(c, ctx, null, now);
  const reply = await knowledgeReply(c, analysis, read, rpc);
  return {
    ok: true, ...reply,
    evidence_count: analysis.evidence.length, warnings: analysis.warnings,
    order_reference: analysis.referenced_order?.reference || null,
    fetched_at: new Date(now).toISOString(), expires_at: new Date(now + 60000).toISOString(),
    revision: c.revision, inbound_revision: c.inbound_revision,
  };
}
