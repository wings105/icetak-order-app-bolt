import { useEffect, useState, type ReactNode } from 'react';
import { CalendarClock, Check, Copy, CreditCard, ExternalLink, MapPin, Package, ShoppingBag, StickyNote, Truck } from 'lucide-react';
import { lookupProduct } from '../../lib/productCatalog';

export interface SidebarOrder {
  order_no: string;
  source_channel?: string | null;
  order_status?: string | null;
  payment_status?: string | null;
  shipment_status?: string | null;
  fulfillment_status?: string | null;
  items: readonly unknown[];
  payment_total?: number | null;
  paid_amount?: number | null;
  balance_amount?: number | null;
  shipping_fee?: number | null;
  payment_method?: string | null;
  currency?: string | null;
  placed_at?: string | null;
  ship_by_at?: string | null;
  date_need?: string | null;
  shipped_at?: string | null;
  buyer_message?: string | null;
  delivery_address?: string | null;
  delivery_method?: string | null;
  courier_name?: string | null;
  tracking_no?: string | null;
  package_number?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  shopee_username?: string | null;
  shopee_buyer_id?: string | null;
  shop_id?: string | null;
  public_order_url?: string | null;
  clickup_url?: string | null;
  detail_complete?: boolean;
  last_synced_at?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function sidebarOrderStatus(order: Pick<SidebarOrder, 'order_status' | 'payment_status' | 'shipment_status' | 'fulfillment_status'>) {
  const status = [order.order_status, order.shipment_status, order.fulfillment_status].filter(Boolean).join(' ').toUpperCase();
  if (/CANCEL|INVALID|REFUND|RETURN/.test(status)) return { key: 'cancelled', label: 'Cancelled / Return', color: 'text-red-600 dark:text-red-300' };
  if (/^(unpaid|pending|payment_pending|not_paid)$/i.test(order.payment_status || '') || /^UNPAID$/.test(order.order_status || '')) return { key: 'unpaid', label: 'Unpaid', color: 'text-amber-600 dark:text-amber-300' };
  if (/COMPLETED|DELIVERED|DELIVERY_DONE/.test(status)) return { key: 'completed', label: 'Completed', color: 'text-emerald-700 dark:text-emerald-300' };
  if (/SHIPPED|IN_TRANSIT|TO_CONFIRM_RECEIVE|PICKUP_DONE/.test(status)) return { key: 'shipping', label: 'Shipping', color: 'text-sky-700 dark:text-sky-300' };
  if (/READY_TO_SHIP|PROCESSED|LOGISTICS_READY|REQUEST_CREATED/.test(status)) return { key: 'to_ship', label: 'To Ship', color: 'text-blue-700 dark:text-blue-300' };
  return { key: 'other', label: order.order_status?.replace(/_/g, ' ') || 'Order', color: 'text-[var(--accent)]' };
}

function number(value: unknown): number | null {
  if (value == null || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

export function sidebarMoney(value: unknown, currency = 'MYR') {
  const amount = number(value);
  if (amount == null) return '—';
  return `${currency === 'MYR' ? 'RM' : currency === 'SGD' ? 'S$' : `${currency} `}${amount.toFixed(2)}`;
}

function dateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T12:00:00+08:00` : value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-MY', { day: 'numeric', month: 'short', year: 'numeric', ...(value.length === 10 ? {} : { hour: '2-digit', minute: '2-digit', hour12: false }), timeZone: 'Asia/Kuala_Lumpur' }).format(date);
}

function ItemImage({ item, shopId }: { item: Record<string, unknown>; shopId?: string | null }) {
  const direct = typeof item.image_url === 'string' ? item.image_url : '';
  const itemId = String(item.provider_item_id ?? item.item_id ?? '');
  const modelId = String(item.provider_variation_id ?? item.model_id ?? '');
  const key = `${shopId}:${itemId}:${modelId}:${direct}`;
  const [resolved, setResolved] = useState<{ key: string; url: string } | null>(null);
  const [broken, setBroken] = useState('');
  useEffect(() => {
    if ((direct && broken !== direct) || !shopId || !/^\d+$/.test(itemId)) return;
    let cancelled = false;
    void lookupProduct(shopId, itemId).then((product) => {
      if (cancelled || !product) return;
      const model = product.models?.find((row) => row.model_id === modelId);
      setResolved({ key, url: model?.image_url || product.image_url || '' });
    });
    return () => { cancelled = true; };
  }, [direct, broken, shopId, itemId, modelId, key]);
  const url = resolved?.key === key ? resolved.url : direct;
  return <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded border border-[var(--border)] bg-[var(--surface-muted)]">
    {url && broken !== url ? <img src={url} alt="" loading="lazy" className="h-full w-full object-contain" onError={() => setBroken(url)} /> : <ShoppingBag size={17} className="text-[var(--text-secondary)]" aria-label="Imej belum tersedia" />}
  </div>;
}

function DetailRow({ icon, label, children, highlight = false }: { icon: ReactNode; label: string; children: ReactNode; highlight?: boolean }) {
  return <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] items-start gap-3 py-1 text-[11px] leading-4">
    <span className="flex min-w-0 items-start gap-1.5 text-[var(--text-secondary)]"><span className="mt-0.5 shrink-0 opacity-70">{icon}</span><span>{label}</span></span>
    <span className={`min-w-0 text-right [overflow-wrap:anywhere] ${highlight ? 'font-semibold text-[#ee4d2d] dark:text-orange-300' : 'text-[var(--text)]'}`}>{children}</span>
  </div>;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" onClick={() => { void navigator.clipboard.writeText(value).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }).catch(() => setCopied(false)); }} title={copied ? 'Disalin' : label} aria-label={copied ? 'Disalin' : label} className="inline-flex shrink-0 rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--accent)]">
    {copied ? <Check size={11} /> : <Copy size={11} />}
  </button>;
}

export function SidebarOrderCard({ order, primary = false, extraRows = [], actions }: {
  order: SidebarOrder;
  primary?: boolean;
  extraRows?: Array<{ label: string; value: string | null | undefined }>;
  actions?: ReactNode;
}) {
  const status = sidebarOrderStatus(order);
  const currency = order.currency || 'MYR';
  const detailsUrl = order.public_order_url || order.clickup_url;
  const paidAt = typeof order.metadata?.paid_at === 'string' ? order.metadata.paid_at : null;
  const additionalRows = [
    { label: 'Username', value: order.shopee_username || order.customer_name },
    { label: 'Buyer ID', value: order.shopee_buyer_id },
    { label: 'Telefon', value: order.customer_phone },
    { label: 'Paid', value: order.paid_amount == null ? null : sidebarMoney(order.paid_amount, currency) },
    { label: 'Baki', value: order.balance_amount == null ? null : sidebarMoney(order.balance_amount, currency) },
    { label: 'Shipping fee', value: order.shipping_fee == null ? null : sidebarMoney(order.shipping_fee, currency) },
    { label: 'Kaedah bayaran', value: order.payment_method },
    { label: 'Tarikh perlu', value: order.date_need ? dateTime(order.date_need) : null },
    { label: 'Shipment', value: order.shipment_status || order.fulfillment_status },
    { label: 'Package', value: order.package_number },
    ...order.items.flatMap((raw, index) => {
      if (!raw || typeof raw !== 'object') return [];
      const item = raw as Record<string, unknown>;
      const wording = String(item.wording || item.custom_text || '').trim();
      return wording ? [{ label: order.items.length > 1 ? `Wording item ${index + 1}` : 'Wording', value: wording }] : [];
    }),
    ...extraRows,
  ].filter((row) => row.value != null && row.value !== '');
  return <article className={`min-w-0 overflow-hidden rounded-lg border bg-[var(--surface)] ${primary ? 'border-[#00a884]/50' : 'border-[var(--border)]'}`} aria-label={`Order ${order.order_no}`}>
    <div className="px-3 pb-2 pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${status.color}`}><Package size={14} />{status.label}</span>
        <div className="flex shrink-0 items-center gap-2">
          {primary && <span className="rounded bg-[#00a884]/10 px-1.5 py-0.5 text-[9px] font-medium text-[var(--accent)]">Utama</span>}
          {detailsUrl && <a href={detailsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] text-blue-600 hover:underline dark:text-blue-300">Lihat detail<ExternalLink size={10} /></a>}
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[10px] text-[var(--text-secondary)]">
        <span className="flex min-w-0 items-center gap-0.5"><span className="break-all text-[var(--text)]">{order.order_no}</span><CopyButton value={order.order_no} label="Salin order ID" /></span>
        <time>{dateTime(order.placed_at)}</time>
      </div>
    </div>

    <div className="space-y-3 border-t border-[var(--border)] px-3 py-3">
      {order.items.length ? order.items.map((raw, index) => {
        if (!raw || typeof raw !== 'object') return null;
        const item = raw as Record<string, unknown>;
        const quantity = number(item.quantity ?? item.qty) ?? 1;
        const subtotal = number(item.line_subtotal);
        const unit = number(item.unit_discounted_price);
        let price = unit ?? (subtotal == null ? null : quantity > 0 ? subtotal / quantity : subtotal);
        if (order.detail_complete === false && price === 0 && (number(item.unit_original_price) ?? 0) > 0) price = null;
        const sku = String(item.variation_sku || item.item_sku || item.sku || '');
        const variation = String(item.variation_name || item.variation || '');
        const title = String(item.title || item.product_name || item.name || 'Item');
        return <div key={`${item.provider_item_id || index}-${item.provider_variation_id || index}`} className="flex items-start gap-2.5">
          <ItemImage item={item} shopId={order.source_channel === 'shopee' ? order.shop_id : null} />
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-[11px] font-medium leading-4 text-[var(--text)]" title={title}>{title}</p>
            {variation && <p className="mt-0.5 break-words text-[10px] text-[var(--text-secondary)]">{variation}</p>}
            {sku && <div className="mt-0.5 flex min-w-0 items-center text-[10px] text-[var(--text-secondary)]"><span className="truncate" title={sku}>SKU: {sku}</span><CopyButton value={sku} label={`Salin SKU ${sku}`} /></div>}
          </div>
          <div className="shrink-0 pl-1 text-right text-[11px]"><p className="font-medium text-[var(--text)]">{sidebarMoney(price, currency)}</p><p className="mt-1 text-[10px] text-[var(--text-secondary)]">×{quantity}</p></div>
        </div>;
      }) : <p className="py-2 text-center text-[11px] text-[var(--text-secondary)]">Detail item belum diterima.</p>}
    </div>

    <div className="border-t border-dashed border-[var(--border)] px-3 py-2">
      <DetailRow icon={<CreditCard size={12} />} label={order.source_channel === 'shopee' ? 'Total Buyer Payment' : 'Jumlah order'} highlight>{sidebarMoney(order.payment_total, currency)}</DetailRow>
      <DetailRow icon={<Truck size={12} />} label="Logistics">{order.courier_name || order.delivery_method || '—'}</DetailRow>
      <DetailRow icon={<CalendarClock size={12} />} label="Ship-by Date">{dateTime(order.ship_by_at)}</DetailRow>
      <DetailRow icon={<CreditCard size={12} />} label="Paid Time">{dateTime(paidAt)}</DetailRow>
      <DetailRow icon={<StickyNote size={12} />} label="Order Note">{order.buyer_message ? <span className="flex items-start justify-end gap-1"><span className="whitespace-pre-wrap text-left">{order.buyer_message}</span><CopyButton value={order.buyer_message} label="Salin nota order" /></span> : '—'}</DetailRow>
      {order.tracking_no && <DetailRow icon={<Truck size={12} />} label="Tracking"><span className="inline-flex items-start gap-1">{order.tracking_no}<CopyButton value={order.tracking_no} label="Salin tracking" /></span></DetailRow>}
    </div>

    {actions && <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-[var(--border)] px-3 py-2.5">{actions}</div>}

    <div className="border-t border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5">
      <p className="mb-1 text-[10px] font-medium text-[var(--text-secondary)]">Maklumat tambahan</p>
      {order.delivery_address && <div className="mb-2 flex items-start gap-1.5 text-[11px] leading-4 text-[var(--text)]"><MapPin size={12} className="mt-0.5 shrink-0 text-[var(--text-secondary)]" /><span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{order.delivery_address}</span></div>}
      <dl className="space-y-1 text-[10px] leading-4">{additionalRows.map((row) => <div key={row.label} className="flex justify-between gap-3"><dt className="shrink-0 text-[var(--text-secondary)]">{row.label}</dt><dd className="min-w-0 whitespace-pre-wrap text-right text-[var(--text)] [overflow-wrap:anywhere]">{row.value}</dd></div>)}</dl>
      {order.detail_complete === false && <p className="mt-2 text-[10px] leading-4 text-amber-700 dark:text-amber-300">Detail API belum lengkap. Nilai yang belum diterima dipaparkan sebagai —.</p>}
      {order.last_synced_at && <p className="mt-2 text-[9px] text-[var(--text-secondary)]">Sync terakhir: {dateTime(order.last_synced_at)}</p>}
    </div>
  </article>;
}
