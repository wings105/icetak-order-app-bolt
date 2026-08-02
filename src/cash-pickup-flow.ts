import { api } from './appdeploy-client';

export {};

declare global {
  interface Window {
    __ICETAK_CASH_PICKUP_FLOW__?: boolean;
  }
}

if (!window.__ICETAK_CASH_PICKUP_FLOW__) {
  window.__ICETAK_CASH_PICKUP_FLOW__ = true;

  let scheduled = false;
  let actionBusy = false;

  function normalize(value: unknown) {
    return String(value || '').trim().toLowerCase();
  }

  function toast(message: string, bad = false) {
    document.querySelector('[data-cash-pickup-toast]')?.remove();
    const element = document.createElement('div');
    element.dataset.cashPickupToast = '1';
    element.textContent = message;
    Object.assign(element.style, {
      position: 'fixed',
      left: '50%',
      bottom: '24px',
      transform: 'translateX(-50%)',
      zIndex: '120000',
      maxWidth: 'calc(100vw - 32px)',
      padding: '12px 16px',
      borderRadius: '12px',
      background: bad ? '#b42318' : '#157f3b',
      color: '#fff',
      fontWeight: '800',
      textAlign: 'center',
      boxShadow: '0 10px 32px rgba(0,0,0,.24)',
    });
    document.body.append(element);
    window.setTimeout(() => element.remove(), 3000);
  }

  function enhanceCustomerCheckout() {
    const cashButton = document.querySelector<HTMLButtonElement>('[data-p="Cash Counter"]');
    if (!cashButton) return;

    if (!cashButton.dataset.cashPickupLabelled) {
      cashButton.dataset.cashPickupLabelled = '1';
      cashButton.innerHTML = '💵 Bayar Semasa Pickup <i>✓</i>';
      cashButton.setAttribute('aria-label', 'Bayar Semasa Pickup');
    }

    const paymentList = cashButton.closest<HTMLElement>('.payment-list');
    if (paymentList && !paymentList.parentElement?.querySelector('[data-cash-pickup-note]')) {
      const note = document.createElement('p');
      note.dataset.cashPickupNote = '1';
      note.textContent = 'Bayaran dibuat di kedai apabila barang diambil. Order boleh mula diproses selepas anda sahkan detail order.';
      Object.assign(note.style, {
        margin: '10px 0 0',
        padding: '10px 12px',
        borderRadius: '10px',
        background: '#fff8e8',
        color: '#7a4b00',
        fontSize: '12px',
        lineHeight: '1.45',
      });
      paymentList.insertAdjacentElement('afterend', note);
    }

    document.querySelectorAll<HTMLElement>('.review-order-summary div').forEach((row) => {
      const bold = row.querySelector('b');
      if (normalize(bold?.textContent) === 'cash counter' && bold) bold.textContent = 'Bayar Semasa Pickup';
    });
  }

  function enhanceCustomerOrderPayment() {
    document.querySelectorAll<HTMLElement>('.cp-payment').forEach((card) => {
      const heading = card.querySelector('b');
      const text = normalize(heading?.textContent);
      if (!text.includes('cash at counter') && !text.includes('cash counter')) return;

      if (heading) heading.textContent = 'Payment: Bayar Semasa Pickup';
      const paragraph = card.querySelector('p');
      if (paragraph) paragraph.textContent = 'Bayar di kedai apabila barang diambil.';
      card.querySelector('[data-cp-pay-now]')?.remove();
      card.classList.add('cash-at-pickup');
    });
  }

  async function runAdminAction(
    button: HTMLButtonElement,
    orderDbId: string,
    action: 'set_pay_at_pickup' | 'confirm_cash_paid',
    orderId: string,
    totalText: string,
  ) {
    if (actionBusy) return;
    const message = action === 'set_pay_at_pickup'
      ? `Tukar ${orderId} kepada Bayar Semasa Pickup? Production/ClickUp boleh dimulakan tanpa menunggu QR Pay.`
      : `Sahkan bayaran tunai ${totalText || ''} untuk ${orderId} sudah diterima?`;
    if (!window.confirm(message)) return;

    const sessionToken = sessionStorage.getItem('admin_session') || '';
    if (!sessionToken) {
      toast('Admin session tidak ditemui', true);
      return;
    }

    actionBusy = true;
    const original = button.textContent || '';
    button.disabled = true;
    button.textContent = action === 'set_pay_at_pickup' ? 'Updating…' : 'Confirming…';

    try {
      await api.post('/api/admin/order-action', {
        session_token: sessionToken,
        order_db_id: orderDbId,
        action,
      });
      toast(action === 'set_pay_at_pickup' ? 'Pay at Pickup diaktifkan' : 'Cash payment disahkan');
      window.setTimeout(() => location.reload(), 650);
    } catch (error) {
      actionBusy = false;
      button.disabled = false;
      button.textContent = original;
      toast(error instanceof Error ? error.message : 'Tindakan gagal', true);
    }
  }

  function createAdminButton(
    card: HTMLElement,
    footer: HTMLElement,
    orderDbId: string,
    action: 'set_pay_at_pickup' | 'confirm_cash_paid',
    label: string,
    orderId: string,
    totalText: string,
  ) {
    if (card.querySelector(`[data-cash-pickup-action="${action}"]`)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.cashPickupAction = action;
    button.textContent = label;
    button.className = action === 'confirm_cash_paid' ? 'primary' : '';
    if (action === 'set_pay_at_pickup') {
      Object.assign(button.style, {
        borderColor: '#d49b16',
        color: '#7a4b00',
        background: '#fff8e8',
      });
    }
    button.onclick = () => void runAdminAction(button, orderDbId, action, orderId, totalText);
    footer.insertBefore(button, footer.querySelector('[data-action="cancel"]'));
  }

  function enhanceAdminCards() {
    document.querySelectorAll<HTMLElement>('.admin-order-card').forEach((card) => {
      const footer = card.querySelector<HTMLElement>('footer');
      if (!footer) return;

      const dbSource = card.querySelector<HTMLElement>('[data-edit-order]')
        || card.querySelector<HTMLElement>('[data-order-db]');
      const orderDbId = dbSource?.dataset.editOrder || dbSource?.dataset.orderDb || '';
      if (!orderDbId) return;

      const orderId = card.querySelector<HTMLElement>('header b')?.textContent?.trim() || 'order';
      const meta = Array.from(card.querySelectorAll<HTMLElement>('.admin-order-meta span'));
      const payment = normalize(meta[1]?.textContent);
      const delivery = normalize(meta[2]?.textContent);
      const totalText = card.querySelector<HTMLElement>('.admin-order-meta b')?.textContent?.trim() || '';
      const pickup = delivery.includes('pickup');
      const unpaid = payment.includes('unpaid') || payment.includes('pending');
      const payAtPickup = payment.includes('cash at counter')
        || payment.includes('cash counter')
        || payment.includes('pay at pickup');
      const paid = payment === 'paid' || payment.includes('payment received');

      if (pickup && unpaid) {
        createAdminButton(card, footer, orderDbId, 'set_pay_at_pickup', 'Pay at Pickup', orderId, totalText);
      }
      if (pickup && payAtPickup && !paid) {
        createAdminButton(card, footer, orderDbId, 'confirm_cash_paid', 'Confirm Cash Paid', orderId, totalText);
      }

      if (payAtPickup) {
        meta[1] && (meta[1].textContent = 'Pay at Pickup');
        if (!card.querySelector('[data-cash-pickup-badge]')) {
          const badge = document.createElement('small');
          badge.dataset.cashPickupBadge = '1';
          badge.textContent = '💵 Bayar semasa ambil';
          Object.assign(badge.style, {
            display: 'inline-flex',
            marginTop: '8px',
            padding: '6px 9px',
            borderRadius: '999px',
            background: '#fff8e8',
            color: '#7a4b00',
            fontWeight: '800',
          });
          card.querySelector('.admin-order-meta')?.insertAdjacentElement('afterend', badge);
        }
      }
    });
  }

  function enhanceAdminLabels() {
    document.querySelectorAll<HTMLElement>('.admin-tabs button').forEach((button) => {
      if (button.textContent?.trim() === 'Cash Approval') button.textContent = 'Pay at Pickup';
    });
    document.querySelectorAll<HTMLElement>('.admin-metrics article span').forEach((label) => {
      if (label.textContent?.trim() === 'Cash Check') label.textContent = 'Pay at Pickup';
    });
  }

  function enhance() {
    scheduled = false;
    enhanceCustomerCheckout();
    enhanceCustomerOrderPayment();
    enhanceAdminCards();
    enhanceAdminLabels();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    window.setTimeout(enhance, 30);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.querySelector('#app') || document.body, { childList: true, subtree: true });
  window.addEventListener('DOMContentLoaded', schedule);
  window.addEventListener('popstate', schedule);
  schedule();
}
