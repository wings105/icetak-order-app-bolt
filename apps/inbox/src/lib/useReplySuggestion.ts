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
type Cached = { result?: ReplySuggestion; error?: string };
type Link = { external_order_id?: string; order_system_order_id?: string; order_no?: string };
const QUIET_MS = 6000, COOLDOWN_MS = 30000, CACHE_SIZE = 30;
// Memory only, cleared on account changes. No chat text in localStorage.
const cache = new Map<string, Cached>();
const cooldown = new Map<string, number>();
const orderVersions = new Map<string, number>();
let account = '', blockedUntil = 0, failures = 0;
let running: Promise<void> | null = null;
const remember = (key: string, value: Cached) => {
  cache.delete(key); cache.set(key, value);
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
};
const selectAccount = (id: string) => {
  if (account !== id) { account = id; cache.clear(); cooldown.clear(); orderVersions.clear(); blockedUntil = 0; failures = 0; }
};
const usefulOrder = (row: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(row).filter(([k]) => !['updated_at', 'last_synced_at', 'created_at'].includes(k))));

export function useReplySuggestion(conversation: Conversation | null, ready: boolean) {
  const [user, setUser] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [, setVersion] = useState(0);
  const [links, setLinks] = useState<{ id: string; rows: Link[] }>({ id: '', rows: [] });
  const [clock, setClock] = useState(Date.now());
  const [state, setState] = useState<{ key: string; loading: boolean } & Cached>({ key: '', loading: false });
  const seenInbound = useRef({ id: '', fingerprint: '', at: 0 });
  const orderChangedAt = useRef(0);
  const id = conversation?.id || '';
  const messages = conversation?.messages || [];
  const latest = messages[messages.length - 1];
  const inboundMessages = messages.filter(m => m.direction === 'inbound');
  const inbound = inboundMessages[inboundMessages.length - 1];
  const inboundKey = inbound ? JSON.stringify([inbound.id, inbound.content, inbound.messageType]) : '';
  // Delivery/read ticks and unread counters are not new reply evidence.
  const sourceKey = JSON.stringify([user, id, inboundMessages.slice(-5).map(m => [m.id, m.content, m.messageType, m.timestamp.getTime()]),
    latest && [latest.id, latest.content, latest.messageType, ['pending', 'unknown', 'failed'].includes(latest.status || '') ? latest.status : 'settled'],
    conversation?.customer.id, conversation?.customer.phone, conversation?.customer.shopeeUsername,
    conversation?.externalCustomerId, conversation?.orderId, conversation?.orderSession]);
  const contextKey = `${sourceKey}:${orderVersions.get(id) || 0}`;
  const key = `${contextKey}:${refresh}:${ready}`;

  useEffect(() => {
    let active = true;
    const update = (id: string) => { if (active) { selectAccount(id); setUser(id); } };
    void supabase.auth.getSession().then(({ data }) => update(data.session?.user.id || ''));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => update(session?.user.id || ''));
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!id || !user) return;
    let active = true;
    orderChangedAt.current = 0;
    const invalidate = () => {
      orderVersions.set(id, (orderVersions.get(id) || 0) + 1);
      orderChangedAt.current = Date.now();
      setVersion(n => n + 1);
    };
    const loadLinks = async () => {
      const { data, error } = await supabase.from('conversation_order_links')
        .select('external_order_id,order_system_order_id,order_no').eq('conversation_id', id).is('unlinked_at', null).limit(20);
      if (active && !error) setLinks({ id, rows: data || [] });
    };
    void loadLinks(); // One bounded read per selection; no periodic link reload.
    const channel = supabase.channel(`reply-suggestion-links-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_order_links', filter: `conversation_id=eq.${id}` }, () => { invalidate(); void loadLinks(); })
      .subscribe();
    return () => { active = false; void supabase.removeChannel(channel); };
  }, [id, user]);

  const orderFilters = new Set<string>();
  const addFilter = (column: string, value?: string) => { if (value && /^[\w+ -]+$/.test(value)) orderFilters.add(`${column}=eq.${value}`); };
  addFilter('order_no', conversation?.orderId);
  addFilter('order_no', conversation?.orderSession?.order_no || undefined);
  addFilter('shopee_username', conversation?.customer.shopeeUsername);
  const phone = conversation?.customer.phone?.replace(/\D/g, '');
  addFilter('customer_phone_normalized', phone?.startsWith('0') ? `6${phone}` : phone);
  if (conversation?.channel === 'shopee' && /^\d+$/.test(conversation.externalCustomerId || '')) addFilter('shopee_buyer_id', conversation.externalCustomerId);
  if (links.id === id) for (const link of links.rows) {
    addFilter('external_order_id', link.external_order_id); addFilter('order_system_order_id', link.order_system_order_id); addFilter('order_no', link.order_no);
  }
  const filtersKey = JSON.stringify([...orderFilters].sort());
  useEffect(() => {
    if (!id || !user) return;
    const filters: string[] = JSON.parse(filtersKey);
    if (!filters.length) return;
    const channel = supabase.channel(`reply-suggestion-orders-${id}`);
    const snapshots = new Map<string, string>();
    for (const filter of filters) channel.on('postgres_changes', { event: '*', schema: 'public', table: 'external_order_summaries', filter }, payload => {
      // Several subscriptions can match one row. Coalesce those notifications.
      const newer = payload.new as Record<string, unknown>, older = payload.old as Record<string, unknown>;
      const rowId = String(newer.id || older.id || newer.order_no || older.order_no || '');
      const fingerprint = usefulOrder(payload.new);
      const previous = snapshots.get(rowId);
      snapshots.set(rowId, fingerprint);
      if (snapshots.size > 100) snapshots.delete(snapshots.keys().next().value!);
      // With RLS, UPDATE old rows may contain only their primary key.
      if (payload.eventType === 'UPDATE' && (fingerprint === previous || fingerprint === usefulOrder(payload.old))) return;
      const now = Date.now();
      if (now - orderChangedAt.current < 100) return;
      orderChangedAt.current = now;
      orderVersions.set(id, (orderVersions.get(id) || 0) + 1);
      setVersion(n => n + 1);
    });
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [id, user, filtersKey]);

  useEffect(() => {
    if (!id || !user || !ready || !inbound || latest?.status === 'pending' || latest?.status === 'unknown') {
      setState({ key, loading: false }); return;
    }
    const existing = cache.get(contextKey);
    if (existing) { setState({ key, loading: false, ...existing }); return; }
    if (seenInbound.current.id !== id) seenInbound.current = { id, fingerprint: inboundKey, at: Math.min(Date.now(), inbound.timestamp.getTime()) };
    else if (seenInbound.current.fingerprint !== inboundKey) seenInbound.current = { id, fingerprint: inboundKey, at: Date.now() };
    let cancelled = false;
    setState({ key, loading: true });
    const timer = window.setTimeout(async () => {
      if (document.visibilityState !== 'visible') { setState({ key, loading: false, error: 'Semak semula untuk cadangan.' }); return; }
      // Serialize this tab, and drop abandoned selections before making a request.
      while (running) { await running; if (cancelled) return; }
      if (cancelled || account !== user) return;
      const completed = cache.get(contextKey);
      if (completed) { setState({ key, loading: false, ...completed }); return; }
      const next = Math.max(blockedUntil, cooldown.get(id) || 0);
      if (next > Date.now()) { setState({ key, loading: false, error: 'Cadangan dijeda. Semak semula kemudian.' }); setClock(Date.now()); return; }
      let release!: () => void;
      running = new Promise<void>(resolve => { release = resolve; });
      cooldown.set(id, Date.now() + COOLDOWN_MS);
      let failureMessage = 'Cadangan belum tersedia. Semak semula kemudian.';
      try {
        const { data, error } = await supabase.functions.invoke('inbox-reply-suggest', { body: { conversation_id: id } });
        if (account !== user) return;
        if (error || data?.ok !== true) {
          let detail = data;
          const response = error && 'context' in error ? error.context : null;
          if (response instanceof Response) detail = await response.clone().json().catch(() => null);
          if (response instanceof Response && response.status === 429) failureMessage = 'Cadangan dijeda. Semak semula kemudian.';
          failures += 1;
          const backoff = Math.min(300000, COOLDOWN_MS * 2 ** Math.min(failures - 1, 4));
          blockedUntil = Math.max(blockedUntil, Date.now() + Math.max(backoff, Number(detail?.retry_after_seconds || 0) * 1000));
          throw new Error('unavailable');
        }
        if (data.conversation_id !== id || data.latest_message_id !== (latest?.id || null) || !Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= Date.now()) throw new Error('changed');
        failures = 0;
        remember(contextKey, { result: data });
        if (!cancelled) setState({ key, loading: false, result: data });
      } catch {
        if (account !== user) return;
        const failed = { error: failureMessage };
        remember(contextKey, failed);
        if (!cancelled) setState({ key, loading: false, ...failed });
      } finally {
        release(); running = null;
        if (!cancelled) setClock(Date.now());
      }
    }, Math.max(0, seenInbound.current.at + QUIET_MS - Date.now(), orderChangedAt.current + QUIET_MS - Date.now(), blockedUntil - Date.now(), (cooldown.get(id) || 0) - Date.now()));
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [key]);

  const current = state.key === key ? state : { key, loading: Boolean(id && user && ready && inbound) };
  const expires = current.result ? Date.parse(current.result.expires_at) : 0;
  const nextAllowed = Math.max(blockedUntil, cooldown.get(id) || 0);
  useEffect(() => {
    // These timers only repaint expiry/cooldown; they never refetch evidence.
    const deadline = [expires, nextAllowed].filter(t => t > Date.now()).sort((a, b) => a - b)[0];
    if (!deadline) return;
    const timer = window.setTimeout(() => setClock(Date.now()), Math.min(2147483647, Math.max(1, deadline - Date.now())));
    return () => window.clearTimeout(timer);
  }, [expires, nextAllowed, clock]);
  const expired = Boolean(expires && expires <= Math.max(clock, Date.now()));
  return {
    ...current, result: expired ? undefined : current.result,
    error: expired ? 'Cadangan tamat. Semak semula.' : current.error,
    canRefresh: !current.loading && nextAllowed <= Math.max(clock, Date.now()),
    refresh: () => { if (nextAllowed > Date.now() || current.loading) return; cache.delete(contextKey); setRefresh(n => n + 1); },
  };
}
