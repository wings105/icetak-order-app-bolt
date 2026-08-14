import { api, supabase } from './appdeploy-client';

export {};

type PaymentSession = {
  id: string;
  status: string;
  orderId: string;
  expectedAmount: number;
  expiresAt: number;
};

type ComponentState = {
  id: string;
  progressPercent: number;
  workflow: string;
  customerStage: string;
  clickupStatus: string;
};

type OrderState = {
  id: string;
  status: string;
  fulfillmentStage: string;
  pickupReadyAt: string;
  pickupCollectedAt: string;
  payment: string;
  paymentStatus: string;
  paymentMethod: string;
  delivery: string;
  components: ComponentState[];
};

const QR_URL = 'https://t3747262.p.clickup-attachments.com/t3747262/836016e0-e613-447b-b61a-291fddd3f83d_large.png';
let scheduled = false;
let loading = false;
let cachedToken = '';
let cachedAt = 0;
let cachedState: OrderState | null = null;
let paymentPoll = 0;
let cancellingPayment = false;

function normalize(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function setText(element: HTMLElement | null, value: string) {
  if (element && element.textContent !== value) element.textContent = value;
}

function selectedOrderToken() {
  return new URL(location.href).searchParams.get('order') || '';
}

function money(value: number) {
  const amount = Number(value || 0);
  return `RM${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}

function toast(message: string, bad = false) {
  document.querySelector('[data-pickup-payment-toast]')?.remove();
  const element = document.createElement('div');
  element.dataset.pickupPaymentToast = '1';
  element.textContent = message;
  Object.assign(element.style, {
    position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)',
    zIndex: '150000', maxWidth: 'calc(100vw - 32px)', padding: '12px 16px',
    borderRadius: '12px', background: bad ? '#b42318' : '#157f3b', color: '#fff',
    fontWeight: '800', textAlign: 'center', boxShadow: '0 10px 32px rgba(0,0,0,.24)',
  });
  document.body.append(element);
  window.setTimeout(() => element.remove(), 3200);
}

function exactReady(state: OrderState) {
  return Boolean(state.pickupReadyAt)
    || normalize(state.fulfillmentStage) === 'ready_for_pickup'
    || ['ready_for_pickup', 'ready_pickup'].includes(normalize(state.status));
}

function completed(state: OrderState) {
  return Boolean(state.pickupCollectedAt)
    || ['completed', 'customer_collected', 'collected'].includes(normalize(state.status))
    || ['completed', 'customer_collected', 'collected'].includes(normalize(state.fulfillmentStage));
}

function paid(state: OrderState) {
  return normalize(state.payment) === 'paid'
    || ['paid', 'matched', 'payment_received'].includes(normalize(state.paymentStatus));
}

function payAtPickup(state: OrderState) {
  return [state.payment, state.paymentStatus, state.paymentMethod]
    .map(normalize)
    .some((value) => ['cash_at_counter', 'cash_counter', 'pay_at_pickup'].includes(value));
}

function pickup(state: OrderState) {
  return normalize(state.delivery).includes('pickup');
}

function componentComplete(component: ComponentState) {
  const workflow = normalize(component.customerStage || component.workflow || component.clickupStatus);
  return component.progressPercent >= 100
    || ['complete', 'completed', 'production_complete', 'ready', 'ready_for_pickup', 'delivered'].includes(workflow);
}

function allComplete(state: OrderState) {
  return state.components.length > 0 && state.components.every(componentComplete);
}

function apiState(raw: any): OrderState | null {
  const payload = raw?.data ?? raw;
  const order = payload?.order ?? payload?.data?.order;
  if (!order) return null;
  return {
    id: String(order.id || ''),
    status: String(order.status || ''),
    fulfillmentStage: String(order.fulfillmentStage || ''),
    pickupReadyAt: String(order.pickupReadyAt || ''),
    pickupCollectedAt: String(order.pickupCollectedAt || ''),
    payment: String(order.payment || ''),
    paymentStatus: String(order.paymentStatus || ''),
    paymentMethod: String(order.paymentMethod || ''),
    delivery: String(order.delivery || order.deliveryMethod || ''),
    components: (Array.isArray(order.items) ? order.items : []).flatMap((item: any) =>
      (Array.isArray(item?.components) ? item.components : []).map((component: any) => ({
        id: String(component?.id || ''),
        progressPercent: Number(component?.progressPercent || 0),
        workflow: String(component?.workflow || ''),
        customerStage: String(component?.customerStage || component?.workflow || ''),
        clickupStatus: String(component?.clickupStatus || ''),
      })),
    ),
  };
}

async function loadState(force = false): Promise<OrderState | null> {
  const token = selectedOrderToken();
  if (!token) return null;
  if (!force && cachedToken === token && cachedState && Date.now() - cachedAt < 2500) return cachedState;
  if (loading) return cachedState;
  loading = true;
  try {
    let fallback: OrderState | null = null;
    try {
      fallback = apiState(await api.get(`/api/orders/${encodeURIComponent(token)}`));
    } catch {
      fallback = null;
    }

    const { data: rows } = await supabase
      .from('orders')
      .select('id,order_no,status,fulfillment_stage,pickup_ready_at,pickup_collected_at,payment,payment_status,payment_method,delivery_method,delivery')
      .eq('public_token', token)
      .limit(1);
    const row: any = rows?.[0];
    if (!row) {
      cachedState = fallback;
      cachedToken = token;
      cachedAt = Date.now();
      return cachedState;
    }

    const { data: componentRows } = await supabase
      .from('production_components')
      .select('id,progress_percent,workflow,customer_stage,clickup_status')
      .eq('order_id', row.id)
      .order('created_at', { ascending: true });

    cachedState = {
      id: String(row.order_no || fallback?.id || ''),
      status: String(row.status || fallback?.status || ''),
      fulfillmentStage: String(row.fulfillment_stage || fallback?.fulfillmentStage || ''),
      pickupReadyAt: String(row.pickup_ready_at || ''),
      pickupCollectedAt: String(row.pickup_collected_at || ''),
      payment: String(row.payment || fallback?.payment || ''),
      paymentStatus: String(row.payment_status || fallback?.paymentStatus || ''),
      paymentMethod: String(row.payment_method || fallback?.paymentMethod || ''),
      delivery: String(row.delivery_method || row.delivery || fallback?.delivery || ''),
      components: (componentRows || []).map((component: any) => ({
        id: String(component.id || ''),
        progressPercent: Number(component.progress_percent || 0),
        workflow: String(component.workflow || ''),
        customerStage: String(component.customer_stage || ''),
        clickupStatus: String(component.clickup_status || ''),
      })),
    };
    cachedToken = token;
    cachedAt = Date.now();
    return cachedState;
  } finally {
    loading = false;
  }
}

function stageLabel(percent: number) {
  if (percent >= 100) return 'Ready';
  if (percent >= 83) return 'Finishing';
  if (percent >= 67) return 'Production';
  if (percent >= 50) return 'Approved';
  if (percent >= 33) return 'Waiting Review';
  if (percent >= 17) return 'Design Editing';
  return 'Order Received';
}

function stageIndex(percent: number, count: number) {
  if (count >= 7) {
    if (percent >= 100) return 6;
    if (percent >= 83) return 5;
    if (percent >= 67) return 4;
    if (percent >= 50) return 3;
    if (percent >= 33) return 2;
    if (percent >= 17) return 1;
    return 0;
  }
  if (percent >= 100) return Math.max(0, count - 1);
  if (percent >= 83) return Math.min(3, count - 1);
  if (percent >= 67) return Math.min(2, count - 1);
  if (percent >= 17) return Math.min(1, count - 1);
  return 0;
}

function applyProgress(detail: HTMLElement, state: OrderState) {
  const cards = Array.from(detail.querySelectorAll<HTMLElement>('.cp-component'));
  if (!cards.length || !state.components.length) return;
  cards.forEach((card, index) => {
    const component = state.components[index];
    if (!component) return;
    setText(card.querySelector<HTMLElement>('.cp-component-head span'), stageLabel(component.progressPercent));
    const steps = Array.from(card.querySelectorAll<HTMLElement>('.cp-step'));
    const current = stageIndex(component.progressPercent, steps.length);
    steps.forEach((step, number) => {
      step.classList.toggle('done', number < current);
      step.classList.toggle('current', number === current);
      setText(step.querySelector<HTMLElement>('i'), number <= current ? '✓' : '');
    });
  });

  const overall = Math.round(state.components.reduce((sum, component) => sum + component.progressPercent, 0) / state.components.length);
  setText(detail.querySelector<HTMLElement>('.cp-overall > div:first-child span'), `${overall}% • ${state.components.length} proses`);
  const bar = detail.querySelector<HTMLElement>('.cp-overall-bar i');
  if (bar && bar.style.width !== `${overall}%`) bar.style.width = `${overall}%`;
}

function removePickupControls(card: HTMLElement) {
  card.querySelector('[data-lifecycle-note="pickup-confirmation"]')?.remove();
  card.querySelector('[data-customer-confirm-pickup]:not([data-payment-guard])')?.remove();
}

function ensureGuard(card: HTMLElement) {
  if (card.querySelector('[data-payment-guard]')) return;
  const guard = document.createElement('span');
  guard.dataset.customerConfirmPickup = '1';
  guard.dataset.paymentGuard = '1';
  guard.hidden = true;
  card.append(guard);
}

async function confirmPickup(button: HTMLButtonElement) {
  const token = selectedOrderToken();
  if (!token || !window.confirm('Sahkan barang sudah diterima daripada staff?')) return;
  const original = button.textContent || '';
  button.disabled = true;
  setText(button, 'Mengesahkan…');
  const { data, error } = await supabase.rpc('icetak_customer_confirm_pickup', { p_order_token: token });
  if (error || !data?.ok) {
    button.disabled = false;
    setText(button, original);
    toast(error?.message || 'Pengesahan pickup gagal', true);
    return;
  }
  toast('Pickup disahkan. Order telah Completed.');
  window.setTimeout(() => location.reload(), 700);
}

function ensurePickupButton(card: HTMLElement) {
  if (card.querySelector('[data-customer-confirm-pickup]:not([data-payment-guard])')) return;
  card.querySelector('[data-payment-guard]')?.remove();
  const note = document.createElement('p');
  note.dataset.lifecycleNote = 'pickup-confirmation';
  note.textContent = 'Tekan butang di bawah hanya selepas barang sudah diterima daripada staff.';
  Object.assign(note.style, { padding: '10px 12px', borderRadius: '10px', background: '#fff3cd', color: '#7a4b00', fontWeight: '700' });
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.customerConfirmPickup = '1';
  button.textContent = '✓ Saya Dah Ambil Barang';
  Object.assign(button.style, {
    width: '100%', marginTop: '12px', padding: '13px 16px', border: '0',
    borderRadius: '12px', background: '#16883f', color: '#fff', fontWeight: '800',
    fontSize: '15px', cursor: 'pointer',
  });
  button.onclick = () => void confirmPickup(button);
  card.append(note, button);
}

function applyPickup(detail: HTMLElement, state: OrderState) {
  const card = detail.querySelector<HTMLElement>('.cp-pickup-card');
  if (!card || !pickup(state)) return;
  const heading = card.querySelector<HTMLElement>('h3');
  const icon = card.querySelector<HTMLElement>('header > span');
  const helper = card.querySelector<HTMLElement>('small:last-child');

  let mode = 'processing';
  if (completed(state)) mode = 'completed';
  else if (exactReady(state) && allComplete(state) && paid(state)) mode = 'ready_paid';
  else if (exactReady(state) && allComplete(state)) mode = 'ready_unpaid';

  if (card.dataset.pickupStateMode !== mode) {
    card.dataset.pickupStateMode = mode;
    removePickupControls(card);
    card.querySelector('[data-payment-guard]')?.remove();
  }

  if (mode === 'completed') {
    card.classList.add('ready');
    setText(heading, 'Barang Telah Diambil');
    setText(icon, '✅');
    setText(helper, 'Pickup telah disahkan. Terima kasih.');
    return;
  }

  if (mode === 'processing') {
    card.classList.remove('ready');
    setText(heading, 'Pickup di Kedai');
    setText(icon, '📍');
    setText(helper, 'Status akan berubah kepada Ready for Pickup selepas production dan packing selesai.');
    return;
  }

  card.classList.add('ready');
  setText(heading, 'Order Ready for Pickup');
  setText(icon, '✅');
  if (mode === 'ready_unpaid') {
    setText(helper, 'Barang sudah siap. Selesaikan bayaran sebelum sahkan pickup.');
    ensureGuard(card);
    return;
  }

  setText(helper, 'Bawa Order ID semasa pickup.');
  ensurePickupButton(card);
}

function closePaymentModal(reload = false) {
  if (paymentPoll) window.clearInterval(paymentPoll);
  paymentPoll = 0;
  cancellingPayment = false;
  document.querySelector('[data-qr-switch-modal]')?.remove();
  if (reload) location.reload();
}

async function cancelPaymentSession(session: PaymentSession) {
  if (cancellingPayment) return;
  const token = selectedOrderToken();
  if (!token || !session.id) {
    closePaymentModal(true);
    return;
  }

  if (paymentPoll) window.clearInterval(paymentPoll);
  paymentPoll = 0;
  cancellingPayment = true;
  const modal = document.querySelector<HTMLElement>('[data-qr-switch-modal]');
  const closeButton = modal?.querySelector<HTMLButtonElement>('[data-close-qr]') || null;
  if (closeButton) {
    closeButton.disabled = true;
    closeButton.textContent = '…';
  }

  try {
    const { data, error } = await supabase.rpc('icetak_cancel_payment', {
      p_order_token: token,
      p_session_id: session.id,
    });
    if (error) throw error;
    const result: any = data || {};
    if (result.already_paid) {
      closePaymentModal();
      toast('Bayaran sudah diterima ✅');
      window.setTimeout(() => location.reload(), 500);
      return;
    }
    if (result.ok === false) throw new Error(result.error || 'QR Pay tidak dapat dibatalkan');

    closePaymentModal();
    cachedAt = 0;
    toast('QR Pay dibatalkan. Kaedah bayaran asal dikekalkan.');
    window.setTimeout(() => location.reload(), 500);
  } catch (error) {
    cancellingPayment = false;
    if (closeButton) {
      closeButton.disabled = false;
      closeButton.textContent = '✕';
    }
    toast(error instanceof Error ? error.message : 'QR Pay tidak dapat dibatalkan', true);
  }
}

function showPaymentModal(session: PaymentSession) {
  closePaymentModal();
  const wrap = document.createElement('div');
  wrap.dataset.qrSwitchModal = '1';
  Object.assign(wrap.style, {
    position: 'fixed', inset: '0', zIndex: '160000', background: 'rgba(0,0,0,.58)',
    display: 'grid', placeItems: 'center', padding: '16px',
  });
  const panel = document.createElement('section');
  Object.assign(panel.style, {
    width: 'min(100%, 430px)', maxHeight: 'calc(100vh - 32px)', overflow: 'auto',
    background: '#fff', borderRadius: '18px', padding: '18px', textAlign: 'center',
    boxShadow: '0 24px 80px rgba(0,0,0,.3)',
  });
  const left = Math.max(0, session.expiresAt - Date.now());
  panel.innerHTML = `<button data-close-qr aria-label="Batal QR Pay" style="float:right;border:0;border-radius:999px;width:36px;height:36px;font-size:18px">✕</button>
    <small>Order ${session.orderId}</small><h2 style="margin:8px 0">Bayar QR Sekarang</h2>
    <p>Scan DuitNow QR dan bayar jumlah tepat.</p>
    <img src="${QR_URL}" alt="DuitNow QR" style="display:block;width:min(100%,310px);margin:12px auto;border-radius:12px">
    <button data-copy-amount style="width:100%;padding:14px;border:1px solid #ee4d2d;border-radius:12px;background:#fff;color:#ee4d2d;font-weight:800">Jumlah Tepat: ${money(session.expectedAmount)}</button>
    <p style="margin:12px 0 0">Session: <b data-countdown>${String(Math.floor(left / 60000)).padStart(2, '0')}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}</b></p>
    <small>Status bayaran akan dikesan automatik. Tekan ✕ untuk batal QR dan kekalkan kaedah bayaran asal.</small>`;
  panel.querySelector<HTMLButtonElement>('[data-close-qr]')!.onclick = () => void cancelPaymentSession(session);
  panel.querySelector<HTMLButtonElement>('[data-copy-amount]')!.onclick = async () => {
    await navigator.clipboard.writeText(session.expectedAmount.toFixed(2));
    toast('Jumlah disalin');
  };
  wrap.append(panel);
  wrap.onclick = (event) => {
    if (event.target === wrap) void cancelPaymentSession(session);
  };
  document.body.append(wrap);

  const token = selectedOrderToken();
  paymentPoll = window.setInterval(async () => {
    const remaining = Math.max(0, session.expiresAt - Date.now());
    setText(panel.querySelector<HTMLElement>('[data-countdown]'), `${String(Math.floor(remaining / 60000)).padStart(2, '0')}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')}`);
    try {
      const response: any = await api.post(`/api/orders/${encodeURIComponent(token)}/payment-session`, {});
      const next = response?.data?.payment ?? response?.payment ?? response?.data ?? response;
      if (normalize(next?.status) === 'matched') {
        closePaymentModal();
        toast('Bayaran diterima ✅');
        window.setTimeout(() => location.reload(), 650);
      }
    } catch {
      // The next poll can recover.
    }
  }, 5000);
}

