import { api } from './appdeploy-client';
import './admin-quick-arrange.css';
import './admin-quick-arrange-entry.css';

type ProductKind = 'edible' | 'burnaway' | 'printed' | 'acrylic' | 'custom';
type ItemDraft = {
  id: string;
  kind: ProductKind;
  title: string;
  qty: number;
  price: number;
  size: string;
  style: string;
  review: 'No Review' | 'Need Review';
  wording: string;
  referenceUrl: string;
};

type QuickResult = {
  order_db_id: string;
  order_id: string;
  order_token: string;
  total: number;
  confirm_token?: string;
  sync?: SyncStatus;
};

type SyncStatus = {
  order?: { db_id: string; order_no: string; order_token: string; payment: string; status: string; production_ready: boolean };
  sync?: { clickup?: { components_total: number; components_linked: number; outbox_status?: string; outbox_error?: string } };
  components?: Array<{ id: string; label: string; set_label?: string; clickup_task_id?: string; clickup_status?: string; clickup_url?: string }>;
  clickup?: { components_total: number; components_linked: number; outbox_status?: string; outbox_error?: string };
};

type MountOptions = {
  root: HTMLElement;
  username: string;
  permissions: string[];
  onBack: () => void;
  onOpenOrder: (token: string) => void;
  notify: (message: string) => void;
};

const PRODUCT: Record<ProductKind, { label: string; icon: string; k: string; title: string; price: number; size: string; style: string }> = {
  edible: { label: 'Edible Image', icon: '🎂', k: 'edible', title: 'Edible Image', price: 6, size: '3 inch', style: 'Round / Bulat' },
  burnaway: { label: 'Wafer + Edible Combo', icon: '🔥', k: 'burnaway', title: 'Burn Away Combo', price: 12, size: '3 inch', style: 'Round / Bulat' },
  printed: { label: 'Cake Topper', icon: '🎉', k: 'printed', title: 'Cake Topper', price: 10, size: '1 pc', style: 'Custom Name' },
  acrylic: { label: 'Acrylic Topper', icon: '✨', k: 'acrylic', title: 'Acrylic Cake Topper', price: 12, size: 'A7 Mini', style: 'Gold' },
  custom: { label: 'New Custom Design Topper', icon: '✏️', k: 'printed', title: 'New Custom Design Topper', price: 10, size: '1 pc', style: 'Custom' },
};

const e = (value: unknown) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[char] || char));

const makeId = () => crypto.randomUUID();
const money = (value: number) => `RM${value.toFixed(2)}`;
const normalizePhone = (value: string) => {
  const digits = value.replace(/\D/g, '');
  const normalized = digits.startsWith('60') ? digits : digits.startsWith('0') ? `60${digits.slice(1)}` : digits.startsWith('1') ? `60${digits}` : '';
  return /^601\d{8,9}$/.test(normalized) ? `+${normalized}` : '';
};

function newItem(kind: ProductKind): ItemDraft {
  const p = PRODUCT[kind];
  return { id: makeId(), kind, title: p.title, qty: 1, price: p.price, size: p.size, style: p.style, review: 'No Review', wording: '', referenceUrl: '' };
}

function syncSummary(status: SyncStatus | undefined) {
  const clickup = status?.sync?.clickup || status?.clickup;
  if (!clickup) return { tone: 'waiting', title: 'Checking ClickUp…', detail: 'Status akan dikemas kini tanpa mencipta order kedua.' };
  if (clickup.components_total > 0 && clickup.components_linked === clickup.components_total) {
    return { tone: 'success', title: 'ClickUp task created', detail: `${clickup.components_linked}/${clickup.components_total} production component linked.` };
  }
  if (clickup.outbox_status === 'error' || clickup.outbox_status === 'retry') {
    return { tone: 'error', title: 'ClickUp perlu retry', detail: clickup.outbox_error || 'Activepieces belum berjaya memproses task.' };
  }
  if (!status?.order?.production_ready) {
    return { tone: 'waiting', title: 'Order saved — ClickUp ditahan', detail: 'Order belum production-ready. Sahkan bayaran/approval dahulu; sistem akan queue secara automatik.' };
  }
  return { tone: 'waiting', title: 'Queued to Activepieces', detail: `${clickup.components_linked}/${clickup.components_total} component linked. Halaman ini sedang menyemak status.` };
}

