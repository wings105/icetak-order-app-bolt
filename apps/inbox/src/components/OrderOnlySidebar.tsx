import { useState } from 'react';
import { CalendarClock, Check, Copy, CreditCard, MapPin, MessageCircle, Package, ShoppingBag, StickyNote, Truck, UserRound, X } from 'lucide-react';
import type { ExternalOrderSummary, MarketplaceOrderItem } from '../lib/externalOrderSummaries';

interface Props {
  order: ExternalOrderSummary;
  onClose: () => void;
  onOpenConversation?: (conversationId: string) => void;
  conversationId?: string | null;
}

function dateTime(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ms-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date(value));
}
function money(value?: number | null, currency = 'MYR') {
  if (value == null) return '—';
  return new Intl.NumberFormat('ms-MY', { style: 'currency', currency }).format(Number(value));
}
function ItemCard({ item, currency }: { item: MarketplaceOrderItem; currency: string }) {
  const price = item.line_subtotal ?? item.unit_discounted_price;
  return <div className="flex gap-3 rounded-xl bg-[var(--surface-muted)] p-3">
    {item.image_url
      ? <img src={item.image_url} alt="" className="h-14 w-14 flex-shrink-0 rounded-lg object-cover" />
      : <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--surface-hover)]"><ShoppingBag size={18} className="text-[var(--text-secondary)]" /></div>}
    <div className="min-w-0 flex-1">
      <p className="line-clamp-2 text-xs font-medium text-[var(--text)]">{item.title || 'Item Shopee'}</p>
      {item.variation_name && <p className="mt-1 text-[10px] text-[var(--text-secondary)]">{item.variation_name}</p>}
      <div className="mt-2 flex items-center justify-between text-[11px]"><span className="text-[var(--text-secondary)]">Qty {item.quantity ?? 0}</span><span className="font-semibold text-[var(--accent)]">{money(price, currency)}</span></div>
      {(item.item_sku || item.variation_sku) && <p className="mt-1 truncate text-[9px] text-[var(--text-secondary)]">SKU: {item.variation_sku || item.item_sku}</p>}
    </div>
  </div>;
}

