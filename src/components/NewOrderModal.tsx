import { useEffect, useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { fetchCustomers, createOrder, type NewOrderItem, type CustomerWithCount } from '../lib/queries';

type Props = { onClose: () => void; onCreated: () => void };

const EMPTY_ITEM: NewOrderItem = { product_type: '', title: '', wording: '', qty: 1, price: 0 };

export default function NewOrderModal({ onClose, onCreated }: Props) {
  const [customers,   setCustomers]   = useState<CustomerWithCount[]>([]);
  const [customerId,  setCustomerId]  = useState('');
  const [orderNo,     setOrderNo]     = useState('');
  const [delivery,    setDelivery]    = useState('pickup');
  const [items,       setItems]       = useState<NewOrderItem[]>([{ ...EMPTY_ITEM }]);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  useEffect(() => {
    fetchCustomers().then(setCustomers).catch(() => {});
    const yr = new Date().getFullYear();
    const ts = Date.now().toString().slice(-4);
    setOrderNo(`ICT-${yr}-${ts}`);
  }, []);

  function updateItem(idx: number, field: keyof NewOrderItem, value: string | number) {
    setItems((prev) => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  }
  function addItem()           { setItems((p) => [...p, { ...EMPTY_ITEM }]); }
  function removeItem(i: number) { setItems((p) => p.filter((_, idx) => idx !== i)); }

  const total = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customerId)                              { setError('Please select a customer'); return; }
    if (!orderNo.trim())                          { setError('Order number is required'); return; }
    if (items.some((i) => !i.product_type.trim())) { setError('All items need a product type'); return; }
    setSaving(true); setError(null);
    try {
      await createOrder({ customerId, orderNo: orderNo.trim(), deliveryMethod: delivery, items });
      onCreated();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create order');
    } finally { setSaving(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>New order</h2>
          <button className="icon-btn" onClick={onClose}><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <div className="form-row">
            <label>
              Customer <span className="req">*</span>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
                <option value="">Select customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label>
              Order No <span className="req">*</span>
              <input value={orderNo} onChange={(e) => setOrderNo(e.target.value)} required />
            </label>
          </div>

          <label>
            Delivery method
            <select value={delivery} onChange={(e) => setDelivery(e.target.value)}>
              <option value="pickup">Pickup</option>
              <option value="courier">Courier</option>
              <option value="hand_delivery">Hand delivery</option>
            </select>
          </label>

          <div className="items-section">
            <div className="items-section-head">
              <strong>Items</strong>
              <button type="button" className="btn-ghost small" onClick={addItem}>
                <Plus size={14} /> Add item
              </button>
            </div>
            {items.map((item, idx) => (
              <div key={idx} className="item-row">
                <input
                  placeholder="Product type *"
                  value={item.product_type}
                  onChange={(e) => updateItem(idx, 'product_type', e.target.value)}
                  required
                />
                <input
                  placeholder="Title / description"
                  value={item.title}
                  onChange={(e) => updateItem(idx, 'title', e.target.value)}
                />
                <input
                  placeholder="Custom wording"
                  value={item.wording}
                  onChange={(e) => updateItem(idx, 'wording', e.target.value)}
                />
                <input
                  type="number" min={1} placeholder="Qty"
                  value={item.qty}
                  onChange={(e) => updateItem(idx, 'qty', Number(e.target.value))}
                  className="input-sm"
                />
                <input
                  type="number" min={0} step="0.01" placeholder="Price (RM)"
                  value={item.price}
                  onChange={(e) => updateItem(idx, 'price', Number(e.target.value))}
                  className="input-sm"
                />
                {items.length > 1 && (
                  <button type="button" className="icon-btn danger" onClick={() => removeItem(idx)}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            ))}
            <div className="items-total">Total: <strong>RM {total.toFixed(2)}</strong></div>
          </div>

          {error && <p className="form-error">{error}</p>}

          <div className="modal-footer">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Creating…' : 'Create order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
