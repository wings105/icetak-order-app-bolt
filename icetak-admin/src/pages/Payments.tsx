import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { IconDownload, IconMore, IconRefresh } from '../components/Icons';

type Session = {
  id: string;
  order_id: string | null;
  transaction_id: string | null;
  status: string | null;
  base_amount: number | string | null;
  discount: number | string | null;
  expected_amount: number | string | null;
  created_at: string;
  submitted_at: string | null;
  matched_at: string | null;
  receipt_path: string | null;
};

const statusTag = (s: string | null) => {
  const v = (s || '').toLowerCase();
  if (v === 'matched' || v === 'paid') return { label: 'Matched', cls: 'badge-success' };
  if (v === 'submitted') return { label: 'Submitted', cls: 'badge-info' };
  if (v === 'expired') return { label: 'Expired', cls: 'badge-neutral' };
  if (v === 'failed' || v === 'rejected') return { label: v, cls: 'badge-error' };
  return { label: v || 'pending', cls: 'badge-warning' };
};

export default function Payments() {
  const [rows, setRows] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from('payment_sessions')
      .select('id, order_id, transaction_id, status, base_amount, discount, expected_amount, created_at, submitted_at, matched_at, receipt_path')
      .order('created_at', { ascending: false })
      .limit(60);
    if (error) setErr(error.message);
    else setRows(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const totals = rows.reduce(
    (acc, r) => {
      const amt = Number(r.expected_amount || 0);
      acc.count += 1;
      if ((r.status || '').toLowerCase() === 'matched' || (r.status || '').toLowerCase() === 'paid') acc.paid += amt;
      else if ((r.status || '').toLowerCase() === 'submitted') acc.submitted += amt;
      else acc.pending += amt;
      return acc;
    },
    { count: 0, paid: 0, submitted: 0, pending: 0 },
  );

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Payments Center</h1>
          <p className="page-subtitle">Track payment sessions and receipts</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={load}><IconRefresh size={16} /> Refresh</button>
          <button className="btn btn-outline"><IconDownload size={16} /> Export</button>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card ready">
          <div className="stat-label">Total Paid</div>
          <div className="stat-value">RM {totals.paid.toFixed(2)}</div>
          <div className="stat-hint">Matched transactions</div>
        </div>
        <div className="stat-card new">
          <div className="stat-label">Submitted</div>
          <div className="stat-value">RM {totals.submitted.toFixed(2)}</div>
          <div className="stat-hint">Awaiting reconciliation</div>
        </div>
        <div className="stat-card pay">
          <div className="stat-label">Pending</div>
          <div className="stat-value">RM {totals.pending.toFixed(2)}</div>
          <div className="stat-hint">Awaiting receipt</div>
        </div>
        <div className="stat-card cash">
          <div className="stat-label">Sessions</div>
          <div className="stat-value">{totals.count}</div>
          <div className="stat-hint">Recent 60</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Payment Sessions</div>
            <div className="panel-subtitle">Latest 60 records from Supabase</div>
          </div>
        </div>
        <div className="table-wrap">
          {loading ? (
            <div className="loading"><span className="spinner" /> <span style={{ marginLeft: 8 }}>Loading…</span></div>
          ) : err ? (
            <div className="empty"><div className="empty-title">Failed to load</div><div>{err}</div></div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Session ID</th>
                  <th>Order</th>
                  <th>Transaction</th>
                  <th>Base</th>
                  <th>Discount</th>
                  <th>Expected</th>
                  <th>Status</th>
                  <th>Receipt</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = statusTag(r.status);
                  return (
                    <tr key={r.id} className="row-hover">
                      <td className="cell-id">{r.id.slice(0, 8)}</td>
                      <td className="cell-sub">{r.order_id ? r.order_id.slice(0, 8) : '—'}</td>
                      <td className="cell-sub">{r.transaction_id || '—'}</td>
                      <td className="cell-amount">RM {Number(r.base_amount || 0).toFixed(2)}</td>
                      <td className="cell-amount">RM {Number(r.discount || 0).toFixed(2)}</td>
                      <td className="cell-amount">RM {Number(r.expected_amount || 0).toFixed(2)}</td>
                      <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                      <td>{r.receipt_path ? <span className="tag tag-ready">Uploaded</span> : <span className="tag tag-neutral">None</span>}</td>
                      <td className="cell-sub">{new Date(r.created_at).toLocaleString()}</td>
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