async function switchToQr(button: HTMLButtonElement) {
  const token = selectedOrderToken();
  if (!token) return;
  const original = button.textContent || '';
  button.disabled = true;
  setText(button, 'Menyediakan QR…');
  try {
    const response: any = await api.post(`/api/orders/${encodeURIComponent(token)}/payment-session`, {});
    const payment = response?.data?.payment ?? response?.payment ?? response?.data ?? response;
    showPaymentModal({
      id: String(payment?.id || ''),
      status: String(payment?.status || 'pending'),
      orderId: String(payment?.orderId || cachedState?.id || ''),
      expectedAmount: Number(payment?.expectedAmount || 0),
      expiresAt: Number(payment?.expiresAt || Date.now() + 600000),
    });
    cachedAt = 0;
  } catch (error) {
    button.disabled = false;
    setText(button, original);
    toast(error instanceof Error ? error.message : 'QR Pay gagal disediakan', true);
  }
}

function applyPayment(detail: HTMLElement, state: OrderState) {
  const card = detail.querySelector<HTMLElement>('.cp-payment');
  if (!card) return;
  const heading = card.querySelector<HTMLElement>('b');
  const paragraph = card.querySelector<HTMLElement>('p');

  if (paid(state)) {
    card.dataset.paymentStateMode = 'paid';
    card.querySelector('[data-switch-to-qr]')?.remove();
    setText(heading, 'Payment: Paid ✅');
    setText(paragraph, 'Bayaran telah diterima.');
    return;
  }

  if (!payAtPickup(state)) return;
  setText(heading, 'Payment: Bayar Semasa Pickup');
  setText(paragraph, 'Boleh bayar di kedai semasa ambil, atau tukar kepada QR Pay sekarang.');
  if (card.querySelector('[data-switch-to-qr]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.switchToQr = '1';
  button.textContent = '▣ Bayar QR Sekarang';
  Object.assign(button.style, {
    width: '100%', marginTop: '12px', padding: '13px 16px', border: '0',
    borderRadius: '12px', background: '#ee4d2d', color: '#fff', fontWeight: '800',
    fontSize: '15px', cursor: 'pointer',
  });
  button.onclick = () => void switchToQr(button);
  card.append(button);
}

async function enhance(force = false) {
  scheduled = false;
  const detail = document.querySelector<HTMLElement>('.order-detail-page');
  if (!detail || !selectedOrderToken()) return;
  const state = await loadState(force);
  if (!state || !document.body.contains(detail)) return;
  applyProgress(detail, state);
  applyPayment(detail, state);
  applyPickup(detail, state);
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  window.setTimeout(() => void enhance(), 80);
}

const observer = new MutationObserver(schedule);
observer.observe(document.querySelector('#app') || document.body, { childList: true, subtree: true });
window.addEventListener('DOMContentLoaded', schedule);
window.addEventListener('popstate', () => {
  cachedAt = 0;
  schedule();
});
document.addEventListener('click', (event) => {
  if ((event.target as HTMLElement)?.closest('[data-cp-refresh-order],[data-cp-refresh-bottom]')) {
    cachedAt = 0;
    window.setTimeout(() => void enhance(true), 500);
  }
});
schedule();
