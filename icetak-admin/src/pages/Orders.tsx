import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

export type AdminOrder = {
  dbId: string;
  id: string;
  orderToken?: string;
  customerToken?: string;
  customerName?: string;
  customerPhone?: string;
  adminStatus?: string;
  status?: string;
  dateNeedRaw?: string;
  dateNeed?: string;
  created?: string;
  total?: number | string;
  deliveryFee?: number | string;
  payment?: string;
  paymentMethod?: string;
  delivery?: string;
  customerConfirmed?: boolean;
  adminRemark?: string;
  productionApproved?: boolean;
  fulfillmentStage?: string;
  pickupReadyAt?: string | null;
  pickupCollectedAt?: string | null;
  componentsTotal?: number;
  componentsLinked?: number;
  clickupSyncStatus?: string;
  tab?: string;
  items?: AdminOrderItem[];
};

type AdminOrderItem = {
  id: string;
  k?: string;
  title?: string;
  qty?: number;
  size?: string;
  style?: string;
  price?: number | string;
  workflow?: string;
  reviewRequired?: boolean;
  customText?: string;
  previewUrl?: string;
  components?: Array<{ id: string; label?: string; clickupTaskId?: string; clickupStatus?: string; customerLabel?: string; workflow?: string; progressPercent?: number }>;
};

type Props = { permissions?: string[]; initialOrder?: string };
type FilterKey = 'all' | 'new' | 'pay' | 'cash' | 'ready' | 'problem';

