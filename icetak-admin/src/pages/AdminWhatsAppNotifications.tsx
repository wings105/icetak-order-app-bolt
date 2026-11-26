import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

type Repeat = 'once' | 'daily' | 'weekly';
type Notification = {
  event_type: string;
  label: string;
  cadence: string;
  enabled: boolean;
  source_enabled: boolean | null;
  message: string | null;
  repeat_mode: Repeat | null;
  next_at: string | null;
};
type Delivery = {
  event_type: string;
  created_at: string;
  phone: string | null;
  status: string;
  detail: string | null;
  provider_message_id: string | null;
};
type Snapshot = { phone: string | null; notifications: Notification[]; logs: Delivery[] };
type Reminder = { event_type?: string; label: string; message: string; repeat_mode: Repeat; date: string; time: string; enabled: boolean };

const blankReminder: Reminder = { label: '', message: '', repeat_mode: 'once', date: '', time: '', enabled: true };
const repeatLabels = { once: 'Sekali', daily: 'Harian', weekly: 'Mingguan' };
const localDate = new Intl.DateTimeFormat('ms-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' });
const editDate = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' });
const statusLabels: Record<string, string> = {
  accepted: 'Diterima WasapFlow', sent: 'Dihantar', delivered: 'Sampai', read: 'Dibaca', failed: 'Gagal',
  paused: 'Dijeda', window_closed: 'Window ditutup', uncertain: 'Belum pasti', sending: 'Sedang dihantar',
};
const detailLabels: Record<string, string> = {
  whatsapp_master_off: 'Suis utama WhatsApp dimatikan',
  admin_notification_off: 'Notifikasi dimatikan',
  admin_whatsapp_window_closed: 'Nombor admin perlu membalas chat untuk buka window 24 jam',
  admin_whatsapp_uncertain: 'WasapFlow belum mengesahkan penerimaan',
  admin_phone_changed: 'Nombor admin berubah sebelum penghantaran',
  admin_phone_invalid: 'Nombor admin belum dikonfigurasi',
  admin_schedule_changed: 'Jadual berubah selepas mesej masuk queue',
  schedule_missed: 'Waktu reminder sudah lepas',
};

