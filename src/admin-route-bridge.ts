import { supabase } from './appdeploy-client';

const OPEN_FLAG = 'admin_open_after_reload';
const TOKEN_MARKER = 'admin_bridge_token';
let routing = false;

function storeSession(session: any) {
  sessionStorage.setItem('admin_access_token', session.access_token);
  sessionStorage.setItem('admin_refresh_token', session.refresh_token || '');
  sessionStorage.setItem('admin_session', session.access_token);
}

function cleanAdminQuery() {
  const url = new URL(location.href);
  if (!url.searchParams.has('admin')) return;
  url.searchParams.delete('admin');
  history.replaceState({}, '', url);
}

function openAdminPage() {
  if (routing || sessionStorage.getItem(OPEN_FLAG) !== '1') return;

  if (document.querySelector('.admin-head')) {
    sessionStorage.removeItem(OPEN_FLAG);
    cleanAdminQuery();
    routing = false;
    return;
  }

  const staffButton = document.querySelector<HTMLButtonElement>('#staffLogin');
  if (staffButton) {
    routing = true;
    staffButton.click();
    window.setTimeout(() => { routing = false; openAdminPage(); }, 250);
    return;
  }

  const accountButton = document.querySelector<HTMLButtonElement>('#headAdmin');
  if (accountButton) {
    routing = true;
    accountButton.click();
    window.setTimeout(() => { routing = false; openAdminPage(); }, 250);
  }
}

async function restoreSecureAdminSession() {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return;

  const previousMarker = sessionStorage.getItem(TOKEN_MARKER);
  storeSession(session);

  if (previousMarker !== session.access_token) {
    sessionStorage.setItem(TOKEN_MARKER, session.access_token);
    sessionStorage.setItem(OPEN_FLAG, '1');
    const url = new URL(location.href);
    url.searchParams.set('admin', '1');
    location.replace(url.toString());
    return;
  }

  if (new URLSearchParams(location.search).get('admin') === '1') {
    sessionStorage.setItem(OPEN_FLAG, '1');
  }
  openAdminPage();
}

supabase.auth.onAuthStateChange((event, session) => {
  if (session) {
    storeSession(session);
    if (event === 'SIGNED_IN') {
      sessionStorage.setItem(TOKEN_MARKER, session.access_token);
      sessionStorage.setItem(OPEN_FLAG, '1');
      const url = new URL(location.href);
      url.searchParams.set('admin', '1');
      window.setTimeout(() => location.replace(url.toString()), 50);
    }
  } else if (event === 'SIGNED_OUT') {
    sessionStorage.removeItem('admin_access_token');
    sessionStorage.removeItem('admin_refresh_token');
    sessionStorage.removeItem('admin_session');
    sessionStorage.removeItem(TOKEN_MARKER);
    sessionStorage.removeItem(OPEN_FLAG);
  }
});

const observer = new MutationObserver(openAdminPage);
observer.observe(document.body, { childList: true, subtree: true });
window.addEventListener('load', () => void restoreSecureAdminSession());
void restoreSecureAdminSession();
