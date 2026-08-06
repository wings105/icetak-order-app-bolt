import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  IconAlert, IconCheck, IconEdit, IconMessage, IconRefresh, IconSearch, IconShipping, IconX,
} from '../components/Icons';

type MessageJob = {
  id: string;
  shipment_id: string;
  notification_type: 'checkout_address' | 'first_scan_tracking';
  source_event_time: string | null;
  tracking_no: string | null;
  courier: string | null;
  tracking_link: string | null;
  recipient_phone: string | null;
  recipient_name: string | null;
  recipient_address_text: string | null;
  message_body: string;
  status: 'ready' | 'blocked' | 'copied' | 'done' | 'dismissed';
  blocked_reason: string | null;
  copied_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type StatusFilter = 'all' | MessageJob['status'];
type TypeFilter = 'all' | MessageJob['notification_type'];

const statusInfo: Record<MessageJob['status'], { label: string; cls: string }> = {
  ready: { label: 'Ready to copy', cls: 'badge-info' },
  blocked: { label: 'Needs attention', cls: 'badge-error' },
  copied: { label: 'Copied', cls: 'badge-warning' },
  done: { label: 'Done', cls: 'badge-success' },
  dismissed: { label: 'Dismissed', cls: 'badge-neutral' },
};

const typeLabel = (type: MessageJob['notification_type']) =>
  type === 'first_scan_tracking' ? 'First Scan Tracking' : 'Checkout Address';

const reasonLabel = (reason: string | null) => {
  const labels: Record<string, string> = {
    MISSING_RECIPIENT_PHONE: 'Phone customer tiada',
    MISSING_RECIPIENT_NAME: 'Nama customer tiada',
    MISSING_RECIPIENT_ADDRESS: 'Alamat customer tiada',
    MISSING_TRACKING_NUMBER: 'Tracking number tiada',
    UNSUPPORTED_TRACKING_FORMAT: 'Format tracking tidak dikenali',
  };
  return reason ? labels[reason] || reason : '';
};

const formatDate = (value: string | null) => {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ms-MY', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kuala_Lumpur',
  }).format(new Date(value));
};

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const area = document.createElement('textarea');
  area.value = value;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