export function mountQuickArrange(options: MountOptions) {
  const { root, username, permissions, onBack, onOpenOrder, notify } = options;
  if (!permissions.includes('quick_arrange')) {
    root.innerHTML = `<header class="qa-head"><button id="qaBack">‹</button><div><small>Admin tool</small><h1>Quick Arrange</h1></div></header><main class="qa-shell"><section class="qa-denied"><span>🔒</span><h2>Akses tidak dibenarkan</h2><p>Admin1 boleh beri permission <code>quick_arrange</code> melalui Admin Permissions.</p></section></main>`;
    root.querySelector<HTMLButtonElement>('#qaBack')!.onclick = onBack;
    return;
  }

  let items: ItemDraft[] = [];
  let delivery = 'pickup';
  let payment = '';
  let result: QuickResult | null = null;
  let status: SyncStatus | undefined;
  let pollCount = 0;
  let pollTimer = 0;
  const requestId = makeId();
  let formDraft = { name: '', phone: '', dateNeed: '', source: 'Walk-in', address: '', note: '', notifyWhatsapp: false };

  const total = () => items.reduce((sum, item) => sum + item.qty * item.price, 0) + (delivery === 'spx' ? 4.5 : 0);

  function readForm() {
    const form = root.querySelector<HTMLFormElement>('#qaForm');
    if (!form) return null;
    const data = new FormData(form);
    formDraft = {
      name: String(data.get('name') || '').trim(),
      phone: String(data.get('phone') || ''),
      dateNeed: String(data.get('date_need') || ''),
      source: String(data.get('source') || 'Walk-in'),
      address: String(data.get('address') || '').trim(),
      note: String(data.get('note') || '').trim(),
      notifyWhatsapp: data.get('notify_whatsapp') === 'on',
    };
    return formDraft;
  }

  function captureItemInputs() {
    root.querySelectorAll<HTMLElement>('[data-qa-item]').forEach((card) => {
      const item = items.find((candidate) => candidate.id === card.dataset.qaItem);
      if (!item) return;
      const get = (name: string) => card.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
      item.title = get('title')?.value.trim() || item.title;
      item.qty = Math.max(1, Number(get('qty')?.value || 1));
      item.price = Math.max(0, Number(get('price')?.value || 0));
      item.size = get('size')?.value.trim() || '';
      item.style = get('style')?.value.trim() || '';
      item.review = get('review')?.value === 'Need Review' ? 'Need Review' : 'No Review';
      item.wording = get('wording')?.value.trim() || '';
      item.referenceUrl = get('reference_url')?.value.trim() || '';
    });
    const totalNode = root.querySelector<HTMLElement>('#qaTotal');
    if (totalNode) totalNode.textContent = money(total());
  }

  function itemCard(item: ItemDraft, index: number) {
    const p = PRODUCT[item.kind];
    return `<article class="qa-item" data-qa-item="${item.id}">
      <header><div><span>${p.icon}</span><div><small>Item ${index + 1}</small><strong>${e(p.label)}</strong></div></div><button type="button" data-remove="${item.id}" aria-label="Remove item">×</button></header>
      <div class="qa-grid qa-grid-item">
        <label class="qa-wide">Task / item name<input name="title" value="${e(item.title)}" required></label>
        <label>Qty<input name="qty" type="number" min="1" step="1" value="${item.qty}" required></label>
        <label>Unit price (RM)<input name="price" type="number" min="0" step="0.01" value="${item.price}" required></label>
        <label>Size<input name="size" value="${e(item.size)}" placeholder="5 inch / A6"></label>
        <label>Shape / colour<input name="style" value="${e(item.style)}" placeholder="Round / Gold"></label>
        <label>Design review<select name="review"><option${item.review === 'No Review' ? ' selected' : ''}>No Review</option><option${item.review === 'Need Review' ? ' selected' : ''}>Need Review</option></select></label>
        <label class="qa-wide">Wording / design detail<input name="wording" value="${e(item.wording)}" placeholder="Nama, umur, tema dan arahan ringkas"></label>
        <label class="qa-wide">Reference image link (optional)<input name="reference_url" type="url" value="${e(item.referenceUrl)}" placeholder="https://…"></label>
      </div>
    </article>`;
  }

  function render() {
    clearTimeout(pollTimer);
    const summary = syncSummary(status || result?.sync);
    root.innerHTML = `<header class="qa-head"><button id="qaBack">‹</button><div><small>Logged in as ${e(username)}</small><h1>Quick Arrange</h1></div><button id="qaCopyLink" class="qa-link">Copy link</button></header>
      <main class="qa-shell">
        <section class="qa-intro"><div><span>⚡</span><div><h2>Arrange order cepat</h2><p>Tekan produk, isi detail penting dan terus hantar ke order system + ClickUp.</p></div></div><small>Secure admin session required</small></section>
        ${result ? `<section class="qa-result ${summary.tone}"><span>${summary.tone === 'success' ? '✓' : summary.tone === 'error' ? '!' : '↻'}</span><div><small>Order ${e(result.order_id)}</small><h2>${e(summary.title)}</h2><p>${e(summary.detail)}</p><div class="qa-result-actions"><button id="qaRefresh" type="button">Refresh status</button>${summary.tone === 'error' ? '<button id="qaRetry" type="button">Retry ClickUp</button>' : ''}<button id="qaOpenOrder" type="button">Open order</button><button id="qaNew" type="button">New arrange</button></div></div></section>` : ''}
        <form id="qaForm">
          <section class="qa-card"><div class="qa-section-title"><span>1</span><div><h2>Pilih jenis order</h2><p>Boleh tambah lebih daripada satu produk.</p></div></div><div class="qa-products">${(Object.keys(PRODUCT) as ProductKind[]).map((kind) => `<button type="button" data-add-kind="${kind}"><span>${PRODUCT[kind].icon}</span>${e(PRODUCT[kind].label)}</button>`).join('')}</div></section>
          <section class="qa-card"><div class="qa-section-title"><span>2</span><div><h2>Customer & payment</h2><p>Medan bertanda * diperlukan untuk create order.</p></div></div><div class="qa-grid">
            <label>Nama customer *<input name="name" autocomplete="name" value="${e(formDraft.name)}" required placeholder="Contoh: Nikhafawati"></label>
            <label>No. WhatsApp *<input name="phone" autocomplete="tel" inputmode="tel" value="${e(formDraft.phone)}" required placeholder="0123456789"></label>
            <label>Date need *<input name="date_need" type="date" min="${new Date().toISOString().slice(0, 10)}" value="${e(formDraft.dateNeed)}" required></label>
            <label>Order source<select name="source">${['Walk-in','WhatsApp','Phone','POS'].map((source) => `<option${formDraft.source === source ? ' selected' : ''}>${source}</option>`).join('')}</select></label>
          </div><fieldset class="qa-choice"><legend>Method *</legend><button type="button" data-delivery="pickup" class="${delivery === 'pickup' ? 'active' : ''}">Pickup</button><button type="button" data-delivery="spx" class="${delivery === 'spx' ? 'active' : ''}">Pos SPX (+RM4.50)</button></fieldset>
          <div id="qaAddress" class="${delivery === 'spx' ? '' : 'qa-hidden'}"><label>Alamat penghantaran *<textarea name="address" rows="2" placeholder="Alamat penuh, postcode, bandar dan negeri">${e(formDraft.address)}</textarea></label></div>
          <fieldset class="qa-choice"><legend>Payment *</legend><button type="button" data-payment="Paid" class="${payment === 'Paid' ? 'active' : ''}">Paid</button><button type="button" data-payment="Unpaid" class="${payment === 'Unpaid' ? 'active' : ''}">Pending</button><button type="button" data-payment="Cash Counter" class="${payment === 'Cash Counter' ? 'active' : ''}">Cash Counter</button></fieldset>
          <label class="qa-check"><input name="notify_whatsapp" type="checkbox" ${formDraft.notifyWhatsapp ? 'checked' : ''}><span><b>Notify customer via WhatsApp</b><small>Off by default untuk order counter cepat.</small></span></label></section>
          <section class="qa-card"><div class="qa-section-title"><span>3</span><div><h2>Detail produk</h2><p>Setiap item/component akan ikut mapping ClickUp sedia ada.</p></div></div><div id="qaItems">${items.length ? items.map(itemCard).join('') : '<div class="qa-empty"><span>＋</span><b>Belum ada produk</b><p>Tekan pilihan produk di bahagian atas.</p></div>'}</div><label>Nota admin<textarea name="note" rows="3" placeholder="Urgent, pickup time atau arahan staff">${e(formDraft.note)}</textarea></label></section>
          <section class="qa-submit"><div><small>Order total</small><strong id="qaTotal">${money(total())}</strong><p>ClickUp hanya dicipta apabila order production-ready.</p></div><button id="qaSubmit" type="submit" ${items.length ? '' : 'disabled'}>Create order & arrange</button></section>
        </form>
      </main>`;

    root.querySelector<HTMLButtonElement>('#qaBack')!.onclick = onBack;
    root.querySelector<HTMLButtonElement>('#qaCopyLink')!.onclick = async () => { await navigator.clipboard.writeText(location.href); notify('Quick Arrange link copied'); };
    root.querySelectorAll<HTMLButtonElement>('[data-add-kind]').forEach((button) => button.onclick = () => { readForm(); captureItemInputs(); items.push(newItem(button.dataset.addKind as ProductKind)); render(); });
    root.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((button) => button.onclick = () => { readForm(); captureItemInputs(); items = items.filter((item) => item.id !== button.dataset.remove); render(); });
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-qa-item] input, [data-qa-item] select').forEach((input) => input.addEventListener('input', captureItemInputs));
    root.querySelectorAll<HTMLButtonElement>('[data-delivery]').forEach((button) => button.onclick = () => { readForm(); captureItemInputs(); delivery = button.dataset.delivery || 'pickup'; render(); });
    root.querySelectorAll<HTMLButtonElement>('[data-payment]').forEach((button) => button.onclick = () => { payment = button.dataset.payment || ''; root.querySelectorAll('[data-payment]').forEach((node) => node.classList.toggle('active', node === button)); });
    root.querySelector<HTMLButtonElement>('#qaOpenOrder')?.addEventListener('click', () => result && onOpenOrder(result.order_token));
    root.querySelector<HTMLButtonElement>('#qaNew')?.addEventListener('click', () => location.reload());
    root.querySelector<HTMLButtonElement>('#qaRefresh')?.addEventListener('click', () => void refreshStatus());
    root.querySelector<HTMLButtonElement>('#qaRetry')?.addEventListener('click', () => void retryClickUp());
    root.querySelector<HTMLFormElement>('#qaForm')!.onsubmit = (event) => { event.preventDefault(); void submit(); };
  }

  async function refreshStatus(auto = false) {
    if (!result || !root.isConnected) return;
    try {
      const response = await api.post('/api/admin/quick-arrange-status', { order_id: result.order_db_id });
      status = response.data as SyncStatus;
      pollCount += 1;
      render();
      const clickup = status.sync?.clickup;
      if (auto && clickup && clickup.components_linked < clickup.components_total && pollCount < 20) {
        pollTimer = window.setTimeout(() => void refreshStatus(true), 3000);
      }
    } catch (error) {
      if (!auto) notify(error instanceof Error ? error.message : 'Status tidak dapat disemak');
    }
  }

  async function retryClickUp() {
    if (!result) return;
    try {
      const response = await api.post('/api/admin/quick-arrange-retry', { order_id: result.order_db_id });
      status = response.data as SyncStatus;
      pollCount = 0;
      render();
      pollTimer = window.setTimeout(() => void refreshStatus(true), 2500);
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Retry ClickUp gagal');
    }
  }

  async function submit() {
    captureItemInputs();
    const values = readForm();
    if (!values || !items.length) { notify('Tambah sekurang-kurangnya satu produk'); return; }
    const phone = normalizePhone(values.phone);
    if (!phone) { notify('Nombor WhatsApp Malaysia tidak sah'); return; }
    if (!payment) { notify('Pilih payment: Paid, Pending atau Cash Counter'); return; }
    if (payment === 'Cash Counter' && delivery !== 'pickup') { notify('Cash Counter hanya untuk Pickup'); return; }
    if (delivery === 'spx' && !values.address) { notify('Isi alamat penghantaran SPX'); return; }
    if (!values.name || !values.dateNeed) { notify('Lengkapkan nama customer dan Date Need'); return; }

    const button = root.querySelector<HTMLButtonElement>('#qaSubmit')!;
    button.disabled = true;
    button.textContent = 'Creating securely…';
    const note = [`Source: ${values.source}`, values.note, delivery === 'spx' ? `Address: ${values.address}` : ''].filter(Boolean).join('\n');
    try {
      const response = await api.post('/api/admin/quick-arrange', {
        request_id: requestId,
        customer: { name: values.name, phone, address_line1: values.address, city: '', postcode: '', state: '', phone_masked: '', address_masked: '' },
        items: items.map((item) => ({
          k: PRODUCT[item.kind].k,
          title: item.title,
          process: 'Pre-order',
          review: item.review,
          size: item.size,
          style: item.style,
          customText: item.wording,
          price: item.price,
          qty: item.qty,
          product_snapshot: item.referenceUrl ? { image_url: item.referenceUrl, quick_arrange_kind: item.kind } : { quick_arrange_kind: item.kind },
          customization: item.referenceUrl ? { reference_url: item.referenceUrl } : {},
        })),
        date_need: values.dateNeed,
        delivery,
        delivery_fee: delivery === 'spx' ? 4.5 : 0,
        payment,
        admin_remark: note,
        notify_whatsapp: values.notifyWhatsapp,
      });
      result = response.data as QuickResult;
      status = result.sync;
      pollCount = 0;
      render();
      notify(`Order ${result.order_id} created`);
      pollTimer = window.setTimeout(() => void refreshStatus(true), 2500);
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Create order & arrange';
      notify(error instanceof Error ? error.message : 'Quick Arrange gagal');
    }
  }

  render();
}

