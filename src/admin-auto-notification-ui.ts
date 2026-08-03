import './admin-ready-pickup-action';
import { api, supabase } from '@appdeploy/client';

type CreateResult = {
  order_id?: string;
  notify_whatsapp?: boolean;
  notification_status?: string;
};

type ToggleResult = {
  order_no?: string;
  enabled?: boolean;
  cancelled_pending?: number;
};

type ControlSummary = {
  global_enabled?: boolean;
  enabled_count?: number;
  total_count?: number;
};

type LastCreateState = {
  orderId: string;
  enabled: boolean;
  status: string;
};

declare global {
  interface Window {
    __icetakAdminNotificationApiPatched?: boolean;
  }
}

const orderState = new Map<string, boolean>();
let lastCreateState: LastCreateState | null = null;
let enhancementQueued = false;
let stateRequestRunning = false;
let controlSummary: ControlSummary | null = null;

function showNotice(message: string, bad = false) {
  document.querySelector('.admin-notification-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = `admin-notification-toast${bad ? ' bad' : ''}`;
  toast.textContent = message;
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 3200);
}

function openNotificationControl() {
  const clickButton = () => {
    const button = document.querySelector<HTMLButtonElement>('#wf5OpenBtn');
    if (!button) return false;
    button.click();
    return true;
  };

  if (clickButton()) return;
  window.dispatchEvent(new Event('focus'));
  window.setTimeout(() => {
    if (!clickButton()) showNotice('WhatsApp Control masih loading. Cuba semula sekejap lagi.', true);
  }, 350);
}

function notificationStatusText(state: LastCreateState) {
  if (!state.enabled || state.status === 'disabled') {
    return {
      title: 'WhatsApp OFF',
      body: 'Order disimpan tanpa notifikasi WhatsApp. Semua notifikasi seterusnya untuk order ini juga dimatikan.',
      tone: 'off',
    };
  }

  if (state.status === 'rule_disabled') {
    return {
      title: 'Order Created rule OFF',
      body: 'Order disimpan. Notifikasi Order Created tidak dihantar kerana event ini dimatikan dalam WhatsApp Control.',
      tone: 'warn',
    };
  }

  if (state.status === 'global_disabled') {
    return {
      title: 'WhatsApp global OFF',
      body: 'Order disimpan. Semua notifikasi WhatsApp sedang dimatikan dalam WhatsApp Control.',
      tone: 'warn',
    };
  }

  if (state.status === 'not_queued') {
    return {
      title: 'WhatsApp belum beratur',
      body: 'Order disimpan tetapi notifikasi belum masuk queue. Semak WhatsApp Control → Queue & Logs.',
      tone: 'warn',
    };
  }

  return {
    title: 'WhatsApp Auto ON',
    body: 'Order disimpan dan notifikasi dihantar automatik melalui queue. Tidak perlu hantar mesej order yang sama secara manual.',
    tone: 'on',
  };
}

function patchAdminCreateApi() {
  if (window.__icetakAdminNotificationApiPatched) return;
  window.__icetakAdminNotificationApiPatched = true;

  const originalPost = api.post.bind(api);
  (api as { post: typeof api.post }).post = async (path: string, body?: unknown) => {
    if (path !== '/api/admin/orders') return originalPost(path, body);

    const checkbox = document.querySelector<HTMLInputElement>('#adminNotifyWhatsapp');
    const enabled = checkbox?.checked ?? true;
    const payload = {
      ...((body && typeof body === 'object') ? body as Record<string, unknown> : {}),
      notify_whatsapp: enabled,
    };

    const response = await originalPost(path, payload);
    const result = (response?.data || {}) as CreateResult;
    lastCreateState = {
      orderId: String(result.order_id || ''),
      enabled: result.notify_whatsapp ?? enabled,
      status: String(result.notification_status || (enabled ? 'queued' : 'disabled')),
    };
    window.dispatchEvent(new CustomEvent('icetak:admin-order-created', { detail: lastCreateState }));
    return response;
  };
}

