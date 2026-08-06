import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  IconAlert, IconCheck, IconMessage, IconRefresh, IconSearch, IconShipping,
} from '../components/Icons';

type TrackingSettings = {
  auto_send_enabled: boolean;
  provider_mode: string;
  provider_ready: boolean;
  updated_at: string | null;
};

type TrackingRow = {
  id: string;
  order_id: string | null;
  reference: string | null;
  tracking_no: string;
  courier: string | null;
  tracking_link: string | null;
  status: string | null;
  normalized_status: string | null;
  provider: string | null;
  service_provider: string | null;
  recipient_phone: string | null;
  recipient_name: string | null;
  recipient_address_text: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
  first_scan_at: string | null;
  first_scan_status: string | null;
  send_status: 'not_ready' | 'blocked' | 'ready' | 'opened' | 'sent' | 'failed';
  blocked_reason: string | null;
  manual_opened_at: string | null;
  sent_at: string | null;
  send_method: string | null;
  message_body: string;
};

type DashboardPayload = {
  settings?: Partial<TrackingSettings>;
  rows?: TrackingRow[];
};

type BadgeInfo = { label: string; cls: string };

const defaultSettings: TrackingSettings = {
  auto_send_enabled: false,
  provider_mode: 'manual_whatsapp_link',
  provider_ready: false,
  updated_at: null,
};

const formatDate = (value: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ms-MY', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kuala_Lumpur',
  }).format(date);
};

const normalizePhone = (value: string | null) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('60')) return digits;
  if (digits.startsWith('0')) return `6${digits}`;
  if (digits.startsWith('1')) return `60${digits}`;
  return digits;
};

const slug = (value: string | null) => String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

const shipmentStatus = (normalizedStatus: string | null, rawStatus: string | null): BadgeInfo => {
  const normalized = slug(normalizedStatus);
  const raw = String(rawStatus || '').trim().toLowerCase();

  if (
    normalized === 'cancelled' || normalized === 'canceled' || normalized === 'failed' ||
    normalized === 'exception' || raw.includes('cancel') || raw.includes('fail') || raw.includes('exception')
  ) {
    return { label: 'Problem', cls: 'badge-error' };
  }

  if (
    normalized === 'delivered' || raw === 'delivered' ||
    raw === 'parcel has been received' || raw.includes('successfully delivered')
  ) {
    return { label: 'Delivered', cls: 'badge-success' };
  }

  if (
    normalized === 'out_for_delivery' || raw === 'delivering' ||
    raw.includes('on its way for delivery') || raw.includes('out for delivery')
  ) {
    return { label: 'Out for Delivery', cls: 'badge-warning' };
  }

  if (
    ['picked_up', 'accepted_by_courier', 'in_transit', 'shipped'].includes(normalized) ||
    raw.includes('in transit') || raw.includes('picked up') || raw.includes('departed to hub') || raw.includes('arrived hub')
  ) {
    return { label: 'In Transit', cls: 'badge-info' };
  }

  if (['shipment_created', 'awb_created', 'pending_pickup', 'pending'].includes(normalized)) {
    return { label: 'Pending Pickup', cls: 'badge-neutral' };
  }

  const fallback = rawStatus || normalizedStatus || 'Pending';
  return { label: fallback, cls: 'badge-neutral' };
};

const sendStatus = (value: TrackingRow['send_status']): BadgeInfo => {
  const map: Record<TrackingRow['send_status'], BadgeInfo> = {
    not_ready: { label: 'Waiting First Scan', cls: 'badge-neutral' },
    blocked: { label: 'Needs Attention', cls: 'badge-error' },
    ready: { label: 'Ready to Send', cls: 'badge-info' },
    opened: { label: 'WhatsApp Opened', cls: 'badge-warning' },
    sent: { label: 'Sent', cls: 'badge-success' },
    failed: { label: 'Failed', cls: 'badge-error' },
  };
  return map[value] || map.not_ready;
};

const blockedReason = (value: string | null) => {
  const map: Record<string, string> = {
    MISSING_RECIPIENT_PHONE: 'Phone customer tiada',
    MISSING_TRACKING_NUMBER: 'Tracking number tiada',
    UNSUPPORTED_TRACKING_FORMAT: 'Format tracking tidak dikenali',
  };
  return value ? map[value] || value : '';
};

const unavailableActionLabel = (row: TrackingRow) => {
  if (!row.first_scan_at) return 'Waiting First Scan';
  if (!row.recipient_phone) return 'Phone Missing';
  if (!row.tracking_link) return 'Tracking Link Missing';
  if (row.send_status === 'blocked') return 'Needs Attention';
  return 'Send Tracking';
};

