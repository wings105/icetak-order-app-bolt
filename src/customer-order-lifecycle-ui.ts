import { api, supabase } from './appdeploy-client';

type PreviewComponent = {
  label: string;
  previewUrl: string;
};

type PreviewItem = {
  title: string;
  previewUrl: string;
  components: PreviewComponent[];
};

const previewCache = new Map<string, PreviewItem[]>();
let previewLoadingToken = '';

function normalizeLifecycleValue(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function selectedOrderToken() {
  return new URL(location.href).searchParams.get('order') || '';
}

function addLifecycleNote(card: HTMLElement, key: string, message: string, warning = false) {
  if (card.querySelector(`[data-lifecycle-note="${key}"]`)) return;
  const note = document.createElement('p');
  note.dataset.lifecycleNote = key;
  note.textContent = message;
  if (warning) {
    Object.assign(note.style, {
      padding: '10px 12px',
      borderRadius: '10px',
      background: '#fff3cd',
      color: '#7a4b00',
      fontWeight: '700',
    });
  }
  card.append(note);
}

function showLifecycleToast(message: string, isError = false) {
  document.querySelector('[data-customer-lifecycle-toast]')?.remove();
  const toast = document.createElement('div');
  toast.dataset.customerLifecycleToast = '1';
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed',
    left: '50%',
    bottom: '24px',
    transform: 'translateX(-50%)',
    zIndex: '99999',
    maxWidth: 'calc(100vw - 32px)',
    padding: '12px 16px',
    borderRadius: '12px',
    background: isError ? '#b42318' : '#157f3b',
    color: '#fff',
    fontWeight: '700',
    textAlign: 'center',
    boxShadow: '0 8px 28px rgba(0,0,0,.22)',
  });
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 3200);
}

function openPreviewLightbox(url: string, title = 'Preview design') {
  if (!url) return;
  document.querySelector('[data-preview-lightbox]')?.remove();

  const overlay = document.createElement('div');
  overlay.dataset.previewLightbox = '1';
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '100000',
    background: 'rgba(0,0,0,.76)',
    display: 'grid',
    placeItems: 'center',
    padding: '14px',
  });

  const card = document.createElement('section');
  Object.assign(card.style, {
    width: 'min(100%, 960px)',
    maxHeight: 'calc(100vh - 28px)',
    background: '#fff',
    borderRadius: '16px',
    overflow: 'hidden',
    display: 'grid',
    gridTemplateRows: 'auto 1fr',
    boxShadow: '0 24px 80px rgba(0,0,0,.35)',
  });

  const header = document.createElement('header');
  Object.assign(header.style, {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    padding: '13px 15px',
    borderBottom: '1px solid #e5e7eb',
  });

  const heading = document.createElement('b');
  heading.textContent = title;
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '✕';
  Object.assign(close.style, {
    width: '36px',
    height: '36px',
    border: '0',
    borderRadius: '999px',
    background: '#eef2f7',
    fontSize: '18px',
    cursor: 'pointer',
  });

  const body = document.createElement('div');
  Object.assign(body.style, {
    overflow: 'auto',
    display: 'grid',
    placeItems: 'center',
    padding: '12px',
    background: '#f8fafc',
  });

  const image = document.createElement('img');
  image.src = url;
  image.alt = title;
  Object.assign(image.style, {
    display: 'block',
    maxWidth: '100%',
    maxHeight: 'calc(100vh - 120px)',
    objectFit: 'contain',
    borderRadius: '10px',
    background: '#fff',
  });

  header.append(heading, close);
  body.append(image);
  card.append(header, body);
  overlay.append(card);
  document.body.append(overlay);

  const destroy = () => overlay.remove();
  close.onclick = destroy;
  overlay.onclick = (event) => {
    if (event.target === overlay) destroy();
  };
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') destroy();
  }, { once: true });
}

