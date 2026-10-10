import { useState, useCallback } from 'react';
import { Conversation } from '../types';
import { WindowBadge } from './WindowBadge';
import { StatusBadge } from './StatusBadge';
import { ChannelBadge } from './ChannelBadge';
import {
  X, Phone, Mail, Building2, Tag, FileText,
  MapPin, Copy, Check, Send, ShoppingBag,
  Package, Hash, CreditCard, Clock, Truck, CalendarClock,
} from 'lucide-react';

interface CustomerPanelProps {
  conversation: Conversation;
  onClose: () => void;
  onFillComposer: (text: string) => void;
}

function getInitials(name: string): string {
  return name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

const AVATAR_COLORS = [
  'bg-teal-500', 'bg-sky-500', 'bg-rose-500', 'bg-amber-500',
  'bg-emerald-500', 'bg-pink-500', 'bg-cyan-600', 'bg-lime-600', 'bg-orange-500',
];

function avatarColor(id: string): string {
  return AVATAR_COLORS[id.charCodeAt(id.length - 1) % AVATAR_COLORS.length];
}

const TAG_COLORS: Record<string, string> = {
  VIP: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400',
  Langganan: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-400',
  Urgent: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400',
  'Same Day': 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400',
  Baru: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400',
  'Pelanggan Baru': 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400',
  'Repeat Order': 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-400',
  Borong: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400',
  Korporat: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400',
  Aduan: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400',
  Gagal: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
  Selesai: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
};

function buildFullAddress(customer: Conversation['customer']): string {
  return [
    customer.address,
    [customer.postcode, customer.city].filter(Boolean).join(' '),
    customer.state,
  ].filter(Boolean).join(', ');
}

function useCopy(resetMs = 1800) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback((key: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), resetMs);
    });
  }, [resetMs]);
  return { copied, copy };
}

