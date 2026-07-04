import './styles.css';
import './pwa.css';
import { supabase } from './lib/supabase';
import {
  fetchDashboardStats,
  fetchRecentOrders,
  fetchOrders,
  fetchCustomers,
  fetchOrder,
  fetchOrderItems,
  fetchProductionComponents,
  fetchPaymentSessions,
  createPaymentSession,
  updatePaymentSession,
  uploadReceipt,
  fetchShipmentEvents,
  createShipmentEvent,
  updateOrderStatus,
  createCustomer,
  createOrder,
} from './lib/queries';
import type { Order, OrderStatus } from './lib/types';
import { PRODUCT_CATALOG, PRODUCT_TYPES, getProductLabel } from './product-details';

// ─── PWA Setup ──────────────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

const offlineBadge = document.createElement('div');
offlineBadge.id = 'offline-badge';
offlineBadge.textContent = 'Offline';
document.body.appendChild(offlineBadge);

window.addEventListener('online', () => offlineBadge.classList.remove('show'));
window.addEventListener('offline', () => offlineBadge.classList.add('show'));
if (!navigator.onLine) offlineBadge.classList.add('show');

// ─── App Shell ───────────────────────────────────────────────────────────────

const app = document.getElementById('app')!;

app.innerHTML = `
  <div class="min-h-screen flex flex-col bg-slate-100">
    <header class="bg-slate-900 text-white px-4 sm:px-6 py-3 flex items-center gap-4 shadow-md">
      <div class="flex items-center gap-2 font-bold text-lg tracking-tight">
        <span class="text-sky-400">iCetak</span>
        <span class="text-slate-400 font-normal text-sm">Admin</span>
      </div>
      <nav id="main-nav" class="flex items-center gap-1 ml-4">
        <button data-tab="dashboard" class="nav-btn nav-btn-active">Dashboard</button>
        <button data-tab="orders" class="nav-btn">Orders</button>
        <button data-tab="customers" class="nav-btn">Customers</button>
      </nav>
    </header>
    <main id="main-content" class="flex-1 p-4 sm:p-6 max-w-7xl mx-auto w-full"></main>
  </div>
  <div id="order-drawer" class="fixed inset-0 z-50 hidden">
    <div id="drawer-overlay" class="absolute inset-0 bg-black/40"></div>
    <div id="drawer-panel" class="absolute right-0 top-0 h-full w-full max-w-2xl bg-white shadow-2xl flex flex-col translate-x-full transition-transform duration-300">
      <div id="drawer-content" class="flex flex-col h-full"></div>
    </div>
  </div>
  <div id="modal-container"></div>
`;

// ─── Nav Styles (injected) ────────────────────────────────────────────────────

const navStyle = document.createElement('style');
navStyle.textContent = `
  .nav-btn { padding: 0.35rem 0.85rem; border-radius: 0.5rem; font-size: 0.875rem; font-weight: 500; background: transparent; color: #94a3b8; border: none; cursor: pointer; transition: background 0.15s, color 0.15s; }
  .nav-btn:hover { background: #1e293b; color: #e2e8f0; }
  .nav-btn-active { background: #0f172a !important; color: #38bdf8 !important; }
`;
document.head.appendChild(navStyle);

// ─── Router ───────────────────────────────────────────────────────────────────

type Tab = 'dashboard' | 'orders' | 'customers';
let currentTab: Tab = 'dashboard';

document.getElementById('main-nav')!.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('[data-tab]');
  if (!btn) return;
  navigateTo(btn.getAttribute('data-tab') as Tab);
});

function navigateTo(tab: Tab) {
  currentTab = tab;
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('nav-btn-active'));
  document.querySelector(`[data-tab="${tab}"]`)?.classList.add('nav-btn-active');
  renderPage();
}