function enhanceDesignPreviews(detail: HTMLElement) {
  detail.querySelectorAll<HTMLElement>('.cp-review-panel').forEach((panel) => {
    const sourceLink = panel.querySelector<HTMLAnchorElement>('a[href]');
    if (!sourceLink || panel.querySelector('[data-design-preview-image]')) return;

    const previewLink = document.createElement('a');
    previewLink.dataset.designPreviewImage = '1';
    previewLink.href = sourceLink.href;
    previewLink.setAttribute('aria-label', 'Buka design penuh');
    Object.assign(previewLink.style, {
      display: 'block',
      gridColumn: '1 / -1',
      width: '100%',
      marginBottom: '10px',
      borderRadius: '12px',
      overflow: 'hidden',
      background: '#f8fafc',
      border: '1px solid #e2e8f0',
    });

    const image = document.createElement('img');
    image.src = sourceLink.href;
    image.alt = 'Design untuk semakan';
    image.loading = 'eager';
    Object.assign(image.style, {
      display: 'block',
      width: '100%',
      maxHeight: '420px',
      objectFit: 'contain',
      background: '#fff',
    });
    image.onerror = () => previewLink.remove();
    previewLink.append(image);
    previewLink.onclick = (event) => {
      event.preventDefault();
      openPreviewLightbox(sourceLink.href, 'Design untuk semakan');
    };

    panel.prepend(previewLink);
    sourceLink.textContent = 'Buka Design Penuh';
    sourceLink.onclick = (event) => {
      event.preventDefault();
      openPreviewLightbox(sourceLink.href, 'Design untuk semakan');
    };
  });
}

async function loadPreviewItems(orderToken: string): Promise<PreviewItem[]> {
  const cached = previewCache.get(orderToken);
  if (cached?.some((item) => item.previewUrl || item.components.some((component) => component.previewUrl))) {
    return cached;
  }
  if (previewLoadingToken === orderToken) return cached || [];

  previewLoadingToken = orderToken;
  try {
    const response: any = await api.get(`/api/orders/${encodeURIComponent(orderToken)}`);
    const payload = response?.data ?? response;
    const order = payload?.order ?? payload?.data?.order;
    const rawItems = Array.isArray(order?.items) ? order.items : [];
    const items: PreviewItem[] = rawItems.map((item: any) => {
      const components = Array.isArray(item?.components) ? item.components : [];
      const mappedComponents: PreviewComponent[] = components.map((component: any) => ({
        label: String(component?.label || 'Component'),
        previewUrl: String(component?.previewUrl || ''),
      }));
      return {
        title: String(item?.title || 'Item'),
        previewUrl: String(item?.previewUrl || mappedComponents.find((component) => component.previewUrl)?.previewUrl || ''),
        components: mappedComponents,
      };
    });
    previewCache.set(orderToken, items);
    return items;
  } finally {
    previewLoadingToken = '';
  }
}

function makeComponentPreview(previewUrl: string, itemTitle: string, componentLabel: string) {
  const wrapper = document.createElement('div');
  wrapper.dataset.componentPreviewThumb = '1';
  Object.assign(wrapper.style, {
    display: 'grid',
    gap: '7px',
    margin: '10px 0 12px',
  });

  const label = document.createElement('small');
  label.textContent = 'Gambar design';
  Object.assign(label.style, {
    fontSize: '11px',
    color: '#667085',
    fontWeight: '700',
  });

  const button = document.createElement('button');
  button.type = 'button';
  Object.assign(button.style, {
    display: 'grid',
    gridTemplateColumns: '72px 1fr',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
    padding: '8px',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    background: '#fff',
    textAlign: 'left',
    cursor: 'pointer',
  });

  const image = document.createElement('img');
  image.src = previewUrl;
  image.alt = `${componentLabel} design`;
  image.loading = 'lazy';
  Object.assign(image.style, {
    width: '72px',
    height: '72px',
    objectFit: 'cover',
    borderRadius: '9px',
    background: '#f8fafc',
  });

  const text = document.createElement('span');
  text.innerHTML = `<b style="display:block;color:#111827;font-size:13px">${componentLabel}</b><small style="display:block;color:#ee4d2d;font-weight:700;margin-top:4px">Tekan untuk zoom / lihat penuh</small><small style="display:block;color:#667085;margin-top:3px">${itemTitle}</small>`;
  button.append(image, text);
  button.onclick = () => openPreviewLightbox(previewUrl, `${itemTitle} — ${componentLabel}`);
  wrapper.append(label, button);
  return wrapper;
}

