import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { IconRefresh, IconIntegration } from '../components/Icons';

type Row = {
  id: string;
  provider: string;
  key: string;
  value: unknown;
  is_secret: boolean;
  updated_at: string;
  url: string | null;
  text_value: string | null;
};

const maskValue = (v: unknown, secret: boolean, text: string | null): string => {
  if (secret) return '••••••••';
  if (text) return text;
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
};

export default function Integrations() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase
      .from('integration_settings')
      .select('id, provider, key, value, is_secret, updated_at, url, text_value')
      .order('provider', { ascending: true })
      .order('key', { ascending: true });
    if (error) setErr(error.message);
    else setRows(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const grouped = rows.reduce<Record<string, Row[]>>((acc, r) => {
    (acc[r.provider] ||= []).push(r);
    return acc;
  }, {});

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Integrations</h1>
          <p className="page-subtitle">Third-party providers & credentials</p>
        </div>
        <button className="btn btn-outline" onClick={load}><IconRefresh size={16} /> Refresh</button>
      </div>

      {loading ? (
        <div className="panel"><div className="loading"><span className="spinner" /></div></div>
      ) : err ? (
        <div className="panel"><div className="empty"><div className="empty-title">Failed to load</div><div>{err}</div></div></div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="panel">
          <div className="empty">
            <div className="empty-icon"><IconIntegration size={22} /></div>
            <div className="empty-title">No integrations configured</div>
          </div>
        </div>
      ) : (
        Object.entries(grouped).map(([provider, items]) => (
          <div className="panel" key={provider}>
            <div className="panel-header">
              <div>
                <div className="panel-title" style={{ textTransform: 'capitalize' }}>{provider}</div>
                <div className="panel-subtitle">{items.length} setting{items.length === 1 ? '' : 's'}</div>
              </div>
              <span className="tag tag-ready">Configured</span>
            </div>
            <div style={{ padding: 20 }}>
              <div className="kv-list">
                {items.map((it) => (
                  <div className="kv-row" key={it.id}>
                    <div>
                      <span className="k">{it.key}</span>
                      {it.is_secret && <span className="tag tag-neutral" style={{ marginLeft: 8 }}>secret</span>}
                      {it.url && (
                        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>{it.url}</div>
                      )}
                    </div>
                    <span className="v">{maskValue(it.value, it.is_secret, it.text_value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