function renderPage() {
  const content = document.getElementById('main-content')!;
  content.innerHTML = '<div class="flex justify-center py-16"><div class="w-8 h-8 border-4 border-sky-500 border-t-transparent rounded-full animate-spin"></div></div>';
  if (currentTab === 'dashboard') renderDashboard();
  else if (currentTab === 'orders') renderOrders();
  else if (currentTab === 'customers') renderCustomers();
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return 'RM ' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtDate(s: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
}

function statusBadge(status: string): string {
  const map: Record<string, string> = {
    pending: 'badge-yellow',
    confirmed: 'badge-blue',
    in_production: 'badge-orange',
    ready: 'badge-cyan',
    shipped: 'badge-purple',
    delivered: 'badge-green',
    cancelled: 'badge-red',
    unpaid: 'badge-yellow',
    partial: 'badge-orange',
    paid: 'badge-green',
    refunded: 'badge-gray',
  };
  return `<span class="${map[status] ?? 'badge-gray'}">${status.replace(/_/g, ' ')}</span>`;
}

function errHtml(msg: string) {
  return `<div class="text-red-600 bg-red-50 border border-red-200 rounded-xl p-4 text-sm">${msg}</div>`;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

async function renderDashboard() {
  const content = document.getElementById('main-content')!;
  try {
    const [stats, recent] = await Promise.all([fetchDashboardStats(), fetchRecentOrders()]);
    content.innerHTML = `
      <div class="space-y-6">
        <h1 class="text-xl font-bold text-slate-800">Dashboard</h1>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          ${statCard('Total Orders', String(stats.total), 'text-sky-600')}
          ${statCard('Revenue', fmt(stats.revenue), 'text-green-600')}
          ${statCard('In Production', String(stats.in_production), 'text-orange-500')}
          ${statCard('Pending', String(stats.pending), 'text-yellow-500')}
        </div>
        <div class="card p-4">
          <div class="flex items-center justify-between mb-3">
            <h2 class="font-semibold text-slate-700">Recent Orders</h2>
            <button class="text-xs text-sky-600 hover:underline" id="dash-view-all">View all</button>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead><tr class="text-left text-slate-400 border-b border-slate-100">
                <th class="pb-2 font-medium">Order</th>
                <th class="pb-2 font-medium">Customer</th>
                <th class="pb-2 font-medium">Status</th>
                <th class="pb-2 font-medium text-right">Total</th>
                <th class="pb-2 font-medium text-right">Date</th>
              </tr></thead>
              <tbody>${recent.map(orderRow).join('')}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    document.getElementById('dash-view-all')?.addEventListener('click', () => navigateTo('orders'));
    content.querySelectorAll('[data-order-id]').forEach((el) => {
      el.addEventListener('click', () => openOrderDrawer(el.getAttribute('data-order-id')!));
    });
  } catch (e: unknown) {
    content.innerHTML = errHtml((e as Error).message);
  }
}

function statCard(label: string, value: string, cls: string) {
  return `<div class="card p-4"><p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">${label}</p><p class="text-2xl font-bold ${cls}">${value}</p></div>`;
}

function orderRow(o: Order) {
  return `<tr class="border-b border-slate-50 hover:bg-slate-50 cursor-pointer" data-order-id="${o.id}">
    <td class="py-2.5 font-mono text-xs text-slate-600">${o.order_no}</td>
    <td class="py-2.5 text-slate-700">${o.customers?.name ?? '—'}</td>
    <td class="py-2.5">${statusBadge(o.status)}</td>
    <td class="py-2.5 text-right text-slate-700">${fmt(o.total)}</td>
    <td class="py-2.5 text-right text-slate-400 text-xs">${fmtDate(o.created_at)}</td>
  </tr>`;
}

// ─── Orders ───────────────────────────────────────────────────────────────────

let ordersFilter: OrderStatus | 'all' = 'all';
let ordersSearch = '';

async function renderOrders() {
  const content = document.getElementById('main-content')!;
  const statusOpts: Array<OrderStatus | 'all'> = ['all', 'pending', 'confirmed', 'in_production', 'ready', 'shipped', 'delivered', 'cancelled'];
  content.innerHTML = `
    <div class="space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 class="text-xl font-bold text-slate-800">Orders</h1>
        <button id="new-order-btn" class="btn-primary self-start sm:self-auto">+ New Order</button>
      </div>
      <div class="flex flex-col sm:flex-row gap-2">
        <input id="orders-search" type="search" placeholder="Search order no or customer..." value="${ordersSearch}" class="form-input sm:w-64">
        <select id="orders-status" class="form-input sm:w-44">
          ${statusOpts.map((s) => `<option value="${s}" ${s === ordersFilter ? 'selected' : ''}>${s === 'all' ? 'All statuses' : s.replace(/_/g, ' ')}</option>`).join('')}
        </select>
      </div>
      <div id="orders-table" class="card overflow-hidden">
        <div class="flex justify-center py-12"><div class="w-7 h-7 border-4 border-sky-500 border-t-transparent rounded-full animate-spin"></div></div>
      </div>
    </div>
  `;

  document.getElementById('new-order-btn')!.addEventListener('click', openNewOrderModal);
  document.getElementById('orders-search')!.addEventListener('input', (e) => {
    ordersSearch = (e.target as HTMLInputElement).value;
    loadOrdersTable();
  });
  document.getElementById('orders-status')!.addEventListener('change', (e) => {
    ordersFilter = (e.target as HTMLSelectElement).value as OrderStatus | 'all';
    loadOrdersTable();
  });

  loadOrdersTable();
}

async function loadOrdersTable() {
  const el = document.getElementById('orders-table');
  if (!el) return;
  try {
    const orders = await fetchOrders(ordersFilter, ordersSearch);
    if (!orders.length) {
      el.innerHTML = '<p class="text-center text-slate-400 py-12 text-sm">No orders found.</p>';
      return;
    }
    el.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead><tr class="text-left text-slate-400 bg-slate-50 border-b border-slate-100">
            <th class="px-4 py-3 font-medium">Order No</th>
            <th class="px-4 py-3 font-medium">Customer</th>
            <th class="px-4 py-3 font-medium">Status</th>
            <th class="px-4 py-3 font-medium">Payment</th>
            <th class="px-4 py-3 font-medium text-right">Total</th>
            <th class="px-4 py-3 font-medium text-right">Created</th>
          </tr></thead>
          <tbody>${orders.map((o) => `<tr class="border-b border-slate-50 hover:bg-slate-50 cursor-pointer" data-order-id="${o.id}">
            <td class="px-4 py-3 font-mono text-xs text-slate-600">${o.order_no}</td>
            <td class="px-4 py-3 text-slate-700">${o.customers?.name ?? '—'}</td>
            <td class="px-4 py-3">${statusBadge(o.status)}</td>
            <td class="px-4 py-3">${statusBadge(o.payment_status)}</td>
            <td class="px-4 py-3 text-right text-slate-700">${fmt(o.total)}</td>
            <td class="px-4 py-3 text-right text-slate-400 text-xs">${fmtDate(o.created_at)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    `;
    el.querySelectorAll('[data-order-id]').forEach((row) => {
      row.addEventListener('click', () => openOrderDrawer(row.getAttribute('data-order-id')!));
    });
  } catch (e: unknown) {
    el.innerHTML = errHtml((e as Error).message);
  }
}

// ─── Order Drawer ─────────────────────────────────────────────────────────────

let drawerOrderId: string | null = null;
let drawerTab = 'items';

async function openOrderDrawer(id: string) {
  drawerOrderId = id;
  drawerTab = 'items';
  const drawer = document.getElementById('order-drawer')!;
  const panel = document.getElementById('drawer-panel')!;
  drawer.classList.remove('hidden');
  requestAnimationFrame(() => panel.classList.remove('translate-x-full'));
  document.getElementById('drawer-overlay')!.onclick = closeOrderDrawer;
  await loadDrawerContent();
}

function closeOrderDrawer() {
  const panel = document.getElementById('drawer-panel')!;
  panel.classList.add('translate-x-full');
  setTimeout(() => document.getElementById('order-drawer')!.classList.add('hidden'), 300);
}

async function loadDrawerContent() {
  const el = document.getElementById('drawer-content')!;
  if (!drawerOrderId) return;
  el.innerHTML = '<div class="flex justify-center py-12"><div class="w-7 h-7 border-4 border-sky-500 border-t-transparent rounded-full animate-spin"></div></div>';
  try {
    const order = await fetchOrder(drawerOrderId);
    if (!order) { el.innerHTML = errHtml('Order not found'); return; }

    const tabs = ['items', 'production', 'payments', 'shipments'];
    el.innerHTML = `
      <div class="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div>
          <p class="font-mono text-xs text-slate-400 mb-0.5">${order.order_no}</p>
          <p class="font-semibold text-slate-800">${order.customers?.name ?? 'Unknown customer'}</p>
        </div>
        <button id="close-drawer" class="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
      </div>
      <div class="flex items-center gap-4 px-5 py-2 border-b border-slate-100 bg-slate-50">
        <div class="flex items-center gap-2 text-sm">${statusBadge(order.status)} ${statusBadge(order.payment_status)}</div>
        <span class="ml-auto font-semibold text-slate-700">${fmt(order.total)}</span>
      </div>
      <div class="flex gap-0 border-b border-slate-100">
        ${tabs.map((t) => `<button data-drawer-tab="${t}" class="drawer-tab ${t === drawerTab ? 'drawer-tab-active' : ''}">${t.charAt(0).toUpperCase() + t.slice(1)}</button>`).join('')}
      </div>
      <div id="drawer-tab-body" class="flex-1 overflow-y-auto p-5"></div>
      <div class="px-5 py-3 border-t border-slate-100 bg-slate-50">
        <label class="form-label">Update Status</label>
        <div class="flex gap-2">
          <select id="status-select" class="form-input flex-1">
            ${(['pending','confirmed','in_production','ready','shipped','delivered','cancelled'] as OrderStatus[]).map((s) => `<option value="${s}" ${s === order.status ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`).join('')}
          </select>
          <button id="status-save-btn" class="btn-primary whitespace-nowrap">Save</button>
        </div>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = '.drawer-tab { padding: 0.6rem 1rem; font-size: 0.8rem; font-weight: 500; color: #64748b; background: transparent; border: none; cursor: pointer; border-bottom: 2px solid transparent; } .drawer-tab-active { color: #0ea5e9; border-bottom-color: #0ea5e9; } .drawer-tab:hover:not(.drawer-tab-active) { color: #334155; }';
    el.prepend(style);

    document.getElementById('close-drawer')!.onclick = closeOrderDrawer;
    el.querySelectorAll('[data-drawer-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        drawerTab = btn.getAttribute('data-drawer-tab')!;
        el.querySelectorAll('.drawer-tab').forEach((b) => b.classList.remove('drawer-tab-active'));
        btn.classList.add('drawer-tab-active');
        loadDrawerTab(order.id);
      });
    });

    document.getElementById('status-save-btn')!.addEventListener('click', async () => {
      const sel = document.getElementById('status-select') as HTMLSelectElement;
      const btn = document.getElementById('status-save-btn') as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        await updateOrderStatus(order.id, sel.value as OrderStatus);
        btn.textContent = 'Saved!';
        setTimeout(() => { btn.disabled = false; btn.textContent = 'Save'; }, 1500);
        if (currentTab === 'orders') loadOrdersTable();
      } catch (e: unknown) {
        btn.disabled = false;
        btn.textContent = 'Error';
        alert((e as Error).message);
      }
    });

    loadDrawerTab(order.id);
  } catch (e: unknown) {
    el.innerHTML = errHtml((e as Error).message);
  }
}

async function loadDrawerTab(orderId: string) {
  const body = document.getElementById('drawer-tab-body');
  if (!body) return;
  body.innerHTML = '<div class="flex justify-center py-8"><div class="w-6 h-6 border-4 border-sky-500 border-t-transparent rounded-full animate-spin"></div></div>';
  try {
    if (drawerTab === 'items') {
      const items = await fetchOrderItems(orderId);
      body.innerHTML = items.length ? `<div class="space-y-3">${items.map((i) => `
        <div class="card p-3">
          <div class="flex items-start justify-between gap-2">
            <div>
              <p class="font-semibold text-sm text-slate-700">${getProductLabel(i.product_type)}</p>
              ${i.title ? `<p class="text-xs text-slate-500 mt-0.5">${i.title}</p>` : ''}
              ${i.size ? `<p class="text-xs text-slate-400">${i.size}</p>` : ''}
            </div>
            <div class="text-right shrink-0">
              <p class="text-sm font-semibold text-slate-700">${fmt(i.qty * i.price)}</p>
              <p class="text-xs text-slate-400">${i.qty} × ${fmt(i.price)}</p>
            </div>
          </div>
        </div>`).join('')}</div>`
        : '<p class="text-slate-400 text-sm">No items.</p>';
    } else if (drawerTab === 'production') {
      const comps = await fetchProductionComponents(orderId);
      body.innerHTML = comps.length ? `<div class="space-y-3">${comps.map((c) => `
        <div class="card p-3">
          <div class="flex items-center justify-between">
            <p class="font-semibold text-sm text-slate-700">${c.label ?? c.component_type}</p>
            ${c.review_status ? statusBadge(c.review_status) : ''}
          </div>
          ${c.clickup_status ? `<p class="text-xs text-slate-400 mt-1">ClickUp: ${c.clickup_status}</p>` : ''}
          ${c.preview_url ? `<a href="${c.preview_url}" target="_blank" class="text-xs text-sky-600 hover:underline mt-1 block">View Preview</a>` : ''}
        </div>`).join('')}</div>`
        : '<p class="text-slate-400 text-sm">No production components.</p>';
    } else if (drawerTab === 'payments') {
      const sessions = await fetchPaymentSessions(orderId);
      body.innerHTML = `
        <div class="space-y-3">
          ${sessions.length ? sessions.map((p) => `
            <div class="card p-3" data-session-id="${p.id}">
              <div class="flex items-center justify-between mb-1">
                <p class="font-semibold text-sm text-slate-700">${fmt(p.expected_amount)}</p>
                ${statusBadge(p.status)}
              </div>
              ${p.transaction_id ? `<p class="text-xs text-slate-400">Txn: ${p.transaction_id}</p>` : ''}
              ${p.submitted_at ? `<p class="text-xs text-slate-400">Submitted: ${fmtDate(p.submitted_at)}</p>` : ''}
              ${p.receipt_name ? `<p class="text-xs text-slate-500">Receipt: ${p.receipt_name}</p>` : ''}
              ${p.status !== 'matched' ? `
                <div class="mt-2 pt-2 border-t border-slate-100 flex flex-wrap gap-2">
                  <label class="btn-ghost text-xs cursor-pointer">
                    Upload Receipt
                    <input type="file" accept="image/*,.pdf" class="hidden receipt-file" data-sid="${p.id}" />
                  </label>
                  ${p.status === 'pending' ? `<button class="btn-ghost text-xs mark-submitted" data-sid="${p.id}">Mark Submitted</button>` : ''}
                  ${p.status === 'submitted' ? `<button class="btn-ghost text-xs text-green-600 mark-matched" data-sid="${p.id}">Mark Matched</button>` : ''}
                </div>` : ''}
            </div>`).join('') : '<p class="text-slate-400 text-sm">No payment sessions.</p>'}
          <div class="card p-3 border-dashed">
            <p class="text-xs font-semibold text-slate-500 mb-2">Add Payment Session</p>
            <div class="grid grid-cols-2 gap-2 mb-2">
              <div><label class="form-label">Base Amount (RM)</label><input id="ps-base" type="number" min="0" step="0.01" class="form-input" placeholder="0.00" /></div>
              <div><label class="form-label">Discount (RM)</label><input id="ps-discount" type="number" min="0" step="0.01" class="form-input" placeholder="0.00" /></div>
            </div>
            <button id="ps-add" class="btn-primary text-xs w-full">+ Create Session</button>
            <p id="ps-error" class="text-red-600 text-xs mt-1 hidden"></p>
          </div>
        </div>
      `;

      body.querySelectorAll('.receipt-file').forEach((input) => {
        input.addEventListener('change', async (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          const sid = (e.target as HTMLInputElement).dataset.sid!;
          if (!file) return;
          const card = body.querySelector(`[data-session-id="${sid}"]`);
          try {
            const { path, name } = await uploadReceipt(sid, file);
            await updatePaymentSession(sid, { receipt_path: path, receipt_name: name });
            if (card) {
              const p = document.createElement('p');
              p.className = 'text-xs text-green-600 mt-1';
              p.textContent = `Uploaded: ${name}`;
              card.appendChild(p);
            }
            loadDrawerTab(orderId);
          } catch (err: unknown) {
            alert((err as Error).message);
          }
        });
      });

      body.querySelectorAll('.mark-submitted').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const sid = (btn as HTMLElement).dataset.sid!;
          try {
            await updatePaymentSession(sid, { status: 'submitted' });
            loadDrawerTab(orderId);
          } catch (err: unknown) { alert((err as Error).message); }
        });
      });

      body.querySelectorAll('.mark-matched').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const sid = (btn as HTMLElement).dataset.sid!;
          try {
            await updatePaymentSession(sid, { status: 'matched' });
            loadDrawerTab(orderId);
            loadDrawerContent();
          } catch (err: unknown) { alert((err as Error).message); }
        });
      });

      document.getElementById('ps-add')?.addEventListener('click', async () => {
        const base = parseFloat((document.getElementById('ps-base') as HTMLInputElement).value) || 0;
        const discount = parseFloat((document.getElementById('ps-discount') as HTMLInputElement).value) || 0;
        const errEl = document.getElementById('ps-error')!;
        const btn = document.getElementById('ps-add') as HTMLButtonElement;
        if (!base) { errEl.textContent = 'Base amount is required.'; errEl.classList.remove('hidden'); return; }
        btn.disabled = true; btn.textContent = 'Creating…';
        try {
          await createPaymentSession({ order_id: orderId, base_amount: base, expected_amount: base - discount, discount: discount || undefined });
          loadDrawerTab(orderId);
        } catch (err: unknown) {
          btn.disabled = false; btn.textContent = '+ Create Session';
          errEl.textContent = (err as Error).message; errEl.classList.remove('hidden');
        }
      });

    } else if (drawerTab === 'shipments') {
      const events = await fetchShipmentEvents(orderId);
      body.innerHTML = `
        <div class="space-y-2">
          ${events.length ? events.map((ev) => `
            <div class="flex items-start gap-3 py-2 border-b border-slate-50">
              <div class="w-2 h-2 rounded-full bg-sky-400 mt-1.5 shrink-0"></div>
              <div class="flex-1">
                <p class="text-sm font-medium text-slate-700">${ev.event_name ?? ev.event_key ?? '—'}</p>
                ${ev.tracking_no ? `<p class="text-xs text-slate-400">${ev.courier ?? ''} ${ev.tracking_no}</p>` : ''}
                <p class="text-xs text-slate-400">${fmtDate(ev.event_time)}</p>
              </div>
              ${ev.status ? statusBadge(ev.status) : ''}
            </div>`).join('') : '<p class="text-slate-400 text-sm pb-3">No shipment events.</p>'}
          <div class="card p-3 border-dashed mt-2">
            <p class="text-xs font-semibold text-slate-500 mb-2">Add Shipment Event</p>
            <div class="grid grid-cols-2 gap-2 mb-2">
              <div><label class="form-label">Event Name *</label><input id="se-name" class="form-input" placeholder="e.g. Dispatched" /></div>
              <div><label class="form-label">Status</label><input id="se-status" class="form-input" placeholder="e.g. in_transit" /></div>
              <div><label class="form-label">Tracking No</label><input id="se-tracking" class="form-input" placeholder="e.g. MY12345" /></div>
              <div><label class="form-label">Courier</label><input id="se-courier" class="form-input" placeholder="e.g. J&T" /></div>
            </div>
            <button id="se-add" class="btn-primary text-xs w-full">+ Add Event</button>
            <p id="se-error" class="text-red-600 text-xs mt-1 hidden"></p>
          </div>
        </div>
      `;

      document.getElementById('se-add')?.addEventListener('click', async () => {
        const name = (document.getElementById('se-name') as HTMLInputElement).value.trim();
        const status = (document.getElementById('se-status') as HTMLInputElement).value.trim();
        const tracking_no = (document.getElementById('se-tracking') as HTMLInputElement).value.trim();
        const courier = (document.getElementById('se-courier') as HTMLInputElement).value.trim();
        const errEl = document.getElementById('se-error')!;
        const btn = document.getElementById('se-add') as HTMLButtonElement;
        if (!name) { errEl.textContent = 'Event name is required.'; errEl.classList.remove('hidden'); return; }
        btn.disabled = true; btn.textContent = 'Adding…';
        try {
          await createShipmentEvent({ order_id: orderId, event_name: name, status: status || undefined, tracking_no: tracking_no || undefined, courier: courier || undefined });
          loadDrawerTab(orderId);
        } catch (err: unknown) {
          btn.disabled = false; btn.textContent = '+ Add Event';
          errEl.textContent = (err as Error).message; errEl.classList.remove('hidden');
        }
      });
    }
  } catch (e: unknown) {
    body.innerHTML = errHtml((e as Error).message);
  }
}

// ─── Customers ────────────────────────────────────────────────────────────────

async function renderCustomers() {
  const content = document.getElementById('main-content')!;
  content.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-bold text-slate-800">Customers</h1>
        <button id="new-customer-btn" class="btn-primary">+ Add Customer</button>
      </div>
      <div id="customers-list" class="card overflow-hidden">
        <div class="flex justify-center py-12"><div class="w-7 h-7 border-4 border-sky-500 border-t-transparent rounded-full animate-spin"></div></div>
      </div>
    </div>
  `;
  document.getElementById('new-customer-btn')!.addEventListener('click', openNewCustomerModal);
  loadCustomersList();
}

async function loadCustomersList() {
  const el = document.getElementById('customers-list');
  if (!el) return;
  try {
    const customers = await fetchCustomers();
    if (!customers.length) {
      el.innerHTML = '<p class="text-center text-slate-400 py-12 text-sm">No customers yet.</p>';
      return;
    }
    el.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead><tr class="text-left text-slate-400 bg-slate-50 border-b border-slate-100">
            <th class="px-4 py-3 font-medium">Name</th>
            <th class="px-4 py-3 font-medium">Phone</th>
            <th class="px-4 py-3 font-medium">Source</th>
            <th class="px-4 py-3 font-medium text-right">Orders</th>
            <th class="px-4 py-3 font-medium text-right">Since</th>
          </tr></thead>
          <tbody>${customers.map((c) => `<tr class="border-b border-slate-50 hover:bg-slate-50">
            <td class="px-4 py-3 font-medium text-slate-700">${c.name}</td>
            <td class="px-4 py-3 text-slate-500">${c.phone ?? '—'}</td>
            <td class="px-4 py-3 text-slate-400 text-xs">${c.source ?? '—'}</td>
            <td class="px-4 py-3 text-right text-slate-600">${c.order_count}</td>
            <td class="px-4 py-3 text-right text-slate-400 text-xs">${fmtDate(c.created_at)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    `;
  } catch (e: unknown) {
    el.innerHTML = errHtml((e as Error).message);
  }
}

// ─── New Customer Modal ───────────────────────────────────────────────────────

function openNewCustomerModal() {
  const container = document.getElementById('modal-container')!;
  container.innerHTML = `
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h2 class="font-bold text-lg text-slate-800 mb-4">Add Customer</h2>
        <div class="space-y-3">
          <div><label class="form-label">Name *</label><input id="nc-name" class="form-input" placeholder="Full name" /></div>
          <div><label class="form-label">Phone</label><input id="nc-phone" class="form-input" placeholder="+60 12-345 6789" /></div>
        </div>
        <div class="flex justify-end gap-2 mt-6">
          <button id="nc-cancel" class="btn-ghost">Cancel</button>
          <button id="nc-save" class="btn-primary">Add Customer</button>
        </div>
        <p id="nc-error" class="text-red-600 text-xs mt-2 hidden"></p>
      </div>
    </div>
  `;
  document.getElementById('nc-cancel')!.onclick = () => (container.innerHTML = '');
  document.getElementById('nc-save')!.addEventListener('click', async () => {
    const name = (document.getElementById('nc-name') as HTMLInputElement).value.trim();
    const phone = (document.getElementById('nc-phone') as HTMLInputElement).value.trim();
    const errEl = document.getElementById('nc-error')!;
    const btn = document.getElementById('nc-save') as HTMLButtonElement;
    if (!name) { errEl.textContent = 'Name is required.'; errEl.classList.remove('hidden'); return; }
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await createCustomer(name, phone);
      container.innerHTML = '';
      if (currentTab === 'customers') loadCustomersList();
    } catch (e: unknown) {
      btn.disabled = false; btn.textContent = 'Add Customer';
      errEl.textContent = (e as Error).message; errEl.classList.remove('hidden');
    }
  });
}

// ─── New Order Modal ──────────────────────────────────────────────────────────

interface CartItem { product_type: string; title: string; qty: number; price: number; }

async function openNewOrderModal() {
  const container = document.getElementById('modal-container')!;
  let cart: CartItem[] = [];
  let customers: Awaited<ReturnType<typeof fetchCustomers>> = [];
  try { customers = await fetchCustomers(); } catch { /* empty list */ }

  function renderModal() {
    const total = cart.reduce((s, i) => s + i.qty * i.price, 0);
    container.innerHTML = `
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
          <div class="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <h2 class="font-bold text-lg text-slate-800">New Order</h2>
            <button id="no-close" class="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
          </div>
          <div class="flex-1 overflow-y-auto p-6 space-y-4">
            <div>
              <label class="form-label">Customer *</label>
              <select id="no-customer" class="form-input">
                <option value="">Select customer…</option>
                ${customers.map((c) => `<option value="${c.id}">${c.name}${c.phone ? ' – ' + c.phone : ''}</option>`).join('')}
              </select>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="form-label">Order No *</label><input id="no-orderno" class="form-input" placeholder="IC-2024-001" /></div>
              <div><label class="form-label">Delivery Method</label>
                <select id="no-delivery" class="form-input">
                  <option value="pickup">Pickup</option>
                  <option value="courier">Courier</option>
                  <option value="hand_delivery">Hand Delivery</option>
                </select>
              </div>
            </div>
            <div class="border-t border-slate-100 pt-3">
              <p class="form-label mb-2">Add Item</p>
              <div class="grid grid-cols-2 gap-2 mb-2">
                <select id="no-product" class="form-input col-span-2">
                  ${PRODUCT_TYPES.map((t) => `<option value="${t}">${PRODUCT_CATALOG[t].label}</option>`).join('')}
                </select>
                <input id="no-qty" type="number" min="1" class="form-input" placeholder="Qty" value="1" />
                <input id="no-price" type="number" min="0" step="0.01" class="form-input" placeholder="Unit price (RM)" value="" />
              </div>
              <input id="no-title" class="form-input mb-2" placeholder="Title / description (optional)" />
              <button id="no-add-item" class="btn-ghost w-full text-sky-600 border-sky-200">+ Add to Order</button>
            </div>
            ${cart.length ? `<div class="space-y-2">${cart.map((i, idx) => `
              <div class="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 text-sm">
                <span class="text-slate-700">${getProductLabel(i.product_type)}${i.title ? ' — ' + i.title : ''}</span>
                <div class="flex items-center gap-3">
                  <span class="text-slate-500">${i.qty} × ${fmt(i.price)}</span>
                  <span class="font-semibold">${fmt(i.qty * i.price)}</span>
                  <button data-remove="${idx}" class="text-red-400 hover:text-red-600 text-xs">&times;</button>
                </div>
              </div>`).join('')}
              <div class="flex justify-between font-semibold text-sm px-3 pt-1 border-t border-slate-100">
                <span>Total</span><span>${fmt(total)}</span>
              </div>
            </div>` : ''}
          </div>
          <div class="px-6 py-4 border-t border-slate-100 flex justify-end gap-2">
            <button id="no-cancel" class="btn-ghost">Cancel</button>
            <button id="no-save" class="btn-primary" ${cart.length === 0 ? 'disabled' : ''}>Create Order</button>
          </div>
          <p id="no-error" class="text-red-600 text-xs px-6 pb-3 hidden"></p>
        </div>
      </div>
    `;

    document.getElementById('no-close')!.onclick = () => (container.innerHTML = '');
    document.getElementById('no-cancel')!.onclick = () => (container.innerHTML = '');

    document.getElementById('no-add-item')!.addEventListener('click', () => {
      const product_type = (document.getElementById('no-product') as HTMLSelectElement).value;
      const qty = parseInt((document.getElementById('no-qty') as HTMLInputElement).value) || 1;
      const price = parseFloat((document.getElementById('no-price') as HTMLInputElement).value) || 0;
      const title = (document.getElementById('no-title') as HTMLInputElement).value.trim();
      cart.push({ product_type, qty, price, title });
      renderModal();
    });

    container.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        cart.splice(parseInt(btn.getAttribute('data-remove')!), 1);
        renderModal();
      });
    });

    document.getElementById('no-save')!.addEventListener('click', async () => {
      const customerId = (document.getElementById('no-customer') as HTMLSelectElement).value;
      const orderNo = (document.getElementById('no-orderno') as HTMLInputElement).value.trim();
      const deliveryMethod = (document.getElementById('no-delivery') as HTMLSelectElement).value;
      const errEl = document.getElementById('no-error')!;
      const btn = document.getElementById('no-save') as HTMLButtonElement;

      if (!customerId) { errEl.textContent = 'Please select a customer.'; errEl.classList.remove('hidden'); return; }
      if (!orderNo) { errEl.textContent = 'Order No is required.'; errEl.classList.remove('hidden'); return; }
      if (!cart.length) { errEl.textContent = 'Add at least one item.'; errEl.classList.remove('hidden'); return; }

      btn.disabled = true; btn.textContent = 'Creating…';
      try {
        const order = await createOrder({
          customerId,
          orderNo,
          deliveryMethod,
          items: cart.map((i) => ({ product_type: i.product_type, title: i.title, wording: '', qty: i.qty, price: i.price })),
        });
        container.innerHTML = '';
        if (currentTab === 'orders') loadOrdersTable();
        openOrderDrawer(order.id);
      } catch (e: unknown) {
        btn.disabled = false; btn.textContent = 'Create Order';
        errEl.textContent = (e as Error).message; errEl.classList.remove('hidden');
      }
    });
  }

  renderModal();
}

// ─── Realtime ─────────────────────────────────────────────────────────────────

supabase
  .channel('orders-changes')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
    if (currentTab === 'orders') loadOrdersTable();
    if (currentTab === 'dashboard') renderDashboard();
    if (drawerOrderId) loadDrawerContent();
  })
  .subscribe();

// ─── Init ─────────────────────────────────────────────────────────────────────

renderPage();