export default function ShipmentMessages() {
  const [rows, setRows] = useState<MessageJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    const { data, error: loadError } = await supabase
      .from('shipment_message_jobs')
      .select('id, shipment_id, notification_type, source_event_time, tracking_no, courier, tracking_link, recipient_phone, recipient_name, recipient_address_text, message_body, status, blocked_reason, copied_at, completed_at, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(200);

    if (loadError) setError(loadError.message);
    else setRows((data || []) as MessageJob[]);
    if (!quiet) setLoading(false);
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const stats = useMemo(() => rows.reduce(
    (acc, row) => {
      acc[row.status] += 1;
      return acc;
    },
    { ready: 0, blocked: 0, copied: 0, done: 0, dismissed: 0 },
  ), [rows]);

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (typeFilter !== 'all' && row.notification_type !== typeFilter) return false;
      if (!search) return true;
      return [
        row.tracking_no,
        row.recipient_phone,
        row.recipient_name,
        row.recipient_address_text,
        row.message_body,
      ].some((value) => String(value || '').toLowerCase().includes(search));
    });
  }, [rows, query, statusFilter, typeFilter]);

  const patch = async (id: string, values: Partial<MessageJob>, successMessage: string) => {
    setBusyId(id);
    const { error: updateError } = await supabase
      .from('shipment_message_jobs')
      .update(values)
      .eq('id', id);
    if (updateError) setError(updateError.message);
    else {
      setRows((current) => current.map((row) => row.id === id ? { ...row, ...values } : row));
      setNotice(successMessage);
    }
    setBusyId(null);
  };

  const handleCopy = async (row: MessageJob) => {
    if (row.status === 'blocked') return;
    setBusyId(row.id);
    try {
      await copyText(row.message_body);
      const { error: updateError } = await supabase
        .from('shipment_message_jobs')
        .update({ status: 'copied' })
        .eq('id', row.id);
      if (updateError) throw updateError;
      setRows((current) => current.map((item) => item.id === row.id ? { ...item, status: 'copied' } : item));
      setNotice('Mesej sudah disalin.');
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : 'Tidak dapat copy mesej.');
    } finally {
      setBusyId(null);
    }
  };

  const beginEdit = (row: MessageJob) => {
    setEditingId(row.id);
    setDraft(row.message_body);
  };

  const saveEdit = async (row: MessageJob) => {
    const message = draft.trim();
    if (!message) {
      setError('Mesej tidak boleh kosong.');
      return;
    }
    await patch(row.id, { message_body: message }, 'Mesej dikemas kini.');
    setEditingId(null);
    setDraft('');
  };

  const reopen = async (row: MessageJob) => {
    await patch(row.id, {
      status: row.blocked_reason ? 'blocked' : 'ready',
      completed_at: null,
    }, 'Job dibuka semula.');
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tracking Messages</h1>
          <p className="page-subtitle">Manual message preparation for checkout and first courier scan</p>
        </div>
        <button className="btn btn-outline" onClick={() => void load()} disabled={loading}>
          <IconRefresh size={16} /> Refresh
        </button>
      </div>

      <div className="panel" style={{ marginBottom: 18, borderColor: '#fed7aa', background: '#fffaf3' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div className="empty-icon" style={{ margin: 0, flex: '0 0 auto' }}><IconAlert size={20} /></div>
          <div>
            <div className="panel-title">Manual only — external sending is disabled</div>
            <div className="panel-subtitle" style={{ marginTop: 4 }}>
              Sistem ini tidak memanggil Wasapflow atau mana-mana messaging API. Staff hanya boleh semak, edit, copy dan tandakan selesai.
            </div>
          </div>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card new"><div className="stat-label">Ready</div><div className="stat-value">{stats.ready}</div><div className="stat-hint">Boleh copy</div></div>
        <div className="stat-card problem"><div className="stat-label">Needs Attention</div><div className="stat-value">{stats.blocked}</div><div className="stat-hint">Data tidak lengkap</div></div>
        <div className="stat-card pay"><div className="stat-label">Copied</div><div className="stat-value">{stats.copied}</div><div className="stat-hint">Belum ditanda selesai</div></div>
        <div className="stat-card ready"><div className="stat-label">Done</div><div className="stat-value">{stats.done}</div><div className="stat-hint">Sudah diurus</div></div>
      </div>

      <div className="panel">
        <div className="panel-header" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="panel-title">Prepared Messages</div>
            <div className="panel-subtitle">Auto refresh setiap 30 saat · shipment baharu sahaja</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginLeft: 'auto' }}>
            <label style={{ position: 'relative' }}>
              <IconSearch size={15} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-muted)' }} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tracking, phone, nama..."
                style={{ minWidth: 220, padding: '9px 12px 9px 32px' }}
              />
            </label>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as TypeFilter)}>
              <option value="all">All message types</option>
              <option value="first_scan_tracking">First Scan Tracking</option>
              <option value="checkout_address">Checkout Address</option>
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
              <option value="all">All statuses</option>
              <option value="ready">Ready</option>
              <option value="blocked">Needs Attention</option>
              <option value="copied">Copied</option>
              <option value="done">Done</option>
              <option value="dismissed">Dismissed</option>
            </select>
          </div>
        </div>

        {notice && <div style={{ margin: '0 18px 12px', padding: '10px 12px', borderRadius: 10, background: '#ecfdf3', color: '#067647', fontWeight: 700 }}>{notice}</div>}
        {error && <div style={{ margin: '0 18px 12px', padding: '10px 12px', borderRadius: 10, background: '#fef3f2', color: '#b42318' }}>{error}</div>}

        {loading ? (
          <div className="loading"><span className="spinner" /><span style={{ marginLeft: 8 }}>Loading…</span></div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <div className="empty-icon"><IconMessage size={22} /></div>
            <div className="empty-title">Belum ada message job</div>
            <div>Job akan muncul untuk checkout berjaya dan first courier scan yang diterima selepas sistem ini dipasang.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 14, padding: 18 }}>
            {filtered.map((row) => {
              const info = statusInfo[row.status];
              const editing = editingId === row.id;
              const busy = busyId === row.id;
              return (
                <article key={row.id} style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 16, background: 'var(--surface)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                    <div className="empty-icon" style={{ margin: 0, flex: '0 0 auto' }}><IconShipping size={20} /></div>
                    <div style={{ minWidth: 220, flex: '1 1 280px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <strong>{typeLabel(row.notification_type)}</strong>
                        <span className={`badge ${info.cls}`}>{info.label}</span>
                        {row.courier && <span className="badge badge-neutral">{row.courier.toUpperCase()}</span>}
                      </div>
                      <div className="cell-sub" style={{ marginTop: 6 }}>
                        {row.recipient_name || 'Nama tiada'} · {row.recipient_phone || 'Phone tiada'}
                      </div>
                      <div className="cell-id" style={{ marginTop: 5 }}>{row.tracking_no || 'Tracking tiada'}</div>
                      {row.notification_type === 'checkout_address' && row.recipient_address_text && (
                        <div className="cell-sub" style={{ marginTop: 6 }}>{row.recipient_address_text}</div>
                      )}
                      {row.blocked_reason && (
                        <div style={{ marginTop: 8, color: '#b42318', fontWeight: 700 }}>{reasonLabel(row.blocked_reason)}</div>
                      )}
                    </div>
                    <div className="cell-sub" style={{ textAlign: 'right' }}>
                      <div>{formatDate(row.source_event_time || row.created_at)}</div>
                      <div style={{ marginTop: 4 }}>Updated {formatDate(row.updated_at)}</div>
                    </div>
                  </div>

                  <div style={{ marginTop: 14 }}>
                    {editing ? (
                      <textarea
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        rows={8}
                        style={{ width: '100%', resize: 'vertical', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: 1.55 }}
                      />
                    ) : (
                      <pre style={{ margin: 0, padding: 14, borderRadius: 12, background: '#f8fafc', border: '1px solid var(--border)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, lineHeight: 1.55 }}>{row.message_body}</pre>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                    {editing ? (
                      <>
                        <button className="btn btn-primary" disabled={busy} onClick={() => void saveEdit(row)}><IconCheck size={14} /> Save</button>
                        <button className="btn btn-outline" disabled={busy} onClick={() => { setEditingId(null); setDraft(''); }}><IconX size={14} /> Cancel</button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-primary" disabled={busy || row.status === 'blocked'} onClick={() => void handleCopy(row)}>
                          <IconMessage size={14} /> Copy message
                        </button>
                        <button className="btn btn-outline" disabled={busy} onClick={() => beginEdit(row)}><IconEdit size={14} /> Edit</button>
                        {row.tracking_link && (
                          <a className="btn btn-outline" href={row.tracking_link} target="_blank" rel="noreferrer">Open courier</a>
                        )}
                        {row.status !== 'done' && row.status !== 'dismissed' ? (
                          <>
                            <button className="btn btn-outline" disabled={busy} onClick={() => void patch(row.id, { status: 'done' }, 'Job ditanda selesai.')}><IconCheck size={14} /> Mark done</button>
                            <button className="btn btn-outline" disabled={busy} onClick={() => void patch(row.id, { status: 'dismissed' }, 'Job diketepikan.')}><IconX size={14} /> Dismiss</button>
                          </>
                        ) : (
                          <button className="btn btn-outline" disabled={busy} onClick={() => void reopen(row)}><IconRefresh size={14} /> Reopen</button>
                        )}
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