let autoMounted = false;
let dashboardLoading = false;

function quickToast(message: string) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  document.body.append(node);
  window.setTimeout(() => node.remove(), 1800);
}

async function installQuickArrange() {
  const root = document.querySelector<HTMLElement>('#app');
  const requested = new URLSearchParams(location.search).get('admin') === 'quick-arrange';

  document.querySelectorAll<HTMLElement>('.admin-users section').forEach((section) => {
    if (section.querySelector('input[value="quick_arrange"]')) return;
    const existing = section.querySelector<HTMLInputElement>('[data-perm-user]');
    const saveButton = section.querySelector<HTMLButtonElement>('[data-save-perms]');
    const username = existing?.dataset.permUser;
    if (!username || !saveButton) return;
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" data-perm-user="${e(username)}" value="quick_arrange" ${username === 'admin1' ? 'checked' : ''}> quick_arrange`;
    saveButton.insertAdjacentElement('beforebegin', label);
  });

  const createOrderButton = document.querySelector<HTMLButtonElement>('#adminCreateOrderBtn');
  if (createOrderButton && !document.querySelector('#adminQuickArrangeBtn')) {
    const button = document.createElement('button');
    button.id = 'adminQuickArrangeBtn';
    button.className = 'admin-create-order-btn qa-admin-entry';
    button.textContent = '⚡ Quick Arrange';
    button.onclick = () => {
      const url = new URL(location.href);
      url.searchParams.set('admin', 'quick-arrange');
      location.assign(url);
    };
    createOrderButton.insertAdjacentElement('afterend', button);
  }

  if (!requested || autoMounted || dashboardLoading || !root || !sessionStorage.getItem('admin_access_token')) return;
  dashboardLoading = true;
  try {
    const response = await api.post('/api/admin/dashboard', { session_token: sessionStorage.getItem('admin_session') || '' });
    const admin = response.data?.admin as { username?: string; permissions?: string[] } | undefined;
    autoMounted = true;
    mountQuickArrange({
      root,
      username: String(admin?.username || 'admin'),
      permissions: Array.isArray(admin?.permissions) ? admin.permissions : [],
      onBack: () => {
        const url = new URL(location.href);
        url.searchParams.set('admin', '1');
        location.assign(url);
      },
      onOpenOrder: (token) => {
        const url = new URL(location.href);
        url.searchParams.delete('admin');
        url.searchParams.set('order', token);
        location.assign(url);
      },
      notify: quickToast,
    });
  } catch {
    // The existing secure admin login remains visible when the session is absent/expired.
  } finally {
    dashboardLoading = false;
  }
}

const quickArrangeObserver = new MutationObserver(() => void installQuickArrange());
quickArrangeObserver.observe(document.body, { childList: true, subtree: true });
window.addEventListener('load', () => void installQuickArrange());
window.setInterval(() => void installQuickArrange(), 500);
void installQuickArrange();