export default function AdminWhatsAppNotifications() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [phone, setPhone] = useState('');
  const [test, setTest] = useState('');
  const [reminder, setReminder] = useState<Reminder | null>(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function run(action: string, payload: Record<string, unknown> = {}, confirmation = '') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await supabase.rpc('icetak_admin_whatsapp_notification_control', { p_action: action, p_data: payload });
      if (response.error) throw new Error(response.error.message);
      const snapshot = response.data as Snapshot;
      setData(snapshot);
      if (action === 'read' || action === 'phone') setPhone(snapshot.phone || '');
      if (action === 'save') setReminder(null);
      if (action === 'test') setTest('');
      setNotice(confirmation);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void run('read'); }, []);

  function edit(row: Notification) {
    const [date = '', time = ''] = row.next_at ? editDate.format(new Date(row.next_at)).split(' ') : [];
    setReminder({
      event_type: row.event_type,
      label: row.label,
      message: row.message || '',
      repeat_mode: row.repeat_mode || 'once',
      date, time, enabled: row.enabled,
    });
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reminder) return;
    void run('save', {
      event_type: reminder.event_type,
      label: reminder.label,
      message: reminder.message,
      repeat_mode: reminder.repeat_mode,
      next_at: `${reminder.date}T${reminder.time}:00+08:00`,
      enabled: reminder.enabled,
    }, 'Jadual disimpan.');
  }

  const rows = data?.notifications || [];
  const labels = new Map(rows.map(row => [row.event_type, row.label]));
  const logs = (data?.logs || []).filter(row => !filter || row.event_type === filter);
  const inputGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,180px),1fr))', gap: 12 };
  const actions = { display: 'flex', flexWrap: 'wrap' as const, gap: 8, alignItems: 'center' };

  return <div style={{ display: 'grid', gap: 14 }}>
    {error && <div className="panel" style={{ padding: 14, color: '#b42318' }} role="alert">{error}</div>}
    {notice && <div className="panel" style={{ padding: 14, color: '#067647' }} role="status">{notice}</div>}
    {!data && <div className="panel" style={{ padding: 16 }}>
      {busy ? 'Memuatkan notifikasi admin…' : <button className="btn btn-outline" onClick={() => void run('read')}>Cuba lagi</button>}
    </div>}
    {data && <>
      <div className="panel">
        <div className="panel-header"><div>
          <div className="panel-title">Nombor WhatsApp admin</div>
          <div className="panel-subtitle">Semua mesej admin guna free-form. Balas chat iCetak daripada nombor ini untuk buka window 24 jam.</div>
        </div></div>
        <div style={{ ...inputGrid, padding: 16 }}>
          <form onSubmit={event => { event.preventDefault(); void run('phone', { phone }, 'Nombor admin disimpan.'); }}>
            <label className="form-field"><span>Nombor default</span><input type="tel" value={phone} onChange={event => setPhone(event.target.value)} required /></label>
            <button className="btn btn-primary" style={{ marginTop: 8 }} disabled={busy || phone === data.phone}>Simpan nombor</button>
          </form>
          <form onSubmit={event => { event.preventDefault(); void run('test', { message: test }, 'Ujian masuk queue. Semak log untuk keputusan.'); }}>
            <label className="form-field"><span>Mesej ujian ke nombor disimpan</span><input value={test} onChange={event => setTest(event.target.value)} maxLength={4000} required /></label>
            <button className="btn btn-outline" style={{ marginTop: 8 }} disabled={busy || !data.phone || !test.trim()}>Hantar ujian</button>
          </form>
        </div>
      </div>
      <div className="panel">
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div><div className="panel-title">Notifikasi dan reminder admin</div><div className="panel-subtitle">Waktu Malaysia</div></div>
          <button className="btn btn-primary" onClick={() => setReminder({ ...blankReminder })}>Tambah reminder</button>
        </div>
        {reminder && <form onSubmit={save} style={{ display: 'grid', gap: 12, padding: 16 }}>
          <div style={inputGrid}>
            <label className="form-field"><span>Nama reminder</span><input value={reminder.label} onChange={event => setReminder({ ...reminder, label: event.target.value })} maxLength={100} required /></label>
            <label className="form-field"><span>Ulangan</span><select value={reminder.repeat_mode} onChange={event => setReminder({ ...reminder, repeat_mode: event.target.value as Repeat })}>
              {Object.entries(repeatLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label className="form-field"><span>Tarikh mula</span><input type="date" value={reminder.date} onChange={event => setReminder({ ...reminder, date: event.target.value })} required /></label>
            <label className="form-field"><span>Waktu mula</span><input type="time" value={reminder.time} onChange={event => setReminder({ ...reminder, time: event.target.value })} required /></label>
          </div>
          <label className="form-field"><span>Mesej free-form</span><textarea rows={4} value={reminder.message} onChange={event => setReminder({ ...reminder, message: event.target.value })} maxLength={4000} required /></label>
          <div style={actions}>
            <label><input type="checkbox" checked={reminder.enabled} onChange={event => setReminder({ ...reminder, enabled: event.target.checked })} /> Aktifkan</label>
            <button className="btn btn-primary" disabled={busy || !data.phone}>Simpan jadual</button>
            <button className="btn btn-outline" type="button" onClick={() => setReminder(null)}>Batal</button>
          </div>
        </form>}
        <div className="table-wrap"><table>
          <thead><tr><th>Notifikasi</th><th>Jadual / pencetus</th><th>Kawalan</th></tr></thead>
          <tbody>{rows.map(row => {
            const completed = row.repeat_mode === 'once' && !row.next_at;
            return <tr key={row.event_type}>
              <td>{row.label}{row.message && <div className="cell-sub" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.message}</div>}</td>
              <td>{row.repeat_mode ? repeatLabels[row.repeat_mode] : row.cadence}
                {row.next_at && <div className="cell-sub">{localDate.format(new Date(row.next_at))}</div>}
                {completed && <div className="cell-sub">Waktu jadual sudah lepas</div>}
              </td>
              <td><div style={actions}>
                <button className={`btn ${row.enabled ? 'btn-primary' : 'btn-outline'}`} type="button" aria-pressed={row.enabled}
                  aria-label={`${row.label} ${row.enabled ? 'ON' : 'OFF'}`} disabled={busy || (completed && !row.enabled)}
                  onClick={() => void run('toggle', { event_type: row.event_type, enabled: !row.enabled }, row.enabled ? 'Notifikasi dimatikan.' : 'Notifikasi diaktifkan.')}>{row.enabled ? 'ON' : 'OFF'}</button>
                {row.repeat_mode && <button className="btn btn-outline" onClick={() => edit(row)}>Edit</button>}
              </div>{row.source_enabled === false && <div className="cell-sub">Rule asal dimatikan</div>}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </div>
      <div className="panel">
        <div className="panel-header" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="panel-title">Log penghantaran admin</div>
          <div style={actions}>
            <select aria-label="Tapis log mengikut notifikasi" value={filter} onChange={event => setFilter(event.target.value)}>
              <option value="">Semua notifikasi</option><option value="admin_notification_test">Ujian free-form</option>
              {rows.map(row => <option key={row.event_type} value={row.event_type}>{row.label}</option>)}
            </select>
            <button className="btn btn-outline" disabled={busy} onClick={() => void run('read')}>Muat semula log</button>
          </div>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>Waktu Malaysia</th><th>Notifikasi</th><th>Nombor</th><th>Status</th><th>ID WasapFlow</th></tr></thead>
          <tbody>{logs.map((row, index) => <tr key={`${row.created_at}:${row.event_type}:${index}`}>
            <td>{localDate.format(new Date(row.created_at))}</td>
            <td>{labels.get(row.event_type) || 'Ujian free-form'}</td>
            <td>{row.phone || '—'}</td>
            <td><span className={`badge ${['accepted', 'sent', 'delivered', 'read'].includes(row.status) ? 'badge-success' : row.status === 'failed' ? 'badge-error' : 'badge-warning'}`}>{statusLabels[row.status] || row.status}</span>
              {row.detail && <div className="cell-sub">{detailLabels[row.detail] || row.detail}</div>}
            </td>
            <td className="cell-sub" style={{ overflowWrap: 'anywhere', maxWidth: 220 }}>{row.provider_message_id || '—'}</td>
          </tr>)}
            {!logs.length && <tr><td colSpan={5}>Tiada rekod untuk paparan ini.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </>}
  </div>;
}
