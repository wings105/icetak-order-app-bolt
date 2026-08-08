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
  return (['edible', 'burnaway', 'wafer', 'printed', 'mirror', 'acrylic'] as AdminProductKind[]).includes(k as AdminProductKind)
    ? k as AdminProductKind
    : 'edible';
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
  const [linkRefs, setLinkRefs] = useState<Record<string, string>>({});
  const [componentBusy, setComponentBusy] = useState<string | null>(null);

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

  const suggestedPrice = (draft: DraftItem) => {
    const product = products.find((p) => p.id === draft.productId);
    if (product?.isCatalogDesign && Number(product.basePrice || 0) > 0) return Number(product.basePrice);
    return adminProductPrice(draft.k, draft.process, draft.size, draft.style, reviewLabel(draft.reviewRequired));
  };

  const patchVariation = (draft: DraftItem, patch: Partial<DraftItem>) => {
    const next = { ...draft, ...patch } as DraftItem;
    update(draft.clientId, draft.isNew ? { ...patch, price: suggestedPrice(next) } : patch);
  };

  const chooseProduct = (draft: DraftItem, productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) return update(draft.clientId, { productId: '' });
    const kind = coreKind(product.kind);
    const cfg = ADMIN_PRODUCTS[kind];
    const process = cfg.process[0] || 'Pre-order';
    const size = cfg.defaultSize;
    const style = adminProductStyles(kind, size)[0] || cfg.defaultStyle;
    const reviewRequired = cfg.defaultReview === 'Need Review';
    const next = { ...draft, productId: product.id, k: kind, title: product.label, process, size, style, reviewRequired } as DraftItem;
    const patch: Partial<DraftItem> = { productId: product.id, k: kind, title: product.label, process, size, style, reviewRequired };
    if (draft.isNew) patch.price = suggestedPrice(next);
    update(draft.clientId, patch);
  };

  const applySuggestedPrice = (draft: DraftItem) => update(draft.clientId, { price: suggestedPrice(draft) });

  const addItem = () => {
    if (structuralLocked) return;
    const product = products.find((p) => p.slug === 'edible-image') || products[0];
    const kind = coreKind(product?.kind || 'edible');
    const cfg = ADMIN_PRODUCTS[kind];
    const process = cfg.process[0] || 'Pre-order';
    const size = cfg.defaultSize;
    const style = adminProductStyles(kind, size)[0] || cfg.defaultStyle;
    const reviewRequired = cfg.defaultReview === 'Need Review';
    const draft = {
      id: '', clientId: `new:${crypto.randomUUID()}`, isNew: true, productId: product?.id || '', k: kind,
      title: product?.label || cfg.label, process, qty: 1, price: 0, size, style, reviewRequired,
      customText: '', previewUrl: '', components: [], workflow: 'Order Received',
    } as DraftItem;
    draft.price = product?.isCatalogDesign && Number(product.basePrice || 0) > 0
      ? Number(product.basePrice)
      : adminProductPrice(kind, process, size, style, reviewLabel(reviewRequired));
    setDrafts((old) => [...old, draft]);
  };

  const removeItem = (draft: DraftItem) => {
    const linked = (draft.components || []).filter((c) => c.clickupTaskId).length;
    if (linked) { setError(`Item “${draft.title || draft.k}” ada ${linked} task ClickUp. Delete dikunci; guna Change Product supaya task sedia ada direuse.`); return; }
    if (structuralLocked) { setError(structuralLockReason || 'Structural editing dikunci untuk order ini.'); return; }
    if (drafts.length <= 1) { setError('Order mesti mempunyai sekurang-kurangnya satu item.'); return; }
    setDrafts((old) => old.filter((x) => x.clientId !== draft.clientId));
    if (draft.id) setDeleteIds((old) => old.includes(draft.id) ? old : [...old, draft.id]);
  };

  const manualLink = async (component: ComponentRef) => {
    const ref = String(linkRefs[component.id] || '').trim();
    if (!ref) { setError('Masukkan ClickUp task ID atau URL dahulu.'); return; }
    if (!window.confirm('Link task ClickUp sedia ada kepada component ini?')) return;
    setComponentBusy(component.id); setError(null); setNotice(null);
    const { data, error: rpcError } = await supabase.rpc('icetak_admin_link_clickup_component', { p_component_id: component.id, p_task_ref: ref });
    setComponentBusy(null);
    if (rpcError) { setError(rpcError.message); return; }
    const result = (data || {}) as { task_id?: string };
    setNotice(`ClickUp linked${result.task_id ? ` · ${result.task_id}` : ''}`);
    setLinkRefs((old) => ({ ...old, [component.id]: '' }));
    await onSaved();
  };

  const retryAuto = async (component: ComponentRef) => {
    setComponentBusy(component.id); setError(null); setNotice(null);
    const { data, error: rpcError } = await supabase.rpc('icetak_admin_retry_clickup_component', { p_component_id: component.id });
    setComponentBusy(null);
    if (rpcError) { setError(rpcError.message); return; }
    const result = (data || {}) as { queued?: boolean; reason?: string };
    if (result.reason === 'already_linked') setNotice('Component ini sudah linked ke ClickUp.');
    else if (result.reason === 'order_not_production_ready') setNotice('Belum queue: order belum production-ready. Auto create akan berlaku selepas approval/ready stage.');
    else setNotice(result.queued ? 'ClickUp auto-create queued.' : 'Tiada task baharu diperlukan.');
    await onSaved();
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
      <div><h3>Order Items</h3><p>Change product, add item, adjust variation/price, atau repair ClickUp link.</p></div>
      {canEdit && !structuralLocked && <button className="btn btn-outline btn-sm" disabled={loadingProducts || !products.length} onClick={addItem}>+ Add Item</button>}
    </div>
    {structuralLocked && <div className="struct-lock"><b>Read-only · structural edit locked</b><span>{structuralLockReason || 'Courier sudah scan / order sudah Ready Pickup atau completed.'}</span></div>}
    {error && <div className="erp-notice error">{error}</div>}
    {notice && <div className="erp-notice success">✓ {notice}</div>}
    {loadingProducts && <div className="cell-sub">Loading product catalog…</div>}

    {drafts.map((draft, index) => {
      const cfg = ADMIN_PRODUCTS[draft.k];
      const styles = adminProductStyles(draft.k, draft.size);
      const linked = (draft.components || []).filter((c) => c.clickupTaskId).length;
      const legacy = !draft.productId;
      const suggested = suggestedPrice(draft);
      const suggestedDiffers = Math.abs(Number(draft.price || 0) - Number(suggested || 0)) > 0.009;
      return <section className="struct-item-card" key={draft.clientId}>
        <div className="struct-item-title">
          <div className="struct-item-heading">
            {draft.previewUrl && <a className="struct-preview" href={draft.previewUrl} target="_blank" rel="noreferrer" title="Open design image"><img src={draft.previewUrl} alt="Design preview" onError={(e) => { e.currentTarget.style.display = 'none'; }} /></a>}
            <div><b>{index + 1}. {draft.title || cfg.label}</b><div className="struct-tags">{draft.isNew && <span className="erp-status-pill info">NEW</span>}{linked > 0 && <span className="erp-status-pill success">{linked} CLICKUP LINKED</span>}{legacy && !draft.isNew && <span className="erp-status-pill neutral">LEGACY ITEM</span>}</div></div>
          </div>
          {canEdit && !structuralLocked && <button className="btn btn-danger btn-sm" disabled={Boolean(linked)} title={linked ? 'Linked ClickUp task prevents delete' : ''} onClick={() => removeItem(draft)}>Delete</button>}
        </div>
        <div className="struct-grid">
          <label><span>Product</span><select disabled={!canEdit || structuralLocked} value={draft.productId || ''} onChange={(e) => chooseProduct(draft, e.target.value)}>{legacy && <option value="">Current: {draft.title || cfg.label}</option>}{!legacy && <option value="" disabled>Select product…</option>}{products.map((p) => <option key={p.id} value={p.id}>{p.isCatalogDesign ? 'Catalog · ' : ''}{p.label}</option>)}</select></label>
          <label><span>Process</span><select disabled={!canEdit || structuralLocked} value={draft.process} onChange={(e) => patchVariation(draft, { process: e.target.value })}>{cfg.process.map((p) => <option key={p}>{p}</option>)}</select></label>
          <label><span>Size</span><select disabled={!canEdit || structuralLocked} value={draft.size} onChange={(e) => { const size = e.target.value; const nextStyles = adminProductStyles(draft.k, size); const style = nextStyles.includes(draft.style) ? draft.style : nextStyles[0]; patchVariation(draft, { size, style }); }}>{cfg.sizes.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label><span>Style</span><select disabled={!canEdit || structuralLocked} value={draft.style} onChange={(e) => patchVariation(draft, { style: e.target.value })}>{styles.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label><span>Review</span><select disabled={!canEdit || structuralLocked} value={draft.reviewRequired ? 'Need Review' : 'No Review'} onChange={(e) => patchVariation(draft, { reviewRequired: e.target.value === 'Need Review' })}><option>No Review</option><option>Need Review</option></select></label>
          <label><span>Qty</span><input type="number" min="1" disabled={!canEdit || structuralLocked} value={draft.qty} onChange={(e) => update(draft.clientId, { qty: Math.max(1, Number(e.target.value || 1)) })} /></label>
          <label><span>Unit Price</span><div className="struct-price"><input type="number" min="0" step="0.01" disabled={!canEdit || structuralLocked} value={draft.price} onChange={(e) => update(draft.clientId, { price: Math.max(0, Number(e.target.value || 0)) })} /><button type="button" disabled={!canEdit || structuralLocked || !suggestedDiffers} onClick={() => applySuggestedPrice(draft)}>{suggestedDiffers ? `Apply ${money(suggested)}` : 'Auto ✓'}</button></div>{!draft.isNew && suggestedDiffers && <small className="struct-suggested">Current price preserved · suggested {money(suggested)}</small>}</label>
          <label className="wide"><span>Custom Text / Wording</span><input disabled={!canEdit || structuralLocked} value={draft.customText} onChange={(e) => update(draft.clientId, { customText: e.target.value })} /></label>
          {draft.reviewRequired && <label className="wide"><span>Design Preview URL</span><input disabled={!canEdit || structuralLocked} value={draft.previewUrl} onChange={(e) => update(draft.clientId, { previewUrl: e.target.value })} /></label>}
        </div>

        {(draft.components || []).length > 0 && <div className="struct-components">{(draft.components || []).map((component) => <div className="struct-component" key={component.id}>
          <div className="struct-component-main">
            {component.previewUrl && <a className="struct-component-thumb" href={component.previewUrl} target="_blank" rel="noreferrer"><img src={component.previewUrl} alt="Component preview" onError={(e) => { e.currentTarget.style.display = 'none'; }} /></a>}
            <div><b>{component.label || 'Production component'}</b><span>{component.customerLabel || component.workflow || '—'} · {component.clickupStatus || component.reviewStatus || 'pending'}</span></div>
          </div>
          {component.clickupTaskId ? <a href={`https://app.clickup.com/t/3747262/${component.clickupTaskId}`} target="_blank" rel="noreferrer">ClickUp {component.clickupTaskId}</a> : <div className="struct-link-fallback">
            <span className="erp-status-pill warning">NOT LINKED</span>
            <div className="struct-link-input"><input placeholder="Task ID atau ClickUp URL" value={linkRefs[component.id] || ''} onChange={(e) => setLinkRefs((old) => ({ ...old, [component.id]: e.target.value }))} /><button className="btn btn-outline btn-sm" disabled={componentBusy === component.id} onClick={() => void manualLink(component)}>Link Existing</button><button className="btn btn-outline btn-sm" disabled={componentBusy === component.id} onClick={() => void retryAuto(component)}>Retry Auto</button></div>
          </div>}
        </div>)}</div>}
      </section>;
    })}

    <div className="struct-footer"><div><span>Items subtotal</span><b>{money(total)}</b><small>Existing item price is preserved when product/variation changes. Apply suggested price only when you want it.</small></div>{canEdit && !structuralLocked ? <button className="btn btn-primary" disabled={saving || !drafts.length} onClick={() => void save()}>{saving ? 'Saving…' : 'Save Order Items'}</button> : <span className="struct-readonly">Read only</span>}</div>
  </div>;
}
