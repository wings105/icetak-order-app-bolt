import { supabase } from './lib/supabase';
import './order-fulfillment-tracking.css';

type OrderLifecycle = {
  id: string;
  orderNo: string;
  delivery: string;
  courier: string;
  tracking: string;
  trackingLink: string;
  fulfillmentStage: string;
  shipmentStatus: string;
  shipmentStatusGroup: string;
  payment: string;
  paymentMethod: string;
  productionApproved: boolean;
  customerConfirmed: boolean;
  createdAt: string | null;
  productionCompletedAt: string | null;
  pickupReadyAt: string | null;
  pickupCollectedAt: string | null;
  deliveredAt: string | null;
};

type Shipment = {
  trackingNo: string;
  courier: string;
  trackingLink: string;
  status: string;
  statusGroup: string;
  normalizedStatus: string;
  firstScanAt: string | null;
  firstScanStatus: string;
  bookedAt: string | null;
  createdAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  awbError: string;
  trackingMessageError: string;
};

type ShipmentEvent = {
  status: string;
  statusGroup: string;
  normalizedStatus: string;
  eventName: string;
  at: string | null;
  location: string;
  description: string;
};

type FulfillmentPayload = {
  ok: boolean;
  order: OrderLifecycle;
  shipment: Shipment | null;
  latestEvent: ShipmentEvent | null;
  events: ShipmentEvent[];
};

type Step = { label: string; done: boolean; at?: string | null; detail?: string };
type Tone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

const REFRESH_MS = 30_000;
const cache = new Map<string, { at: number; data: FulfillmentPayload }>();
const inflight = new Map<string, Promise<FulfillmentPayload>>();
const slug = (value: unknown) => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

function formatDateTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' }).format(date);
}

function drawerContext() {
  const drawer = document.querySelector<HTMLElement>('.erp-order-drawer');
  const orderRef = drawer?.querySelector<HTMLElement>('.erp-drawer-title h2')?.textContent?.trim() || '';
  return { drawer, orderRef };
}

function findCard(drawer: HTMLElement, title: string) {
  return Array.from(drawer.querySelectorAll<HTMLElement>('.erp-drawer-card')).find((card) =>
    card.querySelector(':scope > h3')?.textContent?.trim().toLowerCase() === title.toLowerCase()
  ) || null;
}

function cleanupLegacyFulfillment(drawer: HTMLElement) {
  drawer.querySelectorAll<HTMLElement>('.erp-drawer-card:not([data-fulfillment-card]) [data-fulfillment-360]').forEach((node) => node.remove());
  drawer.querySelectorAll<HTMLElement>('.erp-drawer-card.erp-fulfillment-enhanced:not([data-fulfillment-card])').forEach((card) => {
    card.classList.remove('erp-fulfillment-enhanced');
    delete card.dataset.fulfillmentOrder;
    const heading = card.querySelector(':scope > h3');
    if (heading?.textContent?.trim() === 'Fulfillment / Tracking') heading.textContent = 'Fulfillment';
  });
}

function isPickup(order: OrderLifecycle) {
  return slug(order.delivery).includes('pickup');
}

function statusRank(value: unknown) {
  const v = slug(value);
  if (['delivered', 'completed'].includes(v)) return 5;
  if (['out_for_delivery', 'delivering'].includes(v)) return 4;
  if (['in_transit', 'picked_up', 'accepted_by_courier', 'shipped'].includes(v)) return 3;
  if (['first_scan', 'accepted', 'collected_by_courier'].includes(v)) return 2;
  if (['shipment_created', 'awb_created', 'pending_pickup', 'pending'].includes(v)) return 1;
  return 0;
}

