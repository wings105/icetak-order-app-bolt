import { useState } from 'react';

export default function Settings() {
  const [tab, setTab] = useState('general');
  const [notif, setNotif] = useState({ email: true, sms: false, push: true });

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Manage your account and store preferences</p>
        </div>
      </div>

      <div className="panel" style={{ maxWidth: 720 }}>
        <div className="panel-header">
          <div className="filter-tabs">
            {[
              { k: 'general', l: 'General' },
              { k: 'notifications', l: 'Notifications' },
              { k: 'security', l: 'Security' },
            ].map((t) => (
              <button key={t.k} className={`filter-tab ${tab === t.k ? 'active' : ''}`} onClick={() => setTab(t.k)}>{t.l}</button>
            ))}
          </div>
        </div>

        <div style={{ padding: 24 }}>
          {tab === 'general' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <Field label="Store Name" value="iCetak Printing Sdn Bhd" />
              <Field label="Email Address" value="admin@icetak.my" />
              <Field label="Phone Number" value="+60 12-345 6789" />
              <Field label="Store Address" value="12 Jalan Bukit Bintang, 55100 Kuala Lumpur" />
              <div>
                <button className="btn btn-primary">Save Changes</button>
              </div>
            </div>
          )}

          {tab === 'notifications' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <Toggle label="Email Notifications" desc="Receive order updates via email" checked={notif.email} onChange={(v) => setNotif({ ...notif, email: v })} />
              <Toggle label="SMS Notifications" desc="Get text alerts for urgent orders" checked={notif.sms} onChange={(v) => setNotif({ ...notif, sms: v })} />
              <Toggle label="Push Notifications" desc="Browser push for new orders" checked={notif.push} onChange={(v) => setNotif({ ...notif, push: v })} />
              <div><button className="btn btn-primary">Save Preferences</button></div>
            </div>
          )}

          {tab === 'security' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <Field label="Current Password" type="password" value="" />
              <Field label="New Password" type="password" value="" />
              <Field label="Confirm Password" type="password" value="" />
              <div><button className="btn btn-primary">Update Password</button></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, type = 'text' }: { label: string; value: string; type?: string }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>{label}</label>
      <input
        type={type}
        defaultValue={value}
        style={{ width: '100%', height: 42, padding: '0 14px', border: '1px solid var(--border)', borderRadius: 8, outline: 'none', background: 'var(--content-bg)' }}
      />
    </div>
  );
}

function Toggle({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{label}</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>{desc}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        style={{
          width: 44, height: 24, borderRadius: 12, background: checked ? 'var(--primary)' : '#d1d5db',
          position: 'relative', transition: 'background 0.2s',
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: checked ? 22 : 2, width: 20, height: 20,
          borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: 'var(--shadow-sm)',
        }} />
      </button>
    </div>
  );
}