export default function Shipping() {
  const [rows, setRows] = useState<TrackingRow[]>([]);
  const [settings, setSettings] = useState<TrackingSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [settingBusy, setSettingBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [courierFilter, setCourierFilter] = useState('all');

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);

    const { data, error: loadError } = await supabase.rpc('icetak_admin_tracking_dashboard', {
      p_search: null,
      p_limit: 1000,
    });

    if (loadError) {
      setError(loadError.message);
    } else {
      const payload = (data || {}) as DashboardPayload;
      setRows(Array.isArray(payload.rows) ? payload.rows : []);
      setSettings({ ...defaultSettings, ...(payload.settings || {}) });
    }

    if (!quiet) setLoading(false);
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const stats = useMemo(() => ({
    total: rows.length,
    firstScan: rows.filter((row) => Boolean(row.first_scan_at)).length,
    ready: rows.filter((row) => row.send_status === 'ready' || row.send_status === 'opened').length,
    sent: rows.filter((row) => row.send_status === 'sent').length,
  }), [rows]);

  const couriers = useMemo(() => Array.from(new Set(
    rows.map((row) => String(row.courier || '').toLowerCase()).filter(Boolean),
  )).sort(), [rows]);

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== 'all' && row.send_status !== statusFilter) return false;
      if (courierFilter !== 'all' && String(row.courier || '').toLowerCase() !== courierFilter) return false;
      if (!search) return true;
      return [
        row.tracking_no,
        row.recipient_phone,
        row.recipient_name,
        row.reference,
        row.status,
        row.normalized_status,
        row.first_scan_status,
      ].some((value) => String(value || '').toLowerCase().includes(search));
    });
  }, [rows, query, statusFilter, courierFilter]);

  const trackingAction = async (row: TrackingRow, action: 'opened' | 'sent' | 'reopen') => {
    setBusyId(row.id);
    setError(null);
    const { error: actionError } = await supabase.rpc('icetak_admin_tracking_action', {
      p_shipment_id: row.id,
      p_action: action,
    });

    if (actionError) {
      setError(actionError.message);
    } else {
      const messages = {
        opened: 'WhatsApp dibuka dengan mesej tracking.',
        sent: 'Tracking ditanda sudah dihantar.',
        reopen: 'Tracking dibuka semula.',
      };
      setNotice(messages[action]);
      await load(true);
    }
    setBusyId(null);
  };

  const openManualWhatsApp = (row: TrackingRow) => {
    const phone = normalizePhone(row.recipient_phone);
    if (!phone || !row.first_scan_at || !row.tracking_link || row.send_status === 'blocked') {
      setError('Tracking belum boleh dihantar. Semak phone, tracking format dan first courier scan.');
      return;
    }

    const url = `https://wa.me/${phone}?text=${encodeURIComponent(row.message_body)}`;
    const opened = window.open(url, '_blank');
    if (!opened) {
      setError('Browser menyekat tab WhatsApp. Benarkan pop-up dan cuba semula.');
      return;
    }
    opened.opener = null;
    void trackingAction(row, 'opened');
  };

  const toggleAutoSend = async () => {
    setSettingBusy(true);
    setError(null);
    const next = !settings.auto_send_enabled;
    const { data, error: settingError } = await supabase.rpc('icetak_admin_set_tracking_auto_send', {
      p_enabled: next,
    });

    if (settingError) {
      setError(settingError.message);
    } else {
      setSettings({ ...settings, ...((data || {}) as Partial<TrackingSettings>) });
      setNotice(`Auto Send Tracking ${next ? 'ON' : 'OFF'}.`);
    }
    setSettingBusy(false);
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Shipping & Tracking</h1>
          <p className="page-subtitle">Semua tracking ParcelDaily dalam satu tempat</p>
        </div>
        <button className="btn btn-outline" onClick={() => void load()} disabled={loading}>
          <IconRefresh size={16} /> Refresh
        </button>
      </div>

      <div className="panel" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            <div className="panel-title">Auto Send Tracking</div>
            <div className="panel-subtitle" style={{ marginTop: 4 }}>
              Setting utama untuk semua tracking. Manual Send menggunakan WhatsApp link dan tidak menggunakan Wasapflow API.
            </div>
            {!settings.provider_ready && settings.auto_send_enabled && (
              <div style={{ marginTop: 8, color: '#b54708', fontWeight: 700 }}>
                Auto Send disimpan sebagai ON, tetapi provider automatik belum disambungkan. Tiada mesej API akan dihantar.
              </div>
            )}
          </div>
          <button
            className={`btn ${settings.auto_send_enabled ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => void toggleAutoSend()}
            disabled={settingBusy}
            aria-pressed={settings.auto_send_enabled}
          >
            {settings.auto_send_enabled ? <IconCheck size={15} /> : <IconAlert size={15} />}
            Auto Send: {settings.auto_send_enabled ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card new"><div className="stat-label">Total Tracking</div><div className="stat-value">{stats.total}</div><div className="stat-hint">Semua rekod DB</div></div>
        <div className="stat-card pay"><div className="stat-label">First Scan</div><div className="stat-value">{stats.firstScan}</div><div className="stat-hint">Courier sudah scan</div></div>
        <div className="stat-card problem"><div className="stat-label">Ready to Send</div><div className="stat-value">{stats.ready}</div><div className="stat-hint">Perlu tindakan staff</div></div>
        <div className="stat-card ready"><div className="stat-label">Sent</div><div className="stat-value">{stats.sent}</div><div className="stat-hint">Sudah ditanda hantar</div></div>
      </div>

      <div className="panel">
        <div className="panel-header" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div className="panel-title">Tracking List</div>
            <div className="panel-subtitle">{filtered.length} daripada {rows.length} tracking · auto refresh 30 saat</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginLeft: 'auto' }}>
            <label style={{ position: 'relative' }}>
              <IconSearch size={15} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-muted)' }} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tracking, phone, nama..."
                style={{ minWidth: 230, padding: '9px 12px 9px 32px' }}
              />
            </label>
            <select value={courierFilter} onChange={(event) => setCourierFilter(event.target.value)}>
              <option value="all">All couriers</option>
              {couriers.map((courier) => <option key={courier} value={courier}>{courier.toUpperCase()}</option>)}
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All send statuses</option>
              <option value="not_ready">Waiting First Scan</option>
              <option value="blocked">Needs Attention</option>
              <option value="ready">Ready to Send</option>
              <option value="opened">WhatsApp Opened</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>

        {notice && <div style={{ margin: '0 18px 12px', padding: '10px 12px', borderRadius: 10, background: '#ecfdf3', color: '#067647', fontWeight: 700 }}>{notice}</div>}
        {error && <div style={{ margin: '0 18px 12px', padding: '10px 12px', borderRadius: 10, background: '#fef3f2', color: '#b42318' }}>{error}</div>}

        <div className="table-wrap">
          {loading ? (
            <div className="loading"><span className="spinner" /><span style={{ marginLeft: 8 }}>Loading tracking…</span></div>
          ) : filtered.length === 0 ? (
            <div className="empty">
              <div className="empty-icon"><IconShipping size={22} /></div>
              <div className="empty-title">Tiada tracking dijumpai</div>
              <div>Semak filter atau carian.</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Tracking</th>
                  <th>Courier</th>
                  <th>Parcel Status</th>
                  <th>First Scan</th>
                  <th>Send Status</th>
                  <th>Created</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const parcel = shipmentStatus(row.normalized_status, row.status);
                  const delivery = sendStatus(row.send_status);
                  const busy = busyId === row.id;
                  const canSend = Boolean(
                    row.first_scan_at && row.recipient_phone && row.tracking_link && row.send_status !== 'blocked',
                  );
                  return (
                    <tr key={row.id} className="row-hover">
                      <td>
                        <div style={{ fontWeight: 700 }}>{row.recipient_name || 'Nama tiada'}</div>
                        <div className="cell-sub">{row.recipient_phone || 'Phone tiada'}</div>
                        {row.reference && <div className="cell-id" style={{ marginTop: 3 }}>{row.reference}</div>}
                      </td>
                      <td>
                        <a href={row.tracking_link || '#'} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontWeight: 700 }}>
                          {row.tracking_no}
                        </a>
                      </td>
                      <td>{row.courier ? row.courier.toUpperCase() : '—'}</td>
                      <td>
                        <span className={`badge ${parcel.cls}`}>{parcel.label}</span>
                        <div className="cell-sub" style={{ marginTop: 5 }}>{row.status || row.normalized_status || '—'}</div>
                      </td>
                      <td>
                        <div>{formatDate(row.first_scan_at)}</div>
                        {row.first_scan_status && <div className="cell-sub" style={{ marginTop: 5 }}>{row.first_scan_status}</div>}
                      </td>
                      <td>
                        <span className={`badge ${delivery.cls}`}>{delivery.label}</span>
                        {row.blocked_reason && <div style={{ marginTop: 5, color: '#b42318', fontSize: 12 }}>{blockedReason(row.blocked_reason)}</div>}
                        {row.sent_at && <div className="cell-sub" style={{ marginTop: 5 }}>{formatDate(row.sent_at)}</div>}
                      </td>
                      <td className="cell-sub">{formatDate(row.created_at)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', minWidth: 190 }}>
                          {row.send_status !== 'sent' ? (
                            <>
                              <button
                                className={`btn ${canSend ? 'btn-primary' : 'btn-outline'}`}
                                disabled={!canSend || busy}
                                title={!canSend ? unavailableActionLabel(row) : 'Open WhatsApp with tracking message'}
                                onClick={() => openManualWhatsApp(row)}
                              >
                                <IconMessage size={14} /> {canSend ? 'Send Tracking' : unavailableActionLabel(row)}
                              </button>
                              {(row.send_status === 'opened' || row.send_status === 'ready') && canSend && (
                                <button className="btn btn-outline" disabled={busy} onClick={() => void trackingAction(row, 'sent')}>
                                  <IconCheck size={14} /> Mark Sent
                                </button>
                              )}
                            </>
                          ) : (
                            <button className="btn btn-outline" disabled={busy} onClick={() => void trackingAction(row, 'reopen')}>
                              Reopen
                            </button>
                          )}
                        </div>
                      </td>
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
