import { useState } from 'react';
import { Conversation } from '../types';
import { WindowBadge } from './WindowBadge';
import { StatusBadge } from './StatusBadge';
import { OrderSessionBadge } from './OrderSessionBadge';
import { ChannelBadge } from './ChannelBadge';
import { Archive, ArchiveRestore, MailOpen, AlertTriangle, PanelsTopLeft, ChevronLeft, CheckCheck, Loader2 } from 'lucide-react';

interface ChatHeaderProps {
  conversation: Conversation;
  onArchiveToggle: () => void;
  onMarkUnread: () => void;
  onUrgentToggle: () => void;
  onShowCustomerPanel: () => void;
  onBack?: () => void;
  showCustomerPanel: boolean;
  onMarkReplied: () => Promise<void>;
  orderOnly?: boolean;
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

export function ChatHeader({
  conversation,
  onArchiveToggle,
  onMarkUnread,
  onUrgentToggle,
  onShowCustomerPanel,
  onBack,
  showCustomerPanel,
  onMarkReplied,
  orderOnly = false,
}: ChatHeaderProps) {
  const { customer, isArchived, isUrgent, lastInboundAt, orderStatus, channel, needsReply } = conversation;
  const [replying, setReplying] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const subtitle = channel === 'shopee' && customer.shopeeUsername
    ? `@${customer.shopeeUsername}`
    : customer.phone ?? '';

  async function handleMarkReplied() {
    if (replying) return;
    setReplying(true);
    setReplyError(null);
    try {
      await onMarkReplied();
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : 'Gagal menandakan sudah dibalas.');
    } finally {
      setReplying(false);
    }
  }

  return (
    <div className="flex flex-col bg-[#f0f2f5] dark:bg-[var(--surface-muted)] border-b border-[#e9edef] dark:border-[var(--border)]">
      <div className="flex items-center gap-3 px-4 py-3">
        {onBack && (
          <button onClick={onBack} className="text-[#54656f] dark:text-[var(--text-secondary)] hover:text-[var(--text)] dark:hover:text-[var(--text)] transition-colors mr-1">
            <ChevronLeft size={20} />
          </button>
        )}

        <button onClick={onShowCustomerPanel} className="flex-shrink-0" title="Buka Customer Workspace">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-[var(--text)] font-semibold text-sm ${avatarColor(customer.id)}`}>
            {getInitials(customer.name)}
          </div>
        </button>

        <button onClick={onShowCustomerPanel} className="flex-1 min-w-0 text-left" title="Buka Customer Workspace">
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-sm font-semibold text-[var(--text)] dark:text-[var(--text)] truncate">{customer.name}</p>
            <ChannelBadge channel={channel} size="xs" />
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {subtitle && <span className="text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary)] truncate">{subtitle}</span>}
            <StatusBadge status={orderStatus} size="xs" />
            {channel === 'whatsapp' && <OrderSessionBadge session={conversation.orderSession} />}
            {orderOnly && <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-[9px] font-semibold text-orange-700 dark:text-orange-300">Order customer · belum ada chat</span>}
          </div>
        </button>

        {channel === 'whatsapp' && (
          <div className="hidden sm:block"><WindowBadge lastInboundAt={lastInboundAt} /></div>
        )}

        <div className="flex items-center gap-1">
          {!orderOnly && needsReply && (
            <button
              onClick={handleMarkReplied}
              disabled={replying}
              title="Tandakan Sudah Dibalas"
              className="p-2 rounded-full transition-colors text-[#00a884] hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-60"
            >
              {replying ? <Loader2 size={18} className="animate-spin" /> : <CheckCheck size={18} strokeWidth={2} />}
            </button>
          )}

          {!orderOnly && <>
          <ActionButton onClick={onUrgentToggle} title={isUrgent ? 'Buang Urgent' : 'Tandakan Urgent'} active={isUrgent} activeClass="text-red-500">
            <AlertTriangle size={18} strokeWidth={isUrgent ? 2.5 : 1.5} />
          </ActionButton>

          <ActionButton onClick={onMarkUnread} title="Tandakan Belum Baca">
            <MailOpen size={18} strokeWidth={1.5} />
          </ActionButton>

          <ActionButton onClick={onArchiveToggle} title={isArchived ? 'Nyah-arkib' : 'Arkibkan'}>
            {isArchived ? <ArchiveRestore size={18} strokeWidth={1.5} /> : <Archive size={18} strokeWidth={1.5} />}
          </ActionButton>
          </>}

          <ActionButton onClick={onShowCustomerPanel} title="Customer · Order · Aktiviti" active={showCustomerPanel} activeClass="text-[#00a884]">
            <PanelsTopLeft size={18} strokeWidth={1.5} />
          </ActionButton>
        </div>
      </div>

      {replyError && (
        <div className="px-4 py-1.5 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border-t border-red-200 dark:border-red-800/40">
          {replyError}
        </div>
      )}
    </div>
  );
}

function ActionButton({
  children, onClick, title, active, activeClass = 'text-[#00a884]',
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
  activeClass?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-2 rounded-full transition-colors ${active ? activeClass : 'text-[#54656f] dark:text-[var(--text-secondary)] hover:text-[var(--text)] dark:hover:text-[var(--text)] hover:bg-black/5 dark:hover:bg-white/5'}`}
    >
      {children}
    </button>
  );
}