function compactStatus(payload: FulfillmentPayload): { label: string; tone: Tone; sub: string } {
  const { order, shipment, latestEvent } = payload;
  if (isPickup(order)) {
    if (order.pickupCollectedAt) return { label: 'Customer Collected', tone: 'success', sub: 'Pickup' };
    if (order.pickupReadyAt) return { label: 'Ready for Pickup', tone: 'success', sub: 'Pickup' };
    if (order.productionCompletedAt) return { label: 'Production Completed', tone: 'info', sub: 'Pickup' };
    if (order.productionApproved) return { label: 'In Production', tone: 'info', sub: 'Pickup' };
    return { label: 'Order Received', tone: 'neutral', sub: 'Pickup' };
  }

  const values = [latestEvent?.normalizedStatus, latestEvent?.statusGroup, latestEvent?.status, shipment?.normalizedStatus, shipment?.statusGroup, shipment?.status];
  const rank = values.reduce((max, value) => Math.max(max, statusRank(value)), 0);
  const joined = values.map(slug).join(' ');
  const courier = shipment?.courier || order.courier || order.delivery || 'Courier';
  if (shipment?.cancelledAt || /cancel|failed|exception|return_to_sender|delivery_failed/.test(joined)) return { label: 'Delivery Exception', tone: 'danger', sub: courier };
  if (rank >= 5 || order.deliveredAt) return { label: 'Delivered', tone: 'success', sub: courier };
  if (rank === 4) return { label: 'Out for Delivery', tone: 'warning', sub: courier };
  if (rank >= 3) return { label: 'In Transit', tone: 'info', sub: courier };
  if (shipment?.firstScanAt || rank >= 2) return { label: 'Courier Accepted', tone: 'info', sub: courier };
  if (shipment?.trackingNo || order.tracking) return { label: 'AWB Created', tone: 'neutral', sub: courier };
  if (order.productionCompletedAt) return { label: 'Ready to Ship', tone: 'warning', sub: courier };
  if (order.productionApproved) return { label: 'In Production', tone: 'info', sub: courier };
  return { label: 'Order Received', tone: 'neutral', sub: courier };
}

function journeySteps(payload: FulfillmentPayload): Step[] {
  const { order, shipment, latestEvent } = payload;
  if (isPickup(order)) {
    return [
      { label: 'Order Received', done: true, at: order.createdAt },
      { label: 'Production Approved', done: Boolean(order.productionApproved || order.productionCompletedAt || order.pickupReadyAt || order.pickupCollectedAt) },
      { label: 'Production Completed', done: Boolean(order.productionCompletedAt || order.pickupReadyAt || order.pickupCollectedAt), at: order.productionCompletedAt },
      { label: 'Ready for Pickup', done: Boolean(order.pickupReadyAt || order.pickupCollectedAt), at: order.pickupReadyAt },
      { label: 'Customer Collected', done: Boolean(order.pickupCollectedAt), at: order.pickupCollectedAt },
    ];
  }
  const rank = [latestEvent?.normalizedStatus, latestEvent?.statusGroup, latestEvent?.status, shipment?.normalizedStatus, shipment?.statusGroup, shipment?.status]
    .reduce((max, value) => Math.max(max, statusRank(value)), 0);
  const delivered = Boolean(order.deliveredAt || shipment?.deliveredAt || rank >= 5);
  return [
    { label: 'Order Received', done: true, at: order.createdAt },
    { label: 'Production Completed', done: Boolean(order.productionCompletedAt || shipment), at: order.productionCompletedAt },
    { label: 'AWB Created', done: Boolean(shipment?.trackingNo || order.tracking), at: shipment?.bookedAt || shipment?.createdAt },
    { label: 'Courier First Scan', done: Boolean(shipment?.firstScanAt || rank >= 2), at: shipment?.firstScanAt, detail: shipment?.firstScanStatus },
    { label: 'In Transit', done: rank >= 3 || delivered },
    { label: 'Out for Delivery', done: rank >= 4 || delivered },
    { label: 'Delivered', done: delivered, at: order.deliveredAt || shipment?.deliveredAt },
  ];
}

function appendMeta(parent: HTMLElement, label: string, value: string, action?: HTMLElement) {
  const row = element('div', 'ful360-meta-row');
  row.append(element('span', '', label));
  const right = element('div', 'ful360-meta-value');
  right.append(element('b', '', value || '—'));
  if (action) right.append(action);
  row.append(right);
  parent.append(row);
}

function copyButton(value: string) {
  const button = element('button', 'ful360-copy', 'Copy');
  button.type = 'button';
  button.disabled = !value;
  button.addEventListener('click', async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = 'Copied ✓';
      window.setTimeout(() => { button.textContent = 'Copy'; }, 1200);
    } catch {
      button.textContent = 'Copy failed';
    }
  });
  return button;
}

