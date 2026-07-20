import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { IconRefresh, IconMore, IconWhatsApp } from '../components/Icons';

type Template = {
  id: string;
  name: string;
  language: string | null;
  category: string | null;
  status: string | null;
  synced_at: string | null;
};

const statusTag = (s: string | null) => {
  const v = (s || '').toLowerCase();
  if (v === 'approved') return { label: 'Approved', cls: 'badge-success' };
  if (v === 'pending' || v === 'in_review') return { label: 'Pending', cls: 'badge-warning' };
  if (v === 'rejected' || v === 'disabled') return { label: v, cls: 'badge-error' };
  return { label: v || '—', cls: 'badge-neutral' };
};

export default function WhatsAppTemplates() {
  const [rows, setRows] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from('whatsapp_templates')
      .select('id, name, language, category, status, synced_at')
      .order('name', { ascending: true });
    if (error) setErr(error.message);
    else setRows(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">WhatsApp Templates</h1>
          <p className="page-subtitle">Approved message templates synced from provider</p>
        </div>
        <button className="btn btn-outline" onClick={load}><IconRefresh size={16} /> Refresh</button>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Templates ({rows.length})</div>
            <div className="panel-subtitle">Read-only view of provider template library</div>
          </div>
        </div>
        <div className="table-wrap">
          {loading ? (
            <div className="loading"><span className="spinner" /></div>
          ) : err ? (
            <div className="empty"><div className="empty-title">Failed to load</div><div>{err}</div></div>
          ) : rows.length === 0 ? (
            <div className="empty">
              <div className="empty-icon"><IconWhatsApp size={22} /></div>
              <div className="empty-title">No templates synced</div>
              <div>Trigger a sync from your WhatsApp provider.</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Language</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Last synced</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const st = statusTag(t.status);
                  return (
                    <tr key={t.id} className="row-hover">
                      <td className="cell-name">{t.name}</td>
                      <td className="cell-sub">{t.language || '—'}</td>
                      <td>{t.category || '—'}</td>
                      <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                      <td className="cell-sub">{t.synced_at ? new Date(t.synced_at).toLocaleString() : '—'}</td>
                      <td><button className="icon-btn"><IconMore size={16} /></button></td>
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
