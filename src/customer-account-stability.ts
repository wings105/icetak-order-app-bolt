export {};

declare global {
  interface Window {
    __ICETAK_ACCOUNT_STABILITY__?: boolean;
  }
}

if (!window.__ICETAK_ACCOUNT_STABILITY__) {
  window.__ICETAK_ACCOUNT_STABILITY__ = true;

  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  const nativeGet = descriptor?.get;
  const nativeSet = descriptor?.set;
  const lastAddressCardHtml = new WeakMap<Element, string>();

  if (nativeGet && nativeSet) {
    Object.defineProperty(Element.prototype, 'innerHTML', {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      get: nativeGet,
      set(value: string) {
        const next = String(value);
        if (this instanceof HTMLElement && this.classList.contains('address-card')) {
          if (lastAddressCardHtml.get(this) === next) return;
          lastAddressCardHtml.set(this, next);
        }
        nativeSet.call(this, next);
      },
    });
  }

  const customerToken = () => localStorage.getItem('customer_token') || new URL(location.href).searchParams.get('c') || '';

  function removeAccountModals() {
    document.querySelectorAll('.ca-modal-wrap').forEach((node) => node.remove());
  }

  function openMyOrders() {
    const token = customerToken();
    if (!token) return;
    removeAccountModals();
    const url = new URL(location.origin + location.pathname);
    url.searchParams.set('c', token);
    location.assign(url.toString());
  }

  function continueShopping() {
    removeAccountModals();
    const isPortal = Boolean(document.querySelector('main.history-page,main.order-detail-page,[data-full-portal="1"]'));
    if (isPortal) location.assign(location.origin + location.pathname);
  }

  function enhanceProfileDialog(root: ParentNode = document) {
    root.querySelectorAll<HTMLElement>('.ca-profile-wrap .ca-dialog').forEach((dialog) => {
      if (!dialog.querySelector('[data-ca-account-nav]')) {
        const nav = document.createElement('section');
        nav.dataset.caAccountNav = '1';
        nav.className = 'ca-account-nav';
        nav.innerHTML = '<button type="button" data-ca-my-orders>📦 My Orders</button><button type="button" data-ca-continue-shopping>🛍️ Continue Shopping</button>';
        dialog.querySelector('.ca-profile-head')?.insertAdjacentElement('afterend', nav);
      }

      dialog.querySelectorAll<HTMLElement>('.ca-address').forEach((card) => {
        const confirmed = card.querySelector('header small')?.textContent?.includes('Disahkan customer');
        const footer = card.querySelector('footer');
        if (confirmed && footer && !footer.querySelector('[data-ca-confirmed-state]')) {
          const state = document.createElement('span');
          state.dataset.caConfirmedState = '1';
          state.className = 'ca-confirmed-state';
          state.textContent = '✓ Address Confirmed';
          footer.prepend(state);
        }
      });
    });
  }

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const close = target.closest('[data-ca-close],.ca-x');
    if (close) {
      const wrap = close.closest('.ca-modal-wrap');
      if (wrap) {
        event.preventDefault();
        event.stopImmediatePropagation();
        wrap.remove();
      }
      return;
    }

    if (target.closest('[data-ca-my-orders]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openMyOrders();
      return;
    }

    if (target.closest('[data-ca-continue-shopping]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      continueShopping();
    }
  }, true);

  const style = document.createElement('style');
  style.textContent = `.ca-account-nav{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0}.ca-account-nav button{border:1px solid #dbe3ec;background:#fff;border-radius:12px;padding:12px 10px;font-weight:900;color:#1f2937;cursor:pointer}.ca-account-nav button:first-child{background:#fff4f0;border-color:#ffb8a9;color:#d93c1c}.ca-confirmed-state{display:inline-flex;align-items:center;color:#15803d;background:#ecfdf3;border-radius:999px;padding:7px 10px;font-size:12px;font-weight:900}@media(max-width:600px){.ca-account-nav{grid-template-columns:1fr}}`;
  document.head.append(style);

  const nativeObserver = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (node instanceof HTMLElement) enhanceProfileDialog(node);
      }
    }
  });
  nativeObserver.observe(document.documentElement, { childList: true, subtree: true });
  enhanceProfileDialog();
}
