import { api } from './appdeploy-client';

const processing = new Set<string>();

function normal(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

async function markReady(card: HTMLElement, orderDbId: string, button: HTMLButtonElement) {
  if (processing.has(orderDbId)) return;
  if (!window.confirm('Tandakan order ini siap untuk pickup? Customer akan menerima notifikasi WhatsApp.')) return;

  processing.add(orderDbId);
  button.disabled = true;
  button.textContent = 'Sending…';

  try {
    await api.post('/api/admin/order-action', {
      order_db_id: orderDbId,
      action: 'ready_pickup',
    });

    const status = card.querySelector<HTMLElement>('header > span');
    if (status) status.textContent = 'Ready for Pickup';
    button.textContent = 'Ready for Pickup ✓';
    button.classList.remove('primary');
    button.dataset.readyPickupDone = '1';
  } catch (error) {
    console.error('Mark ready for pickup failed:', error);
    button.disabled = false;
    button.textContent = 'Mark Ready for Pickup';
    window.alert(error instanceof Error ? error.message : 'Gagal tandakan order siap pickup');
  } finally {
    processing.delete(orderDbId);
  }
}

function mountReadyPickupButtons() {
  document.querySelectorAll<HTMLElement>('.admin-order-card').forEach(card => {
    const footer = card.querySelector<HTMLElement>('footer');
    if (!footer || footer.querySelector('[data-ready-pickup]')) return;

    const status = normal(card.querySelector<HTMLElement>('header > span')?.textContent);
    if (!['ready to process', 'production started'].includes(status)) return;

    const meta = Array.from(card.querySelectorAll<HTMLElement>('.admin-order-meta > span'));
    const payment = normal(meta[1]?.textContent);
    const delivery = normal(meta[2]?.textContent);
    if (!payment.includes('paid') || !delivery.includes('pickup')) return;

    // Production must be approved first. The existing Approve Production button
    // disappears after approval, then this explicit pickup action becomes available.
    if (footer.querySelector('[data-action="approve_production"]')) return;

    const source = footer.querySelector<HTMLElement>('[data-order-db], [data-edit-order]');
    const orderDbId = source?.dataset.orderDb || source?.dataset.editOrder || '';
    if (!orderDbId) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'primary';
    button.dataset.readyPickup = orderDbId;
    button.textContent = 'Mark Ready for Pickup';
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      void markReady(card, orderDbId, button);
    });
    footer.append(button);
  });
}

const observer = new MutationObserver(mountReadyPickupButtons);
observer.observe(document.body, { childList: true, subtree: true });
window.addEventListener('focus', mountReadyPickupButtons);
window.setInterval(mountReadyPickupButtons, 2500);