async function enhanceComponentPreviews(detail: HTMLElement) {
  const orderToken = selectedOrderToken();
  if (!orderToken) return;
  const itemCards = Array.from(detail.querySelectorAll<HTMLElement>('.cp-item-card'));
  if (!itemCards.length) return;

  const items = await loadPreviewItems(orderToken);
  itemCards.forEach((itemCard, itemIndex) => {
    const itemPreview = items[itemIndex];
    if (!itemPreview) return;

    const mainPreview = itemPreview.previewUrl || itemPreview.components.find((component) => component.previewUrl)?.previewUrl || '';
    const itemImage = itemCard.querySelector<HTMLImageElement>(':scope > header img');
    if (itemImage && mainPreview && !itemImage.dataset.orderPreviewZoom) {
      itemImage.src = mainPreview;
      itemImage.dataset.orderPreviewZoom = '1';
      itemImage.title = 'Tekan untuk zoom';
      itemImage.tabIndex = 0;
      itemImage.style.cursor = 'zoom-in';
      itemImage.onclick = () => openPreviewLightbox(mainPreview, itemPreview.title);
      itemImage.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') openPreviewLightbox(mainPreview, itemPreview.title);
      };
    }

    const componentCards = Array.from(itemCard.querySelectorAll<HTMLElement>('.cp-component'));
    componentCards.forEach((componentCard, componentIndex) => {
      if (componentCard.querySelector('[data-component-preview-thumb]')) return;
      const componentPreview = itemPreview.components[componentIndex];
      const previewUrl = componentPreview?.previewUrl || itemPreview.previewUrl;
      if (!previewUrl) return;
      const preview = makeComponentPreview(
        previewUrl,
        itemPreview.title,
        componentPreview?.label || componentCard.querySelector<HTMLElement>('.cp-component-head b')?.textContent || 'Component',
      );
      const track = componentCard.querySelector('.cp-track');
      if (track) componentCard.insertBefore(preview, track);
      else componentCard.append(preview);
    });
  });
}

function workflowStageIndex(workflowValue: unknown, stepCount: number) {
  const workflow = normalizeLifecycleValue(workflowValue);
  const finalIndex = Math.max(0, stepCount - 1);

  if ([
    'complete', 'completed', 'production_complete', 'ready', 'ready_to_ship',
    'ready_for_pickup', 'ready_to_pickup', 'delivered', 'customer_collected', 'collected',
  ].includes(workflow)) return finalIndex;

  if (stepCount >= 7) {
    if (['finishing', 'packing', 'print_alamat'].includes(workflow)) return 5;
    if (['production', 'printing', 'in_production'].includes(workflow)) return 4;
    if (['approved', 'preparing_production'].includes(workflow)) return 3;
    if (['waiting_review', 'review', 'waiting_approval'].includes(workflow)) return 2;
    if (['design_editing', 'edit_requested', 'request_editing'].includes(workflow)) return 1;
    return 0;
  }

  if (['finishing', 'packing', 'print_alamat'].includes(workflow)) return Math.min(3, finalIndex);
  if (['production', 'printing', 'in_production'].includes(workflow)) return Math.min(2, finalIndex);
  if (['design_editing', 'edit_requested', 'request_editing'].includes(workflow)) return Math.min(1, finalIndex);
  return 0;
}

function updateOverallProgress(detail: HTMLElement) {
  const components = Array.from(detail.querySelectorAll<HTMLElement>('.cp-component'));
  if (!components.length) return;

  const ratios = components.map((component) => {
    const steps = Array.from(component.querySelectorAll<HTMLElement>('.cp-step'));
    if (steps.length <= 1) return 0;
    const workflow = component.querySelector<HTMLElement>('.cp-component-head span')?.textContent;
    return workflowStageIndex(workflow, steps.length) / (steps.length - 1);
  });
  const overall = Math.round((ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length) * 100);
  const value = detail.querySelector<HTMLElement>('.cp-overall > div:first-child span');
  const bar = detail.querySelector<HTMLElement>('.cp-overall-bar i');
  const text = `${overall}% • ${components.length} proses`;
  if (value && value.textContent !== text) value.textContent = text;
  if (bar && bar.style.width !== `${overall}%`) bar.style.width = `${overall}%`;
}

async function confirmCustomerPickup(button: HTMLButtonElement) {
  const orderToken = selectedOrderToken();
  if (!orderToken) {
    showLifecycleToast('Order token tidak ditemui', true);
    return;
  }
  const confirmed = window.confirm('Sahkan anda sudah menerima dan mengambil barang ini? Selepas disahkan, order akan dipindahkan ke Completed.');
  if (!confirmed) return;

  const originalText = button.textContent || 'Saya Dah Ambil Barang';
  button.disabled = true;
  button.textContent = 'Mengesahkan…';
  const { data, error } = await supabase.rpc('icetak_customer_confirm_pickup', { p_order_token: orderToken });
  if (error || !data?.ok) {
    button.disabled = false;
    button.textContent = originalText;
    showLifecycleToast(error?.message || 'Pengesahan pickup gagal', true);
    return;
  }
  button.textContent = 'Pickup Disahkan ✓';
  showLifecycleToast('Terima kasih. Order dipindahkan ke Completed.');
  window.setTimeout(() => location.reload(), 800);
}

