import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  IconAlert, IconCheck, IconMessage, IconRefresh, IconSearch, IconShipping, IconX,
} from '../components/Icons';

type SendStatus = 'not_ready' | 'blocked' | 'ready' | 'queued' | 'opened' | 'sent' | 'failed' | 'cancelled';
type TrackingAction = 'opened' | 'sent' | 'reopen' | 'cancel' | 'restore' | 'retry_auto';

type MatchCandidate = { orderDbId?: string; orderNo?: string; status?: string; adminStatus?: string; delivery?: string; courier?: string; createdAt?: string };
type MatchSuggestion = { candidateCount?: number; autoLinkable?: boolean; reason?: string; orderDbId?: string; orderNo?: string; confidence?: number; candidates?: MatchCandidate[] };

type ProviderStatus = {
  ready?: boolean;
  provider?: string;
  template_name?: string;
  checks?: Record<string, boolean>;
};

type TrackingSettings = {
  auto_send_enabled: boolean;
  provider_mode: string;
  provider_name: string;
  provider_ready: boolean;
  template_name: string;
  auto_send_activated_at: string | null;
  updated_at: string | null;
  provider_error: string | null;
  provider_status?: ProviderStatus;
};

type TrackingRow = {
  id: string;
  order_id: string | null;
  order_no: string | null;
  reference: string | null;
  tracking_no: string;
  courier: string | null;
  tracking_link: string | null;
  status: string | null;
  normalized_status: string | null;
  recipient_phone: string | null;
  recipient_name: string | null;
  created_at: string;
  first_scan_at: string | null;
  first_scan_status: string | null;
  send_status: SendStatus;
  blocked_reason: string | null;
  sent_at: string | null;
  send_method: string | null;
  manual_cancelled_at: string | null;
  manual_cancel_reason: string | null;
  auto_queue_id: string | null;
  auto_queued_at: string | null;
  auto_attempted_at: string | null;
  provider_message_id: string | null;
  auto_queue_status: string | null;
  auto_attempts: number | null;
  auto_next_retry_at: string | null;
  last_error: string | null;
  message_body: string;
  match_suggestion?: MatchSuggestion | null;
};

type DashboardPayload = {
  settings?: Partial<TrackingSettings>;
  rows?: TrackingRow[];
};

type Badge = { label: string; cls: string };

const CLICKUP_TEAM_ID = '3747262';

