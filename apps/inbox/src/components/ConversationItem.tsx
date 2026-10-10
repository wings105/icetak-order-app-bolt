import { Conversation, Message } from '../types';
import { formatConversationTime } from '../utils/timeUtils';
import { WindowBadge } from './WindowBadge';
import { StatusBadge } from './StatusBadge';
import { OrderSessionBadge } from './OrderSessionBadge';
import { ChannelBadge } from './ChannelBadge';
import { AlertTriangle, Tag } from 'lucide-react';

interface ConversationItemProps {
  conversation: Conversation;
  isSelected: boolean;
  onClick: () => void;
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

const MEDIA_LABELS: Record<string, string> = {
  image: '[Gambar]', audio: '[Audio]', video: '[Video]', document: '[Dokumen]',
  sticker: '[Sticker]', location: '[Lokasi]', template: '[Templat]', interactive: '[Interaktif]',
};

function messagePreview(msg: Message): string {
  const type = msg.messageType ?? 'text';
  if (type !== 'text' && !msg.content) return MEDIA_LABELS[type] ?? `[${type}]`;
  return msg.content || MEDIA_LABELS[type] || '';
}

function tagClass(tag: string): string {
  const key = tag.toLowerCase().replace(/\s+/g, '_');
  if (key === 'paid') return 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300';
  if (key === 'urgent' || key === 'due_today' || key === 'complaint') return 'bg-red-500/20 text-red-700 dark:text-red-300';
  if (key === 'due_tomorrow' || key === 'waiting_payment') return 'bg-orange-500/20 text-orange-700 dark:text-orange-300';
  if (key === 'order_confirmed' || key === 'approved') return 'bg-blue-500/20 text-blue-700 dark:text-blue-300';
  if (key === 'waiting_design' || key === 'review') return 'bg-violet-500/20 text-violet-300';
  if (key === 'future_date' || key === 'inactive') return 'bg-slate-500/20 text-slate-300';
  return 'bg-[var(--surface-hover)] text-[var(--text)]';
}

function formatDueDate(value?: string): string | null {
  if (!value) return null;
  const parts = value.split('-');
  if (parts.length !== 3) return value;
  return `${parts[2]}/${parts[1]}`;
}

export function ConversationItem({ conversation, isSelected, onClick }: ConversationItemProps) {
  const {
    customer, messages, unreadCount, isUrgent, isArchived, lastInboundAt,
    orderStatus, channel, aiPriorityScore, aiRemark, aiDueDate,
  } = conversation;
  const lastMsg = messages[messages.length - 1];
  const timeStr = lastMsg
    ? formatConversationTime(lastMsg.timestamp)
    : conversation.lastMessageAt
      ? formatConversationTime(conversation.lastMessageAt)
      : '';
  let preview = 'Tiada mesej';
  if (lastMsg) {
    const body = messagePreview(lastMsg);
    preview = lastMsg.direction === 'outbound' ? `Anda: ${body}` : body;
  }
  const displayName = customer.name;
  const subtitle = channel === 'shopee' && customer.shopeeUsername ? `@${customer.shopeeUsername}` : customer.phone ?? '';
  const tags = customer.tags ?? [];
  const dueDate = formatDueDate(aiDueDate);

  return (
    <button onClick={onClick} className={`w-full flex items-start gap-3 px-3 py-3 text-left transition-colors ${isSelected ? 'bg-[#f0f2f5] dark:bg-[var(--surface-hover)]' : 'hover:bg-[#f5f6f6] dark:hover:bg-[var(--surface-hover)]/60'}`}>
      <div className={`relative mt-0.5 flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center text-[var(--text)] font-semibold text-sm ${avatarColor(customer.id)}`}>
        {getInitials(displayName)}
        {isUrgent && <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center"><AlertTriangle size={9} className="text-white" strokeWidth={2.5} /></span>}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className={`text-sm truncate ${unreadCount > 0 ? 'font-semibold text-[var(--text)] dark:text-[var(--text)]' : 'font-medium text-[var(--text)] dark:text-[var(--text)]'}`}>{displayName}</span>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            {(aiPriorityScore ?? 0) > 0 && (
              <span className={`rounded px-1 py-0.5 text-[9px] font-bold ${isUrgent ? 'bg-red-500/20 text-red-700 dark:text-red-300' : 'bg-[#00a884]/20 text-[#00a884]'}`}>
                P{aiPriorityScore}
              </span>
            )}
            <span className={`text-[11px] ${unreadCount > 0 ? 'text-[#00a884] font-medium' : 'text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'}`}>{timeStr}</span>
          </div>
        </div>

        {subtitle && <p className="text-[11px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] truncate mb-0.5">{subtitle}</p>}

        {aiRemark && (
          <p className={`mb-1 line-clamp-2 text-[11px] font-medium leading-snug ${isUrgent ? 'text-red-500 dark:text-red-300' : 'text-[#167d65] dark:text-[var(--accent)]'}`}>
            {aiRemark}
          </p>
        )}

        <div className="flex items-center justify-between gap-2">
          <p className={`text-xs truncate leading-tight ${unreadCount > 0 ? 'text-[var(--text)] dark:text-[var(--text)]' : 'text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'}`}>{preview}</p>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {dueDate && <span className="rounded bg-orange-500/15 px-1 py-0.5 text-[9px] font-semibold text-orange-700 dark:text-orange-400">Due {dueDate}</span>}
            {isArchived && <span className="text-[10px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)] bg-gray-100 dark:bg-gray-700 px-1 rounded">Arkib</span>}
            {unreadCount > 0 && <span className="bg-[#00a884] text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">{unreadCount}</span>}
          </div>
        </div>

        {tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {tags.slice(0, 4).map((tag) => <span key={tag} className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] ${tagClass(tag)}`}><Tag size={9} />{tag}</span>)}
            {tags.length > 4 && <span className="text-[10px] text-[var(--text-secondary)]">+{tags.length - 4}</span>}
          </div>
        )}

        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <ChannelBadge channel={channel} size="xs" />
          <StatusBadge status={orderStatus} size="xs" />
          {channel === 'whatsapp' && <OrderSessionBadge session={conversation.orderSession} compact />}
          {channel === 'whatsapp' && <WindowBadge lastInboundAt={lastInboundAt} compact />}
        </div>
      </div>
    </button>
  );
}