function enhancePickupCard(detail: HTMLElement) {
  const pickupCard = detail.querySelector<HTMLElement>('.cp-pickup-card');
  if (!pickupCard) return false;
  const pageStatus = normalizeLifecycleValue(detail.querySelector<HTMLElement>('.cp-summary .cp-status')?.textContent);
  const heading = pickupCard.querySelector<HTMLElement>('h3');
  const icon = pickupCard.querySelector<HTMLElement>('header > span');
  const helper = pickupCard.querySelector<HTMLElement>('small:last-child');
  const completed = ['completed', 'customer_collected', 'collected'].includes(pageStatus);

  if (completed) {
    pickupCard.classList.add('ready');
    if (heading) heading.textContent = 'Barang Telah Diambil';
    if (icon) icon.textContent = '✅';
    if (helper) helper.textContent = 'Pickup telah disahkan. Terima kasih.';
    pickupCard.querySelector('[data-customer-confirm-pickup]')?.remove();
    return true;
  }

  const ready = pickupCard.classList.contains('ready') || normalizeLifecycleValue(heading?.textContent).includes('ready_for_pickup') || pageStatus.includes('ready_for_pickup');
  if (!ready || pickupCard.querySelector('[data-customer-confirm-pickup]')) return true;

  addLifecycleNote(pickupCard, 'pickup-confirmation', 'Tekan butang di bawah hanya selepas barang sudah diterima daripada staff.', true);
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.customerConfirmPickup = '1';
  button.textContent = '✓ Saya Dah Ambil Barang';
  Object.assign(button.style, {
    width: '100%', marginTop: '12px', padding: '13px 16px', border: '0',
    borderRadius: '12px', background: '#16883f', color: '#fff', fontWeight: '800',
    fontSize: '15px', cursor: 'pointer',
  });
  button.onclick = () => void confirmCustomerPickup(button);
  pickupCard.append(button);
  return true;
}

function enhanceProductionSteps(detail: HTMLElement) {
  detail.querySelectorAll<HTMLElement>('.cp-component').forEach((component) => {
    const workflow = normalizeLifecycleValue(component.querySelector<HTMLElement>('.cp-component-head span')?.textContent);
    const steps = Array.from(component.querySelectorAll<HTMLElement>('.cp-step'));
    if (!steps.length) return;

    steps.forEach((step) => {
      const label = step.querySelector<HTMLElement>('span');
      if (normalizeLifecycleValue(label?.textContent) === 'shipped' && label) label.textContent = 'Ready';
    });

    const productionReady = ['ready', 'ready_to_ship', 'production_complete', 'complete', 'completed'].includes(workflow);
    if (!productionReady) return;
    steps.forEach((step) => {
      step.classList.add('done');
      step.classList.remove('current');
      const stepIcon = step.querySelector<HTMLElement>('i');
      if (stepIcon) stepIcon.textContent = '✓';
    });
    steps.at(-1)?.classList.add('current');
  });
}

function enhanceShipmentCard(detail: HTMLElement) {
  const shipmentCard = detail.querySelector<HTMLElement>('.cp-shipment-card');
  if (!shipmentCard) return;
  const status = normalizeLifecycleValue(shipmentCard.querySelector<HTMLElement>('h3')?.textContent);
  if (['awb_created', 'shipment_created'].includes(status)) addLifecycleNote(shipmentCard, 'awb', 'Parcel telah disediakan. Menunggu courier pickup.');
  if (['delivery_failed', 'failed', 'exception'].includes(status)) addLifecycleNote(shipmentCard, 'delivery-issue', 'Penghantaran menghadapi masalah. Sila semak tracking atau hubungi kami untuk tindakan lanjut.', true);
  if (['returned', 'return_to_sender'].includes(status)) addLifecycleNote(shipmentCard, 'returned', 'Parcel sedang atau telah dipulangkan kepada pengirim. Hubungi kami untuk susunan penghantaran semula.', true);
}

function enhanceOrderLifecycleUi() {
  const detail = document.querySelector<HTMLElement>('.order-detail-page');
  if (!detail) return;
  enhanceDesignPreviews(detail);
  enhanceProductionSteps(detail);
  updateOverallProgress(detail);
  void enhanceComponentPreviews(detail);
  const isPickup = enhancePickupCard(detail);
  if (!isPickup) enhanceShipmentCard(detail);
}

let scheduled = false;
function scheduleEnhancement() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    enhanceOrderLifecycleUi();
  });
}

const observer = new MutationObserver(scheduleEnhancement);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('DOMContentLoaded', scheduleEnhancement);
scheduleEnhancement();
