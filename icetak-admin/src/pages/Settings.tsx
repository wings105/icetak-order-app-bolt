import { useState } from 'react';
import { IconRefresh } from '../components/Icons';

export default function Settings() {
  const [tab, setTab] = useState('general');
  const [notif, setNotif] = useState({ email: true, sms: false, whatsapp: true });

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Manage your workspace preferences</p>
        </div>
        <button className="btn btn-outline"><IconRefresh size={16} /> Reset</button>
      </div>

      <div className="panel" style={{ maxWidth: 800 }}>
        <div className="panel-header">
          <div className="filter-tabs">
            {[
              { k: 'general', l: 'General' },
              { k: 'notifications', l: 'Notifications' },
              { k: 'security', l: 'Security' },
            ].map((t) => (
              <button key={t.k} className={`filter-tab ${tab === t.k ? 'active' : ''}`} onClick={() => setTab(t.k)}>
                {t.l}
              </button>
            ))}
          </div>
        </div>

        <div style={{ padding: 24 }}>
          {tab === 'general' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div className="form-field">
                <label>Store Name</label>
                <input defaultValue="iCetak Printing Sdn Bhd" />
              </div>
              <div className="form-field">
                <label>Store Email</label>
                <input defaultValue="admin@icetak.my" />
              </div>
              <div className="form-field">
                <label>Phone Number</label>
                <input defaultValue="+60 12-345 6789" />
              </div>
              <div className="form-field">
                <label>Business Address</label>
                <textarea defaultValue="12 Jalan Bukit Bintang, 55100 Kuala Lumpur" />
              </div>
              <div><button className="btn btn-primary">Save Changes</button></div>
            </div>
          )}

          {tab === 'notifications' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <Toggle label="Email Notifications" desc="Receive order updates via email" checked={notif.email} onChange={(v) => setNotif({ ...notif, email: v })} />
              <Toggle label="SMS Alerts" desc="Get text alerts for urgent orders" checked={notif.sms} onChange={(v) => setNotif({ ...notif, sms: v })} />
              <Toggle label="WhatsApp Broadcasts" desc="Send customer updates via WhatsApp" checked={notif.whatsapp} onChange={(v) => setNotif({ ...notif, whatsapp: v })} />
              <div><button className="btn btn-primary">Save Preferences</button></div>
            </div>
          )}

          {tab === 'security' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div className="form-field">
                <label>Current Password</label>
                <input type="password" />
              </div>
              <div className="form-field">
                <label>New Password</label>
                <input type="password" />
              </div>
              <div className="form-field">
                <label>Confirm Password</label>
                <input type="password" />
              </div>
              <div><button className="btn btn-primary">Update Password</button></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#fafbfc', borderRadius: 12, border: '1px solid var(--border-light)' }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{label}</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2 }}>{desc}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        style={{ width: 44, height: 24, borderRadius: 12, background: checked ? 'var(--primary)' : '#d1d5db', position: 'relative', transition: 'background 0.2s' }}
      >
        <span style={{ position: 'absolute', top: 2, left: checked ? 22 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: 'var(--shadow-sm)' }} />
      </button>
    </div>
  );
}
