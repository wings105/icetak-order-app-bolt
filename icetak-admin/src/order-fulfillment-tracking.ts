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
  customerConfirmedAt: string | null;
  createdAt: string | null;
  productionCompletedAt: string | null;
  pickupReadyAt: string | null;
  pickupCollectedAt: string | null;
  deliveredAt: string | null;
  updatedAt: string | null;
};

type Shipment = {
  id: string;
  trackingNo: string;
  courier: string;
  trackingLink: string;
  connoteUrl: string;
  status: string;
  statusGroup: string;
  normalizedStatus: string;
  awbStatus: string;
  awbError: string;
  bookedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  provider: string;
  serviceProvider: string;
  recipientName: string;
  recipientPhone: string;
  firstScanAt: string | null;
  firstScanStatus: string;
  sendStatus: string;
  trackingMessageSentAt: string | null;
  trackingMessageError: string;
};

type ShipmentEvent = {
  id: string;
  status: string;
  statusGroup: string;
  normalizedStatus: string;
  eventName: string;
  at: string | null;
  location: string;
  description: string;
  courier: string;
  source: string;
  provider: string;
};

type FulfillmentPayload = {
  ok: boolean;
  order: OrderLifecycle;
  shipment: Shipment | null;
  latestEvent: ShipmentEvent | null;
  events: ShipmentEvent[];
};

type StatusView = { label: string; tone: 'success' | 'info' | 'warning' | 'danger' | 'neutral'; sub?: string };

type Step = { label: string; done: boolean; at?: string | null; detail?: string };

const cache = new Map<string, { at: number; data: FulfillmentPayload }>();
const inflight = new Map<string, Promise<FulfillmentPayload>>();
const REFRESH_MS = 30_000;

const slug = (value: unknown) => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const isPickup = (order: OrderLifecycle) => slug(order.delivery).includes('pickup');
const isPaid = (order: OrderLifecycle) => ['paid', 'matched', 'payment_received'].includes(slug(order.payment));

const formatDateTime = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-MY', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kuala_Lumpur',
  }).format(date);
};

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

function statusRank(value: unknown) {
  const v = slug(value);
  if (['delivered', 'completed'].includes(v)) return 5;
  if (['out_for_delivery', 'delivering'].includes(v)) return 4;
  if (['in_transit', 'picked_up', 'accepted_by_courier', 'shipped'].includes(v)) return 3;
  if (['first_scan', 'accepted', 'collected_by_courier'].includes(v)) return 2;
  if (['shipment_created', 'awb_created', 'pending_pickup', 'pending'].includes(v)) return 1;
  return 0;
}

function courierStatus(payload: FulfillmentPayload): StatusView {
  const shipment = payload.shipment;
  const event = payload.latestEvent;
  const values = [event?.normalizedStatus, event?.statusGroup, event?.status, shipment?.normalizedStatus, shipment?.statusGroup, shipment?.status]
    .map(slug).filter(Boolean);
  const joined = values.join(' ');

  if (shipment?.cancelledAt || /cancel|failed|exception|return_to_sender|delivery_failed/.test(joined)) {
    return { label: 'Delivery Exception', tone: 'danger', sub: event?.description || event?.status || shipment?.status || 'Shipment needs attention' };
  }
  if (values.some((v) => statusRank(v) >= 5)) return { label: 'Delivered', tone: 'success' };
  if (values.some((v) => statusRank(v) === 4)) return { label: 'Out for Delivery', tone: 'warning' };
  if (values.some((v) => statusRank(v) === 3)) return { label: 'In Transit', tone: 'info' };
  if (shipment?.firstScanAt) return { label: 'Courier Accepted', tone: 'info' };
  if (shipment?.trackingNo || payload.order.tracking) return { label: 'AWB Created · Waiting Courier', tone: 'neutral' };
  if (payload.order.productionCompletedAt) return { label: 'Ready to Ship · Waiting AWB', tone: 'warning' };
  if (payload.order.productionApproved) return { label: 'In Production', tone: 'info' };
  return { label: 'Order Received', tone: 'neutral' };
}

