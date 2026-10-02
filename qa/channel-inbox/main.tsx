import { createRoot } from 'react-dom/client';
import '../../icetak-admin/src/index.css';

// Only compiled on this QA branch. No production login or real admin session.
const result = { data: [], error: null };
const query = new Proxy({}, {
  get(_target, key) {
    if (key === 'then') return Promise.resolve(result).then.bind(Promise.resolve(result));
    return () => query;
  },
});
(window as any).__ICETAK_SUPABASE__ = {
  rpc: async () => ({ data: null, error: null }),
  from: () => query,
  functions: { invoke: async () => ({ data: { success: false, error: 'Controlled QA: backend disabled' }, error: null }) },
  auth: { getSession: async () => ({ data: { session: null }, error: null }), signOut: async () => ({ error: null }) },
};
// Guard any independently-created clients. The Inbox iframe retains its own auth gate.
const originalFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(requestUrl, window.location.href);
  if (url.hostname.endsWith('.supabase.co') || url.pathname.startsWith('/api/')) {
    return Promise.resolve(new Response(JSON.stringify({ error: 'Controlled QA: backend disabled' }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
  }
  return originalFetch(input, init);
};

let mounts = 0;
let loads = 0;
const seen = new WeakSet<Element>();
const status = document.getElementById('qa-status')!;
const updateStatus = () => { status.textContent = `QA fixture · synthetic admin · no backend writes · Inbox mounts: ${mounts} · loads: ${loads}`; };
new MutationObserver(() => {
  document.querySelectorAll<HTMLIFrameElement>('iframe[title="Unified Inbox ICETAK"]').forEach(frame => {
    if (seen.has(frame)) return;
    seen.add(frame); mounts += 1; updateStatus();
    frame.addEventListener('load', () => { loads += 1; updateStatus(); });
  });
}).observe(document.getElementById('root')!, { childList: true, subtree: true });

void import('../../icetak-admin/src/App').then(({ default: App }) => {
  createRoot(document.getElementById('root')!).render(<App adminData={{ admin: { username: 'qa-demo', display_name: 'QA Demo', role: 'owner', permissions: [] }, orders: [] }} />);
});
