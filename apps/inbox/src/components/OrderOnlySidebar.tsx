import { MessageCircle, X } from 'lucide-react';
import { InboxClickUpDesigner } from './InboxClickUpDesigner';
import { SidebarOrderCard } from './workspace/SidebarOrderCard';
import type { ExternalOrderSummary } from '../lib/externalOrderSummaries';

interface Props {
  order: ExternalOrderSummary;
  onClose: () => void;
  onOpenConversation?: (conversationId: string) => void;
  conversationId?: string | null;
}

export function OrderOnlySidebar({ order, onClose, onOpenConversation, conversationId }: Props) {
  return <div className="flex h-full w-full flex-col border-l border-[var(--border)] bg-[var(--surface)] text-[var(--text)] shadow-2xl sm:shadow-none">
    <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">Order #{order.order_no}</p>
        <p className="mt-0.5 text-[10px] text-[var(--text-secondary)]">{conversationId ? 'Order + conversation' : 'Order sahaja · belum ada chat'}</p>
      </div>
      <button onClick={onClose} title="Tutup sidebar" className="rounded-full p-2 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"><X size={18} /></button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto">
      <InboxClickUpDesigner key={order.id} orders={[{ id: order.id, order_no: order.order_no }]} defaultOpen />
      <section className="p-3">
        <SidebarOrderCard
          order={order}
          extraRows={[{ label: 'Channel', value: order.source_channel === 'whatsapp' ? 'Decocake' : 'Shopee' }, { label: 'Status bayaran', value: order.payment_status }]}
          actions={conversationId && onOpenConversation ? <button onClick={() => onOpenConversation(conversationId)} className="inline-flex items-center justify-center gap-1.5 rounded bg-[#00a884] px-3 py-2 text-[11px] font-semibold text-white"><MessageCircle size={13} />Buka chat</button> : undefined}
        />
      </section>
    </div>
  </div>;
}
