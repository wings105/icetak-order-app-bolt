import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { IconRefresh } from '../components/Icons';

type Status = {
  template_count: number | null;
  rule_count: number | null;
  outbox_count: number | null;
  open_window_count: number | null;
  settings: Record<string, unknown> | null;
};

type OutboxRow = {
  id: string;
  event_type: string | null;
  phone: string | null;
  customer_name: string | null;
  status: string | null;
  message_type: string | null;
  created_at: string;
  error_message: string | null;
};

const statusBadge = (s: string | null) => {
  const v = (s || '').toLowerCase();
  if (v === 'sent' || v === 'delivered') return { label: v, cls: 'badge-success' };
  if (v === 'pending' || v === 'queued') return { label: v, cls: 'badge-warning' };
  if (v === 'failed' || v === 'error') return { label: v, cls: 'badge-error' };
  return { label: v || 'draft', cls: 'badge-neutral' };
};

export default function WhatsAppControl() {
  const [status, setStatus] = useState<Status | null>(null);
  const [outbox, setOutbox] = useState<OutboxRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [statusRes, outboxRes] = await Promise.all([
      supabase.from('wasapflow_control_status').select('*').maybeSingle(),
      supabase.from('whatsapp_outbox')
        .select('id, event_type, phone, customer_name, status, message_type, created_at, error_message')
        .order('created_at', { ascending: false })
        .limit(20),
    ]);
    setStatus(statusRes.data as Status | null);
    setOutbox(outboxRes.data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const settings = (status?.settings || {}) as Record<string, unknown>;
  const provider = String(settings.provider || 'wasapflow');
  const dispatcher = settings.dispatcher_enabled !== false;

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <div className="page-label">WhatsApp</div>
          <h1 className="page-title">Control Center</h1>
          <p className="page-subtitle">Provider health, dispatcher status, message pipeline</p>
        </div>
        <button className="btn btn-outline" onClick={load}><IconRefresh size={16} /> Refresh</button>
      </div>

      <div className="stat-row">
        <div className="stat-card green">
          <div className="stat-label">Provider</div>
          <div className="stat-value" style={{ fontSize: 20, textTransform: 'capitalize' }}>{provider}</div>
          <div className="stat-hint">WhatsApp gateway</div>
        </div>
        <div className="stat-card blue">
          <div className="stat-label">Templates</div>
          <div className="stat-value">{status?.template_count ?? '—'}</div>
          <div className="stat-hint">Approved</div>
        </div>
        <div className="stat-card amber">
          <div className="stat-label">Rules</div>
          <div className="stat-value">{status?.rule_count ?? '—'}</div>
          <div className="stat-hint">Automation rules</div>
        </div>
        <div className="stat-card purple">
          <div className="stat-label">Dispatcher</div>
          <div className="stat-value" style={{ fontSize: 20 }}>{dispatcher ? 'Active' : 'Paused'}</div>
          <div className="stat-hint">Auto-dispatch</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-header"><div className="panel-title">Configuration</div></div>
          <div style={{ padding: 20 }}>
            {loading ? (
              <div className="loading"><span className="spinner" /></div>
            ) : (
              <div className="kv-list">
                <div className="kv-row"><span className="k">Provider</span><span className="v">{provider}</span></div>
                <div className="kv-row"><span className="k">Approved templates</span><span className="v">{status?.template_count ?? 0}</span></div>
                <div className="kv-row"><span className="k">Automation rules</span><span className="v">{status?.rule_count ?? 0}</span></div>
                <div className="kv-row"><span className="k">Outbox queue</span><span className="v">{status?.outbox_count ?? 0}</span></div>
                <div className="kv-row"><span className="k">Open 24h windows</span><span className="v">{status?.open_window_count ?? 0}</span></div>
                <div className="kv-row"><span className="k">Dispatcher</span><span className="v" style={{ color: dispatcher ? 'var(--success)' : 'var(--error)' }}>{dispatcher ? 'Running' : 'Paused'}</span></div>
              </div>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header"><div className="panel-title">Recent Outbox</div></div>
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {loading ? (
              <div className="loading"><span className="spinner" /></div>
            ) : outbox.length === 0 ? (
              <div className="empty">No messages yet</div>
            ) : (
              outbox.map((m) => {
                const st = statusBadge(m.status);
                return (
                  <div key={m.id} style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-light)', display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 3 }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{m.customer_name || m.phone || '—'}</span>
                        <span className={`badge ${st.cls}`}>{st.label}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{m.event_type || 'manual'} · {new Date(m.created_at).toLocaleString()}</div>
                      {m.error_message && <div style={{ fontSize: 11, color: 'var(--error)', marginTop: 2 }}>{m.error_message}</div>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