function trackLink(url: string) {
  const link = element('a', 'ful360-track', 'Track parcel');
  link.href = url || '#';
  link.target = '_blank';
  link.rel = 'noreferrer';
  if (!url) {
    link.setAttribute('aria-disabled', 'true');
    link.addEventListener('click', (event) => event.preventDefault());
  }
  return link;
}

function renderFulfillment(card: HTMLElement, payload: FulfillmentPayload, orderRef: string, cacheAt: number) {
  const heading = element('h3', '', 'Fulfillment / Tracking');
  const root = element('div', 'ful360-root');
  root.dataset.fulfillment360 = 'true';

  const state = compactStatus(payload);
  const hero = element('div', `ful360-hero ${state.tone}`);
  const heroTop = element('div', 'ful360-hero-top');
  heroTop.append(element('span', 'ful360-dot'));
  const heroTitle = element('div', 'ful360-hero-title');
  heroTitle.append(element('b', '', state.label), element('small', '', state.sub));
  heroTop.append(heroTitle);
  hero.append(heroTop);
  root.append(hero);

  const meta = element('div', 'ful360-meta');
  if (isPickup(payload.order)) {
    appendMeta(meta, 'Payment', [payload.order.payment, payload.order.paymentMethod].filter(Boolean).join(' · '));
    appendMeta(meta, 'Stage', payload.order.fulfillmentStage || state.label);
  } else {
    const trackingNo = payload.shipment?.trackingNo || payload.order.tracking || '';
    const courier = payload.shipment?.courier || payload.order.courier || payload.order.delivery || '';
    const url = payload.shipment?.trackingLink || payload.order.trackingLink || '';
    appendMeta(meta, 'Courier', courier);
    const actions = element('div', 'ful360-inline-actions');
    actions.append(copyButton(trackingNo), trackLink(url));
    appendMeta(meta, 'Tracking No.', trackingNo, actions);
  }
  root.append(meta);

  const latest = payload.latestEvent;
  if (!isPickup(payload.order) && (latest || payload.shipment?.firstScanAt)) {
    const latestBox = element('div', 'ful360-latest');
    latestBox.append(element('div', 'ful360-section-title', 'Latest courier update'));
    latestBox.append(element('b', 'ful360-latest-headline', latest?.description || latest?.eventName || latest?.status || payload.shipment?.firstScanStatus || payload.shipment?.status || 'Courier update received'));
    const latestMeta = [latest?.location || '', formatDateTime(latest?.at || payload.shipment?.firstScanAt)].filter(Boolean).join(' · ');
    if (latestMeta) latestBox.append(element('small', '', latestMeta));
    root.append(latestBox);
  }

  const errors = [payload.shipment?.awbError, payload.shipment?.trackingMessageError].filter(Boolean) as string[];
  if (errors.length) {
    const warning = element('div', 'ful360-alert warning');
    errors.forEach((value) => warning.append(element('div', '', `⚠ ${value}`)));
    root.append(warning);
  }

  const details = element('details', 'ful360-details');
  details.append(element('summary', '', 'View order journey'));
  const journey = element('div', 'ful360-journey');
  const steps = journeySteps(payload);
  const firstOpen = steps.findIndex((step) => !step.done);
  steps.forEach((step, index) => {
    const row = element('div', `ful360-step ${step.done ? 'done' : index === firstOpen ? 'active' : 'future'}`);
    const marker = element('span', 'ful360-step-marker', step.done ? '✓' : index === firstOpen ? '●' : '○');
    const body = element('div', 'ful360-step-body');
    body.append(element('b', '', step.label));
    const metaText = [step.at ? formatDateTime(step.at) : '', step.detail || ''].filter(Boolean).join(' · ');
    if (metaText) body.append(element('small', '', metaText));
    row.append(marker, body);
    journey.append(row);
  });
  details.append(journey);
  if (!isPickup(payload.order) && payload.events?.length) {
    const eventList = element('div', 'ful360-events');
    payload.events.slice(0, 6).forEach((event) => {
      const row = element('div', 'ful360-event-row');
      const left = element('div');
      left.append(element('b', '', event.description || event.eventName || event.status || 'Shipment event'));
      if (event.location) left.append(element('small', '', event.location));
      row.append(left, element('small', '', formatDateTime(event.at)));
      eventList.append(row);
    });
    details.append(eventList);
  }
  root.append(details);

  card.replaceChildren(heading, root);
  card.dataset.fulfillmentCard = 'true';
  card.dataset.fulfillmentOrder = orderRef;
  card.dataset.fulfillmentVersion = String(cacheAt);
}

