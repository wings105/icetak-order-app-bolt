type TrackingEvent = {
  status?: string | null;
  status_group?: string | null;
  normalized_status?: string | null;
  event_name?: string | null;
  event_time?: string | null;
  location?: string | null;
  description?: string | null;
};

type TrackingShipment = {
  courier?: string | null;
  tracking_no?: string | null;
  tracking_link?: string | null;
  status?: string | null;
  status_group?: string | null;
  normalized_status?: string | null;
  updated_at?: string | null;
  shipped_at?: string | null;
  delivered_at?: string | null;
};

type TrackingResponse = {
  success?: boolean;
  shipment?: TrackingShipment;
  events?: TrackingEvent[];
};

const API_BASE = 'https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/tracking';
const REFRESH_INTERVAL_MS = 60_000;
const token = new URLSearchParams(window.location.search).get('tracking')?.trim() || '';
const root = document.querySelector<HTMLDivElement>('#app');

if (!root) throw new Error('Tracking root is unavailable');

document.title = 'Tracking Parcel | DecoCake.my';
document.documentElement.classList.add('tracking-page-active');

autoInstallStyles();
renderShell();
void loadTracking();
window.setInterval(() => void loadTracking(true), REFRESH_INTERVAL_MS);

function autoInstallStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .tracking-page-active, .tracking-page-active body { min-height: 100%; background: #f5f7fb; }
    .tracking-page-active body { margin: 0; color: #172033; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .tracking-shell { width: min(760px, 100%); margin: 0 auto; padding: 24px 16px 48px; }
    .tracking-brand { display: flex; align-items: center; gap: 11px; margin: 4px 0 20px; }
    .tracking-logo { width: 44px; height: 44px; border-radius: 14px; display: grid; place-items: center; background: #172033; color: #fff; font-weight: 900; letter-spacing: -.03em; }
    .tracking-brand strong { display: block; font-size: 18px; }
    .tracking-brand span, .tracking-muted { color: #687386; font-size: 13px; }
    .tracking-card { background: #fff; border: 1px solid #e6eaf0; border-radius: 20px; box-shadow: 0 10px 30px rgba(25,39,70,.07); padding: 20px; margin-bottom: 14px; }
    .tracking-loading, .tracking-empty { min-height: 220px; display: grid; place-items: center; text-align: center; }
    .tracking-spinner { width: 34px; height: 34px; border: 3px solid #e1e6ef; border-top-color: #ee4d2d; border-radius: 50%; animation: tracking-spin .8s linear infinite; margin: 0 auto 12px; }
    @keyframes tracking-spin { to { transform: rotate(360deg); } }
    .tracking-status { display: inline-flex; padding: 7px 11px; border-radius: 999px; background: #fff1ed; color: #bd351d; font-size: 13px; font-weight: 800; }
    .tracking-title { margin: 14px 0 8px; font-size: clamp(24px, 6vw, 30px); line-height: 1.15; }
    .tracking-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; margin-top: 18px; }
    .tracking-item { min-width: 0; padding: 13px; border-radius: 14px; background: #f7f9fc; }
    .tracking-item small { display: block; color: #7b8595; margin-bottom: 5px; }
    .tracking-item strong { display: block; overflow-wrap: anywhere; }
    .tracking-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
    .tracking-btn { border: 0; border-radius: 12px; padding: 11px 14px; background: #172033; color: #fff; text-decoration: none; font: inherit; font-weight: 800; cursor: pointer; }
    .tracking-btn-secondary { background: #edf1f6; color: #172033; }
    .tracking-section-title { margin: 0 0 18px; font-size: 20px; }
    .tracking-timeline { list-style: none; padding: 0; margin: 0; }
    .tracking-event { position: relative; padding: 0 0 22px 30px; }
    .tracking-event::before { content: ""; position: absolute; left: 6px; top: 7px; width: 10px; height: 10px; border-radius: 50%; background: #ee4d2d; }
    .tracking-event::after { content: ""; position: absolute; left: 10px; top: 20px; bottom: 2px; width: 2px; background: #dfe4ec; }
    .tracking-event:last-child::after { display: none; }
    .tracking-event h3 { margin: 0 0 5px; font-size: 15px; }
    .tracking-event p { margin: 3px 0; color: #687386; font-size: 14px; }
    .tracking-live { display: inline-flex; align-items: center; gap: 7px; color: #557064; font-size: 12px; margin-top: 10px; }
    .tracking-live::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: #27a66d; }
    @media (max-width: 560px) { .tracking-grid { grid-template-columns: 1fr; } .tracking-shell { padding-top: 16px; } }
  `;
  document.head.appendChild(style);
}

function renderShell() {
  root.innerHTML = `
    <main class="tracking-shell">
      <header class="tracking-brand">
        <div class="tracking-logo">DC</div>
        <div><strong>DecoCake.my Tracking</strong><span>Status penghantaran terkini</span></div>
      </header>
      <section id="trackingSummary" class="tracking-card tracking-loading" aria-live="polite">
        <div><div class="tracking-spinner"></div><p class="tracking-muted">Memuatkan tracking...</p></div>
      </section>
      <section id="trackingTimeline" class="tracking-card" hidden></section>
    </main>
  `;
}

async function loadTracking(silent = false) {
  const summary = document.querySelector<HTMLElement>('#trackingSummary');
  const timeline = document.querySelector<HTMLElement>('#trackingTimeline');
  if (!summary || !timeline) return;

  if (!isUuid(token)) {
    renderError(summary, timeline, 'Pautan tracking tidak sah', 'Sila buka semula pautan yang dihantar melalui WhatsApp.');
    return;
  }

  try {
    const response = await fetch(`${API_BASE}?token=${encodeURIComponent(token)}&format=json`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    const payload = await response.json() as TrackingResponse;
    if (!response.ok || payload.success === false || !payload.shipment) {
      renderError(summary, timeline, 'Tracking tidak dijumpai', 'Semak semula pautan tracking anda.');
      return;
    }
    renderTracking(summary, timeline, payload, silent);
  } catch {
    if (!silent) renderError(summary, timeline, 'Tidak dapat memuatkan tracking', 'Cuba refresh sebentar lagi.');
  }
}

function renderTracking(summary: HTMLElement, timeline: HTMLElement, payload: TrackingResponse, silent: boolean) {
  const shipment = payload.shipment || {};
  const events = [...(payload.events || [])].sort((a, b) => dateValue(b.event_time) - dateValue(a.event_time));

  summary.className = 'tracking-card';
  summary.replaceChildren();

  const badge = node('span', 'tracking-status', statusLabel(shipment.normalized_status || shipment.status_group));
  const title = node('h1', 'tracking-title', shipment.status || statusLabel(shipment.normalized_status || shipment.status_group));
  const updated = node('p', 'tracking-muted', `Dikemas kini ${formatDate(shipment.updated_at)}`);
  const grid = node('div', 'tracking-grid');
  grid.append(
    infoItem('Courier', shipment.courier || '-'),
    infoItem('No. tracking', shipment.tracking_no || '-'),
    infoItem('Tarikh pickup', formatDate(shipment.shipped_at)),
    infoItem('Tarikh sampai', formatDate(shipment.delivered_at)),
  );

  const actions = node('div', 'tracking-actions');
  if (shipment.tracking_link) {
    const link = node('a', 'tracking-btn', 'Buka laman courier') as HTMLAnchorElement;
    link.href = shipment.tracking_link;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    actions.append(link);
  }
  const refresh = node('button', 'tracking-btn tracking-btn-secondary', 'Refresh status') as HTMLButtonElement;
  refresh.type = 'button';
  refresh.addEventListener('click', () => void loadTracking());
  actions.append(refresh);

  const live = node('div', 'tracking-live', 'Auto refresh setiap 1 minit');
  summary.append(badge, title, updated, grid, actions, live);

  timeline.hidden = false;
  timeline.replaceChildren(node('h2', 'tracking-section-title', 'Perjalanan parcel'));
  const list = node('ol', 'tracking-timeline');
  if (!events.length) {
    list.append(node('p', 'tracking-muted', 'Belum ada scan courier.'));
  } else {
    for (const event of events) {
      const item = node('li', 'tracking-event');
      item.append(
        node('h3', '', event.status || statusLabel(event.normalized_status || event.status_group) || event.event_name || 'Shipment update'),
        node('p', '', formatDate(event.event_time)),
      );
      if (event.location) item.append(node('p', '', event.location));
      if (event.description) item.append(node('p', '', event.description));
      list.append(item);
    }
  }
  timeline.append(list);

  if (!silent) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderError(summary: HTMLElement, timeline: HTMLElement, title: string, message: string) {
  timeline.hidden = true;
  summary.className = 'tracking-card tracking-empty';
  const wrap = node('div');
  wrap.append(node('h2', '', title), node('p', 'tracking-muted', message));
  summary.replaceChildren(wrap);
}

function infoItem(label: string, value: string) {
  const item = node('div', 'tracking-item');
  item.append(node('small', '', label), node('strong', '', value));
  return item;
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('ms-MY', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kuala_Lumpur',
  }).format(date);
}

function dateValue(value?: string | null) {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function statusLabel(value?: string | null) {
  const key = String(value || 'unknown').toLowerCase();
  const labels: Record<string, string> = {
    awb_created: 'Tempahan penghantaran diterima',
    shipment_created: 'Menunggu pickup',
    picked_up: 'Parcel diambil courier',
    in_transit: 'Dalam perjalanan',
    out_for_delivery: 'Sedang dihantar',
    delivery_exception: 'Isu penghantaran',
    returning: 'Dipulangkan',
    delivered: 'Telah sampai',
    cancelled: 'Dibatalkan',
    unknown: 'Status penghantaran',
  };
  return labels[key] || key.replaceAll('_', ' ');
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
