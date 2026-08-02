function normalizeLifecycleValue(value: unknown) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function enhanceOrderLifecycleUi() {
  const detail = document.querySelector<HTMLElement>('.order-detail-page');
  if (!detail) return;

  // Pickup uses its own Ready for Pickup card and does not need shipping labels.
  if (detail.querySelector('.cp-pickup-card')) return;

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
      const icon = step.querySelector<HTMLElement>('i');
      if (icon) icon.textContent = '✓';
    });
    steps.at(-1)?.classList.add('current');
  });

  const shipmentCard = detail.querySelector<HTMLElement>('.cp-shipment-card');
  if (!shipmentCard) return;
  const heading = shipmentCard.querySelector<HTMLElement>('h3');
  const status = normalizeLifecycleValue(heading?.textContent);
  if (['awb_created', 'shipment_created'].includes(status)) {
    const explanation = shipmentCard.querySelector<HTMLElement>('[data-lifecycle-awb-note]');
    if (!explanation) {
      const note = document.createElement('p');
      note.dataset.lifecycleAwbNote = '1';
      note.textContent = 'Parcel telah disediakan. Menunggu courier pickup.';
      shipmentCard.append(note);
    }
  }
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
