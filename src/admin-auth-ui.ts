import { supabase } from './appdeploy-client';

const env = (import.meta as any).env || {};
const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';

function notice(message: string, isError = false) {
  let el = document.querySelector<HTMLElement>('#adminAuthNotice');
  if (!el) {
    el = document.createElement('div');
    el.id = 'adminAuthNotice';
    Object.assign(el.style, {
      position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)',
      zIndex: '9999', maxWidth: '90vw', padding: '12px 16px', borderRadius: '12px',
      color: '#fff', fontWeight: '700', boxShadow: '0 12px 40px rgba(0,0,0,.2)'
    });
    document.body.append(el);
  }
  el.style.background = isError ? '#b91c1c' : '#166534';
  el.textContent = message;
  window.setTimeout(() => el?.remove(), 5000);
}

function openDialog(title: string, html: string) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap admin-auth-modal';
  wrap.innerHTML = `<div class="modal"><button type="button" class="modal-x">×</button><h2>${title}</h2>${html}</div>`;
  document.body.append(wrap);
  wrap.querySelector<HTMLButtonElement>('.modal-x')!.onclick = () => wrap.remove();
  return wrap;
}

function saveSession(session: any) {
  sessionStorage.setItem('admin_access_token', session.access_token);
  sessionStorage.setItem('admin_refresh_token', session.refresh_token || '');
  sessionStorage.setItem('admin_session', session.access_token);
}

async function linkOwner(accessToken: string, bootstrapKey: string, displayName = 'Owner') {
  const response = await fetch(`${supabaseUrl}/functions/v1/admin-link`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'x-bootstrap-key': bootstrapKey,
    },
    body: JSON.stringify({ display_name: displayName }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || 'Admin setup gagal');
  return data;
}

async function login(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error || !data.session) throw error || new Error('Login gagal');

  const pendingKey = sessionStorage.getItem('admin_pending_bootstrap_key');
  if (pendingKey) {
    await linkOwner(data.session.access_token, pendingKey, sessionStorage.getItem('admin_pending_display_name') || 'Owner');
    sessionStorage.removeItem('admin_pending_bootstrap_key');
    sessionStorage.removeItem('admin_pending_display_name');
  }

  saveSession(data.session);
  notice('Login admin berjaya');
  window.setTimeout(() => location.reload(), 500);
}

