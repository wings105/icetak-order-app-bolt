import { useEffect, useMemo, useState } from 'react';
import { Database, RefreshCcw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { supabase } from './lib/supabase';

type RpcRow = {
  table_name: string;
  row_count: number;
  ok: boolean;
  error: string | null;
};

type TableCheck = {
  table: string;
  ok: boolean;
  count: number | null;
  error?: string;
};

async function loadTableCounts(): Promise<TableCheck[]> {
  const { data, error } = await supabase.rpc('icetak_table_counts');
  if (error) return [{ table: 'icetak_table_counts()', ok: false, count: null, error: error.message }];
  return ((data || []) as RpcRow[]).map((row) => ({
    table: row.table_name,
    ok: row.ok,
    count: Number(row.row_count || 0),
    error: row.error || undefined,
  }));
}

function App() {
  const [checks, setChecks] = useState<TableCheck[]>([]);
  const [loading, setLoading] = useState(false);

  const totals = useMemo(() => {
    const ok = checks.filter((item) => item.ok).length;
    const failed = checks.length - ok;
    const rows = checks.reduce((sum, item) => sum + (item.count ?? 0), 0);
    return { ok, failed, rows };
  }, [checks]);

  async function runChecks() {
    setLoading(true);
    try {
      setChecks(await loadTableCounts());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    runChecks();
  }, []);

  return (
    <main className="page">
      <section className="hero">
        <div className="badge"><ShieldCheck size={16} /> Supabase connected starter</div>
        <h1>iCetak Order App</h1>
        <p>Clean Bolt-ready frontend connected to Supabase. Use this repo as the new GitHub/Bolt base.</p>
        <button onClick={runChecks} disabled={loading}>
          <RefreshCcw size={18} className={loading ? 'spin' : ''} />
          {loading ? 'Checking...' : 'Test Supabase tables'}
        </button>
      </section>

      <section className="summary-grid">
        <div className="card"><span>Readable tables</span><strong>{totals.ok}/{checks.length || 8}</strong></div>
        <div className="card"><span>Total visible rows</span><strong>{totals.rows}</strong></div>
        <div className="card"><span>Errors</span><strong>{totals.failed}</strong></div>
      </section>

      <section className="panel">
        <div className="panel-title"><Database size={20} /><h2>Database readiness</h2></div>
        <div className="table-list">
          {checks.map((item) => (
            <div className="table-row" key={item.table}>
              <div><strong>{item.table}</strong><small>{item.ok ? 'OK' : item.error}</small></div>
              <span className={item.ok ? 'pill ok' : 'pill fail'}>{item.ok ? `${item.count ?? 0} rows` : <><TriangleAlert size={14} /> fail</>}</span>
            </div>
          ))}
          {!checks.length && <p className="muted">No checks yet.</p>}
        </div>
      </section>
    </main>
  );
}

export default App;
