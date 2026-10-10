import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface RealtimeReloaderProps {
  channelName: string;
  onConversationChange: () => void;
  onMessageChange?: (conversationId: string | null) => void;
}

// Realtime handles healthy tabs. Poll only while the channel is unavailable.
const FALLBACK_SYNC_MS = 60_000;

export function RealtimeReloader({ channelName, onConversationChange, onMessageChange }: RealtimeReloaderProps) {
  const [isStale, setIsStale] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conversationCallbackRef = useRef(onConversationChange);
  const messageCallbackRef = useRef(onMessageChange);
  const pendingMessageConversationRef = useRef<string | null>(null);
  const realtimeHealthyRef = useRef(false);

  useEffect(() => { conversationCallbackRef.current = onConversationChange; }, [onConversationChange]);
  useEffect(() => { messageCallbackRef.current = onMessageChange; }, [onMessageChange]);

  useEffect(() => {
    const runRefresh = (includeMessages = true, conversationId: string | null = null) => {
      if (conversationId) pendingMessageConversationRef.current = conversationId;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        conversationCallbackRef.current();
        if (includeMessages) messageCallbackRef.current?.(pendingMessageConversationRef.current);
        pendingMessageConversationRef.current = null;
        setIsStale(false);
      }, 120);
    };

    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => runRefresh(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (payload) => {
        const row = (payload.new && typeof payload.new === 'object' ? payload.new : payload.old) as Record<string, unknown>;
        runRefresh(true, row?.conversation_id ? String(row.conversation_id) : null);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          realtimeHealthyRef.current = true;
          setIsStale(false);
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          realtimeHealthyRef.current = false;
          setIsStale(true);
        }
      });

    const refreshOnResume = () => {
      if (document.visibilityState === 'visible') runRefresh(true);
    };
    const fallbackTimer = window.setInterval(() => {
      if (!realtimeHealthyRef.current && document.visibilityState === 'visible') runRefresh(true);
    }, FALLBACK_SYNC_MS);

    window.addEventListener('online', refreshOnResume);
    document.addEventListener('visibilitychange', refreshOnResume);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      window.clearInterval(fallbackTimer);
      window.removeEventListener('online', refreshOnResume);
      document.removeEventListener('visibilitychange', refreshOnResume);
      void supabase.removeChannel(channel);
    };
  }, [channelName]);

  function forceReload() {
    setRefreshing(true);
    conversationCallbackRef.current();
    messageCallbackRef.current?.(null);
    setIsStale(false);
    window.setTimeout(() => setRefreshing(false), 500);
  }

  if (!isStale) return null;

  return (
    <button
      type="button"
      onClick={forceReload}
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+12px)] right-3 z-[100] flex items-center gap-2 rounded-full bg-[var(--surface-muted)] px-3 py-2 text-xs text-[var(--text)] shadow-lg ring-1 ring-[#3b4a54]"
      aria-label="Muat semula mesej"
    >
      <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
      Sync semula
    </button>
  );
}