const defaultSettings: TrackingSettings = {
  auto_send_enabled: false,
  provider_mode: 'external_provider',
  provider_name: 'wasapflow',
  provider_ready: false,
  template_name: 'tracking_update',
  auto_send_activated_at: null,
  updated_at: null,
  provider_error: null,
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

const parcelBadge = (row: TrackingRow): Badge => {
  if (row.send_status === 'cancelled') return { label: 'Cancelled', cls: 'badge-error' };
  const normalized = slug(row.normalized_status);
  const raw = String(row.status || '').trim().toLowerCase();

  if (
    ['cancelled', 'canceled', 'failed', 'exception'].includes(normalized) ||
    raw.includes('cancel') || raw.includes('fail') || raw.includes('exception')
  ) return { label: 'Problem', cls: 'badge-error' };

  if (
    normalized === 'delivered' || raw === 'delivered' ||
    raw === 'parcel has been received' || raw.includes('successfully delivered')
  ) return { label: 'Delivered', cls: 'badge-success' };

  if (
    normalized === 'out_for_delivery' || raw === 'delivering' ||
    raw.includes('on its way for delivery') || raw.includes('out for delivery')
  ) return { label: 'Out for Delivery', cls: 'badge-warning' };

  if (
    ['picked_up', 'accepted_by_courier', 'in_transit', 'shipped'].includes(normalized) ||
    raw.includes('in transit') || raw.includes('picked up') ||
    raw.includes('departed to hub') || raw.includes('arrived hub')
  ) return { label: 'In Transit', cls: 'badge-info' };

  if (['shipment_created', 'awb_created', 'pending_pickup', 'pending'].includes(normalized)) {
    return { label: 'Pending Pickup', cls: 'badge-neutral' };
  }
  return { label: row.status || row.normalized_status || 'Pending', cls: 'badge-neutral' };
};

const sendBadge = (status: SendStatus): Badge => ({
  not_ready: { label: 'Waiting First Scan', cls: 'badge-neutral' },
  blocked: { label: 'Needs Attention', cls: 'badge-error' },
  ready: { label: 'Ready to Send', cls: 'badge-info' },
  queued: { label: 'Auto Queued', cls: 'badge-warning' },
  opened: { label: 'WhatsApp Opened', cls: 'badge-warning' },
  sent: { label: 'Sent', cls: 'badge-success' },
  failed: { label: 'Auto Failed', cls: 'badge-error' },
  cancelled: { label: 'Cancelled', cls: 'badge-error' },
})[status];

const unavailableLabel = (row: TrackingRow) => {
  if (row.send_status === 'cancelled') return 'Tracking Cancelled';
  if (row.send_status === 'queued') return 'Auto Queued';
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
  const [parcelStatusFilter, setParcelStatusFilter] = useState('all');

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    const { data, error: loadError } = await supabase.rpc('icetak_admin_tracking_dashboard', {
      p_search: null,
      p_limit: 1000,
    });

    if (loadError) setError(loadError.message);
    else {
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
    const timer = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const stats = useMemo(() => ({
    total: rows.length,
    firstScan: rows.filter((row) => Boolean(row.first_scan_at)).length,
    pending: rows.filter((row) => ['ready', 'queued', 'opened', 'failed'].includes(row.send_status)).length,
    sent: rows.filter((row) => row.send_status === 'sent').length,
  }), [rows]);

  const couriers = useMemo(() => Array.from(new Set(
    rows.map((row) => String(row.courier || '').toLowerCase()).filter(Boolean),
  )).sort(), [rows]);

  const parcelStatuses = useMemo(() => {
    const preferred = ['Pending Pickup', 'In Transit', 'Out for Delivery', 'Delivered', 'Cancelled', 'Problem'];
    const found = Array.from(new Set(rows.map((row) => parcelBadge(row).label).filter(Boolean)));
    return [
      ...preferred.filter((status) => found.includes(status)),
      ...found.filter((status) => !preferred.includes(status)).sort(),
    ];
  }, [rows]);

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== 'all' && row.send_status !== statusFilter) return false;
      if (courierFilter !== 'all' && String(row.courier || '').toLowerCase() !== courierFilter) return false;
      if (parcelStatusFilter !== 'all' && parcelBadge(row).label !== parcelStatusFilter) return false;
      if (!search) return true;
      return [row.tracking_no, row.recipient_phone, row.recipient_name, row.reference, row.order_no, row.status]
        .some((value) => String(value || '').toLowerCase().includes(search));
    });
  }, [rows, query, statusFilter, courierFilter, parcelStatusFilter]);

  const trackingAction = async (row: TrackingRow, action: TrackingAction) => {
    if (action === 'cancel') {
      const confirmed = window.confirm(
        `Cancel tracking ${row.tracking_no} dalam sistem iCetak?\n\nTracking ini tidak akan boleh dihantar kepada customer.`,
      );
      if (!confirmed) return;
    }

    setBusyId(row.id);
    setError(null);
    const { error: actionError } = await supabase.rpc('icetak_admin_tracking_action', {
      p_shipment_id: row.id,
      p_action: action,
    });

    if (actionError) setError(actionError.message);
    else {
      const messages: Record<TrackingAction, string> = {
        opened: 'WhatsApp dibuka dengan mesej tracking.',
        sent: 'Tracking ditanda sudah dihantar.',
        reopen: 'Tracking dibuka semula.',
        cancel: 'Tracking dibatalkan dalam sistem iCetak.',
        restore: 'Tracking dipulihkan semula.',
        retry_auto: 'Auto Send dimasukkan semula ke queue.',
      };
      setNotice(messages[action]);
      await load(true);
    }
    setBusyId(null);
  };

  const openManualWhatsApp = (row: TrackingRow) => {
    const phone = normalizePhone(row.recipient_phone);
    if (
      !phone || !row.first_scan_at || !row.tracking_link ||
      ['blocked', 'cancelled', 'queued'].includes(row.send_status)
    ) {
      setError('Tracking belum boleh dihantar. Semak status, phone, tracking format dan first courier scan.');
      return;
    }

    const opened = window.open(
      `https://wa.me/${phone}?text=${encodeURIComponent(row.message_body)}`,
      '_blank',
    );
    if (!opened) {
      setError('Browser menyekat tab WhatsApp. Benarkan pop-up dan cuba semula.');
      return;
    }
    opened.opener = null;
    void trackingAction(row, 'opened');
  };

  const linkShipmentOrder = async (row: TrackingRow, suggestedRef?: string) => {
    const suggestion = row.match_suggestion;
    const initial = suggestedRef || suggestion?.orderNo || '';
    const orderRef = suggestedRef || window.prompt(
      suggestion?.orderNo
        ? `Link tracking ${row.tracking_no} ke order iCetak?\n\nSuggested: ${suggestion.orderNo} (${suggestion.confidence || 0}% match)\nBoleh ubah Order ID jika perlu.`
        : `Masukkan Order ID iCetak untuk tracking ${row.tracking_no}.\nContoh: IC260810-7539`,
      initial,
    );
    if (!orderRef?.trim()) return;
    const confirmed = window.confirm(`Link ${row.tracking_no} → ${orderRef.trim()}?\n\nStatus shipment semasa akan sync ke order tersebut.`);
    if (!confirmed) return;
    setBusyId(row.id);
    setError(null);
    const { data, error: linkError } = await supabase.rpc('icetak_admin_link_shipment_order', {
      p_shipment_id: row.id,
      p_order_ref: orderRef.trim(),
    });
    if (linkError) setError(linkError.message);
    else {
      const linked = (data || {}) as { orderNo?: string };
      setNotice(`Tracking linked ke ${linked.orderNo || orderRef.trim()}.`);
      await load(true);
    }
    setBusyId(null);
  };

  const toggleAutoSend = async () => {
    const next = !settings.auto_send_enabled;
    const confirmed = window.confirm(next
      ? 'Aktifkan Auto Send Tracking melalui Wasapflow?\n\nHanya first scan baharu selepas switch ON akan dihantar. Tracking lama tidak akan dihantar semula.'
      : 'Matikan Auto Send Tracking?\n\nSemua auto job yang masih pending akan dihentikan.');
    if (!confirmed) return;

    setSettingBusy(true);
    setError(null);
    const { data, error: settingError } = await supabase.rpc('icetak_admin_set_tracking_auto_send', {
      p_enabled: next,
    });

    if (settingError) setError(settingError.message);
    else {
      setSettings({ ...settings, ...((data || {}) as Partial<TrackingSettings>) });
      setNotice(`Auto Send Tracking ${next ? 'ON' : 'OFF'}.`);
      await load(true);
    }
    setSettingBusy(false);
  };

  const providerLabel = settings.provider_ready ? 'Wasapflow Ready' : 'Wasapflow Not Ready';

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
              Bila ON, first courier scan baharu dihantar sekali sahaja melalui Wasapflow. Tracking Cancelled tidak akan dihantar.
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className={`badge ${settings.provider_ready ? 'badge-success' : 'badge-error'}`}>{providerLabel}</span>
              <span className="cell-sub">Template fallback: {settings.template_name || 'tracking_update'}</span>
              {settings.auto_send_activated_at && settings.auto_send_enabled && (
                <span className="cell-sub">ON sejak {formatDate(settings.auto_send_activated_at)}</span>
              )}
            </div>
            {!settings.provider_ready && (
              <div style={{ marginTop: 8, color: '#b42318', fontWeight: 700 }}>
                {settings.provider_error || 'Credential, dispatcher atau approved tracking template belum lengkap.'}
              </div>
            )}
          </div>
          <button
            className={`btn ${settings.auto_send_enabled ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => void toggleAutoSend()}
            disabled={settingBusy || (!settings.provider_ready && !settings.auto_send_enabled)}
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
        <div className="stat-card problem"><div className="stat-label">Pending Send</div><div className="stat-value">{stats.pending}</div><div className="stat-hint">Ready, queue atau failed</div></div>
        <div className="stat-card ready"><div className="stat-label">Sent</div><div className="stat-value">{stats.sent}</div><div className="stat-hint">Manual atau Wasapflow</div></div>
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
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tracking, phone, nama, order..." style={{ minWidth: 230, padding: '9px 12px 9px 32px' }} />
            </label>
            <select value={courierFilter} onChange={(event) => setCourierFilter(event.target.value)}>
              <option value="all">All couriers</option>
              {couriers.map((courier) => <option key={courier} value={courier}>{courier.toUpperCase()}</option>)}
            </select>
            <select value={parcelStatusFilter} onChange={(event) => setParcelStatusFilter(event.target.value)}>
              <option value="all">All parcel statuses</option>
              {parcelStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All send statuses</option>
              <option value="not_ready">Waiting First Scan</option>
              <option value="blocked">Needs Attention</option>
              <option value="ready">Ready to Send</option>
              <option value="queued">Auto Queued</option>
              <option value="opened">WhatsApp Opened</option>
              <option value="sent">Sent</option>
              <option value="failed">Auto Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        {notice && <div style={{ margin: '0 18px 12px', padding: '10px 12px', borderRadius: 10, background: '#ecfdf3', color: '#067647', fontWeight: 700 }}>{notice}</div>}
        {error && <div style={{ margin: '0 18px 12px', padding: '10px 12px', borderRadius: 10, background: '#fef3f2', color: '#b42318' }}>{error}</div>}

        <div className="table-wrap">
          {loading ? (
            <div className="loading"><span className="spinner" /><span style={{ marginLeft: 8 }}>Loading tracking…</span></div>
          ) : filtered.length === 0 ? (
            <div className="empty"><div className="empty-icon"><IconShipping size={22} /></div><div className="empty-title">Tiada tracking dijumpai</div><div>Semak filter atau carian.</div></div>
          ) : (
            <table>
              <thead><tr><th>Customer</th><th>Tracking</th><th>Courier</th><th>Parcel Status</th><th>First Scan</th><th>Send Status</th><th>Created</th><th>Action</th></tr></thead>
              <tbody>
                {filtered.map((row) => {
                  const cancelled = row.send_status === 'cancelled';
                  const queued = row.send_status === 'queued';
                  const parcel = parcelBadge(row);
                  const delivery = sendBadge(row.send_status);
                  const busy = busyId === row.id;
                  const phone = normalizePhone(row.recipient_phone);
                  const canSend = Boolean(
                    row.first_scan_at && row.recipient_phone && row.tracking_link &&
                    !['blocked', 'cancelled', 'queued', 'sent'].includes(row.send_status),
                  );

                  return (
                    <tr key={row.id} className="row-hover">
                      <td>
                        <div style={{ fontWeight: 700 }}>{row.recipient_name || 'Nama tiada'}</div>
                        {phone ? (
                          <a href={`https://wa.me/${phone}`} target="_blank" rel="noreferrer" className="cell-sub" title={`Open WhatsApp ${phone}`} style={{ display: 'inline-block', color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}>
                            {row.recipient_phone}
                          </a>
                        ) : <div className="cell-sub">Phone tiada</div>}
                        {row.reference && /^86[a-z0-9]+$/i.test(row.reference) && (
                          <div style={{ marginTop: 3 }}>
                            <a href={`https://app.clickup.com/t/${CLICKUP_TEAM_ID}/${encodeURIComponent(row.reference)}`} target="_blank" rel="noreferrer" className="cell-id" title="Open ClickUp task" style={{ color: 'var(--primary)', textDecoration: 'none' }}>
                              {row.reference}
                            </a>
                          </div>
                        )}
                        {row.reference && !/^86[a-z0-9]+$/i.test(row.reference) && !row.order_id && (
                          <div className="cell-sub" style={{ marginTop: 3 }}>Reference: {row.reference}</div>
                        )}
                        {row.order_id && row.order_no && (
                          <div style={{ marginTop: 3 }}>
                            <a href={`/?admin=v2&order=${encodeURIComponent(row.order_no)}`} target="_blank" rel="noreferrer" className="cell-sub" title="Open linked iCetak order" style={{ color: 'var(--primary)', fontWeight: 700, textDecoration: 'none' }}>
                              Order {row.order_no}
                            </a>
                          </div>
                        )}
                        {!row.order_id && row.match_suggestion?.orderNo && (
                          <div style={{ marginTop: 4 }}>
                            <span className={`badge ${row.match_suggestion.autoLinkable ? 'badge-success' : 'badge-warning'}`}>
                              Suggested {row.match_suggestion.orderNo} · {row.match_suggestion.confidence || 0}%
                            </span>
                            <div className="cell-sub" style={{ marginTop: 3 }}>
                              {row.match_suggestion.reason === 'phone_unique_courier_mismatch' ? 'Phone exact · courier perlu semak' : 'Phone + courier match'}
                            </div>
                          </div>
                        )}
                      </td>
                      <td><a href={row.tracking_link || '#'} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontWeight: 700 }}>{row.tracking_no}</a></td>
                      <td>{row.courier ? row.courier.toUpperCase() : '—'}</td>
                      <td><span className={`badge ${parcel.cls}`}>{parcel.label}</span><div className="cell-sub" style={{ marginTop: 5 }}>{cancelled ? `PD: ${row.status || row.normalized_status || '—'}` : (row.status || row.normalized_status || '—')}</div></td>
                      <td><div>{formatDate(row.first_scan_at)}</div>{row.first_scan_status && <div className="cell-sub" style={{ marginTop: 5 }}>{row.first_scan_status}</div>}</td>
                      <td>
                        <span className={`badge ${delivery.cls}`}>{delivery.label}</span>
                        {row.send_method && row.send_status === 'sent' && <div className="cell-sub" style={{ marginTop: 5 }}>{row.send_method === 'wasapflow_api' ? 'Wasapflow API' : 'Manual WhatsApp'}</div>}
                        {row.auto_attempts ? <div className="cell-sub" style={{ marginTop: 5 }}>Attempt: {row.auto_attempts}</div> : null}
                        {row.last_error && <div style={{ marginTop: 5, color: '#b42318', fontSize: 12, maxWidth: 230 }}>{row.last_error}</div>}
                        {row.sent_at && !cancelled && <div className="cell-sub" style={{ marginTop: 5 }}>{formatDate(row.sent_at)}</div>}
                        {row.manual_cancelled_at && <div style={{ marginTop: 5, color: '#b42318', fontSize: 12 }}>{formatDate(row.manual_cancelled_at)}</div>}
                      </td>
                      <td className="cell-sub">{formatDate(row.created_at)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', minWidth: 230 }}>
                          {!row.order_id && row.match_suggestion?.orderNo && (
                            <button className={row.match_suggestion.autoLinkable ? 'btn btn-primary' : 'btn btn-outline'} disabled={busy} onClick={() => void linkShipmentOrder(row, row.match_suggestion?.orderNo || undefined)}>
                              Link {row.match_suggestion.orderNo}
                            </button>
                          )}
                          {!row.order_id && (
                            <button className="btn btn-outline" disabled={busy} onClick={() => void linkShipmentOrder(row)}>Link Order</button>
                          )}
                          {cancelled ? (
                            <button className="btn btn-outline" disabled={busy} onClick={() => void trackingAction(row, 'restore')}><IconRefresh size={14} /> Restore</button>
                          ) : (
                            <>
                              {queued ? (
                                <button className="btn btn-outline" disabled><IconRefresh size={14} /> Auto Queued</button>
                              ) : row.send_status === 'sent' ? (
                                <button className="btn btn-outline" disabled={busy} onClick={() => void trackingAction(row, 'reopen')}>Reopen</button>
                              ) : (
                                <>
                                  <button className={`btn ${canSend ? 'btn-primary' : 'btn-outline'}`} disabled={!canSend || busy} title={!canSend ? unavailableLabel(row) : 'Open WhatsApp with tracking message'} onClick={() => openManualWhatsApp(row)}>
                                    <IconMessage size={14} /> {canSend ? 'Send Tracking' : unavailableLabel(row)}
                                  </button>
                                  {(row.send_status === 'ready' || row.send_status === 'opened') && canSend && (
                                    <button className="btn btn-outline" disabled={busy} onClick={() => void trackingAction(row, 'sent')}><IconCheck size={14} /> Mark Sent</button>
                                  )}
                                  {row.send_status === 'failed' && settings.auto_send_enabled && (
                                    <button className="btn btn-outline" disabled={busy} onClick={() => void trackingAction(row, 'retry_auto')}><IconRefresh size={14} /> Retry Auto</button>
                                  )}
                                </>
                              )}
                              <button className="btn btn-outline" disabled={busy} style={{ color: '#b42318', borderColor: '#fecdca' }} onClick={() => void trackingAction(row, 'cancel')}><IconX size={14} /> Cancel</button>
                            </>
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