async function getPayload(orderRef: string, force = false) {
  const cached = cache.get(orderRef);
  if (!force && cached && Date.now() - cached.at < REFRESH_MS) return cached;
  const pending = inflight.get(orderRef);
  if (pending) return { at: cached?.at || Date.now(), data: await pending };
  const request = (async () => {
    const { data, error } = await supabase.rpc('icetak_admin_order_fulfillment_by_ref_v1', { p_order_ref: orderRef });
    if (error) throw error;
    if (!data) throw new Error('No fulfillment data');
    return data as FulfillmentPayload;
  })();
  inflight.set(orderRef, request);
  try {
    const data = await request;
    const result = { at: Date.now(), data };
    cache.set(orderRef, result);
    return result;
  } finally {
    inflight.delete(orderRef);
  }
}

async function enhanceFulfillment(force = false) {
  const { drawer, orderRef } = drawerContext();
  if (!drawer || !orderRef) return;
  cleanupLegacyFulfillment(drawer);

  const productionCard = findCard(drawer, 'Production');
  if (!productionCard) return;
  const grid = productionCard.parentElement as HTMLElement | null;
  if (!grid?.classList.contains('erp-drawer-grid')) return;

  const clickupCard = findCard(drawer, 'ClickUp Components');
  clickupCard?.classList.add('ful360-clickup-wide');

  let card = Array.from(grid.children).find((child) => (child as HTMLElement).dataset.fulfillmentCard === 'true') as HTMLElement | undefined;
  if (!card) {
    card = element('section', 'erp-drawer-card ful360-card');
    card.dataset.fulfillmentCard = 'true';
    card.append(element('h3', '', 'Fulfillment / Tracking'), element('div', 'ful360-loading', 'Loading live fulfillment…'));
    grid.insertBefore(card, clickupCard || productionCard.nextSibling);
  }

  const cached = cache.get(orderRef);
  if (!force && cached && card.dataset.fulfillmentOrder === orderRef && card.dataset.fulfillmentVersion === String(cached.at)) return;

  try {
    const result = await getPayload(orderRef, force);
    const live = drawerContext();
    if (!live.drawer || live.orderRef !== orderRef || !document.body.contains(card)) return;
    renderFulfillment(card, result.data, orderRef, result.at);
  } catch (error) {
    card.replaceChildren(element('h3', '', 'Fulfillment / Tracking'));
    const root = element('div', 'ful360-root');
    root.dataset.fulfillment360 = 'true';
    root.append(element('div', 'ful360-alert danger', `Unable to load tracking: ${error instanceof Error ? error.message : String(error)}`));
    card.append(root);
  }
}

function kvText(card: HTMLElement, label: string) {
  for (const row of Array.from(card.querySelectorAll<HTMLElement>('.erp-kv'))) {
    const key = row.querySelector('span')?.textContent?.trim().toLowerCase();
    if (key === label.toLowerCase()) return row.querySelector('b')?.textContent?.trim() || '';
  }
  return '';
}

function methodValue(current: string) {
  const value = slug(current);
  if (value.includes('bank') || value.includes('duitnow') || value.includes('online_banking')) return 'bank_transfer';
  if (value.includes('cash') || value.includes('counter') || value.includes('pickup')) return 'cash_at_counter';
  if (value.includes('card')) return 'card';
  if (value.includes('qr')) return 'qr_pay_manual';
  return 'other';
}

function isPaymentPaid(card: HTMLElement) {
  const status = slug(kvText(card, 'Status'));
  const paidAt = kvText(card, 'Paid At');
  return ['paid', 'matched', 'payment_received', 'success', 'completed'].includes(status) || Boolean(paidAt && paidAt !== '—' && paidAt !== '-');
}

function setRecoveryMessage(box: HTMLElement, message: string, tone: 'success' | 'error' | 'neutral' = 'neutral') {
  box.textContent = message;
  box.className = `payrec-message ${tone}`;
}

