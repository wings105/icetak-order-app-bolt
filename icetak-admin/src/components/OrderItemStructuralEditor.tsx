import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  ADMIN_PRODUCTS,
  adminProductPrice,
  adminProductStyles,
  type AdminProductKind,
  type ProductReview,
} from '../lib/orderProducts';
import './OrderItemStructuralEditor.css';

type ProductOption = {
  id: string;
  slug: string;
  label: string;
  basePrice: number;
  kind: AdminProductKind;
  productKind?: string;
  catalogClickupTaskId?: string;
  imageUrl?: string;
  isCatalogDesign?: boolean;
};

type ComponentRef = {
  id: string;
  label?: string;
  workflow?: string;
  customerLabel?: string;
  reviewStatus?: string;
  previewUrl?: string;
  progressPercent?: number;
  clickupTaskId?: string;
  clickupStatus?: string;
};

export type StructuralOrderItem = {
  id: string;
  k?: string;
  title?: string;
  productId?: string | null;
  catalogSlug?: string;
  catalogClickupTaskId?: string;
  process?: string;
  qty?: number;
  price?: number;
  size?: string;
  style?: string;
  reviewRequired?: boolean;
  customText?: string;
  previewUrl?: string;
  workflow?: string;
  components?: ComponentRef[];
};

type DraftItem = StructuralOrderItem & {
  clientId: string;
  productId?: string;
  k: AdminProductKind;
  process: string;
  qty: number;
  price: number;
  size: string;
  style: string;
  reviewRequired: boolean;
  customText: string;
  previewUrl: string;
  isNew?: boolean;
};

type Props = {
  orderDbId: string;
  items: StructuralOrderItem[];
  canEdit: boolean;
  structuralLocked: boolean;
  structuralLockReason?: string;
  onSaved: () => Promise<void>;
};

const money = (value: unknown) => `RM ${Number(value || 0).toFixed(2)}`;
const coreKind = (value: unknown): AdminProductKind => {
  const k = String(value || '').toLowerCase();
  return (['edible','burnaway','wafer','printed','mirror','acrylic'] as AdminProductKind[]).includes(k as AdminProductKind) ? k as AdminProductKind : 'edible';
};
const reviewLabel = (required: boolean): ProductReview => required ? 'Need Review' : 'No Review';

function normalizeItem(item: StructuralOrderItem): DraftItem {
  const kind = coreKind(item.k);
  const config = ADMIN_PRODUCTS[kind];
  const size = item.size || config.defaultSize;
  const styles = adminProductStyles(kind, size);
  const style = item.style && styles.includes(item.style) ? item.style : (item.style || styles[0] || config.defaultStyle);
  return {
    ...item,
    clientId: item.id || crypto.randomUUID(),
    productId: item.productId || '',
    k: kind,
    process: item.process || config.process[0] || 'Pre-order',
    qty: Math.max(1, Number(item.qty || 1)),
    price: Math.max(0, Number(item.price || 0)),
    size,
    style,
    reviewRequired: Boolean(item.reviewRequired),
    customText: item.customText || '',
    previewUrl: item.previewUrl || '',
  };
}

