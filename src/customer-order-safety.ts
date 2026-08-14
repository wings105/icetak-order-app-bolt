import { api } from './appdeploy-client';

type CustomerOrderComponent = { workflow?: string };
type CustomerOrderItem = { components?: CustomerOrderComponent[] };
type CustomerOrder = {
  orderToken?: string;
  status?: string;
  tab?: string;
  delivery?: string;
  items?: CustomerOrderItem[];
};

let safetyRequest = 0;
let queued = false;

const normalize = (value: unknown) => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const finalWorkflows = new Set([
  'complete', 'completed', 'production_complete', 'ready', 'ready_to_ship',
  'ready_for_pickup', 'ready_to_pickup', 'delivered', 'customer_collected', 'collected',
]);

function exactOrderToken() {
  return new URL(location.href).searchParams.get('order')?.trim() || '';
}

function clearStaleHistoryOrderToken() {
  if (exactOrderToken()) return;
  const state = history.state;
  if (!state || typeof state !== 'object' || !('orderToken' in state)) return;
  const next = { ...(state as Record<string, unknown>) };
  delete next.orderToken;
  history.replaceState(next, '', location.href);
}

function removePickupActions(card: HTMLElement) {
  card.querySelector('[data-customer-confirm-pickup]')?.remove();
  card.querySelector('[data-lifecycle-note="pickup-confirmation"]')?.remove();
}

function setPickupCard(card: HTMLElement, mode: 'waiting' | 'cancelled' | 'collected' | 'checking') {
  removePickupActions(card);
  card.classList.toggle('ready', mode === 'collected');
  const heading = card.querySelector<HTMLElement>('h3');
  const icon = card.querySelector<HTMLElement>('header > span');
  const helper = card.querySelector<HTMLElement>('small:last-child');

  if (mode === 'cancelled') {
    if (heading) heading.textContent = 'Order Dibatalkan';
    if (icon) icon.textContent = '✕';
    if (helper) helper.textContent = 'Order ini telah dibatalkan dan tidak boleh diambil.';
    return;
  }
  if (mode === 'collected') {
    if (heading) heading.textContent = 'Barang Telah Diambil';
    if (icon) icon.textContent = '✅';
    if (helper) helper.textContent = 'Pickup telah disahkan. Terima kasih.';
    return;
  }
  if (mode === 'checking') {
    if (heading) heading.textContent = 'Pickup Status Sedang Disemak';
    if (icon) icon.textContent = '…';
    if (helper) helper.textContent = 'Refresh order untuk semak status pickup terkini.';
    return;
  }
  if (heading) heading.textContent = 'Pickup di Kedai';
  if (icon) icon.textContent = '📍';
  if (helper) helper.textContent = 'Status akan berubah kepada Ready for Pickup selepas semua proses production siap.';
}

function componentsComplete(order: CustomerOrder) {
  const components = (order.items || []).flatMap((item) => item.components || []);
  return components.length > 0 && components.every((component) => finalWorkflows.has(normalize(component.workflow)));
}

async function enforcePickupSafety() {
  clearStaleHistoryOrderToken();

  const detail = document.querySelector<HTMLElement>('.order-detail-page');
  const card = detail?.querySelector<HTMLElement>('.cp-pickup-card');
  if (!detail || !card) return;

  const token = exactOrderToken();
  if (!token) {
    // Never show an actionable pickup state without an explicit order URL.
    card.remove();
    return;
  }

  const request = ++safetyRequest;
  try {
    const response: any = await api.get(`/api/orders/${encodeURIComponent(token)}`);
    if (request !== safetyRequest || exactOrderToken() !== token || !document.body.contains(card)) return;
    const payload = response?.data ?? response;
    const order = (payload?.order ?? payload?.data?.order ?? {}) as CustomerOrder;
    const delivery = normalize(order.delivery);
    if (!delivery.includes('pickup')) {
      card.remove();
      return;
    }

    const status = normalize(order.status);
    const tab = normalize(order.tab);
    const cancelled = status.includes('cancel') || tab === 'cancelled';
    const collected = ['completed', 'customer_collected', 'collected'].includes(status) || tab === 'completed';
    const readyStatus = status.includes('ready_for_pickup') || status.includes('ready_to_pickup');
    const ready = !cancelled && !collected && readyStatus && componentsComplete(order);

    if (cancelled) {
      setPickupCard(card, 'cancelled');
      return;
    }
    if (collected) {
      setPickupCard(card, 'collected');
      return;
    }
    if (!ready) {
      setPickupCard(card, 'waiting');
      return;
    }

    // Exact order is genuinely ready. Keep the existing lifecycle UI/button.
    card.classList.add('ready');
  } catch {
    if (request !== safetyRequest || !document.body.contains(card)) return;
    setPickupCard(card, 'checking');
  }
}

function scheduleSafety() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    void enforcePickupSafety();
  });
}

window.addEventListener('popstate', scheduleSafety);
window.addEventListener('hashchange', scheduleSafety);
const observer = new MutationObserver(scheduleSafety);
observer.observe(document.documentElement, { childList: true, subtree: true });
scheduleSafety();
