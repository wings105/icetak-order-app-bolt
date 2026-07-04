import { useEffect, useState } from 'react';
import { X, Package, Cog, CreditCard, Truck, ChevronDown, CircleCheck as CheckCircle } from 'lucide-react';
import {
  fetchOrder, fetchOrderItems, fetchProductionComponents,
  fetchPaymentSessions, fetchShipmentEvents,
  updateOrderStatus, updateOrderRemark,
} from '../lib/queries';
import type {
  Order, OrderItem, ProductionComponent, PaymentSession, ShipmentEvent, OrderStatus,
} from '../lib/types';
import {
  statusClass, statusLabel, paymentClass, paymentLabel,
  fmtCurrency, fmtDate, fmtDateTime, ALL_STATUSES,
} from './utils';

type Tab = 'items' | 'production' | 'payments' | 'shipments';

const TABS: Array<{ id: Tab; label: string; Icon: React.ComponentType<{ size?: number }> }> = [
  { id: 'items',      label: 'Items',      Icon: Package    },
  { id: 'production', label: 'Production', Icon: Cog        },
  { id: 'payments',   label: 'Payments',   Icon: CreditCard },
  { id: 'shipments',  label: 'Shipments',  Icon: Truck      },
];

type Props = { orderId: string; onClose: () => void };