async function loadControlSummary() {
  if (controlSummary) return controlSummary;
  const { data, error } = await supabase.rpc('icetak_admin_notification_control_summary');
  if (error) return null;
  controlSummary = (data || {}) as ControlSummary;
  return controlSummary;
}

function summaryText(summary: ControlSummary | null) {
  if (!summary) return 'Tetapan event boleh diubah dalam WhatsApp Control.';
  if (summary.global_enabled === false) return 'Global WhatsApp: OFF';
  return `Global WhatsApp: ON · ${Number(summary.enabled_count || 0)}/${Number(summary.total_count || 0)} event aktif`;
}

function enhanceCreateForm() {
  const form = document.querySelector<HTMLFormElement>('#adminCreateOrder');
  if (!form || form.querySelector('#adminNotifyWhatsapp')) return;

  const submit = Array.from(form.querySelectorAll<HTMLButtonElement>('button'))
    .find(button => button.type !== 'button' && button.classList.contains('confirm'));
  if (!submit) return;

  const panel = document.createElement('section');
  panel.className = 'admin-notification-choice';
  panel.innerHTML = `
    <div class="admin-notification-choice-head">
      <div>
        <b>WhatsApp Notification</b>
        <small data-notification-summary>Tetapan event boleh diubah dalam WhatsApp Control.</small>
      </div>
      <button type="button" data-open-notification-control>Manage Rules</button>
    </div>
    <label class="admin-notification-switch">
      <input id="adminNotifyWhatsapp" name="notify_whatsapp" type="checkbox" checked>
      <span>
        <b>Hantar notifikasi WhatsApp untuk order ini</b>
        <small>Jika OFF, Order Created, bayaran, design, production dan shipping untuk order ini tidak akan dihantar.</small>
      </span>
    </label>`;
  submit.insertAdjacentElement('beforebegin', panel);
  panel.querySelector<HTMLButtonElement>('[data-open-notification-control]')!.onclick = openNotificationControl;

  void loadControlSummary().then(summary => {
    const target = panel.querySelector<HTMLElement>('[data-notification-summary]');
    if (target) target.textContent = summaryText(summary);
  });
}

function enhanceAdminToolbar() {
  const createButton = document.querySelector<HTMLButtonElement>('#adminCreateOrderBtn');
  if (!createButton || document.querySelector('#adminNotificationRulesButton')) return;

  const button = document.createElement('button');
  button.id = 'adminNotificationRulesButton';
  button.type = 'button';
  button.textContent = '⚡ WhatsApp Control';
  button.onclick = openNotificationControl;
  createButton.insertAdjacentElement('afterend', button);
}

function enhanceCreatedModal() {
  document.querySelectorAll<HTMLElement>('.modal').forEach(modal => {
    const copyButton = modal.querySelector<HTMLButtonElement>('#copyOrderLink');
    const orderIdElement = modal.querySelector<HTMLElement>('.order-confirm-id');
    if (!copyButton || !orderIdElement) return;

    const orderId = orderIdElement.textContent?.trim() || '';
    const manualButton = modal.querySelector<HTMLElement>('a.wa-confirm');
    manualButton?.remove();

    const paragraphs = Array.from(modal.querySelectorAll<HTMLParagraphElement>('p'));
    const legacy = paragraphs.find(p => /Activepieces|notification turut dimasukkan|Notifikasi WhatsApp akan dihantar/i.test(p.textContent || ''));
    const state = lastCreateState?.orderId === orderId
      ? lastCreateState
      : { orderId, enabled: true, status: 'queued' };
    const copy = notificationStatusText(state);

    if (legacy) legacy.textContent = copy.body;

    let badge = modal.querySelector<HTMLElement>('.admin-created-notification-status');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'admin-created-notification-status';
      copyButton.insertAdjacentElement('beforebegin', badge);
    }
    badge.className = `admin-created-notification-status ${copy.tone}`;
    badge.innerHTML = `<b>${copy.title}</b><span>${copy.body}</span>`;

    if (!modal.querySelector('[data-created-manage-rules]')) {
      const manageButton = document.createElement('button');
      manageButton.type = 'button';
      manageButton.className = 'confirm secondary-confirm';
      manageButton.dataset.createdManageRules = 'true';
      manageButton.textContent = 'Manage WhatsApp Rules';
      manageButton.onclick = openNotificationControl;
      copyButton.insertAdjacentElement('beforebegin', manageButton);
    }
  });
}

