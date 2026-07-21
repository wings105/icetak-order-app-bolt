import { supabase } from './appdeploy-client';

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

  function showNavToast(message: string, bad = false) {
    document.querySelector('.ca-nav-toast')?.remove();
    const toast = document.createElement('div');
    toast.className = `ca-nav-toast${bad ? ' bad' : ''}`;
    toast.textContent = message;
    document.body.append(toast);
    setTimeout(() => toast.remove(), 2600);
  }

  async function resolveCustomerToken() {
    const existing = localStorage.getItem('customer_token') || new URL(location.href).searchParams.get('c') || '';
    if (existing) return existing;

    const session = localStorage.getItem('customer_session') || '';
    if (!session) return '';

    const { data, error } = await supabase.rpc('icetak_customer_me' as any, { p_value: session } as any);
    if (error) throw new Error(error.message);
    const token = String((data as any)?.customer?.customerToken || '');
    if (token) localStorage.setItem('customer_token', token);
    return token;
  }

  function removeAccountModals() {
    document.querySelectorAll('.ca-modal-wrap').forEach((node) => node.remove());
  }

  async function openMyOrders(trigger?: HTMLElement | null) {
    const button = trigger instanceof HTMLButtonElement ? trigger : null;
    const original = button?.textContent || '';
    if (button) {
      button.disabled = true;
      button.textContent = 'Loading Orders…';
    }

    try {
      const token = await resolveCustomerToken();
      if (!token) {
        showNavToast('Login WhatsApp dahulu untuk melihat order.', true);
        return;
      }
      removeAccountModals();
      const url = new URL(location.origin + location.pathname);
      url.searchParams.set('c', token);
      location.assign(url.toString());
    } catch (error) {
      showNavToast(error instanceof Error ? error.message : 'Order tracker gagal dibuka.', true);
    } finally {
      if (button && document.body.contains(button)) {
        button.disabled = false;
        button.textContent = original;
      }
    }
  }

  function continueShopping() {
    removeAccountModals();
    const isPortal = Boolean(document.querySelector('main.history-page,main.order-detail-page,[data-full-portal="1"]'));
    if (isPortal) location.assign(location.origin + location.pathname);
  }

  function enhanceProfileDialog() {
    document.querySelectorAll<HTMLElement>('.ca-profile-wrap .ca-dialog').forEach((dialog) => {
      const header = dialog.querySelector('.ca-profile-head');
      if (header && !dialog.querySelector('[data-ca-account-nav]')) {
        const nav = document.createElement('section');
        nav.dataset.caAccountNav = '1';
        nav.className = 'ca-account-nav';
        nav.innerHTML = '<button type="button" data-ca-my-orders>📦 Track My Orders</button><button type="button" data-ca-continue-shopping>🛍️ Continue Shopping</button>';
        header.insertAdjacentElement('afterend', nav);
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

  function enhanceWhatsAppNotice() {
    document.querySelectorAll<HTMLLabelElement>('.ca-notify:not([data-ca-notice-ready])').forEach((label) => {
      label.dataset.caNoticeReady = '1';
      const copy = label.querySelector('span');
      if (copy) copy.innerHTML = '<b>Terima update order melalui WhatsApp</b><small>Notifikasi dihantar selepas bayaran disahkan dan apabila status order berubah.</small>';
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

    const myOrders = target.closest<HTMLElement>('[data-ca-my-orders]');
    if (myOrders) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void openMyOrders(myOrders);
      return;
    }

    const historyButton = target.closest<HTMLElement>('#navHistory');
    if (historyButton && localStorage.getItem('customer_session')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void openMyOrders(historyButton);
      return;
    }

    if (target.closest('[data-ca-continue-shopping]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      continueShopping();
    }
  }, true);

  const style = document.createElement('style');
  style.textContent = `
    .ca-account-nav{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0}
    .ca-account-nav button{border:1px solid #dbe3ec;background:#fff;border-radius:12px;padding:13px 10px;font-weight:900;color:#1f2937;cursor:pointer}
    .ca-account-nav button:first-child{background:#ee4d2d;border-color:#ee4d2d;color:#fff}
    .ca-account-nav button:disabled{opacity:.65;cursor:wait}
    .ca-confirmed-state{display:inline-flex;align-items:center;color:#15803d;background:#ecfdf3;border-radius:999px;padding:7px 10px;font-size:12px;font-weight:900}
    .ca-notify{align-items:flex-start!important;border:1px solid #bbf7d0!important;background:#f0fdf4!important;padding:13px!important;border-radius:12px!important}
    .ca-notify input{margin-top:3px;accent-color:#16a34a}
    .ca-notify span{display:grid;gap:3px;color:#166534}
    .ca-notify span b{font-size:14px}
    .ca-notify span small{font-size:12px;line-height:1.4;color:#4b5563}
    .ca-notify:has(input:not(:checked)){border-color:#dbe3ec!important;background:#f8fafc!important;opacity:.78}
    .ca-nav-toast{position:fixed;z-index:1000020;left:50%;bottom:84px;transform:translateX(-50%);background:#166534;color:#fff;padding:11px 16px;border-radius:999px;font-weight:800;box-shadow:0 10px 30px #0003;max-width:92vw;text-align:center}
    .ca-nav-toast.bad{background:#b91c1c}
    @media(max-width:600px){.ca-account-nav{grid-template-columns:1fr}}
  `;
  document.head.append(style);

  let profileEnhanceQueued = false;
  const nativeObserver = new MutationObserver(() => {
    if (profileEnhanceQueued) return;
    profileEnhanceQueued = true;
    setTimeout(() => {
      profileEnhanceQueued = false;
      enhanceProfileDialog();
      enhanceWhatsAppNotice();
    }, 0);
  });
  nativeObserver.observe(document.documentElement, { childList: true, subtree: true });
  enhanceProfileDialog();
  enhanceWhatsAppNotice();
}
