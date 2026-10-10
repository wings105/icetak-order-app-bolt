import { useMemo, useState } from 'react';
import {
  AlertTriangle, Bot, ChevronDown, ChevronUp, CircleUserRound,
  History, Link2, Package, Settings2, Tag, UserRound,
} from 'lucide-react';
import type { WorkspaceActivity } from '../../lib/conversationWorkspace';

type ActivityFilter = 'all' | 'staff' | 'ai' | 'system' | 'order';

interface Props {
  activities: WorkspaceActivity[];
  loading: boolean;
}

const FILTERS: Array<{ id: ActivityFilter; label: string }> = [
  { id: 'all', label: 'Semua' },
  { id: 'staff', label: 'Staff' },
  { id: 'ai', label: 'AI' },
  { id: 'system', label: 'System' },
  { id: 'order', label: 'Order' },
];

function isOrderEvent(eventType: string): boolean {
  return /order|payment|shipment|tracking|product/.test(eventType);
}

function matchesFilter(activity: WorkspaceActivity, filter: ActivityFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'staff') return activity.actor_type === 'user';
  if (filter === 'ai') return activity.actor_type === 'ai';
  if (filter === 'system') return ['system', 'external', 'integration'].includes(activity.actor_type);
  return isOrderEvent(activity.event_type);
}

function eventIcon(activity: WorkspaceActivity) {
  if (activity.event_type.includes('tag')) return <Tag size={15} />;
  if (isOrderEvent(activity.event_type)) return activity.event_type.includes('link') ? <Link2 size={15} /> : <Package size={15} />;
  if (activity.actor_type === 'ai') return <Bot size={15} />;
  if (activity.actor_type === 'user') return <UserRound size={15} />;
  if (activity.importance === 'high' || activity.importance === 'critical') return <AlertTriangle size={15} />;
  return <Settings2 size={15} />;
}

function iconClass(activity: WorkspaceActivity): string {
  if (activity.importance === 'critical') return 'bg-red-500/20 text-red-700 dark:text-red-300';
  if (activity.importance === 'high') return 'bg-orange-500/20 text-orange-700 dark:text-orange-300';
  if (activity.actor_type === 'ai') return 'bg-violet-500/20 text-violet-300';
  if (activity.actor_type === 'user') return 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300';
  if (isOrderEvent(activity.event_type)) return 'bg-sky-500/20 text-sky-700 dark:text-sky-300';
  return 'bg-[var(--surface-hover)] text-[var(--text-secondary)]';
}

function formatDateHeader(value: string): string {
  const date = new Date(value);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((today.getTime() - target.getTime()) / 86_400_000);
  if (diff === 0) return 'Hari ini';
  if (diff === 1) return 'Semalam';
  return date.toLocaleDateString('ms-MY', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function hasDetails(activity: WorkspaceActivity): boolean {
  return Object.keys(activity.old_value ?? {}).length > 0 || Object.keys(activity.new_value ?? {}).length > 0;
}

function AiEvidence({ activity }: { activity: WorkspaceActivity }) {
  if (activity.actor_type !== 'ai') return null;
  const evidence = activity.metadata?.decision_evidence;
  if (!evidence || typeof evidence !== 'object') return null;
  const record = evidence as Record<string, unknown>;
  const messages = Array.isArray(record.latest_inbound)
    ? record.latest_inbound.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    : [];
  const signals = record.matched_signals && typeof record.matched_signals === 'object'
    ? record.matched_signals as Record<string, unknown>
    : {};

  return (
    <div className="mt-2 rounded-lg border border-violet-500/20 bg-violet-500/5 p-2.5 text-[10px] text-[#c8b8f8]">
      <p className="mb-1 font-semibold uppercase tracking-wide text-violet-300">Rujukan keputusan AI</p>
      <p>Asas: {record.decision_basis === 'authoritative_order' ? 'status order yang linked' : 'mesej conversation'}</p>
      {Boolean(signals.shipping_question) && typeof signals.shipping_question === 'object' && (
        <p className="mt-1">Padanan shipping: “{String((signals.shipping_question as Record<string, unknown>).text ?? '')}”</p>
      )}
      {messages.length > 0 && (
        <div className="mt-1 space-y-0.5 text-[var(--text-secondary)]">
          {messages.map((message, index) => (
            <p key={String(message.message_id ?? index)}>Mesej: “{String(message.text ?? '')}”</p>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityRow({ activity }: { activity: WorkspaceActivity }) {
  const [expanded, setExpanded] = useState(false);
  const details = hasDetails(activity);

  return (
    <div className="relative flex gap-3 pb-5">
      <div className="absolute left-[15px] top-8 bottom-0 w-px bg-[var(--surface-hover)]" />
      <div className={`relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${iconClass(activity)}`}>
        {eventIcon(activity)}
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium leading-relaxed text-[var(--text)]">{activity.summary}</p>
          {details && (
            <button
              onClick={() => setExpanded((value) => !value)}
              className="flex-shrink-0 rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              aria-label={expanded ? 'Tutup detail' : 'Lihat detail'}
            >
              {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[var(--text-secondary)]">
          <span className="inline-flex items-center gap-1"><CircleUserRound size={10} />{activity.actor_label}</span>
          <span>{formatTime(activity.created_at)}</span>
          {activity.source && <span className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5">{activity.source}</span>}
        </div>
        {expanded && (
          <>
          <AiEvidence activity={activity} />
          <div className="mt-2 space-y-2 rounded-lg border border-[var(--border)] bg-[var(--canvas)] p-2.5 text-[10px] text-[var(--text-secondary)]">
            {Object.keys(activity.old_value ?? {}).length > 0 && (
              <div>
                <p className="mb-1 font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Sebelum</p>
                <pre className="whitespace-pre-wrap break-words font-mono">{JSON.stringify(activity.old_value, null, 2)}</pre>
              </div>
            )}
            {Object.keys(activity.new_value ?? {}).length > 0 && (
              <div>
                <p className="mb-1 font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Selepas</p>
                <pre className="whitespace-pre-wrap break-words font-mono">{JSON.stringify(activity.new_value, null, 2)}</pre>
              </div>
            )}
          </div>
          </>
        )}
      </div>
    </div>
  );
}

export function ActivityWorkspaceTab({ activities, loading }: Props) {
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const filtered = useMemo(() => activities.filter((activity) => matchesFilter(activity, filter)), [activities, filter]);

  const grouped = useMemo(() => {
    const groups: Array<{ date: string; activities: WorkspaceActivity[] }> = [];
    for (const activity of filtered) {
      const key = new Date(activity.created_at).toLocaleDateString('en-CA');
      const current = groups[groups.length - 1];
      if (!current || current.date !== key) groups.push({ date: key, activities: [activity] });
      else current.activities.push(activity);
    }
    return groups;
  }, [filtered]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-1 overflow-x-auto border-b border-[var(--border)] px-3 py-2">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            onClick={() => setFilter(item.id)}
            className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              filter === item.id ? 'bg-[#00a884] text-white' : 'bg-[var(--surface-muted)] text-[var(--text-secondary)] hover:text-white'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {loading && activities.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-[var(--text-secondary)]"><History size={16} className="animate-pulse" />Memuatkan aktiviti…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-[var(--text-secondary)]">
            <History size={28} strokeWidth={1.5} />
            <p className="text-xs">Belum ada aktiviti untuk filter ini.</p>
          </div>
        )}
        {grouped.map((group) => (
          <div key={group.date}>
            <p className="mb-3 mt-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">{formatDateHeader(group.activities[0].created_at)}</p>
            {group.activities.map((activity) => <ActivityRow key={activity.id} activity={activity} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