function enhancePaymentRecovery() {
  const { drawer, orderRef } = drawerContext();
  if (!drawer || !orderRef) return;
  const card = findCard(drawer, 'Payment Summary');
  if (!card) return;
  if (card.querySelector('[data-manual-payment-recovery]')) return;

  const wrap = element('div', 'payrec-wrap');
  wrap.dataset.manualPaymentRecovery = 'true';
  wrap.append(element('div', 'payrec-title', 'Manual Payment Recovery'));
  wrap.append(element('p', 'payrec-note', 'Guna bila QRPay webhook / automation gagal tetapi bayaran customer sudah disahkan secara manual. Semua tindakan direkod dalam audit log.'));

  const selectLabel = element('label', 'payrec-field');
  selectLabel.append(element('span', '', 'Payment method'));
  const select = element('select', 'payrec-select') as HTMLSelectElement;
  [
    ['qr_pay_manual', 'QR Pay (Manual)'],
    ['bank_transfer', 'Bank Transfer'],
    ['cash_at_counter', 'Cash at Counter'],
    ['card', 'Card'],
    ['other', 'Other'],
  ].forEach(([value, label]) => {
    const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option);
  });
  select.value = methodValue(kvText(card, 'Method'));
  selectLabel.append(select);

  const referenceLabel = element('label', 'payrec-field');
  referenceLabel.append(element('span', '', 'Reference / note (optional)'));
  const reference = element('input', 'payrec-input') as HTMLInputElement;
  reference.type = 'text';
  reference.maxLength = 180;
  reference.placeholder = 'contoh: receipt checked / DuitNow ref';
  referenceLabel.append(reference);

  const actions = element('div', 'payrec-actions');
  const saveMethod = element('button', 'btn btn-outline btn-sm', 'Save Payment Method') as HTMLButtonElement;
  saveMethod.type = 'button';
  const confirmPaid = element('button', 'btn btn-primary btn-sm', 'Mark Paid Manually') as HTMLButtonElement;
  confirmPaid.type = 'button';
  const paid = isPaymentPaid(card);
  if (paid) {
    confirmPaid.disabled = true;
    confirmPaid.textContent = 'Already Paid';
  }
  actions.append(saveMethod, confirmPaid);
  const message = element('div', 'payrec-message neutral');

  const callOverride = async (action: 'set_method' | 'confirm_paid') => {
    saveMethod.disabled = true;
    confirmPaid.disabled = true;
    setRecoveryMessage(message, action === 'confirm_paid' ? 'Confirming payment…' : 'Saving payment method…');
    const { data, error } = await supabase.rpc('icetak_admin_payment_override_v1', {
      p_payload: {
        order_id: orderRef,
        action,
        payment_method: select.value,
        reference: reference.value.trim() || null,
      },
    });
    if (error) {
      saveMethod.disabled = false;
      confirmPaid.disabled = paid;
      setRecoveryMessage(message, error.message, 'error');
      return;
    }
    const result = (data || {}) as { already_paid?: boolean };
    setRecoveryMessage(message, result.already_paid ? 'Order memang sudah Paid. Payment method telah dikemaskini.' : action === 'confirm_paid' ? 'Payment confirmed. Production release sedang diproses.' : 'Payment method saved.', 'success');
    window.setTimeout(() => window.location.reload(), 700);
  };

  saveMethod.addEventListener('click', () => { void callOverride('set_method'); });
  confirmPaid.addEventListener('click', () => {
    const total = kvText(card, 'Total') || 'order total';
    const label = select.options[select.selectedIndex]?.textContent || select.value;
    if (!window.confirm(`Confirm customer sudah bayar ${total} melalui ${label}?\n\nIni akan mark order Paid dan boleh release production ikut approval rule.`)) return;
    void callOverride('confirm_paid');
  });

  wrap.append(selectLabel, referenceLabel, actions, message);
  card.append(wrap);
}

let queued = false;
function scheduleEnhance() {
  if (queued) return;
  queued = true;
  window.requestAnimationFrame(() => {
    queued = false;
    const { drawer } = drawerContext();
    if (!drawer) return;
    cleanupLegacyFulfillment(drawer);
    enhancePaymentRecovery();
    void enhanceFulfillment(false);
  });
}

const observer = new MutationObserver(scheduleEnhance);
function start() {
  const root = document.getElementById('root');
  if (!root) return;
  observer.observe(root, { childList: true, subtree: true });
  scheduleEnhance();
  window.setInterval(() => { void enhanceFulfillment(true); }, REFRESH_MS);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
