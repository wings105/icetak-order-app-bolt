import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { IconRefresh, IconWhatsApp, IconPower, IconWifi, IconMessage, IconAlert } from '../components/Icons';

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
  sent_at: string | null;
  error_message: string | null;
};

const outboxTag = (s: string | null) => {
  const v = (s || '').toLowerCase();
  if (v === 'sent' || v === 'delivered' || v === 'read') return { label: v, cls: 'badge-success' };
  if (v === 'pending' || v === 'queued') return { label: v, cls: 'badge-warning' };
  if (v === 'failed' || v === 'error') return { label: v, cls: 'badge-error' };
  return { label: v || 'draft', cls: 'badge-neutral' };
};

export default function WhatsAppControl() {
  const [status, setStatus] = useState<Status | null>(null);
  const [outbox, setOutbox] = useState<OutboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    const [statusRes, outboxRes] = await Promise.all([
      supabase.from('wasapflow_control_status').select('*').maybeSingle(),
      supabase.from('whatsapp_outbox')
        .select('id, event_type, phone, customer_name, status, message_type, created_at, sent_at, error_message')
        .order('created_at', { ascending: false })
        .limit(20),
    ]);
    if (statusRes.error) setErr(statusRes.error.message);
    else setStatus(statusRes.data as Status | null);
    if (!outboxRes.error) setOutbox(outboxRes.data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const settings = status?.settings || {};
  const provider = (settings as any).provider || 'wasapflow';
  const wabaId = (settings as any).waba_id || (settings as any).phone_number_id || '—';
  const dispatcher = (settings as any).dispatcher_enabled ?? true;

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">WhatsApp Control</h1>
          <p className="page-subtitle">Provider health, dispatcher status, message pipeline</p>
        </div>
        <button className="btn btn-outline" onClick={load}><IconRefresh size={16} /> Refresh</button>
      </div>

      <div className="stats-grid">
        <div className="stat-card ready">
          <div className="stat-label"><IconWifi size={12} style={{ verticalAlign: '-2px' }} /> Provider</div>
          <div className="stat-value" style={{ fontSize: 22, textTransform: 'capitalize' }}>{String(provider)}</div>
          <div className="stat-hint">WhatsApp gateway</div>
        </div>
        <div className="stat-card new">
          <div className="stat-label"><IconMessage size={12} style={{ verticalAlign: '-2px' }} /> Templates</div>
          <div className="stat-value">{status?.template_count ?? '—'}</div>
          <div className="stat-hint">Approved templates</div>
        </div>
        <div className="stat-card pay">
          <div className="stat-label"><IconWhatsApp size={12} style={{ verticalAlign: '-2px' }} /> Rules</div>
          <div className="stat-value">{status?.rule_count ?? '—'}</div>
          <div className="stat-hint">Automation rules</div>
        </div>
        <div className="stat-card cash">
          <div className="stat-label"><IconPower size={12} style={{ verticalAlign: '-2px' }} /> Dispatcher</div>
          <div className="stat-value" style={{ fontSize: 22 }}>{dispatcher ? 'Running' : 'Paused'}</div>
          <div className="stat-hint">Auto-dispatch worker</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Configuration</div>
              <div className="panel-subtitle">Live snapshot from wasapflow_control_status</div>
            </div>
          </div>
          <div style={{ padding: 20 }}>
            {loading ? (
              <div className="loading"><span className="spinner" /></div>
            ) : err ? (
              <div className="empty"><IconAlert size={22} /><div>{err}</div></div>
            ) : (
              <div className="kv-list">
                <div className="kv-row"><span className="k">Provider</span><span className="v">{String(provider)}</span></div>
                <div className="kv-row"><span className="k">WABA / Phone ID</span><span className="v">{String(wabaId)}</span></div>
                <div className="kv-row"><span className="k">Approved templates</span><span className="v">{status?.template_count ?? 0}</span></div>
                <div className="kv-row"><span className="k">Automation rules</span><span className="v">{status?.rule_count ?? 0}</span></div>
                <div className="kv-row"><span className="k">Outbox size</span><span className="v">{status?.outbox_count ?? 0}</span></div>
                <div className="kv-row"><span className="k">Open 24h windows</span><span className="v">{status?.open_window_count ?? 0}</span></div>
                <div className="kv-row"><span className="k">Dispatcher</span><span className="v" style={{ color: dispatcher ? 'var(--success)' : 'var(--error)' }}>{dispatcher ? 'Active' : 'Paused'}</span></div>
              </div>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Recent Outbox</div>
              <div className="panel-subtitle">Latest 20 messages</div>
            </div>
          </div>
          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            {loading ? (
              <div className="loading"><span className="spinner" /></div>
            ) : outbox.length === 0 ? (
              <div className="empty"><div className="empty-icon"><IconWhatsApp /></div><div>No outgoing messages yet</div></div>
            ) : (
              outbox.map((m) => {
                const st = outboxTag(m.status);
                return (
                  <div key={m.id} style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-light)', display: 'flex', gap: 12, alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontWeight: 600 }}>{m.customer_name || m.phone || 'Unknown'}</span>
                        <span className={`badge ${st.cls}`}>{st.label}</span>
                        <span className="tag tag-neutral">{m.message_type || 'text'}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.event_type || 'manual'} · {new Date(m.created_at).toLocaleString()}</div>
                      {m.error_message && <div style={{ fontSize: 12, color: 'var(--error)', marginTop: 4 }}>{m.error_message}</div>}
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
