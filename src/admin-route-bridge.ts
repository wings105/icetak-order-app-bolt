import { supabase } from './appdeploy-client';

const OPEN_FLAG = 'admin_open_after_reload';
let routing = false;
let lastOpenAttempt = 0;

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

function isPersistentAdminRoute() {
  return ['quick-arrange', 'v2'].includes(new URLSearchParams(location.search).get('admin') || '');
}

function isAdminV2Route() {
  return new URLSearchParams(location.search).get('admin') === 'v2';
}

function markAdminIntent() {
  sessionStorage.setItem(OPEN_FLAG, '1');
  const url = new URL(location.href);
  if (!['quick-arrange', 'v2'].includes(url.searchParams.get('admin') || '')) url.searchParams.set('admin', '1');
  history.replaceState({}, '', url);
}

function openAdminPage() {
  if (isAdminV2Route()) {
    sessionStorage.removeItem(OPEN_FLAG);
    routing = false;
    return;
  }
  if (routing || sessionStorage.getItem(OPEN_FLAG) !== '1') return;

  const now = Date.now();
  if (now - lastOpenAttempt < 180) return;
  lastOpenAttempt = now;

  if (document.querySelector('.admin-head')) {
    sessionStorage.removeItem(OPEN_FLAG);
    if (!isPersistentAdminRoute()) cleanAdminQuery();
    routing = false;
    return;
  }

  const staffButton = document.querySelector<HTMLButtonElement>('#staffLogin');
  if (staffButton) {
    routing = true;
    staffButton.click();
    window.setTimeout(() => { routing = false; openAdminPage(); }, 280);
    return;
  }

  const accountButton = document.querySelector<HTMLButtonElement>('#headAdmin');
  if (accountButton) {
    routing = true;
    accountButton.click();
    window.setTimeout(() => { routing = false; openAdminPage(); }, 280);
  }
}

async function restoreSecureAdminSession() {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) return;

  storeSession(session);

  if (isAdminV2Route()) {
    sessionStorage.removeItem(OPEN_FLAG);
    return;
  }

  if (['1', 'quick-arrange'].includes(new URLSearchParams(location.search).get('admin') || '')) {
    sessionStorage.setItem(OPEN_FLAG, '1');
  }

  openAdminPage();
}

supabase.auth.onAuthStateChange((event, session) => {
  if (session) {
    storeSession(session);
    if (event === 'SIGNED_IN') {
      if (isAdminV2Route()) {
        sessionStorage.removeItem(OPEN_FLAG);
      } else {
        markAdminIntent();
        window.setTimeout(openAdminPage, 100);
      }
    }
  } else if (event === 'SIGNED_OUT') {
    sessionStorage.removeItem('admin_access_token');
    sessionStorage.removeItem('admin_refresh_token');
    sessionStorage.removeItem('admin_session');
    sessionStorage.removeItem(OPEN_FLAG);
    cleanAdminQuery();
  }
});

const observer = new MutationObserver(() => {
  if (sessionStorage.getItem(OPEN_FLAG) === '1') openAdminPage();
});
observer.observe(document.body, { childList: true, subtree: true });
window.addEventListener('load', () => void restoreSecureAdminSession());
if (['1', 'quick-arrange'].includes(new URLSearchParams(location.search).get('admin') || '')) {
  sessionStorage.setItem(OPEN_FLAG, '1');
} else if (isAdminV2Route()) {
  sessionStorage.removeItem(OPEN_FLAG);
}
void restoreSecureAdminSession();