export function OrderOnlySidebar({ order, onClose, onOpenConversation, conversationId }: Props) {
  const [noteCopied, setNoteCopied] = useState(false);
  const currency = order.currency || 'MYR';
  return <div className="flex h-full w-full flex-col border-l border-[var(--border)] bg-[var(--surface)] text-[var(--text)] shadow-2xl sm:shadow-none">
    <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">Order #{order.order_no}</p>
        <p className="mt-0.5 text-[10px] text-[var(--text-secondary)]">{conversationId ? 'Order + conversation' : 'Order sahaja · belum ada chat'}</p>
      </div>
      <button onClick={onClose} className="rounded-full p-2 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"><X size={18} /></button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto">
      <section className="border-b border-[var(--border)] p-4">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-orange-500/15 px-2 py-1 text-[10px] font-semibold text-orange-700 dark:text-orange-300">Shopee</span>
          <span className="rounded-full bg-[#00a884]/15 px-2 py-1 text-[10px] font-semibold text-[var(--accent)]">{order.order_status || 'Status belum ada'}</span>
          {order.payment_status && <span className="rounded-full bg-blue-500/15 px-2 py-1 text-[10px] font-semibold text-blue-700 dark:text-blue-300">{order.payment_status}</span>}
          {!order.detail_complete && <span className="rounded-full bg-amber-500/15 px-2 py-1 text-[10px] text-amber-700 dark:text-amber-300">Menunggu detail</span>}
        </div>
        {conversationId && onOpenConversation && <button onClick={() => onOpenConversation(conversationId)} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#00a884] px-3 py-2 text-xs font-semibold text-white"><MessageCircle size={14} /> Buka conversation</button>}
      </section>

      <section className="grid grid-cols-2 gap-2 border-b border-[var(--border)] p-4">
        <Info icon={<UserRound size={13} />} label="Username" value={order.shopee_username || order.customer_name || '—'} />
        <Info icon={<UserRound size={13} />} label="Buyer ID" value={order.shopee_buyer_id || '—'} />
        <Info icon={<CreditCard size={13} />} label="Jumlah" value={money(order.payment_total, currency)} />
        <Info icon={<Package size={13} />} label="Item" value={String(order.item_count ?? order.items.length)} />
        <Info icon={<CalendarClock size={13} />} label="Order placed" value={dateTime(order.placed_at)} />
        <Info icon={<CalendarClock size={13} />} label="Ship by" value={dateTime(order.ship_by_at)} />
      </section>

      {order.buyer_message && <section className="border-b border-[var(--border)] p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <Header icon={<StickyNote size={14} />} text="Nota checkout" className="mb-0" />
          <button
            onClick={() => {
              void navigator.clipboard.writeText(order.buyer_message ?? '');
              setNoteCopied(true);
              window.setTimeout(() => setNoteCopied(false), 1800);
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-amber-500/15 px-2 py-1 text-[10px] font-semibold text-amber-700 dark:text-amber-200 hover:bg-amber-500/25"
            title="Salin nota checkout"
          >
            {noteCopied ? <Check size={12} /> : <Copy size={12} />}
            {noteCopied ? 'Disalin' : 'Salin nota'}
          </button>
        </div>
        <p className="whitespace-pre-wrap rounded-xl bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-700 dark:text-amber-100">{order.buyer_message}</p>
      </section>}
      <section className="border-b border-[var(--border)] p-4">
        <Header icon={<MapPin size={14} />} text="Penghantaran" />
        <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--text)]">{order.delivery_address || 'Alamat belum diterima'}</p>
        <div className="mt-3 space-y-1 text-[11px] text-[var(--text-secondary)]">
          <p><span className="text-[var(--text-secondary)]">Courier:</span> {order.courier_name || order.delivery_method || '—'}</p>
          <p><span className="text-[var(--text-secondary)]">Tracking:</span> {order.tracking_no || 'Belum discan'}</p>
          <p><span className="text-[var(--text-secondary)]">Shipment:</span> {order.shipment_status || order.fulfillment_status || '—'}</p>
          {order.package_number && <p><span className="text-[var(--text-secondary)]">Package:</span> {order.package_number}</p>}
        </div>
      </section>

      <section className="border-b border-[var(--border)] p-4">
        <Header icon={<ShoppingBag size={14} />} text={`Item order (${order.items.length})`} />
        <div className="space-y-2">{order.items.length ? order.items.map((item, index) => <ItemCard key={`${item.provider_item_id || index}-${item.provider_variation_id || index}`} item={item} currency={currency} />) : <p className="rounded-xl border border-dashed border-[var(--border)] p-4 text-center text-xs text-[var(--text-secondary)]">Detail item belum diterima.</p>}</div>
      </section>

      <section className="p-4">
        <Header icon={<Truck size={14} />} text="Ringkasan bayaran" />
        <div className="space-y-2 rounded-xl bg-[var(--surface-muted)] p-3 text-xs">
          <Row label="Item / order total" value={money(order.payment_total, currency)} />
          <Row label="Shipping fee" value={money(order.shipping_fee, currency)} />
          <Row label="Paid" value={money(order.paid_amount, currency)} />
          <Row label="Balance" value={money(order.balance_amount, currency)} />
          <Row label="Payment method" value={order.payment_method || '—'} />
        </div>
        <p className="mt-3 text-[9px] text-[var(--text-secondary)]">Last sync: {dateTime(order.last_synced_at)}</p>
      </section>
    </div>
  </div>;
}
function Header({ icon, text, className = 'mb-3' }: { icon: React.ReactNode; text: string; className?: string }) { return <h3 className={`${className} flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]`}>{icon}{text}</h3>; }
function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="rounded-lg bg-[var(--surface-muted)] p-2"><div className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-[var(--text-secondary)]">{icon}{label}</div><p className="mt-1 break-words text-xs font-medium text-[var(--text)]">{value}</p></div>; }
function Row({ label, value }: { label: string; value: string }) { return <div className="flex items-start justify-between gap-3"><span className="text-[var(--text-secondary)]">{label}</span><span className="text-right font-medium text-[var(--text)]">{value}</span></div>; }
