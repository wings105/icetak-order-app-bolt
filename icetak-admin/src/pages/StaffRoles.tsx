import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { IconRefresh, IconStaff } from '../components/Icons';

type Admin = {
  id: string;
  username: string;
  display_name: string | null;
  email: string | null;
  role: string | null;
  is_active: boolean;
  last_login_at: string | null;
  whatsapp_phone: string | null;
  whatsapp_otp_enabled: boolean | null;
  created_at: string;
  permissions: string[];
};

type Props = { currentPermissions?: string[] };
const PERMISSIONS = ['view_orders','create_order','quick_arrange','edit_order','approve_production','cancel_order','verify_payments','export_data','manage_whatsapp','manage_admins'];

export default function StaffRoles({ currentPermissions = [] }: Props) {
  const [rows, setRows] = useState<Admin[]>([]);
  const [drafts, setDrafts] = useState<Record<string,string[]>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canManage = currentPermissions.includes('manage_admins');

  const load = async () => {
    setLoading(true); setErr(null);
    const [users, permissions] = await Promise.all([
      supabase.from('admin_users').select('id, username, display_name, email, role, is_active, last_login_at, whatsapp_phone, whatsapp_otp_enabled, created_at').order('created_at', { ascending: false }),
      supabase.from('admin_permissions').select('username, permissions'),
    ]);
    if (users.error) setErr(users.error.message);
    else {
      const map = new Map((permissions.data || []).map((p: any) => [String(p.username), Array.isArray(p.permissions) ? p.permissions : []]));
      const merged = (users.data || []).map((u: any) => ({ ...u, permissions: map.get(String(u.username)) || [] })) as Admin[];
      setRows(merged); setDrafts(Object.fromEntries(merged.map((u) => [u.username, [...u.permissions]])));
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => { if (!notice) return; const t=window.setTimeout(()=>setNotice(null),3000); return()=>window.clearTimeout(t); }, [notice]);

  const toggle = (username:string, permission:string) => setDrafts((old) => {
    const current = old[username] || [];
    const next = current.includes(permission) ? current.filter((p)=>p!==permission) : [...current,permission];
    return { ...old, [username]: next };
  });

  const save = async (username:string) => {
    setBusy(username); setErr(null);
    const { data, error } = await supabase.rpc('icetak_admin_save_permissions', { p_payload: { username, permissions: drafts[username] || [] } });
    setBusy(null);
    if (error) setErr(error.message);
    else { const result=(data||{}) as {permissions?:string[]}; setDrafts((old)=>({...old,[username]:result.permissions||old[username]||[]})); setNotice(`${username}: permissions saved.`); await load(); }
  };

  return <div className="fade-in">
    <div className="page-header"><div><h1 className="page-title">Staff & Roles</h1><p className="page-subtitle">Admin accounts and V2 permissions</p></div><button className="btn btn-outline" onClick={()=>void load()}><IconRefresh size={16}/> Refresh</button></div>
    {notice&&<div style={{marginBottom:12,padding:10,borderRadius:10,background:'#ecfdf3',color:'#067647',fontWeight:700}}>{notice}</div>}
    {err&&<div style={{marginBottom:12,padding:10,borderRadius:10,background:'#fef3f2',color:'#b42318'}}>{err}</div>}
    <div className="panel"><div className="panel-header"><div><div className="panel-title">Admin users ({rows.length})</div><div className="panel-subtitle">Permissions ini digunakan oleh Orders, Quick Order, Payments dan WhatsApp V2.</div></div></div>
      {loading?<div className="loading"><span className="spinner"/></div>:rows.length===0?<div className="empty"><div className="empty-icon"><IconStaff size={22}/></div><div>No admin users found</div></div>:<div style={{display:'grid',gap:12,padding:16}}>{rows.map((u)=><section key={u.id} style={{border:'1px solid var(--border-light)',borderRadius:14,padding:16}}><div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><div><div className="cell-name">{u.display_name||u.username}</div><div className="cell-sub">@{u.username} · {u.email||'no email'} · {u.role||'admin'}</div><div className="cell-sub">{u.whatsapp_phone||'no WhatsApp'} · last login {u.last_login_at?new Date(u.last_login_at).toLocaleString():'never'}</div></div><div>{u.is_active?<span className="badge badge-success">Active</span>:<span className="badge badge-neutral">Disabled</span>}</div></div><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:8,marginTop:14}}>{PERMISSIONS.map((p)=><label key={p} style={{display:'flex',gap:8,alignItems:'center',padding:'8px 10px',border:'1px solid var(--border-light)',borderRadius:9}}><input type="checkbox" disabled={!canManage || (['manage_admins','manage_whatsapp'].includes(p)&&u.permissions.includes(p))} checked={(drafts[u.username]||[]).includes(p)} onChange={()=>toggle(u.username,p)}/><span>{p}</span></label>)}</div>{canManage&&<div style={{marginTop:12}}><button className="btn btn-primary" disabled={busy===u.username} onClick={()=>void save(u.username)}>{busy===u.username?'Saving...':'Save Permissions'}</button></div>}</section>)}</div>}
    </div>
  </div>;
}
