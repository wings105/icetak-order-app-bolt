import { supabase } from './appdeploy-client';

function isPaidText(text: string) {
  const t = text.toLowerCase();
  return t.includes('payment_received') || t.includes('payment received') || t.includes('payment_status: paid') || /\bpaid\b/.test(t);
}

function guardPaidOrderUi() {
  const app = document.querySelector('#app');
  if (!app) return;
  const text = app.textContent || '';
  if (!isPaidText(text)) return;

  document.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    const label = (button.textContent || '').toLowerCase();
    if (label.includes('pay') || label.includes('upload receipt')) {
      button.disabled = true;
      button.textContent = 'Payment Received';
      button.classList.add('payment-paid-disabled');
    }
  });
}

async function pollPaymentStatus() {
  const params = new URLSearchParams(location.search);
  const token = params.get('order') || '';
  if (!token) return;

  const { data } = await supabase
    .from('orders')
    .select('payment_status,status,tab')
    .eq('public_token', token)
    .maybeSingle();

  if (!data) return;
  if (data.payment_status === 'paid' || data.status === 'payment_received') {
    guardPaidOrderUi();
    if ((document.querySelector('#app')?.textContent || '').includes('Scan DuitNow QR')) {
      location.reload();
    }
  }
}

const observer = new MutationObserver(() => guardPaidOrderUi());
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('load', () => {
  guardPaidOrderUi();
  setInterval(() => {
    pollPaymentStatus().catch(() => undefined);
  }, 3000);
});
