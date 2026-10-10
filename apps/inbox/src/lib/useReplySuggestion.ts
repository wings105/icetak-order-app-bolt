import { useEffect, useRef, useState } from 'react';
import { Conversation } from '../types';
import { supabase } from './supabase';

export interface ReplySuggestion {
  conversation_id: string;
  latest_message_id: string | null;
  text: string;
  evidence_count: number;
  warnings: string[];
  order_reference: string | null;
  expires_at: string;
}
const QUIET_MS = 6000;
const REFRESH_MS = 60000;

export function useReplySuggestion(conversation: Conversation | null, ready: boolean) {
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<{ key: string; loading: boolean; result?: ReplySuggestion; error?: string }>({ key: '', loading: false });
  const seenInbound = useRef({ id: '', fingerprint: '', at: 0 });
  const id = conversation?.id || '';
  const messages = conversation?.messages || [];
  const latest = messages[messages.length - 1];
  const inboundMessages = messages.filter(m => m.direction === 'inbound');
  const inbound = inboundMessages[inboundMessages.length - 1];
  const inboundKey = inbound ? JSON.stringify([inbound.id, inbound.content, inbound.messageType]) : '';
  const sourceKey = JSON.stringify([id, messages.map(m => [m.id, m.content, m.messageType, m.status, m.timestamp.getTime()]), conversation?.customer, conversation?.metadata, conversation?.orderSession]);
  const key = `${sourceKey}:${refresh}:${ready}`;

  useEffect(() => {
    if (!id) return;
    const invalidate = () => setRefresh(n => n + 1);
    const channel = supabase.channel(`reply-suggestion-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_order_links', filter: `conversation_id=eq.${id}` }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'external_order_summaries' }, invalidate)
      .subscribe();
    const resume = () => { if (document.visibilityState === 'visible') invalidate(); };
    const timer = window.setInterval(resume, REFRESH_MS);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      void supabase.removeChannel(channel);
    };
  }, [id]);

  useEffect(() => {
    if (!id || !ready || !inbound || latest?.status === 'pending' || latest?.status === 'unknown') {
      setState({ key, loading: false });
      return;
    }
    if (seenInbound.current.id !== id) {
      seenInbound.current = { id, fingerprint: inboundKey, at: Math.min(Date.now(), inbound.timestamp.getTime()) };
    } else if (seenInbound.current.fingerprint !== inboundKey) {
      seenInbound.current = { id, fingerprint: inboundKey, at: Date.now() };
    }
    let cancelled = false;
    let expiryTimer: number | undefined;
    setState({ key, loading: true });
    const timer = window.setTimeout(async () => {
      if (document.visibilityState !== 'visible') { setState({ key, loading: false }); return; }
      try {
        const { data, error } = await supabase.functions.invoke('inbox-reply-suggest', { body: { conversation_id: id } });
        if (cancelled) return;
        if (error || data?.ok !== true) throw new Error('unavailable');
        // The backend re-reads chat after checking orders. Also require the loaded UI to match.
        if (data.conversation_id !== id || data.latest_message_id !== (latest?.id || null) || !Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= Date.now()) throw new Error('changed');
        setState({ key, loading: false, result: data });
        expiryTimer = window.setTimeout(() => setRefresh(n => n + 1), Math.max(0, Date.parse(data.expires_at) - Date.now()));
      } catch {
        if (!cancelled) setState({ key, loading: false, error: 'Cadangan belum tersedia.' });
      }
    }, Math.max(0, seenInbound.current.at + QUIET_MS - Date.now()));
    return () => { cancelled = true; window.clearTimeout(timer); if (expiryTimer) window.clearTimeout(expiryTimer); };
  }, [key]); // Stable content key cancels old customer/message responses immediately.

  const current: typeof state = state.key === key ? state : { key, loading: Boolean(id && ready && inbound) };
  return { ...current, refresh: () => setRefresh(n => n + 1) };
}