export default function OrderDetail({ orderId, onClose }: Props) {
  const [order,    setOrder]    = useState<Order | null>(null);
  const [items,    setItems]    = useState<OrderItem[]>([]);
  const [prod,     setProd]     = useState<ProductionComponent[]>([]);
  const [payments, setPayments] = useState<PaymentSession[]>([]);
  const [ships,    setShips]    = useState<ShipmentEvent[]>([]);
  const [tab,      setTab]      = useState<Tab>('items');
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [saving,   setSaving]   = useState(false);
  const [remark,   setRemark]   = useState('');
  const [remarkSaved, setRemarkSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const [o, i, p, pay, s] = await Promise.all([
          fetchOrder(orderId),
          fetchOrderItems(orderId),
          fetchProductionComponents(orderId),
          fetchPaymentSessions(orderId),
          fetchShipmentEvents(orderId),
        ]);
        if (!cancelled) {
          setOrder(o); setItems(i); setProd(p); setPayments(pay); setShips(s);
          setRemark(o?.admin_remark ?? '');
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [orderId]);

  async function handleStatusChange(s: OrderStatus) {
    if (!order || saving) return;
    setSaving(true);
    try {
      await updateOrderStatus(order.id, s);
      setOrder({ ...order, status: s });
    } finally { setSaving(false); }
  }

  async function handleSaveRemark() {
    if (!order) return;
    setSaving(true);
    try {
      await updateOrderRemark(order.id, remark);
      setRemarkSaved(true);
      setTimeout(() => setRemarkSaved(false), 2000);
    } finally { setSaving(false); }
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          {!loading && order ? (
            <div className="drawer-title-row">
              <div>
                <h2>{order.order_no}</h2>
                <span className="muted">{order.customers?.name ?? 'No customer'}</span>
              </div>
              <div className="drawer-badges">
                <span className={`pill ${statusClass(order.status)}`}>{statusLabel(order.status)}</span>
                <span className={`pill ${paymentClass(order.payment_status)}`}>{paymentLabel(order.payment_status)}</span>
              </div>
            </div>
          ) : (
            <div className="drawer-title-stub" />
          )}
          <button className="icon-btn" onClick={onClose}><X size={20} /></button>
        </div>

        {loading && <div className="page-loading">Loading…</div>}
        {error   && <div className="page-error">{error}</div>}

        {!loading && !error && order && (
          <>
            <div className="drawer-meta">
              <div className="meta-grid">
                <div><span>Created</span><strong>{fmtDate(order.created_at)}</strong></div>
                <div><span>Total</span><strong>{fmtCurrency(order.total)}</strong></div>
                <div><span>Delivery</span><strong>{order.delivery_method?.replace('_', ' ') ?? '—'}</strong></div>
                <div><span>Need by</span><strong>{order.date_need ? fmtDate(order.date_need) : '—'}</strong></div>
              </div>

              {(order.delivery_name || order.delivery_address) && (
                <div className="delivery-block">
                  <strong>{order.delivery_name}</strong>
                  {order.delivery_phone && <span> · {order.delivery_phone}</span>}
                  {order.delivery_address && (
                    <div className="muted">
                      {[order.delivery_address, order.delivery_city, order.delivery_postcode, order.delivery_state]
                        .filter(Boolean).join(', ')}
                    </div>
                  )}
                </div>
              )}

              <div className="status-select-row">
                <span>Change status</span>
                <div className="select-wrap">
                  <select
                    value={order.status}
                    disabled={saving}
                    onChange={(e) => handleStatusChange(e.target.value as OrderStatus)}
                  >
                    {ALL_STATUSES.map((s) => (
                      <option key={s} value={s}>{statusLabel(s)}</option>
                    ))}
                  </select>
                  <ChevronDown size={14} />
                </div>
              </div>

              <div className="remark-row">
                <span>Admin remark</span>
                <div className="remark-controls">
                  <textarea
                    rows={2}
                    value={remark}
                    onChange={(e) => setRemark(e.target.value)}
                    placeholder="Internal notes…"
                  />
                  <button className="btn-small" disabled={saving} onClick={handleSaveRemark}>
                    {remarkSaved ? <><CheckCircle size={14} /> Saved</> : 'Save'}
                  </button>
                </div>
              </div>
            </div>

            <div className="drawer-tabs">
              {TABS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  className={`drawer-tab${tab === id ? ' active' : ''}`}
                  onClick={() => setTab(id)}
                >
                  <Icon size={15} />{label}
                </button>
              ))}
            </div>

            <div className="drawer-body">
              {tab === 'items' && (
                <div className="tab-section">
                  {!items.length && <p className="empty-state">No items</p>}
                  {items.map((item) => (
                    <div key={item.id} className="detail-card">
                      <div className="detail-card-header">
                        <strong>{item.title || item.product_type}</strong>
                        <span className="pill pill-blue">{item.product_type}</span>
                      </div>
                      {item.wording && <p className="wording">"{item.wording}"</p>}
                      <div className="detail-card-meta">
                        <span>Qty: <strong>{item.qty}</strong></span>
                        <span>Unit: <strong>{fmtCurrency(item.price)}</strong></span>
                        <span>Subtotal: <strong>{fmtCurrency(item.qty * item.price)}</strong></span>
                      </div>
                    </div>
                  ))}
                  {items.length > 0 && (
                    <div className="items-total">
                      Total: <strong>{fmtCurrency(items.reduce((s, i) => s + i.qty * i.price, 0))}</strong>
                    </div>
                  )}
                </div>
              )}

              {tab === 'production' && (
                <div className="tab-section">
                  {!prod.length && <p className="empty-state">No production components</p>}
                  {prod.map((c) => (
                    <div key={c.id} className="detail-card">
                      <div className="detail-card-header">
                        <strong>{c.label || c.component_type}</strong>
                        <span className={`pill ${prodStatusClass(c.clickup_status)}`}>
                          {c.clickup_status ?? 'unknown'}
                        </span>
                      </div>
                      {c.workflow      && <p className="muted">Workflow: {c.workflow}</p>}
                      {c.clickup_task_id && <p className="muted">ClickUp: {c.clickup_task_id}</p>}
                    </div>
                  ))}
                </div>
              )}

              {tab === 'payments' && (
                <div className="tab-section">
                  {!payments.length && <p className="empty-state">No payment records</p>}
                  {payments.map((p) => (
                    <div key={p.id} className="detail-card">
                      <div className="detail-card-header">
                        <strong>{p.transaction_id ?? 'Payment'}</strong>
                        <span className={`pill ${paymentClass(p.status)}`}>{paymentLabel(p.status)}</span>
                      </div>
                      <div className="detail-card-meta">
                        <span>Expected: <strong>{fmtCurrency(p.expected_amount)}</strong></span>
                        {p.base_amount !== p.expected_amount && (
                          <span>Base: <strong>{fmtCurrency(p.base_amount)}</strong></span>
                        )}
                        {p.discount ? <span>Discount: <strong>{fmtCurrency(p.discount)}</strong></span> : null}
                      </div>
                      {p.matched_at   && <p className="muted small">Matched {fmtDateTime(p.matched_at)}</p>}
                      {p.submitted_at && <p className="muted small">Submitted {fmtDateTime(p.submitted_at)}</p>}
                    </div>
                  ))}
                </div>
              )}

              {tab === 'shipments' && (
                <div className="tab-section">
                  {!ships.length && <p className="empty-state">No shipment events</p>}
                  <div className="timeline">
                    {ships.map((s, i) => (
                      <div key={s.id} className={`timeline-item${i === ships.length - 1 ? ' last' : ''}`}>
                        <div className="timeline-dot" />
                        <div className="timeline-content">
                          <div className="timeline-header">
                            <strong>{s.event_name ?? s.event_key}</strong>
                            {s.status && (
                              <span className={`pill ${shipStatusClass(s.status)}`}>{s.status}</span>
                            )}
                          </div>
                          {s.tracking_no && (
                            <p className="muted small">{s.courier} · {s.tracking_no}</p>
                          )}
                          {s.event_time && (
                            <p className="muted small">{fmtDateTime(s.event_time)}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function prodStatusClass(s: string | null): string {
  if (!s) return 'pill-gray';
  if (s === 'done' || s === 'complete') return 'pill-green';
  if (s === 'in progress') return 'pill-orange';
  return 'pill-yellow';
}

function shipStatusClass(s: string): string {
  if (s === 'delivered') return 'pill-green';
  if (s === 'dispatched' || s === 'in_transit') return 'pill-blue';
  if (s === 'failed') return 'pill-red';
  return 'pill-gray';
}