export function CustomerPanel({ conversation, onClose, onFillComposer }: CustomerPanelProps) {
  const { customer, messages, lastInboundAt, isUrgent, isArchived, orderStatus, channel, shopeeOrder } = conversation;
  const { copied, copy } = useCopy();

  const totalMessages = messages.length;
  const inboundCount = messages.filter((m) => m.direction === 'inbound').length;
  const outboundCount = messages.filter((m) => m.direction === 'outbound').length;

  const fullAddress = buildFullAddress(customer);

  function handleSendConfirmation() {
    const text = [
      'Mohon sahkan maklumat penghantaran:',
      `Nama: ${customer.name}`,
      `No. Telefon: ${customer.phone ?? '—'}`,
      `Alamat: ${fullAddress || '—'}`,
      'Betul ya?',
    ].join('\n');
    onFillComposer(text);
  }

  return (
    <div className="w-full h-full flex flex-col bg-[#f0f2f5] dark:bg-[var(--surface)] border-l border-[#e9edef] dark:border-[var(--border)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 bg-[#f0f2f5] dark:bg-[var(--surface-muted)] border-b border-[#e9edef] dark:border-[var(--border)]">
        <span className="text-sm font-semibold text-[var(--text)] dark:text-[var(--text)]">Info Kenalan</span>
        <button
          onClick={onClose}
          className="p-1 rounded-full text-[#54656f] dark:text-[var(--text-secondary)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {/* Avatar & name */}
        <div className="flex flex-col items-center gap-3 py-6 px-4">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center text-[var(--text)] text-2xl font-semibold ${avatarColor(customer.id)}`}>
            {getInitials(customer.name)}
          </div>
          <div className="text-center">
            <p className="font-semibold text-[var(--text)] dark:text-[var(--text)] text-base">{customer.name}</p>
            {channel === 'shopee' && customer.shopeeUsername && (
              <p className="text-sm text-orange-500 dark:text-orange-400 mt-0.5">@{customer.shopeeUsername}</p>
            )}
            {customer.company && (
              <p className="text-sm text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mt-0.5">{customer.company}</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-center">
            <ChannelBadge channel={channel} size="sm" />
            {isUrgent && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 font-medium">
                Urgent
              </span>
            )}
            {isArchived && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 font-medium">
                Diarkibkan
              </span>
            )}
          </div>
        </div>

        {/* Status row */}
        <Section title="Status">
          <div className="flex items-center justify-between px-1 flex-wrap gap-2">
            {channel === 'whatsapp' && <WindowBadge lastInboundAt={lastInboundAt} />}
            <StatusBadge status={orderStatus} size="sm" />
          </div>
        </Section>

        {/* ── Shopee order panel ─────────────────────────────────────────── */}
        {channel === 'shopee' && shopeeOrder && (
          <>
            <Section title="Maklumat Order Shopee">
              <div className="flex flex-col gap-2.5">
                <OrderRow icon={<Hash size={13} />} label="Order ID" value={shopeeOrder.orderId} />
                <OrderRow icon={<Package size={13} />} label="Produk" value={shopeeOrder.product} />
                <OrderRow icon={<ShoppingBag size={13} />} label="Variasi" value={shopeeOrder.variation} />
                <OrderRow icon={<CreditCard size={13} />} label="Jumlah Bayaran" value={shopeeOrder.totalPayment} highlight />
                <OrderRow icon={<Clock size={13} />} label="Masa Bayaran" value={shopeeOrder.paidTime} />
                <OrderRow icon={<CalendarClock size={13} />} label="Hantar Sebelum" value={shopeeOrder.shipByDate} highlight />
                <OrderRow
                  icon={<Truck size={13} />}
                  label="No. Tracking"
                  value={shopeeOrder.trackingNumber || '—'}
                />
              </div>
            </Section>

            <Section title="Status Order">
              <div className="px-1">
                <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full ${
                  shopeeOrder.orderStatus === 'Dibatalkan' || shopeeOrder.orderStatus === 'Gagal'
                    ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400'
                    : shopeeOrder.orderStatus === 'Perlu Dihantar Hari Ini'
                    ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-400'
                    : shopeeOrder.orderStatus === 'Dalam Penghantaran'
                    ? 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-400'
                    : shopeeOrder.orderStatus === 'Selesai'
                    ? 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                    : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400'
                }`}>
                  {shopeeOrder.orderStatus}
                </span>
              </div>
            </Section>
          </>
        )}

        {/* ── WhatsApp contact panel ─────────────────────────────────────── */}
        {channel === 'whatsapp' && (
          <>
            <Section title="Maklumat Kenalan">
              {customer.phone && (
                <CopyRow
                  icon={<Phone size={14} />}
                  label="No. Telefon"
                  value={customer.phone}
                  copyKey="phone"
                  copied={copied}
                  onCopy={() => copy('phone', customer.phone!)}
                />
              )}
              {customer.email && (
                <InfoRow icon={<Mail size={14} />} label="E-mel" value={customer.email} />
              )}
              {customer.company && (
                <InfoRow icon={<Building2 size={14} />} label="Syarikat" value={customer.company} />
              )}
            </Section>

            <Section title="Alamat Penghantaran">
              {customer.address ? (
                <CopyRow
                  icon={<MapPin size={14} />}
                  label="Alamat"
                  value={fullAddress}
                  copyKey="address"
                  copied={copied}
                  onCopy={() => copy('address', fullAddress)}
                  multiline
                />
              ) : (
                <p className="text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)] px-1">Tiada alamat disimpan</p>
              )}
              {customer.postcode && (
                <div className="grid grid-cols-2 gap-2 px-1 mt-1">
                  <div>
                    <p className="text-[10px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] uppercase tracking-wider">Poskod</p>
                    <p className="text-sm text-[#3b4a54] dark:text-[var(--text)]">{customer.postcode}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] uppercase tracking-wider">Bandar</p>
                    <p className="text-sm text-[#3b4a54] dark:text-[var(--text)]">{customer.city}</p>
                  </div>
                  {customer.state && (
                    <div className="col-span-2">
                      <p className="text-[10px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] uppercase tracking-wider">Negeri</p>
                      <p className="text-sm text-[#3b4a54] dark:text-[var(--text)]">{customer.state}</p>
                    </div>
                  )}
                </div>
              )}
            </Section>

            {/* Confirmation button */}
            <div className="px-4 pt-1 pb-3 border-t border-[#e9edef] dark:border-[var(--border)]">
              <button
                onClick={handleSendConfirmation}
                className="w-full flex items-center justify-center gap-2 bg-[#00a884] hover:bg-[#008069] active:bg-[#006d59] text-white text-sm font-medium py-2.5 px-4 rounded-lg transition-colors"
              >
                <Send size={14} strokeWidth={2} />
                Hantar Untuk Pengesahan
              </button>
            </div>

            <Section title="Nama Pelanggan">
              <CopyRow
                icon={null}
                label="Nama Penuh"
                value={customer.name}
                copyKey="name"
                copied={copied}
                onCopy={() => copy('name', customer.name)}
              />
            </Section>
          </>
        )}

        {/* Tags */}
        {customer.tags && customer.tags.length > 0 && (
          <Section title="Label">
            <div className="flex items-start gap-2 px-1">
              <Tag size={14} className="text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mt-0.5 flex-shrink-0" />
              <div className="flex flex-wrap gap-1.5">
                {customer.tags.map((tag) => (
                  <span
                    key={tag}
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${TAG_COLORS[tag] ?? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </Section>
        )}

        {/* Notes */}
        {customer.notes && (
          <Section title="Nota">
            <div className="flex gap-2 px-1">
              <FileText size={14} className="text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mt-0.5 flex-shrink-0" />
              <p className="text-sm text-[#3b4a54] dark:text-[var(--text)] leading-relaxed">{customer.notes}</p>
            </div>
          </Section>
        )}

        {/* Stats */}
        <Section title="Statistik Perbualan">
          <div className="grid grid-cols-3 gap-2">
            <StatCard label="Jumlah" value={totalMessages} />
            <StatCard label="Masuk" value={inboundCount} color="text-sky-600 dark:text-sky-400" />
            <StatCard label="Keluar" value={outboundCount} color="text-[#00a884]" />
          </div>
        </Section>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3 border-t border-[#e9edef] dark:border-[var(--border)]">
      <p className="text-xs font-semibold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] uppercase tracking-wider mb-2.5">{title}</p>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5 px-1">
      <span className="text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mt-0.5 flex-shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] uppercase tracking-wider">{label}</p>
        <p className="text-sm text-[#3b4a54] dark:text-[var(--text)] break-all">{value}</p>
      </div>
    </div>
  );
}

function OrderRow({
  icon, label, value, highlight = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 px-1">
      <span className="text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mt-0.5 flex-shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] uppercase tracking-wider">{label}</p>
        <p className={`text-sm break-all ${highlight ? 'font-semibold text-[var(--text)] dark:text-[var(--text)]' : 'text-[#3b4a54] dark:text-[var(--text)]'}`}>
          {value}
        </p>
      </div>
    </div>
  );
}

function CopyRow({
  icon, label, value, copyKey, copied, onCopy, multiline = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  copyKey: string;
  copied: string | null;
  onCopy: () => void;
  multiline?: boolean;
}) {
  const isCopied = copied === copyKey;
  return (
    <div className="flex items-start gap-2.5 px-1">
      {icon && <span className="text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mt-0.5 flex-shrink-0">{icon}</span>}
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] uppercase tracking-wider">{label}</p>
        <p className={`text-sm text-[#3b4a54] dark:text-[var(--text)] ${multiline ? 'break-words leading-snug' : 'break-all'}`}>
          {value}
        </p>
      </div>
      <button
        onClick={onCopy}
        title={isCopied ? 'Disalin!' : 'Salin'}
        className={`flex-shrink-0 flex items-center gap-1 mt-0.5 px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
          isCopied
            ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'
            : 'bg-[#e9edef] dark:bg-[var(--surface-hover)] text-[#54656f] dark:text-[var(--text-secondary)] hover:bg-[#d1d7db] dark:hover:bg-[var(--surface-hover)]'
        }`}
      >
        {isCopied ? (
          <><Check size={11} strokeWidth={2.5} />Disalin</>
        ) : (
          <><Copy size={11} strokeWidth={2} />Salin</>
        )}
      </button>
    </div>
  );
}

function StatCard({ label, value, color = 'text-[var(--text)] dark:text-[var(--text)]' }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-white dark:bg-[var(--surface-muted)] rounded-lg px-3 py-2.5 text-center">
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      <p className="text-[10px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] mt-0.5">{label}</p>
    </div>
  );
}