function pickupStatus(order: OrderLifecycle): StatusView {
  const stage = slug(order.fulfillmentStage);
  if (order.pickupCollectedAt || stage === 'collected') return { label: 'Customer Collected', tone: 'success' };
  if (order.pickupReadyAt || stage === 'ready_for_pickup') return { label: 'Ready for Pickup', tone: 'success' };
  if (order.productionCompletedAt) return { label: 'Production Completed', tone: 'info' };
  if (order.productionApproved) return { label: 'In Production', tone: 'info' };
  if (order.customerConfirmed) return { label: 'Order Confirmed', tone: 'neutral' };
  return { label: 'Order Received', tone: 'neutral' };
}

function statusFor(payload: FulfillmentPayload) {
  return isPickup(payload.order) ? pickupStatus(payload.order) : courierStatus(payload);
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
      window.setTimeout(() => { button.textContent = 'Copy'; }, 1600);
    } catch {
      button.textContent = 'Copy failed';
      window.setTimeout(() => { button.textContent = 'Copy'; }, 1600);
    }
  });
  return button;
}

function trackingLink(value: string) {
  const link = element('a', 'ful360-track', 'Track parcel');
  link.href = value || '#';
  link.target = '_blank';
  link.rel = 'noreferrer';
  if (!value) {
    link.setAttribute('aria-disabled', 'true');
    link.addEventListener('click', (event) => event.preventDefault());
  }
  return link;
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

  const rawStatuses = [latestEvent?.normalizedStatus, latestEvent?.statusGroup, latestEvent?.status, shipment?.normalizedStatus, shipment?.statusGroup, shipment?.status];
  const rank = rawStatuses.reduce((max, value) => Math.max(max, statusRank(value)), 0);
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

function renderJourney(parent: HTMLElement, steps: Step[]) {
  const wrap = element('div', 'ful360-journey');
  wrap.append(element('div', 'ful360-section-title', 'Order journey'));
  const firstOpen = steps.findIndex((step) => !step.done);
  steps.forEach((step, index) => {
    const row = element('div', `ful360-step ${step.done ? 'done' : index === firstOpen ? 'active' : 'future'}`);
    const marker = element('span', 'ful360-step-marker', step.done ? '✓' : index === firstOpen ? '●' : '○');
    const body = element('div', 'ful360-step-body');
    body.append(element('b', '', step.label));
    const meta = [step.at ? formatDateTime(step.at) : '', step.detail || ''].filter(Boolean).join(' · ');
    if (meta) body.append(element('small', '', meta));
    row.append(marker, body);
    wrap.append(row);
  });
  parent.append(wrap);
}

function latestUpdate(parent: HTMLElement, payload: FulfillmentPayload) {
  const event = payload.latestEvent;
  const shipment = payload.shipment;
  if (!event && !shipment?.firstScanAt) return;
  const box = element('div', 'ful360-latest');
  box.append(element('div', 'ful360-section-title', 'Latest courier update'));
  const headline = event?.description || event?.eventName || event?.status || shipment?.firstScanStatus || shipment?.status || 'Courier scan received';
  box.append(element('b', 'ful360-latest-headline', headline));
  if (event?.location) box.append(element('div', 'ful360-location', `📍 ${event.location}`));
  const at = event?.at || shipment?.firstScanAt || shipment?.updatedAt;
  if (at) box.append(element('small', '', formatDateTime(at)));
  parent.append(box);
}

function warningBox(parent: HTMLElement, payload: FulfillmentPayload) {
  const shipment = payload.shipment;
  const status = statusFor(payload);
  const messages: string[] = [];
  if (shipment?.awbError) messages.push(`AWB: ${shipment.awbError}`);
  if (shipment?.trackingMessageError) messages.push(`Tracking WhatsApp: ${shipment.trackingMessageError}`);
  if (status.tone === 'danger' && status.sub) messages.push(status.sub);
  if (shipment?.trackingNo && !shipment.firstScanAt && !shipment.cancelledAt) messages.push('AWB sudah dibuat tetapi courier belum ada first scan.');
  if (!messages.length) return;
  const box = element('div', `ful360-alert ${status.tone === 'danger' ? 'danger' : 'warning'}`);
  messages.forEach((message) => box.append(element('div', '', `⚠ ${message}`)));
  parent.append(box);
}

function render(card: HTMLElement, payload: FulfillmentPayload, orderRef: string) {
  card.classList.add('erp-fulfillment-enhanced');
  card.dataset.fulfillmentOrder = orderRef;
  const heading = card.querySelector(':scope > h3');
  if (heading && heading.textContent !== 'Fulfillment / Tracking') heading.textContent = 'Fulfillment / Tracking';

  card.querySelector('[data-fulfillment-360]')?.remove();
  const root = element('div', 'ful360-root');
  root.dataset.fulfillment360 = 'true';

  const state = statusFor(payload);
  const hero = element('div', `ful360-hero ${state.tone}`);
  const heroTop = element('div', 'ful360-hero-top');
  heroTop.append(element('span', 'ful360-dot'));
  const title = element('div', 'ful360-hero-title');
  title.append(element('b', '', state.label));
  const deliveryLabel = isPickup(payload.order) ? 'Pickup' : (payload.shipment?.courier || payload.order.courier || payload.order.delivery || 'Courier');
  title.append(element('small', '', deliveryLabel));
  heroTop.append(title);
  hero.append(heroTop);

  if (isPickup(payload.order)) {
    if (payload.order.pickupCollectedAt) hero.append(element('div', 'ful360-hero-time', `Collected ${formatDateTime(payload.order.pickupCollectedAt)}`));
    else if (payload.order.pickupReadyAt) hero.append(element('div', 'ful360-hero-time', `Ready since ${formatDateTime(payload.order.pickupReadyAt)}`));
    else if (payload.order.productionCompletedAt) hero.append(element('div', 'ful360-hero-time', `Production completed ${formatDateTime(payload.order.productionCompletedAt)}`));
  } else if (payload.latestEvent?.at) {
    hero.append(element('div', 'ful360-hero-time', `Updated ${formatDateTime(payload.latestEvent.at)}`));
  }
  root.append(hero);

  const meta = element('div', 'ful360-meta');
  if (isPickup(payload.order)) {
    appendMeta(meta, 'Payment', [payload.order.payment, payload.order.paymentMethod].filter(Boolean).join(' · '));
    appendMeta(meta, 'Fulfillment', pickupStatus(payload.order).label);
  } else {
    const trackingNo = payload.shipment?.trackingNo || payload.order.tracking || '';
    const courier = payload.shipment?.courier || payload.order.courier || payload.order.delivery || '';
    const url = payload.shipment?.trackingLink || payload.order.trackingLink || '';
    appendMeta(meta, 'Courier', courier);
    const actions = element('div', 'ful360-inline-actions');
    actions.append(copyButton(trackingNo), trackingLink(url));
    appendMeta(meta, 'Tracking No.', trackingNo, actions);
    if (payload.shipment?.firstScanAt) appendMeta(meta, 'First scan', formatDateTime(payload.shipment.firstScanAt));
  }
  root.append(meta);

  warningBox(root, payload);
  if (!isPickup(payload.order)) latestUpdate(root, payload);
  renderJourney(root, journeySteps(payload));

  if (!isPickup(payload.order) && payload.events?.length) {
    const details = element('details', 'ful360-events');
    const summary = element('summary', '', `Courier event history (${payload.events.length})`);
    details.append(summary);
    payload.events.slice(0, 8).forEach((event) => {
      const row = element('div', 'ful360-event-row');
      const text = event.description || event.eventName || event.status || event.normalizedStatus || 'Shipment event';
      const left = element('div');
      left.append(element('b', '', text));
      if (event.location) left.append(element('small', '', event.location));
      row.append(left, element('small', '', formatDateTime(event.at)));
      details.append(row);
    });
    root.append(details);
  }

  card.append(root);
}

function renderLoading(card: HTMLElement, orderRef: string) {
  card.classList.add('erp-fulfillment-enhanced');
  card.dataset.fulfillmentOrder = orderRef;
  const heading = card.querySelector(':scope > h3');
  if (heading) heading.textContent = 'Fulfillment / Tracking';
  card.querySelector('[data-fulfillment-360]')?.remove();
  const root = element('div', 'ful360-root ful360-loading', 'Loading live fulfillment…');
  root.dataset.fulfillment360 = 'true';
  card.append(root);
}

function renderError(card: HTMLElement, orderRef: string, message: string) {
  card.classList.add('erp-fulfillment-enhanced');
  card.dataset.fulfillmentOrder = orderRef;
  card.querySelector('[data-fulfillment-360]')?.remove();
  const root = element('div', 'ful360-root');
  root.dataset.fulfillment360 = 'true';
  const box = element('div', 'ful360-alert danger', `Unable to load live tracking: ${message}`);
  root.append(box);
  card.append(root);
}

async function getPayload(orderRef: string, force = false) {
  const cached = cache.get(orderRef);
  if (!force && cached && Date.now() - cached.at < REFRESH_MS) return cached.data;
  const pending = inflight.get(orderRef);
  if (pending) return pending;

  const request = (async () => {
    const { data, error } = await supabase.rpc('icetak_admin_order_fulfillment_by_ref_v1', { p_order_ref: orderRef });
    if (error) throw error;
    const payload = data as FulfillmentPayload;
    cache.set(orderRef, { at: Date.now(), data: payload });
    return payload;
  })();
  inflight.set(orderRef, request);
  try { return await request; }
  finally { inflight.delete(orderRef); }
}

async function enhance(force = false) {
  const drawer = document.querySelector<HTMLElement>('.erp-order-drawer');
  if (!drawer) return;
  const orderRef = drawer.querySelector<HTMLElement>('.erp-drawer-title h2')?.textContent?.trim() || '';
  if (!orderRef) return;
  const cards = Array.from(drawer.querySelectorAll<HTMLElement>('.erp-drawer-card'));
  const card = cards.find((candidate) => candidate.querySelector(':scope > h3')?.textContent?.trim().toLowerCase().startsWith('fulfillment'));
  if (!card) return;

  const current = cache.get(orderRef);
  const existing = card.querySelector('[data-fulfillment-360]');
  if (!force && existing && card.dataset.fulfillmentOrder === orderRef && current && Date.now() - current.at < REFRESH_MS) return;
  if (current && !force) render(card, current.data, orderRef);
  else renderLoading(card, orderRef);

  try {
    const payload = await getPayload(orderRef, force);
    const liveDrawer = document.querySelector<HTMLElement>('.erp-order-drawer');
    const liveRef = liveDrawer?.querySelector<HTMLElement>('.erp-drawer-title h2')?.textContent?.trim() || '';
    if (liveRef !== orderRef) return;
    const liveCards = Array.from(liveDrawer?.querySelectorAll<HTMLElement>('.erp-drawer-card') || []);
    const liveCard = liveCards.find((candidate) => candidate.querySelector(':scope > h3')?.textContent?.trim().toLowerCase().startsWith('fulfillment'));
    if (liveCard) render(liveCard, payload, orderRef);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'Unknown error');
    renderError(card, orderRef, message);
  }
}

let queued = false;
const scheduleEnhance = () => {
  if (queued) return;
  queued = true;
  window.requestAnimationFrame(() => {
    queued = false;
    void enhance(false);
  });
};

const observer = new MutationObserver(scheduleEnhance);
const start = () => {
  const root = document.getElementById('root');
  if (!root) return;
  observer.observe(root, { childList: true, subtree: true });
  scheduleEnhance();
  window.setInterval(() => {
    if (document.querySelector('.erp-order-drawer')) void enhance(true);
  }, REFRESH_MS);
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
