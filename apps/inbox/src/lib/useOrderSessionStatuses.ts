import { useEffect, useMemo, useRef, useState } from 'react';
import type { Conversation, OrderSessionSnapshot } from '../types';
import { supabase } from './supabase';

type SessionMap = Record<string, OrderSessionSnapshot>;
type SessionTarget = { conversation_id: string; phone: string | null };

const BATCH_SIZE = 1000;
const REFRESH_INTERVAL_MS = 30_000;

function sameSessions(previous: SessionMap, next: SessionMap): boolean {
  const keys = Object.keys(next);
  if (keys.length !== Object.keys(previous).length) return false;

  return keys.every((id) => {
    const before = previous[id];
    const after = next[id];
    return Boolean(before)
      && before.state === after.state
      && before.session_id === after.session_id
      && before.session_status === after.session_status
      && before.opened_at === after.opened_at
      && before.closed_at === after.closed_at
      && before.closed_reason === after.closed_reason
      && before.order_no === after.order_no;
  });
}

export function useOrderSessionStatuses(conversations: Conversation[]): SessionMap {
  const [sessions, setSessions] = useState<SessionMap>({});
  const targets = useMemo<SessionTarget[]>(() => conversations
    .filter((conversation) => conversation.channel === 'whatsapp')
    .map((conversation) => ({
      conversation_id: conversation.id,
      phone: conversation.customer.phone ?? null,
    })), [conversations]);

  // Message activity changes the list order frequently. A stable target key
  // prevents a new network request for every incoming or outgoing message.
  const targetKey = useMemo(() => targets
    .map(({ conversation_id, phone }) => `${conversation_id}:${phone ?? ''}`)
    .sort()
    .join('|'), [targets]);
  const latestTargets = useRef(targets);
  latestTargets.current = targets;

  useEffect(() => {
    if (!targetKey) {
      setSessions({});
      return;
    }

    let current = true;
    let inFlight = false;

    async function refresh() {
      if (inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;

      try {
        const currentTargets = latestTargets.current;
        const batches: SessionTarget[][] = [];
        for (let index = 0; index < currentTargets.length; index += BATCH_SIZE) {
          batches.push(currentTargets.slice(index, index + BATCH_SIZE));
        }

        const responses = await Promise.all(batches.map((batch) =>
          supabase.functions.invoke<{ ok: boolean; sessions: SessionMap }>(
            'order-session-status',
            { body: { conversations: batch } },
          )));

        const next: SessionMap = {};
        for (const response of responses) {
          if (response.error || !response.data?.ok || !response.data.sessions) {
            throw response.error ?? new Error('Order session status unavailable');
          }
          Object.assign(next, response.data.sessions);
        }

        if (current) setSessions((previous) => sameSessions(previous, next) ? previous : next);
      } catch (error) {
        // The inbox must keep working if the independent order system is down.
        console.warn('Unable to refresh order session badges', error);
      } finally {
        inFlight = false;
      }
    }

    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    void refresh();

    return () => {
      current = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [targetKey]);

  return sessions;
}

