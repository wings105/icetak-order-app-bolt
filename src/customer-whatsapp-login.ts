import { supabase } from './appdeploy-client';

const env = (import.meta as any).env || {};
const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';

type Any = Record<string, any>;

function normalizePhone(value: string) {
  const digits = String(value || '').replace(/\D/g, '');
  const phone = digits.startsWith('60') ? digits : digits.startsWith('0') ? `6${digits}` : digits.startsWith('1') ? `60${digits}` : digits;
  return /^601\d{8,9}$/.test(phone) ? phone : '';
}

function toast(message: string, bad = false) {
  const el = document.createElement('div');
  el.textContent = message;
  Object.assign(el.style, {
    position: 'fixed', zIndex: '1000000', left: '50%', bottom: '24px', transform: 'translateX(-50%)',
    background: bad ? '#b91c1c' : '#166534', color: '#fff', padding: '12px 16px', borderRadius: '12px', fontWeight: '800',
  });
  document.body.append(el);
  setTimeout(() => el.remove(), 4000);
}

async function loginApi(path: string, body: Any) {
  const response = await fetch(`${supabaseUrl}/functions/v1/whatsapp-login${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || `Login ${response.status}`);
  return data;
}

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function complete(customerToken: string, verifiedPhone: string) {
  const secret = randomSecret();
  const { data, error } = await supabase.rpc('icetak_customer_session_register' as any, {
    p_customer_token: customerToken,
    p_phone: verifiedPhone,
    p_session_hash: await sha256(secret),
    p_user_agent: navigator.userAgent,
  } as any);
  if (error) throw new Error(error.message);

  localStorage.setItem('customer_session', secret);
  localStorage.setItem('customer_session_expires_at', String(new Date((data as Any)?.session_expires_at || Date.now() + 30 * 86400000).getTime()));
  localStorage.setItem('customer_token', customerToken);
  localStorage.removeItem('customer_profile');
  sessionStorage.removeItem('customer');

  const url = new URL(location.origin + location.pathname.replace(/\/login\/?$/, '/'));
  url.searchParams.set('c', customerToken);
  location.replace(url.toString());
}

function modal() {
  document.querySelector('#customerOtpModal')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'customerOtpModal';
  wrap.innerHTML = `<div class="cw-card"><button class="cw-x">×</button><div class="cw-icon">💬</div><h2>Login My Orders</h2><p>Masukkan nombor WhatsApp yang digunakan semasa order.</p><form id="cwRequest"><label>Nombor WhatsApp<input name="phone" inputmode="tel" placeholder="0129554732" required></label><button>Hantar OTP / Magic Link</button></form><section id="cwVerify" hidden><p>Kod sudah dihantar melalui WhatsApp.</p><form><label>Kod OTP 6 digit<input name="otp" inputmode="numeric" maxlength="6" required></label><button>Verify & Open My Orders</button></form><button id="cwResend" class="cw-secondary" disabled>Hantar semula dalam 60s</button></section></div>`;
  document.body.append(wrap);
  wrap.querySelector<HTMLButtonElement>('.cw-x')!.onclick = () => wrap.remove();

  let phone = '';
  let timer = 0;
  const requestForm = wrap.querySelector<HTMLFormElement>('#cwRequest')!;
  const verify = wrap.querySelector<HTMLElement>('#cwVerify')!;
  const resend = wrap.querySelector<HTMLButtonElement>('#cwResend')!;
  const startTimer = () => {
    let left = 60;
    resend.disabled = true;
    resend.textContent = `Hantar semula dalam ${left}s`;
    clearInterval(timer);
    timer = window.setInterval(() => {
      left--;
      resend.textContent = left > 0 ? `Hantar semula dalam ${left}s` : 'Hantar semula';
      if (left <= 0) { clearInterval(timer); resend.disabled = false; }
    }, 1000);
  };
  const request = async () => {
    const data = await loginApi('/request', { phone });
    verify.hidden = false;
    requestForm.querySelector('button')!.textContent = 'OTP dihantar';
    requestForm.querySelector<HTMLButtonElement>('button')!.disabled = true;
    toast(data.mode === 'template' ? 'Magic link dihantar melalui template' : 'OTP dan link dihantar');
    startTimer();
  };

  requestForm.onsubmit = async (event) => {
    event.preventDefault();
    phone = normalizePhone(String(new FormData(requestForm).get('phone') || ''));
    if (!phone) { toast('Nombor Malaysia tidak sah', true); return; }
    const btn = requestForm.querySelector<HTMLButtonElement>('button')!;
    btn.disabled = true;
    btn.textContent = 'Menghantar…';
    try { await request(); }
    catch (error) { btn.disabled = false; btn.textContent = 'Hantar OTP / Magic Link'; toast(error instanceof Error ? error.message : String(error), true); }
  };

  verify.querySelector<HTMLFormElement>('form')!.onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const btn = form.querySelector<HTMLButtonElement>('button')!;
    btn.disabled = true;
    btn.textContent = 'Verifying…';
    try {
      const otp = String(new FormData(form).get('otp') || '').trim();
      const data = await loginApi('/verify', { phone, otp });
      btn.textContent = 'Preparing account…';
      await complete(data.customer_token, data.phone || phone);
    } catch (error) {
      btn.disabled = false;
      btn.textContent = 'Verify & Open My Orders';
      toast(error instanceof Error ? error.message : String(error), true);
    }
  };
  resend.onclick = async () => {
    resend.disabled = true;
    try { await request(); }
    catch (error) { toast(error instanceof Error ? error.message : String(error), true); resend.disabled = false; }
  };
}

function intercept(event: Event) {
  const target = (event.target as HTMLElement)?.closest('#customerMagic,#loginHistory,[data-customer-secure-login]');
  if (!target) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  modal();
}
document.addEventListener('click', intercept, true);

async function consumeMagicLink() {
  const url = new URL(location.href);
  const token = url.searchParams.get('magic_token') || (location.pathname.replace(/\/$/, '').endsWith('/login') ? url.searchParams.get('token') : '');
  if (!token) return;
  try {
    const data = await loginApi('/verify', { token });
    await complete(data.customer_token, data.phone);
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), true);
  }
}

const style = document.createElement('style');
style.textContent = `#customerOtpModal{position:fixed;inset:0;z-index:999999;background:rgba(15,23,42,.65);display:grid;place-items:center;padding:18px}.cw-card{width:min(440px,100%);background:white;border-radius:22px;padding:24px;box-shadow:0 30px 90px rgba(0,0,0,.3);position:relative}.cw-x{position:absolute;right:14px;top:14px;border:0;background:#e2e8f0;border-radius:999px;width:38px;height:38px;font-size:24px}.cw-icon{font-size:42px}.cw-card h2{margin:6px 0}.cw-card p{color:#64748b}.cw-card label{display:block;font-weight:800;margin:12px 0}.cw-card input{width:100%;box-sizing:border-box;margin-top:7px;padding:13px;border:1px solid #cbd5e1;border-radius:12px;font:inherit}.cw-card button:not(.cw-x){width:100%;border:0;border-radius:12px;padding:13px;background:#16a34a;color:white;font-weight:900}.cw-card .cw-secondary{margin-top:10px;background:#0f172a}.cw-card button:disabled{opacity:.55}`;
document.head.append(style);
void consumeMagicLink();
