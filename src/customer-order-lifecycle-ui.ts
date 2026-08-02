import { supabase } from './appdeploy-client';

function normalizeLifecycleValue(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
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

function enhanceDesignPreviews(detail: HTMLElement) {
  detail.querySelectorAll<HTMLElement>('.cp-review-panel').forEach((panel) => {
    const sourceLink = panel.querySelector<HTMLAnchorElement>('a[href]');
    if (!sourceLink || panel.querySelector('[data-design-preview-image]')) return;

    const previewLink = document.createElement('a');
    previewLink.dataset.designPreviewImage = '1';
    previewLink.href = sourceLink.href;
    previewLink.target = '_blank';
    previewLink.rel = 'noopener';
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

    panel.prepend(previewLink);
    sourceLink.textContent = 'Buka Design Penuh';
  });
}

function selectedOrderToken() {
  return new URL(location.href).searchParams.get('order') || '';
}

async function confirmCustomerPickup(button: HTMLButtonElement) {
  const orderToken = selectedOrderToken();
  if (!orderToken) {
    showLifecycleToast('Order token tidak ditemui', true);
    return;
  }

  const confirmed = window.confirm(
    'Sahkan anda sudah menerima dan mengambil barang ini? Selepas disahkan, order akan dipindahkan ke Completed.',
  );
  if (!confirmed) return;

  const originalText = button.textContent || 'Saya Dah Ambil Barang';
  button.disabled = true;
  button.textContent = 'Mengesahkan…';

  const { data, error } = await supabase.rpc('icetak_customer_confirm_pickup', {
    p_order_token: orderToken,
  });

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

  const pageStatus = normalizeLifecycleValue(
    detail.querySelector<HTMLElement>('.cp-summary .cp-status')?.textContent,
  );
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

  const ready = pickupCard.classList.contains('ready')
    || normalizeLifecycleValue(heading?.textContent).includes('ready_for_pickup')
    || pageStatus.includes('ready_for_pickup');
  if (!ready || pickupCard.querySelector('[data-customer-confirm-pickup]')) return true;

  addLifecycleNote(
    pickupCard,
    'pickup-confirmation',
    'Tekan butang di bawah hanya selepas barang sudah diterima daripada staff.',
    true,
  );

  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.customerConfirmPickup = '1';
  button.textContent = '✓ Saya Dah Ambil Barang';
  Object.assign(button.style, {
    width: '100%',
    marginTop: '12px',
    padding: '13px 16px',
    border: '0',
    borderRadius: '12px',
    background: '#16883f',
    color: '#fff',
    fontWeight: '800',
    fontSize: '15px',
    cursor: 'pointer',
  });
  button.onclick = () => void confirmCustomerPickup(button);
  pickupCard.append(button);
  return true;
}

function enhanceProductionSteps(detail: HTMLElement) {
  detail.querySelectorAll<HTMLElement>('.cp-component').forEach((component) => {
    const workflow = normalizeLifecycleValue(
      component.querySelector<HTMLElement>('.cp-component-head span')?.textContent,
    );
    const steps = Array.from(component.querySelectorAll<HTMLElement>('.cp-step'));
    if (!steps.length) return;

    steps.forEach((step) => {
      const label = step.querySelector<HTMLElement>('span');
      if (normalizeLifecycleValue(label?.textContent) === 'shipped' && label) {
        label.textContent = 'Ready';
      }
    });

    const productionReady = [
      'ready',
      'ready_to_ship',
      'production_complete',
      'complete',
      'completed',
    ].includes(workflow);

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
  const heading = shipmentCard.querySelector<HTMLElement>('h3');
  const status = normalizeLifecycleValue(heading?.textContent);

  if (['awb_created', 'shipment_created'].includes(status)) {
    addLifecycleNote(shipmentCard, 'awb', 'Parcel telah disediakan. Menunggu courier pickup.');
  }

  if (['delivery_failed', 'failed', 'exception'].includes(status)) {
    addLifecycleNote(
      shipmentCard,
      'delivery-issue',
      'Penghantaran menghadapi masalah. Sila semak tracking atau hubungi kami untuk tindakan lanjut.',
      true,
    );
  }

  if (['returned', 'return_to_sender'].includes(status)) {
    addLifecycleNote(
      shipmentCard,
      'returned',
      'Parcel sedang atau telah dipulangkan kepada pengirim. Hubungi kami untuk susunan penghantaran semula.',
      true,
    );
  }
}

function enhanceOrderLifecycleUi() {
  const detail = document.querySelector<HTMLElement>('.order-detail-page');
  if (!detail) return;

  enhanceDesignPreviews(detail);
  enhanceProductionSteps(detail);
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