function visibleOrderCards() {
  return Array.from(document.querySelectorAll<HTMLElement>('.admin-order-card'))
    .map(card => ({
      card,
      orderNo: card.querySelector<HTMLElement>('header b')?.textContent?.trim() || '',
      footer: card.querySelector<HTMLElement>('footer'),
    }))
    .filter(item => item.orderNo && item.footer);
}

function paintOrderToggle(button: HTMLButtonElement, enabled: boolean) {
  button.disabled = false;
  button.className = `order-whatsapp-toggle ${enabled ? 'on' : 'off'}`;
  button.textContent = enabled ? 'WhatsApp ON' : 'WhatsApp OFF';
  button.title = enabled
    ? 'Klik untuk matikan semua notifikasi WhatsApp bagi order ini.'
    : 'Klik untuk aktifkan notifikasi bagi status seterusnya. Mesej lama tidak dihantar semula.';
}

async function toggleOrderNotification(orderNo: string, button: HTMLButtonElement) {
  const current = orderState.get(orderNo) ?? true;
  const next = !current;
  const accepted = window.confirm(next
    ? `Aktifkan WhatsApp untuk ${orderNo}?\n\nHanya notifikasi status seterusnya akan dihantar. Mesej lama tidak dihantar semula.`
    : `Matikan WhatsApp untuk ${orderNo}?\n\nSemua notifikasi pending untuk order ini akan dibatalkan.`);
  if (!accepted) return;

  button.disabled = true;
  button.textContent = 'Updating…';
  const { data, error } = await supabase.rpc('icetak_admin_set_order_whatsapp', {
    p_order_no: orderNo,
    p_enabled: next,
  });

  if (error) {
    paintOrderToggle(button, current);
    showNotice(error.message || 'Gagal ubah WhatsApp order', true);
    return;
  }

  const result = (data || {}) as ToggleResult;
  const enabled = result.enabled ?? next;
  orderState.set(orderNo, enabled);
  paintOrderToggle(button, enabled);
  const cancelled = Number(result.cancelled_pending || 0);
  showNotice(enabled
    ? `${orderNo}: WhatsApp diaktifkan untuk status seterusnya.`
    : `${orderNo}: WhatsApp dimatikan${cancelled ? ` · ${cancelled} pending dibatalkan` : ''}.`);
}

async function loadVisibleOrderStates() {
  if (stateRequestRunning) return;
  const cards = visibleOrderCards();
  const missing = cards.map(item => item.orderNo).filter(orderNo => !orderState.has(orderNo));
  if (!missing.length) {
    cards.forEach(({ card, orderNo, footer }) => {
      const button = card.querySelector<HTMLButtonElement>('[data-order-whatsapp-toggle]');
      if (button && orderState.has(orderNo)) paintOrderToggle(button, orderState.get(orderNo)!);
      if (!button && footer) addOrderToggle(card, footer, orderNo);
    });
    return;
  }

  stateRequestRunning = true;
  const { data, error } = await supabase.rpc('icetak_admin_order_notification_states', {
    p_order_nos: Array.from(new Set(missing)),
  });
  stateRequestRunning = false;

  if (error) {
    cards.forEach(({ card, footer, orderNo }) => {
      if (!footer) return;
      let button = card.querySelector<HTMLButtonElement>('[data-order-whatsapp-toggle]');
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.dataset.orderWhatsappToggle = orderNo;
        footer.append(button);
      }
      button.disabled = true;
      button.className = 'order-whatsapp-toggle off';
      button.textContent = 'WhatsApp ?';
      button.title = error.message || 'Status WhatsApp tidak dapat dimuatkan';
    });
    return;
  }

  if (data && typeof data === 'object') {
    Object.entries(data as Record<string, unknown>).forEach(([orderNo, enabled]) => {
      orderState.set(orderNo, Boolean(enabled));
    });
  }

  cards.forEach(({ card, orderNo, footer }) => {
    if (!orderState.has(orderNo)) orderState.set(orderNo, false);
    if (footer) addOrderToggle(card, footer, orderNo);
  });
}

