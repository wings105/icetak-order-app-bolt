import type { Root } from 'react-dom/client';
import { api, supabase } from './appdeploy-client';
import './admin-v2-switch.css';

const V2_ROUTE = 'v2';
let adminV2Root: Root | null = null;
let mounting = false;
let mountFailed = false;

function adminRoute() {
  return new URLSearchParams(location.search).get('admin') || '';
}

function goToAdmin(version: '1' | 'v2') {
  const url = new URL(location.href);
  ['order', 'confirm', 'login', 'c'].forEach((key) => url.searchParams.delete(key));
  url.searchParams.set('admin', version);
  location.assign(url);
}

function installV2Switch() {
  if (adminRoute() === V2_ROUTE || document.querySelector('#adminV2Switch')) return;
  const header = document.querySelector<HTMLElement>('.admin-head');
  if (!header) return;

  const button = document.createElement('button');
  button.id = 'adminV2Switch';
  button.className = 'admin-version-switch';
  button.type = 'button';
  button.innerHTML = '<span>New</span> Switch to Admin V2';
  button.onclick = () => goToAdmin('v2');

  const logout = header.querySelector<HTMLButtonElement>('#adminLogout');
  if (logout) logout.insertAdjacentElement('beforebegin', button);
  else header.append(button);
}

function showV2Error(message: string) {
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) return;
  root.innerHTML = '<main class="admin-v2-gate"><section><span>🔒</span><h1>Admin V2 unavailable</h1><p></p><button id="adminV2Back">Back to Admin V1</button></section></main>';
  root.querySelector('p')!.textContent = message;
  root.querySelector<HTMLButtonElement>('#adminV2Back')!.onclick = () => goToAdmin('1');
}

async function mountAdminV2() {
  if (adminRoute() !== V2_ROUTE || mounting || mountFailed || adminV2Root) return;
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) return;

  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return;

  mounting = true;
  try {
    sessionStorage.setItem('admin_access_token', session.access_token);
    sessionStorage.setItem('admin_refresh_token', session.refresh_token || '');
    sessionStorage.setItem('admin_session', session.access_token);

    // This endpoint validates that the signed-in Supabase user is linked to an
    // active iCetak admin before the React dashboard is downloaded or mounted.
    const dashboard = await api.post('/api/admin/dashboard', { session_token: session.access_token });

    // Reuse the production client's authenticated session inside Admin V2.
    // The standalone prototype still creates its own client when run by itself.
    (globalThis as typeof globalThis & { __ICETAK_SUPABASE__?: typeof supabase }).__ICETAK_SUPABASE__ = supabase;

    const [{ createElement }, { createRoot }, { default: AdminV2 }] = await Promise.all([
      import('react'),
      import('react-dom/client'),
      import('../icetak-admin/src/App'),
      import('../icetak-admin/src/index.css'),
    ]);

    root.innerHTML = '';
    adminV2Root = createRoot(root);
    adminV2Root.render(createElement(AdminV2, {
      onSwitchToV1: () => goToAdmin('1'),
      adminData: dashboard.data,
    }));
    document.title = 'iCetak ERP — Admin V2';
  } catch (error) {
    mountFailed = true;
    const message = error instanceof Error ? error.message : 'Your account could not be verified.';
    showV2Error(message);
  } finally {
    mounting = false;
  }
}

const observer = new MutationObserver(() => {
  installV2Switch();
  void mountAdminV2();
});

observer.observe(document.body, { childList: true, subtree: true });
window.addEventListener('load', () => {
  installV2Switch();
  void mountAdminV2();
});

installV2Switch();
void mountAdminV2();
