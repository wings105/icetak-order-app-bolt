import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { IconMore, IconRefresh, IconTrend, IconBox, IconShipping } from '../components/Icons';

type Shipment = {
  id: string;
  order_id: string | null;
  courier: string | null;
  tracking_no: string | null;
  tracking_link: string | null;
  status: string | null;
  normalized_status: string | null;
  provider: string | null;
  service_provider: string | null;
  quoted_amount: number | string | null;
  charged_amount: number | string | null;
  parcel_weight_kg: number | string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  created_at: string;
};

const statusTag = (s: string | null) => {
  const v = (s || '').toLowerCase();
  if (v.includes('deliver')) return { label: 'Delivered', cls: 'badge-success' };
  if (v.includes('transit') || v.includes('shipped')) return { label: 'In Transit', cls: 'badge-info' };
  if (v.includes('pickup') || v.includes('booked') || v.includes('pending')) return { label: 'Pending Pickup', cls: 'badge-warning' };
  if (v.includes('cancel') || v.includes('fail')) return { label: 'Cancelled', cls: 'badge-error' };
  return { label: v || 'draft', cls: 'badge-neutral' };
};

export default function Shipping() {
  const [rows, setRows] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from('shipments')
      .select('id, order_id, courier, tracking_no, tracking_link, status, normalized_status, provider, service_provider, quoted_amount, charged_amount, parcel_weight_kg, shipped_at, delivered_at, created_at')
      .order('created_at', { ascending: false })
      .limit(60);
    if (error) setErr(error.message);
    else setRows(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const stats = rows.reduce(
    (acc, s) => {
      const v = ((s.normalized_status || s.status) || '').toLowerCase();
      if (v.includes('deliver')) acc.delivered += 1;
      else if (v.includes('transit') || v.includes('shipped')) acc.transit += 1;
      else if (v.includes('cancel') || v.includes('fail')) acc.cancelled += 1;
      else acc.pending += 1;
      return acc;
    },
    { delivered: 0, transit: 0, pending: 0, cancelled: 0 },
  );

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Shipping & Delivery</h1>
          <p className="page-subtitle">Track parcels across couriers</p>
        </div>
        <button className="btn btn-outline" onClick={load}><IconRefresh size={16} /> Refresh</button>
      </div>

      <div className="stats-grid">
        <div className="stat-card new">
          <div className="stat-label">In Transit</div>
          <div className="stat-value">{stats.transit}</div>
          <div className="stat-hint">Currently on the road</div>
        </div>
        <div className="stat-card pay">
          <div className="stat-label">Pending Pickup</div>
          <div className="stat-value">{stats.pending}</div>
          <div className="stat-hint">Awaiting courier</div>
        </div>
        <div className="stat-card ready">
          <div className="stat-label">Delivered</div>
          <div className="stat-value">{stats.delivered}</div>
          <div className="stat-hint">Completed successfully</div>
        </div>
        <div className="stat-card problem">
          <div className="stat-label">Cancelled / Failed</div>
          <div className="stat-value">{stats.cancelled}</div>
          <div className="stat-hint">Requires attention</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Recent Shipments</div>
            <div className="panel-subtitle">Latest 60 records</div>
          </div>
        </div>
        <div className="table-wrap">
          {loading ? (
            <div className="loading"><span className="spinner" /> <span style={{ marginLeft: 8 }}>Loading…</span></div>
          ) : err ? (
            <div className="empty"><div className="empty-title">Failed to load</div><div>{err}</div></div>
          ) : rows.length === 0 ? (
            <div className="empty">
              <div className="empty-icon"><IconShipping size={22} /></div>
              <div className="empty-title">No shipments yet</div>
              <div>Bookings will appear here once created.</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Order</th>
                  <th>Courier</th>
                  <th>Tracking</th>
                  <th>Provider</th>
                  <th>Weight</th>
                  <th>Charged</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const st = statusTag(s.normalized_status || s.status);
                  return (
                    <tr key={s.id} className="row-hover">
                      <td className="cell-id">{s.id.slice(0, 8)}</td>
                      <td className="cell-sub">{s.order_id ? s.order_id.slice(0, 8) : '—'}</td>
                      <td>{s.courier || '—'}</td>
                      <td className="cell-sub">
                        {s.tracking_link ? (
                          <a href={s.tracking_link} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontWeight: 600 }}>{s.tracking_no || 'Link'}</a>
                        ) : (
                          s.tracking_no || '—'
                        )}
                      </td>
                      <td>{s.provider || s.service_provider || '—'}</td>
                      <td className="cell-sub">{s.parcel_weight_kg ? `${Number(s.parcel_weight_kg)} kg` : '—'}</td>
                      <td className="cell-amount">{s.charged_amount ? `RM ${Number(s.charged_amount).toFixed(2)}` : '—'}</td>
                      <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                      <td className="cell-sub">{new Date(s.created_at).toLocaleString()}</td>
                      <td><button className="icon-btn"><IconMore size={16} /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// Silence unused-import warning
void IconTrend; void IconBox;
