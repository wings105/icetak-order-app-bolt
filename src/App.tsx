import { useEffect, useMemo, useState } from 'react';
import { Database, RefreshCcw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { supabase } from './lib/supabase';

type TableCheck = {
  table: string;
  ok: boolean;
  count: number | null;
  error?: string;
};

const TABLES = [
  'appdeploy_mirror',
  'appdeploy_migration_runs',
  'customers',
  'orders',
  'order_items',
  'production_components',
  'payment_sessions',
  'shipment_events',
];

async function countTable(table: string): Promise<TableCheck> {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true });

  return {
    table,
    ok: !error,
    count: error ? null : count ?? 0,
    error: error?.message,
  };
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
      const results = await Promise.all(TABLES.map(countTable));
      setChecks(results);
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
        <p>
          Clean Bolt-ready frontend connected to Supabase project. Use this as the new GitHub/Bolt base,
          then migrate the old AppDeploy backend data into Supabase.
        </p>
        <button onClick={runChecks} disabled={loading}>
          <RefreshCcw size={18} className={loading ? 'spin' : ''} />
          {loading ? 'Checking...' : 'Test Supabase tables'}
        </button>
      </section>

      <section className="summary-grid">
        <div className="card">
          <span>Readable tables</span>
          <strong>{totals.ok}/{TABLES.length}</strong>
        </div>
        <div className="card">
          <span>Total visible rows</span>
          <strong>{totals.rows}</strong>
        </div>
        <div className="card">
          <span>Errors</span>
          <strong>{totals.failed}</strong>
        </div>
      </section>

      <section className="panel">
        <div className="panel-title">
          <Database size={20} />
          <h2>Database readiness</h2>
        </div>
        <div className="table-list">
          {checks.map((item) => (
            <div className="table-row" key={item.table}>
              <div>
                <strong>{item.table}</strong>
                <small>{item.ok ? 'OK' : item.error}</small>
              </div>
              <span className={item.ok ? 'pill ok' : 'pill fail'}>
                {item.ok ? `${item.count ?? 0} rows` : <><TriangleAlert size={14} /> fail</>}
              </span>
            </div>
          ))}
          {!checks.length && <p className="muted">No checks yet.</p>}
        </div>
      </section>
    </main>
  );
}

export default App;
