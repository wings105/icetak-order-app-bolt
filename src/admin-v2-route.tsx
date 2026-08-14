import type { Root } from 'react-dom/client';
import { api, supabase } from './appdeploy-client';

const V2_ROUTE = 'v2';
let rootHandle: Root | null = null;
let mounting = false;

function adminRoute() { return new URLSearchParams(location.search).get('admin') || ''; }

function goV2() {
  const url = new URL(location.href);
  ['confirm','login','c'].forEach((key) => url.searchParams.delete(key));
  url.searchParams.set('admin', V2_ROUTE);
  location.assign(url);
}

function normalizeLegacyAdminRoute() {
  if (adminRoute() !== '1') return;
  const url = new URL(location.href);
  url.searchParams.set('admin', V2_ROUTE);
  history.replaceState({}, '', url);
}

async function ensureRoot() {
  const host = document.querySelector<HTMLElement>('#app');
  if (!host) return null;
  if (rootHandle) return rootHandle;
  const { createRoot } = await import('react-dom/client');
  host.innerHTML = '';
  const mount = document.createElement('div');
  mount.id = 'root';
  mount.style.minHeight = '100%';
  host.append(mount);
  rootHandle = createRoot(mount);
  return rootHandle;
}

async function renderLogin() {
  const root = await ensureRoot();
  if (!root) return;
  const [{ createElement }, { default: AdminLogin }] = await Promise.all([
    import('react'), import('../icetak-admin/src/AdminLogin'), import('../icetak-admin/src/index.css'),
  ]);
  root.render(createElement(AdminLogin, { onAuthenticated: () => location.reload() }));
  document.title = 'iCetak ERP — Admin Login';
}

async function mountAdminV2() {
  normalizeLegacyAdminRoute();
  if (adminRoute() !== V2_ROUTE || mounting) return;
  mounting = true;
  try {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) { await renderLogin(); return; }

    sessionStorage.setItem('admin_access_token', session.access_token);
    sessionStorage.setItem('admin_refresh_token', session.refresh_token || '');
    sessionStorage.setItem('admin_session', session.access_token);

    let dashboard;
    try {
      dashboard = await api.post('/api/admin/dashboard', { session_token: session.access_token });
    } catch (error) {
      await supabase.auth.signOut();
      sessionStorage.removeItem('admin_access_token');
      sessionStorage.removeItem('admin_refresh_token');
      sessionStorage.removeItem('admin_session');
      await renderLogin();
      console.warn('[Admin V2 validation]', error);
      return;
    }

    (globalThis as typeof globalThis & { __ICETAK_SUPABASE__?: typeof supabase }).__ICETAK_SUPABASE__ = supabase;
    const root = await ensureRoot();
    if (!root) return;
    const [{ createElement }, { default: AdminV2 }] = await Promise.all([
      import('react'), import('../icetak-admin/src/App'), import('../icetak-admin/src/index.css'),
    ]);
    root.render(createElement(AdminV2, { adminData: dashboard.data }));
    document.title = 'iCetak ERP';
  } finally {
    mounting = false;
  }
}

// Customer storefront keeps its Account Access page, but Staff/Admin now has one destination only.
document.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement | null)?.closest?.('#staffLogin');
  if (!target) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  goV2();
}, true);

supabase.auth.onAuthStateChange(() => {
  if (adminRoute() === V2_ROUTE) void mountAdminV2();
});

window.addEventListener('load', () => void mountAdminV2());
normalizeLegacyAdminRoute();
void mountAdminV2();