function addOrderToggle(card: HTMLElement, footer: HTMLElement, orderNo: string) {
  let button = card.querySelector<HTMLButtonElement>('[data-order-whatsapp-toggle]');
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.dataset.orderWhatsappToggle = orderNo;
    button.textContent = 'WhatsApp…';
    button.disabled = true;
    button.onclick = () => void toggleOrderNotification(orderNo, button!);
    footer.append(button);
  }
  paintOrderToggle(button, orderState.get(orderNo) ?? true);
}

function runEnhancements() {
  enhancementQueued = false;
  enhanceCreateForm();
  enhanceAdminToolbar();
  enhanceCreatedModal();
  void loadVisibleOrderStates();
}

function queueEnhancements() {
  if (enhancementQueued) return;
  enhancementQueued = true;
  window.setTimeout(runEnhancements, 40);
}

patchAdminCreateApi();

const observer = new MutationObserver(queueEnhancements);
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('load', queueEnhancements);
window.addEventListener('icetak:admin-order-created', queueEnhancements);
queueEnhancements();

const style = document.createElement('style');
style.textContent = `
.admin-notification-choice{grid-column:1/-1;border:1px solid #bbf7d0;background:#f0fdf4;border-radius:14px;padding:14px;margin:4px 0 10px}
.admin-notification-choice-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px}.admin-notification-choice-head b{display:block}.admin-notification-choice-head small{display:block;color:#58715f;margin-top:3px}
.admin-notification-choice-head button,#adminNotificationRulesButton{border:0;border-radius:10px;background:#166534;color:#fff;padding:10px 13px;font-weight:850;white-space:nowrap}
#adminNotificationRulesButton{margin:0 0 14px 10px;background:#15803d}
.admin-notification-switch{display:flex!important;gap:11px;align-items:flex-start;background:#fff;border:1px solid #dcfce7;border-radius:12px;padding:12px!important;cursor:pointer}
.admin-notification-switch input{width:20px!important;height:20px;margin:1px 0 0!important;flex:0 0 auto}.admin-notification-switch span{display:block}.admin-notification-switch b,.admin-notification-switch small{display:block}.admin-notification-switch small{color:#64748b;margin-top:4px;line-height:1.35}
.admin-created-notification-status{border-radius:12px;padding:12px 14px;margin:8px 0 12px;display:grid;gap:3px}.admin-created-notification-status b{font-size:14px}.admin-created-notification-status span{font-size:13px;line-height:1.4}.admin-created-notification-status.on{background:#dcfce7;color:#14532d}.admin-created-notification-status.off{background:#f1f5f9;color:#334155}.admin-created-notification-status.warn{background:#fef3c7;color:#92400e}
.order-whatsapp-toggle{font-weight:850!important;border-radius:9px!important}.order-whatsapp-toggle.on{background:#dcfce7!important;color:#166534!important;border:1px solid #86efac!important}.order-whatsapp-toggle.off{background:#f1f5f9!important;color:#475569!important;border:1px solid #cbd5e1!important}
.admin-notification-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:1000001;background:#166534;color:#fff;padding:12px 17px;border-radius:12px;font-weight:850;box-shadow:0 15px 40px #0003;max-width:min(760px,92vw);text-align:center}.admin-notification-toast.bad{background:#b42318}
@media(max-width:700px){.admin-notification-choice-head{display:block}.admin-notification-choice-head button{margin-top:10px;width:100%}#adminNotificationRulesButton{display:block;width:100%;margin:0 0 12px}.admin-notification-switch{align-items:flex-start}}
`;
document.head.append(style);
