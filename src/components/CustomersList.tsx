import { useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { fetchCustomers, createCustomer, type CustomerWithCount } from '../lib/queries';
import { fmtDate } from './utils';

export default function CustomersList() {
  const [customers, setCustomers] = useState<CustomerWithCount[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [search,    setSearch]    = useState('');
  const [showForm,  setShowForm]  = useState(false);
  const [newName,   setNewName]   = useState('');
  const [newPhone,  setNewPhone]  = useState('');
  const [saving,    setSaving]    = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try { setCustomers(await fetchCustomers()); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setSaving(true); setSaveError(null);
    try {
      await createCustomer(newName, newPhone);
      setNewName(''); setNewPhone(''); setShowForm(false);
      await load();
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save');
    } finally { setSaving(false); }
  }

  const filtered = customers.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.phone ?? '').includes(search),
  );

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h1>Customers</h1>
          <p className="page-subtitle">{customers.length} customer{customers.length !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          <Plus size={16} /> New customer
        </button>
      </div>

      {showForm && (
        <div className="inline-form panel">
          <h3>New customer</h3>
          <form onSubmit={handleCreate}>
            <div className="form-row">
              <label>
                Name <span className="req">*</span>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Full name" required />
              </label>
              <label>
                Phone
                <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="01x-xxx xxxx" />
              </label>
            </div>
            {saveError && <p className="form-error">{saveError}</p>}
            <div className="form-actions">
              <button type="button" className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Create customer'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="panel">
        <div className="list-controls">
          <div className="search-wrap">
            <Search size={16} className="search-icon" />
            <input
              className="search-input"
              placeholder="Search by name or phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {loading && <div className="table-loading">Loading…</div>}
        {error   && <div className="table-error">{error}</div>}

        {!loading && !error && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Source</th>
                <th>Orders</th>
                <th>Since</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.name}</strong></td>
                  <td className="muted">{c.phone ?? '—'}</td>
                  <td className="muted">{c.source ?? '—'}</td>
                  <td><span className="order-badge">{c.order_count}</span></td>
                  <td className="muted">{fmtDate(c.created_at)}</td>
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={5} className="empty-row">No customers found</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
