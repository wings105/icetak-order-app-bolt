type Data = Record<string, any>;
type Dependencies = {
  member: (req: Request) => Promise<Data | null>;
  claim: (id: string) => Promise<{ allowed: boolean; code?: string; retry_after_seconds?: number }>;
  read: (id: string) => Promise<Data | null>;
  suggest: (conversation: Data) => Promise<Data>;
};
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Expose-Headers': 'Retry-After' };
const out = (data: unknown, status = 200, retryAfter?: number) => Response.json(data, { status, headers: { ...cors, 'cache-control': 'no-store', ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}) } });
export const fingerprint = (c: Data) => JSON.stringify([c.revision, c.inbound_revision, c.master_id, c.identities, c.messages]);

// This endpoint only calculates a draft. It never claims/sends/resolves a message.
export function suggestionHandler(deps: Dependencies) {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return out({ ok: true });
    if (req.method !== 'POST') return out({ ok: false, error: 'POST required' }, 405);
    try {
      const member = await deps.member(req);
      if (!member) return out({ ok: false, error: 'Sila log masuk sebagai staf.' }, 401);
      if (member.active !== true || !['owner', 'admin', 'staff', 'agent'].includes(member.role)) return out({ ok: false, error: 'Akses staf aktif diperlukan.' }, 403);
      const body = await req.json();
      const id = String(body.conversation_id || '');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return out({ ok: false, error: 'Invalid conversation ID' }, 400);
      const budget = await deps.claim(id);
      if (budget.allowed !== true) {
        if (budget.code === 'NOT_FOUND') return out({ ok: false, error: 'Conversation not found' }, 404);
        const retry = Math.max(1, Math.ceil(budget.retry_after_seconds || 30));
        return out({ ok: false, error: 'Cadangan dijeda untuk jimat penggunaan. Cuba semula kemudian.', code: budget.code || 'SUGGESTION_LIMIT', retry_after_seconds: retry }, 429, retry);
      }
      // Ignore browser-supplied text, order IDs and identity. Load authoritative evidence.
      const source = await deps.read(id);
      if (!source) return out({ ok: false, error: 'Conversation not found' }, 404);
      const result = await deps.suggest(source);
      const current = await deps.read(id);
      if (!current || fingerprint(source) !== fingerprint(current)) return out({ ok: false, error: 'Chat berubah. Semak mesej terkini.', code: 'CHAT_CHANGED' }, 409);
      return out({ ok: true, ...result, conversation_id: id, latest_message_id: source.messages?.at(-1)?.id || null });
    } catch {
      return out({ ok: false, error: 'Cadangan belum tersedia. Cuba semak semula.', retry_after_seconds: 30 }, 503, 30);
    }
  };
}