export default function OrderItemStructuralEditor({ orderDbId, items: sourceItems, canEdit, structuralLocked, structuralLockReason, onSaved }: Props) {
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [originals, setOriginals] = useState<Record<string, DraftItem>>({});
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const next = sourceItems.map(normalizeItem);
    setDrafts(next);
    setOriginals(Object.fromEntries(next.filter((x) => !x.isNew).map((x) => [x.id, x])));
    setDeleteIds([]);
  }, [sourceItems]);

  useEffect(() => {
    let live = true;
    void (async () => {
      setLoadingProducts(true);
      const { data, error: rpcError } = await supabase.rpc('icetak_admin_order_product_options');
      if (!live) return;
      setLoadingProducts(false);
      if (rpcError) { setError(rpcError.message); return; }
      setProducts(Array.isArray(data) ? data as ProductOption[] : []);
    })();
    return () => { live = false; };
  }, []);

  const total = useMemo(() => drafts.reduce((sum, item) => sum + item.qty * item.price, 0), [drafts]);
  const update = (clientId: string, patch: Partial<DraftItem>) => setDrafts((old) => old.map((item) => item.clientId === clientId ? { ...item, ...patch } : item));

  const chooseProduct = (draft: DraftItem, productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) return update(draft.clientId, { productId: '' });
    const kind = coreKind(product.kind);
    const cfg = ADMIN_PRODUCTS[kind];
    const process = cfg.process[0] || 'Pre-order';
    const size = cfg.defaultSize;
    const style = adminProductStyles(kind, size)[0] || cfg.defaultStyle;
    const reviewRequired = cfg.defaultReview === 'Need Review';
    const autoPrice = product.isCatalogDesign && Number(product.basePrice || 0) > 0
      ? Number(product.basePrice)
      : adminProductPrice(kind, process, size, style, reviewLabel(reviewRequired));
    update(draft.clientId, { productId: product.id, k: kind, title: product.label, process, size, style, reviewRequired, price: autoPrice });
  };

  const autoPrice = (draft: DraftItem) => {
    const product = products.find((p) => p.id === draft.productId);
    const price = product?.isCatalogDesign && Number(product.basePrice || 0) > 0
      ? Number(product.basePrice)
      : adminProductPrice(draft.k, draft.process, draft.size, draft.style, reviewLabel(draft.reviewRequired));
    update(draft.clientId, { price });
  };

  const addItem = () => {
    if (structuralLocked) return;
    const product = products.find((p) => p.slug === 'edible-image') || products[0];
    const kind = coreKind(product?.kind || 'edible');
    const cfg = ADMIN_PRODUCTS[kind];
    const process = cfg.process[0] || 'Pre-order';
    const size = cfg.defaultSize;
    const style = adminProductStyles(kind, size)[0] || cfg.defaultStyle;
    const reviewRequired = cfg.defaultReview === 'Need Review';
    const price = product?.isCatalogDesign && Number(product.basePrice || 0) > 0 ? Number(product.basePrice) : adminProductPrice(kind, process, size, style, reviewLabel(reviewRequired));
    setDrafts((old) => [...old, {
      id: '', clientId: `new:${crypto.randomUUID()}`, isNew: true, productId: product?.id || '', k: kind, title: product?.label || cfg.label,
      process, qty: 1, price, size, style, reviewRequired, customText: '', previewUrl: '', components: [], workflow: 'Order Received',
    }]);
  };

  const removeItem = (draft: DraftItem) => {
    const linked = (draft.components || []).filter((c) => c.clickupTaskId).length;
    if (linked) { setError(`Item “${draft.title || draft.k}” ada ${linked} task ClickUp. Delete dikunci; guna Change Product supaya task sedia ada direuse.`); return; }
    if (structuralLocked) { setError(structuralLockReason || 'Structural editing dikunci untuk order ini.'); return; }
    if (drafts.length <= 1) { setError('Order mesti mempunyai sekurang-kurangnya satu item.'); return; }
    setDrafts((old) => old.filter((x) => x.clientId !== draft.clientId));
    if (draft.id) setDeleteIds((old) => old.includes(draft.id) ? old : [...old, draft.id]);
  };

  const linkedProductChanges = drafts.filter((draft) => {
    const before = originals[draft.id];
    if (!before || !(draft.components || []).some((c) => c.clickupTaskId)) return false;
    return before.productId !== draft.productId || before.k !== draft.k || before.reviewRequired !== draft.reviewRequired || before.title !== draft.title;
  });

  const save = async () => {
    if (!canEdit || !drafts.length) return;
    if (structuralLocked) { setError(structuralLockReason || 'Editing dikunci untuk order ini.'); return; }
    setError(null); setNotice(null);
    if (linkedProductChanges.length && !window.confirm(`${linkedProductChanges.length} item mempunyai task ClickUp sedia ada. Sistem akan reuse task/component ID itu dan update product dalam iCetak. Teruskan?`)) return;
    if (structuralLocked) {
      const structuralRequested = deleteIds.length > 0 || drafts.some((d) => d.isNew || (originals[d.id] && (originals[d.id].productId !== d.productId || originals[d.id].k !== d.k || originals[d.id].reviewRequired !== d.reviewRequired)));
      if (structuralRequested) { setError(structuralLockReason || 'Structural editing dikunci untuk order ini.'); return; }
    }
    setSaving(true);
    const { data, error: rpcError } = await supabase.rpc('icetak_admin_order_items_reconcile', { p_payload: {
      order_db_id: orderDbId,
      delete_ids: deleteIds,
      items: drafts.map((d) => ({
        id: d.isNew ? undefined : d.id,
        product_id: d.productId || undefined,
        k: d.k,
        title: d.title,
        process: d.process,
        qty: d.qty,
        price: d.price,
        size: d.size,
        style: d.style,
        review_required: d.reviewRequired,
        custom_text: d.customText,
        design_preview_url: d.previewUrl,
      })),
    } });
    setSaving(false);
    if (rpcError) { setError(rpcError.message); return; }
    const result = (data || {}) as { added?: number; deleted?: number; linkedComponentsReused?: number; total?: number; clickupOutboxId?: string | null };
    setNotice(`Saved · total ${money(result.total)}${result.added ? ` · ${result.added} item added` : ''}${result.deleted ? ` · ${result.deleted} deleted` : ''}${result.linkedComponentsReused ? ` · ${result.linkedComponentsReused} ClickUp task reused` : ''}${result.clickupOutboxId ? ' · ClickUp sync queued' : ''}`);
    await onSaved();
  };

  return <div className="struct-items">
    <div className="struct-items-head">
      <div><h3>Order Items</h3><p>Change product, add item, adjust variation/price, atau delete item yang belum linked.</p></div>
      {canEdit && <button className="btn btn-outline btn-sm" disabled={structuralLocked || loadingProducts || !products.length} onClick={addItem}>+ Add Item</button>}
    </div>
    {structuralLocked && <div className="struct-lock"><b>Structural edit locked</b><span>{structuralLockReason || 'Courier sudah scan / order sudah Ready Pickup atau completed.'}</span></div>}
    {error && <div className="erp-notice error">{error}</div>}
    {notice && <div className="erp-notice success">✓ {notice}</div>}
    {loadingProducts && <div className="cell-sub">Loading product catalog…</div>}

    {drafts.map((draft, index) => {
      const cfg = ADMIN_PRODUCTS[draft.k];
      const styles = adminProductStyles(draft.k, draft.size);
      const linked = (draft.components || []).filter((c) => c.clickupTaskId).length;
      const legacy = !draft.productId;
      return <section className="struct-item-card" key={draft.clientId}>
        <div className="struct-item-title"><div><b>{index + 1}. {draft.title || cfg.label}</b><div className="struct-tags">{draft.isNew && <span className="erp-status-pill info">NEW</span>}{linked > 0 && <span className="erp-status-pill success">{linked} CLICKUP LINKED</span>}{legacy && !draft.isNew && <span className="erp-status-pill neutral">LEGACY ITEM</span>}</div></div>{canEdit && <button className="btn btn-danger btn-sm" disabled={Boolean(linked) || structuralLocked} title={linked ? 'Linked ClickUp task prevents delete' : ''} onClick={() => removeItem(draft)}>Delete</button>}</div>
        <div className="struct-grid">
          <label><span>Product</span><select disabled={!canEdit || structuralLocked} value={draft.productId || ''} onChange={(e) => chooseProduct(draft, e.target.value)}>{legacy && <option value="">Current: {draft.title || cfg.label}</option>}{!legacy && <option value="" disabled>Select product…</option>}{products.map((p) => <option key={p.id} value={p.id}>{p.isCatalogDesign ? 'Catalog · ' : ''}{p.label}</option>)}</select></label>
          <label><span>Process</span><select disabled={!canEdit || structuralLocked} value={draft.process} onChange={(e) => { update(draft.clientId, { process: e.target.value }); window.setTimeout(() => autoPrice({ ...draft, process: e.target.value }), 0); }}>{cfg.process.map((p) => <option key={p}>{p}</option>)}</select></label>
          <label><span>Size</span><select disabled={!canEdit || structuralLocked} value={draft.size} onChange={(e) => { const size = e.target.value; const nextStyles = adminProductStyles(draft.k, size); const style = nextStyles.includes(draft.style) ? draft.style : nextStyles[0]; const next = { ...draft, size, style }; update(draft.clientId, { size, style }); window.setTimeout(() => autoPrice(next), 0); }}>{cfg.sizes.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label><span>Style</span><select disabled={!canEdit || structuralLocked} value={draft.style} onChange={(e) => { const next = { ...draft, style: e.target.value }; update(draft.clientId, { style: e.target.value }); window.setTimeout(() => autoPrice(next), 0); }}>{styles.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label><span>Review</span><select disabled={!canEdit || structuralLocked} value={draft.reviewRequired ? 'Need Review' : 'No Review'} onChange={(e) => { const reviewRequired = e.target.value === 'Need Review'; const next = { ...draft, reviewRequired }; update(draft.clientId, { reviewRequired }); window.setTimeout(() => autoPrice(next), 0); }}><option>No Review</option><option>Need Review</option></select></label>
          <label><span>Qty</span><input type="number" min="1" disabled={!canEdit || structuralLocked} value={draft.qty} onChange={(e) => update(draft.clientId, { qty: Math.max(1, Number(e.target.value || 1)) })} /></label>
          <label><span>Unit Price</span><div className="struct-price"><input type="number" min="0" step="0.01" disabled={!canEdit || structuralLocked} value={draft.price} onChange={(e) => update(draft.clientId, { price: Math.max(0, Number(e.target.value || 0)) })} /><button type="button" disabled={!canEdit || structuralLocked} onClick={() => autoPrice(draft)}>Auto</button></div></label>
          <label className="wide"><span>Custom Text / Wording</span><input disabled={!canEdit || structuralLocked} value={draft.customText} onChange={(e) => update(draft.clientId, { customText: e.target.value })} /></label>
          {draft.reviewRequired && <label className="wide"><span>Design Preview URL</span><input disabled={!canEdit || structuralLocked} value={draft.previewUrl} onChange={(e) => update(draft.clientId, { previewUrl: e.target.value })} /></label>}
        </div>
        {(draft.components || []).length > 0 && <div className="struct-components">{draft.components!.map((c) => <div key={c.id}><span><b>{c.label || 'Component'}</b> · {c.customerLabel || c.workflow || '—'} · {c.reviewStatus || '—'}</span>{c.clickupTaskId ? <a href={`https://app.clickup.com/t/3747262/${c.clickupTaskId}`} target="_blank" rel="noreferrer">ClickUp {c.clickupTaskId}</a> : <span>Not linked</span>}</div>)}</div>}
      </section>;
    })}

    <div className="struct-footer"><div><span>Items subtotal</span><b>{money(total)}</b><small>Delivery fee is added by the order total backend.</small></div>{canEdit && <button className="btn btn-primary" disabled={saving || !drafts.length || structuralLocked} onClick={() => void save()}>{saving ? 'Saving…' : 'Save Order Items'}</button>}</div>
  </div>;
}
