import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { IconRefresh, IconStaff, IconMore } from '../components/Icons';

type Admin = {
  id: string;
  username: string | null;
  display_name: string | null;
  email: string | null;
  role: string | null;
  is_active: boolean;
  last_login_at: string | null;
  whatsapp_phone: string | null;
  whatsapp_otp_enabled: boolean | null;
  created_at: string;
};

export default function StaffRoles() {
  const [rows, setRows] = useState<Admin[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from('admin_users')
      .select('id, username, display_name, email, role, is_active, last_login_at, whatsapp_phone, whatsapp_otp_enabled, created_at')
      .order('created_at', { ascending: false });
    if (error) setErr(error.message);
    else setRows(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Staff & Roles</h1>
          <p className="page-subtitle">Admin accounts and permissions</p>
        </div>
        <button className="btn btn-outline" onClick={load}><IconRefresh size={16} /> Refresh</button>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div className="panel-title">Admin users ({rows.length})</div>
        </div>
        <div className="table-wrap">
          {loading ? (
            <div className="loading"><span className="spinner" /></div>
          ) : err ? (
            <div className="empty"><div className="empty-title">Failed to load</div><div>{err}</div></div>
          ) : rows.length === 0 ? (
            <div className="empty">
              <div className="empty-icon"><IconStaff size={22} /></div>
              <div>No admin users found</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>WhatsApp</th>
                  <th>OTP</th>
                  <th>Status</th>
                  <th>Last login</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} className="row-hover">
                    <td>
                      <div className="cell-customer">
                        <div className="cell-avatar">{(u.display_name || u.username || 'U').slice(0, 2).toUpperCase()}</div>
                        <div>
                          <div className="cell-name">{u.display_name || u.username || '—'}</div>
                          <div className="cell-sub">@{u.username || u.id.slice(0, 8)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="cell-sub">{u.email || '—'}</td>
                    <td><span className="tag tag-ready" style={{ textTransform: 'capitalize' }}>{u.role || 'admin'}</span></td>
                    <td className="cell-sub">{u.whatsapp_phone || '—'}</td>
                    <td>{u.whatsapp_otp_enabled ? <span className="tag tag-ready">On</span> : <span className="tag tag-neutral">Off</span>}</td>
                    <td>{u.is_active ? <span className="badge badge-success">Active</span> : <span className="badge badge-neutral">Disabled</span>}</td>
                    <td className="cell-sub">{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'Never'}</td>
                    <td><button className="icon-btn"><IconMore size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
