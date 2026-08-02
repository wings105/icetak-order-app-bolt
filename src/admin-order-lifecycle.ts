import { supabase } from './appdeploy-client';

let enhancing = false;

function showToast(message: string, bad = false) {
  document.querySelector('.order-lifecycle-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = `order-lifecycle-toast${bad ? ' bad' : ''}`;
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed',
    left: '50%',
    bottom: '24px',
    transform: 'translateX(-50%)',
    zIndex: '99999',
    padding: '12px 18px',
    borderRadius: '10px',
    background: bad ? '#b42318' : '#157f3b',
    color: '#fff',
    fontWeight: '700',
    boxShadow: '0 8px 28px rgba(0,0,0,.2)',
  });
  document.body.append(toast);
  setTimeout(() => toast.remove(), 2600);
}

async function markPickupCollected(orderId: string, button: HTMLButtonElement) {
  if (!confirm(`Sahkan customer sudah ambil order ${orderId}?`)) return;
  button.disabled = true;
  button.textContent = 'Updating…';
  const { error } = await supabase.rpc('icetak_admin_order_action', {
    p_payload: { order_id: orderId, action: 'pickup_collected' },
  });
  if (error) {
    button.disabled = false;
    button.textContent = 'Customer Collected';
    showToast(error.message || 'Gagal update pickup', true);
    return;
  }
  button.textContent = 'Collected ✓';
  showToast('Order dipindahkan ke Completed');
  setTimeout(() => location.reload(), 700);
}

function enhanceAdminCards() {
  if (enhancing) return;
  enhancing = true;
  try {
    document.querySelectorAll<HTMLElement>('.admin-order-card').forEach((card) => {
      if (card.querySelector('[data-pickup-collected]')) return;
      const cardText = String(card.textContent || '').toLowerCase();
      if (!cardText.includes('ready for pickup')) return;
      if (cardText.includes('customer collected') || cardText.includes('completed')) return;

      const orderId = card.querySelector<HTMLElement>('header b')?.textContent?.trim() || '';
      const footer = card.querySelector<HTMLElement>('footer');
      if (!orderId || !footer) return;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'primary';
      button.dataset.pickupCollected = orderId;
      button.textContent = 'Customer Collected';
      button.onclick = () => void markPickupCollected(orderId, button);
      footer.append(button);
    });
  } finally {
    enhancing = false;
  }
}

const observer = new MutationObserver(enhanceAdminCards);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('DOMContentLoaded', enhanceAdminCards);
enhanceAdminCards();