const money = (v: unknown) => `RM ${Number(v || 0).toFixed(2)}`;
const norm = (v: unknown) => String(v || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

function bucket(o: AdminOrder): FilterKey {
  const status = norm(o.adminStatus || o.status);
  const payment = norm(o.payment);
  if (status.includes('cancel') || status.includes('action_required')) return 'problem';
  if (status.includes('new_order') || status === 'new') return 'new';
  if (payment.includes('cash') && !payment.includes('paid')) return 'cash';
  if (payment.includes('unpaid') || payment.includes('pending') || payment === '') return 'pay';
  if (status.includes('ready') || status.includes('production') || status.includes('pickup') || status.includes('completed')) return 'ready';
  return 'all';
}

function paid(o: AdminOrder) {
  const p = norm(o.payment);
  return p.includes('paid') || p.includes('matched') || p.includes('payment_received');
}

function pickup(o: AdminOrder) { return norm(o.delivery).includes('pickup'); }

export default function Orders({ permissions = [], initialOrder = '' }: Props) {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState(initialOrder);
  const [selected, setSelected] = useState<AdminOrder | null>(null);
  const [customerToken, setCustomerToken] = useState<string>('');
  const [waStates, setWaStates] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const can = (permission: string) => permissions.includes(permission);

  const load = async () => {
    setLoading(true); setError(null);
    const { data, error: rpcError } = await supabase.rpc('icetak_admin_dashboard_for_current_user');
    if (rpcError) { setError(rpcError.message); setLoading(false); return; }
    const rows = (((data || {}) as { orders?: AdminOrder[] }).orders || []);
    setOrders(rows);
    if (selected) setSelected(rows.find((o) => o.dbId === selected.dbId) || null);
    const orderNos = rows.map((o) => o.id).filter(Boolean);
    if (orderNos.length) {
      const { data: states } = await supabase.rpc('icetak_admin_order_notification_states', { p_order_nos: orderNos });
      if (states && typeof states === 'object') setWaStates(states as Record<string, boolean>);
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => { if (!notice) return; const t = window.setTimeout(() => setNotice(null), 3000); return () => window.clearTimeout(t); }, [notice]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      if (filter !== 'all' && bucket(o) !== filter) return false;
      if (customerToken && o.customerToken !== customerToken) return false;
      if (!q) return true;
      return [o.id, o.customerName, o.customerPhone, o.adminStatus, o.payment].some((x) => String(x || '').toLowerCase().includes(q));
    });
  }, [orders, filter, query, customerToken]);

  const counts = useMemo(() => {
    const out: Record<FilterKey, number> = { all: orders.length, new: 0, pay: 0, cash: 0, ready: 0, problem: 0 };
    orders.forEach((o) => { const b = bucket(o); if (b !== 'all') out[b] += 1; });
    return out;
  }, [orders]);

  const action = async (order: AdminOrder, name: string) => {
    const labels: Record<string, string> = { approve_production: 'Approve order untuk production?', cancel: 'Cancel order ini?', ready_pickup: 'Tandakan order siap untuk pickup?', pickup_collected: 'Sahkan customer sudah ambil order?', set_pay_at_pickup: 'Tukar kepada Bayar Semasa Pickup?', confirm_cash_paid: 'Sahkan bayaran cash sudah diterima?' };
    if (labels[name] && !window.confirm(labels[name])) return;
    setBusyId(order.dbId); setError(null);
    const { error: rpcError } = await supabase.rpc('icetak_admin_order_action', { p_payload: { order_db_id: order.dbId, order_id: order.id, action: name } });
    setBusyId(null);
    if (rpcError) setError(rpcError.message);
    else { setNotice(`${order.id}: ${name.replaceAll('_', ' ')} berjaya.`); await load(); }
  };

  const toggleWhatsapp = async (order: AdminOrder) => {
    const current = waStates[order.id] ?? true;
    const next = !current;
    if (!window.confirm(next ? `Aktifkan WhatsApp untuk ${order.id}? Hanya status seterusnya dihantar.` : `Matikan WhatsApp untuk ${order.id}? Pending notification akan dibatalkan.`)) return;
    setBusyId(order.dbId);
    const { data, error: rpcError } = await supabase.rpc('icetak_admin_set_order_whatsapp', { p_order_no: order.id, p_enabled: next });
    setBusyId(null);
    if (rpcError) setError(rpcError.message);
    else {
      const result = (data || {}) as { enabled?: boolean; cancelled_pending?: number };
      setWaStates((old) => ({ ...old, [order.id]: result.enabled ?? next }));
      setNotice(`${order.id}: WhatsApp ${(result.enabled ?? next) ? 'ON' : 'OFF'}${result.cancelled_pending ? ` · ${result.cancelled_pending} pending cancelled` : ''}`);
    }
  };

  const customerOrders = customerToken ? orders.filter((o) => o.customerToken === customerToken) : [];
  const customer = customerOrders[0];

  return (
    <div className="fade-in">
      <div className="page-header"><div><div className="page-label">Order Control</div><h1 className="page-title">Orders</h1><p className="page-subtitle">Full V2 order lifecycle, ClickUp and WhatsApp controls</p></div><button className="btn btn-outline" onClick={() => void load()}>Refresh</button></div>
      <div className="stats-grid">
        <Stat label="All" value={counts.all} /><Stat label="New" value={counts.new} /><Stat label="To Pay" value={counts.pay} /><Stat label="Ready" value={counts.ready} />
      </div>
      {notice && <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: '#ecfdf3', color: '#067647', fontWeight: 700 }}>{notice}</div>}
      {error && <div style={{ marginBottom: 12, padding: 10, borderRadius: 10, background: '#fef3f2', color: '#b42318' }}>{error}</div>}

      {customer && <div className="panel" style={{ marginBottom: 14, padding: 16 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><div><div className="panel-title">{customer.customerName}</div><a href={`https://wa.me/${String(customer.customerPhone || '').replace(/\D/g, '')}`} target="_blank" rel="noreferrer">{customer.customerPhone}</a><div className="panel-subtitle">{customerOrders.length} orders · {money(customerOrders.reduce((sum, o) => sum + Number(o.total || 0), 0))} total</div></div><button className="btn btn-outline" onClick={() => setCustomerToken('')}>Close</button></div></div>}

      <div className="panel">
        <div className="panel-header" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div className="filter-tabs">{([['all','All'],['new','New'],['pay','To Pay'],['cash','Cash'],['ready','Ready'],['problem','Problem']] as [FilterKey,string][]).map(([k,l]) => <button key={k} className={`filter-tab ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>{l} <span className="count">{counts[k]}</span></button>)}</div>
          <input style={{ marginLeft: 'auto', minWidth: 230 }} placeholder="Search order, name, phone..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="table-wrap">
          {loading ? <div className="loading"><span className="spinner" /> Loading orders...</div> : filtered.length === 0 ? <div className="empty">No orders found</div> : <table><thead><tr><th>Order</th><th>Customer</th><th>Need</th><th>Payment</th><th>Delivery</th><th>Production / ClickUp</th><th>WhatsApp</th><th>Action</th></tr></thead><tbody>{filtered.map((o) => <OrderRow key={o.dbId} order={o} busy={busyId === o.dbId} waEnabled={waStates[o.id] ?? true} can={can} onSelect={() => setSelected(o)} onCustomer={() => setCustomerToken(o.customerToken || '')} onAction={(a) => void action(o, a)} onWhatsapp={() => void toggleWhatsapp(o)} />)}</tbody></table>}
        </div>
      </div>
      {selected && <OrderModal order={selected} permissions={permissions} onClose={() => setSelected(null)} onSaved={async () => { await load(); setNotice(`${selected.id}: changes saved.`); }} onAction={(a) => void action(selected, a)} />}
    </div>
  );
}

function OrderRow({ order, busy, waEnabled, can, onSelect, onCustomer, onAction, onWhatsapp }: { order: AdminOrder; busy: boolean; waEnabled: boolean; can: (p: string) => boolean; onSelect: () => void; onCustomer: () => void; onAction: (a: string) => void; onWhatsapp: () => void }) {
  const readyPickup = pickup(order) && paid(order) && order.productionApproved && !order.pickupReadyAt && !norm(order.status).includes('ready_for_pickup');
  const collected = pickup(order) && paid(order) && Boolean(order.pickupReadyAt || norm(order.status).includes('ready_for_pickup')) && !order.pickupCollectedAt;
  const cancelled = norm(order.adminStatus || order.status).includes('cancel');
  return <tr className="row-hover"><td><button onClick={onSelect} style={{ fontWeight: 800, color: 'var(--primary)' }}>{order.id}</button><div className="cell-sub">{order.adminStatus || order.status || '—'}</div></td><td><button onClick={onCustomer} style={{ fontWeight: 700 }}>{order.customerName || 'Guest'}</button><div><a className="cell-sub" href={`https://wa.me/${String(order.customerPhone || '').replace(/\D/g, '')}`} target="_blank" rel="noreferrer">{order.customerPhone || '—'}</a></div></td><td>{order.dateNeed || order.dateNeedRaw || '—'}</td><td><b>{order.payment || '—'}</b><div className="cell-sub">{money(order.total)}</div></td><td>{order.delivery || '—'}</td><td><div>{order.productionApproved ? 'Production approved' : 'Waiting approval'}</div><div className="cell-sub">ClickUp {order.componentsLinked || 0}/{order.componentsTotal || 0} · {order.clickupSyncStatus || '—'}</div></td><td><button className={`btn ${waEnabled ? 'btn-primary' : 'btn-outline'}`} disabled={busy} onClick={onWhatsapp}>WhatsApp {waEnabled ? 'ON' : 'OFF'}</button></td><td><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', minWidth: 220 }}><button className="btn btn-outline" onClick={onSelect}>View</button>{can('approve_production') && !order.productionApproved && paid(order) && !cancelled && <button className="btn btn-primary" disabled={busy} onClick={() => onAction('approve_production')}>Approve Production</button>}{readyPickup && can('approve_production') && <button className="btn btn-primary" disabled={busy} onClick={() => onAction('ready_pickup')}>Ready Pickup</button>}{collected && can('approve_production') && <button className="btn btn-primary" disabled={busy} onClick={() => onAction('pickup_collected')}>Customer Collected</button>}{can('cancel_order') && !cancelled && <button className="btn btn-outline" style={{ color: '#b42318' }} disabled={busy} onClick={() => onAction('cancel')}>Cancel</button>}</div></td></tr>;
}

function OrderModal({ order, permissions, onClose, onSaved, onAction }: { order: AdminOrder; permissions: string[]; onClose: () => void; onSaved: () => Promise<void>; onAction: (a: string) => void }) {
  const canEdit = permissions.includes('edit_order');
  const canVerify = permissions.includes('verify_payments');
  const [dateNeed, setDateNeed] = useState((order.dateNeedRaw || order.dateNeed || '').slice(0, 10));
  const [remark, setRemark] = useState(order.adminRemark || '');
  const [items, setItems] = useState((order.items || []).map((i) => ({ ...i, qty: Number(i.qty || 1), price: Number(i.price || 0), customText: i.customText || '', previewUrl: i.previewUrl || '' })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true); setError(null);
    const { error: rpcError } = await supabase.rpc('icetak_admin_order_update', { p_payload: { order_db_id: order.dbId, date_need: dateNeed, admin_remark: remark, items: items.map((i) => ({ id: i.id, qty: i.qty, price: i.price, custom_text: i.customText, design_preview_url: i.previewUrl })) } });
    setBusy(false);
    if (rpcError) setError(rpcError.message); else await onSaved();
  };

  return <div className="modal-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="modal" style={{ maxWidth: 920, maxHeight: '90vh', overflow: 'auto' }}><button className="modal-x" onClick={onClose}>×</button><h2>{order.id}</h2><p>{order.customerName} · {order.customerPhone} · {order.adminStatus || order.status}</p>{error && <div style={{ color: '#b42318', marginBottom: 10 }}>{error}</div>}<div className="grid-2"><div><h3>Order</h3><Field label="Date Need"><input type="date" disabled={!canEdit} value={dateNeed} onChange={(e) => setDateNeed(e.target.value)} /></Field><Field label="Admin Remark"><textarea rows={3} disabled={!canEdit} value={remark} onChange={(e) => setRemark(e.target.value)} /></Field><div style={{ marginTop: 12 }}><b>Payment</b><div>{order.payment} · {order.paymentMethod || '—'}</div>{pickup(order) && !paid(order) && canEdit && <button className="btn btn-outline" style={{ marginTop: 8 }} onClick={() => onAction('set_pay_at_pickup')}>Set Pay at Pickup</button>}{pickup(order) && norm(order.payment).includes('cash') && !paid(order) && canVerify && <button className="btn btn-primary" style={{ marginTop: 8, marginLeft: 6 }} onClick={() => onAction('confirm_cash_paid')}>Confirm Cash Paid</button>}</div></div><div><h3>Production / ClickUp</h3><div className="kv-list"><div className="kv-row"><span className="k">Production approved</span><span className="v">{order.productionApproved ? 'Yes' : 'No'}</span></div><div className="kv-row"><span className="k">Components</span><span className="v">{order.componentsLinked || 0}/{order.componentsTotal || 0}</span></div><div className="kv-row"><span className="k">Sync</span><span className="v">{order.clickupSyncStatus || '—'}</span></div></div></div></div><h3 style={{ marginTop: 18 }}>Items</h3>{items.map((item, index) => <div key={item.id} style={{ border: '1px solid var(--border-light)', borderRadius: 12, padding: 12, marginBottom: 10 }}><b>{index + 1}. {item.title || item.k}</b><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8, marginTop: 8 }}><Field label="Qty"><input type="number" min={1} disabled={!canEdit} value={item.qty} onChange={(e) => setItems((old) => old.map((x) => x.id === item.id ? { ...x, qty: Math.max(1, Number(e.target.value || 1)) } : x))} /></Field><Field label="Unit Price"><input type="number" min={0} step="0.01" disabled={!canEdit} value={item.price} onChange={(e) => setItems((old) => old.map((x) => x.id === item.id ? { ...x, price: Math.max(0, Number(e.target.value || 0)) } : x))} /></Field><Field label="Custom Text"><input disabled={!canEdit} value={item.customText} onChange={(e) => setItems((old) => old.map((x) => x.id === item.id ? { ...x, customText: e.target.value } : x))} /></Field>{item.reviewRequired && <Field label="Design Preview URL"><input disabled={!canEdit} value={item.previewUrl} onChange={(e) => setItems((old) => old.map((x) => x.id === item.id ? { ...x, previewUrl: e.target.value } : x))} /></Field>}</div>{(item.components || []).length > 0 && <div style={{ marginTop: 8 }}>{item.components!.map((c) => <div key={c.id} className="cell-sub">{c.label || 'Component'} · {c.customerLabel || c.workflow || '—'} · ClickUp {c.clickupTaskId ? <a href={`https://app.clickup.com/t/3747262/${c.clickupTaskId}`} target="_blank" rel="noreferrer">{c.clickupTaskId}</a> : 'not linked'}</div>)}</div>}</div>)}<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}><button className="btn btn-outline" onClick={onClose}>Close</button>{canEdit && <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving...' : 'Save Changes'}</button>}</div></div></div>;
}

function Stat({ label, value }: { label: string; value: number }) { return <div className="stat-card new"><div className="stat-label">{label}</div><div className="stat-value">{value}</div></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="form-field" style={{ marginBottom: 8 }}><span>{label}</span>{children}</label>; }
