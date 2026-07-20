import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { IconRefresh, IconWhatsApp } from '../components/Icons';

type OutboxRow = {
  id: string;
  event_type: string | null;
  order_no: string | null;
  phone: string | null;
  customer_name: string | null;
  status: string | null;
  message_type: string | null;
  mode: string | null;
  body: string | null;
  template_name: string | null;
  attempt_count: number | null;
  error_message: string | null;
  created_at: string;
  sent_at: string | null;
};

const outboxTag = (s: string | null) => {
  const v = (s || '').toLowerCase();
  if (v === 'sent' || v === 'delivered' || v === 'read') return { label: v, cls: 'badge-success' };
  if (v === 'pending' || v === 'queued') return { label: v, cls: 'badge-warning' };
  if (v === 'failed' || v === 'error') return { label: v, cls: 'badge-error' };
  return { label: v || 'draft', cls: 'badge-neutral' };
};

export default function WhatsAppOutbox() {
  const [rows, setRows] = useState<OutboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from('whatsapp_outbox')
      .select('id, event_type, order_no, phone, customer_name, status, message_type, mode, body, template_name, attempt_count, error_message, created_at, sent_at')
      .order('created_at', { ascending: false })
      .limit(60);
    if (error) setErr(error.message);
    else setRows(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">WhatsApp Outbox</h1>
          <p className="page-subtitle">Message queue & delivery history</p>
        </div>
        <button className="btn btn-outline" onClick={load}><IconRefresh size={16} /> Refresh</button>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Recent Messages</div>
        </div>
        <div className="table-wrap">
          {loading ? (
            <div className="loading"><span className="spinner" /></div>
          ) : err ? (
            <div className="empty"><div className="empty-title">Failed to load</div><div>{err}</div></div>
          ) : rows.length === 0 ? (
            <div className="empty">
              <div className="empty-icon"><IconWhatsApp size={22} /></div>
              <div className="empty-title">No messages yet</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Event</th>
                  <th>Recipient</th>
                  <th>Order</th>
                  <th>Type</th>
                  <th>Template / Body</th>
                  <th>Status</th>
                  <th>Attempts</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const st = outboxTag(m.status);
                  return (
                    <tr key={m.id} className="row-hover">
                      <td className="cell-sub">{new Date(m.created_at).toLocaleString()}</td>
                      <td><span className="tag tag-neutral">{m.event_type || 'manual'}</span></td>
                      <td>
                        <div className="cell-name">{m.customer_name || '—'}</div>
                        <div className="cell-sub">{m.phone || '—'}</div>
                      </td>
                      <td className="cell-sub">{m.order_no || '—'}</td>
                      <td>
                        <span className="tag tag-neutral">{m.mode || m.message_type || 'text'}</span>
                      </td>
                      <td style={{ maxWidth: 320 }}>
                        <div className="cell-name" style={{ fontSize: 12.5 }}>{m.template_name || '—'}</div>
                        {m.body && <div className="cell-sub" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.body}</div>}
                        {m.error_message && <div style={{ fontSize: 11.5, color: 'var(--error)', marginTop: 2 }}>{m.error_message}</div>}
                      </td>
                      <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                      <td className="cell-sub">{m.attempt_count ?? 0}</td>
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