function setupOwner() {
  const dialog = openDialog('First Admin Setup', `
    <p>Daftar owner menggunakan Supabase Auth. Password disimpan secara selamat oleh Supabase dan tidak boleh dilihat semula.</p>
    <form id="adminSetupForm">
      <label>Display Name<input name="display_name" value="Owner" required></label>
      <label>Email<input name="email" type="email" autocomplete="email" required></label>
      <label>New Password<input name="password" type="password" minlength="10" autocomplete="new-password" required></label>
      <label>Bootstrap Key<input name="bootstrap_key" type="password" required></label>
      <button class="confirm">Create Secure Admin</button>
    </form>`);

  dialog.querySelector<HTMLFormElement>('#adminSetupForm')!.onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || '').trim().toLowerCase();
    const password = String(form.get('password') || '');
    const bootstrapKey = String(form.get('bootstrap_key') || '');
    const displayName = String(form.get('display_name') || 'Owner');
    const button = event.currentTarget.querySelector<HTMLButtonElement>('button')!;
    button.disabled = true;
    button.textContent = 'Creating…';
    try {
      sessionStorage.setItem('admin_pending_bootstrap_key', bootstrapKey);
      sessionStorage.setItem('admin_pending_display_name', displayName);
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${location.origin}${location.pathname}?admin=1` },
      });
      if (error) throw error;
      if (data.session) {
        await linkOwner(data.session.access_token, bootstrapKey, displayName);
        saveSession(data.session);
        sessionStorage.removeItem('admin_pending_bootstrap_key');
        sessionStorage.removeItem('admin_pending_display_name');
        notice('Admin owner berjaya dibuat');
        dialog.remove();
        window.setTimeout(() => location.reload(), 600);
      } else {
        notice('Semak email untuk sahkan akaun, kemudian login semula. Setup akan disambung automatik.');
        dialog.remove();
      }
    } catch (error: any) {
      notice(error.message || 'Setup gagal', true);
      button.disabled = false;
      button.textContent = 'Create Secure Admin';
    }
  };
}

async function forgotPassword() {
  const email = window.prompt('Masukkan email admin:')?.trim().toLowerCase();
  if (!email) return;
  const redirectTo = `${location.origin}${location.pathname}?admin-reset=1`;
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) notice(error.message, true);
  else notice('Jika email wujud, link reset password telah dihantar.');
}

async function showResetPassword() {
  const params = new URLSearchParams(location.search);
  if (params.get('admin-reset') !== '1') return;
  const dialog = openDialog('Set New Admin Password', `
    <form id="adminResetForm">
      <label>New Password<input name="password" type="password" minlength="10" autocomplete="new-password" required></label>
      <label>Confirm Password<input name="confirm" type="password" minlength="10" autocomplete="new-password" required></label>
      <button class="confirm">Update Password</button>
    </form>`);
  dialog.querySelector<HTMLFormElement>('#adminResetForm')!.onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') || '');
    if (password !== String(form.get('confirm') || '')) return notice('Password confirmation tidak sama', true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return notice(error.message, true);
    await supabase.auth.signOut();
    sessionStorage.removeItem('admin_access_token');
    sessionStorage.removeItem('admin_refresh_token');
    sessionStorage.removeItem('admin_session');
    dialog.remove();
    const clean = new URL(location.href);
    clean.searchParams.delete('admin-reset');
    history.replaceState({}, '', clean);
    notice('Password berjaya ditukar. Sila login semula.');
  };
}

function upgradeLoginForm() {
  const form = document.querySelector<HTMLFormElement>('#adminLoginForm');
  if (!form || form.dataset.secureAuth === '1') return;
  form.dataset.secureAuth = '1';
  const username = form.querySelector<HTMLInputElement>('input[name="username"]');
  if (username) {
    username.name = 'email';
    username.type = 'email';
    username.autocomplete = 'email';
    username.placeholder = 'owner@example.com';
    const label = username.closest('label');
    if (label?.firstChild) label.firstChild.textContent = 'Email';
  }
  form.insertAdjacentHTML('beforeend', `
    <button type="button" id="adminForgotPassword" class="confirm secondary-confirm">Forgot Password</button>
    <button type="button" id="adminFirstSetup" class="confirm secondary-confirm">First Admin Setup</button>
    <small style="display:block;margin-top:10px;color:#64748b">Secure login by Supabase Auth. Password is never stored in application source.</small>`);
  form.querySelector<HTMLButtonElement>('#adminForgotPassword')!.onclick = () => void forgotPassword();
  form.querySelector<HTMLButtonElement>('#adminFirstSetup')!.onclick = setupOwner;
}

document.addEventListener('submit', (event) => {
  const form = event.target as HTMLFormElement;
  if (form?.id !== 'adminLoginForm') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const data = new FormData(form);
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"],button.confirm')!;
  button.disabled = true;
  button.textContent = 'Signing in…';
  void login(String(data.get('email') || ''), String(data.get('password') || '')).catch((error) => {
    notice(error.message || 'Login gagal', true);
    button.disabled = false;
    button.textContent = 'Login Admin';
  });
}, true);

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  if (target?.id !== 'adminLogout') return;
  void supabase.auth.signOut();
  sessionStorage.removeItem('admin_access_token');
  sessionStorage.removeItem('admin_refresh_token');
  sessionStorage.removeItem('admin_session');
}, true);

supabase.auth.onAuthStateChange((_event, session) => {
  if (session) saveSession(session);
});

const observer = new MutationObserver(upgradeLoginForm);
observer.observe(document.body, { childList: true, subtree: true });
upgradeLoginForm();
void showResetPassword();
