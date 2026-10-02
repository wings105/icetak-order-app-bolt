import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

const WASAPFLOW_SCHEME = 'wasapflow-media://';
const STORAGE_SCHEME = 'storage://';
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const CACHE_SAFETY_WINDOW_MS = 5 * 60 * 1000;

type CacheEntry = {
  url: string;
  expiresAt: number;
  revokeOnDelete?: boolean;
};

const cache = new Map<string, CacheEntry>();

function classify(rawUrl: string | undefined) {
  if (!rawUrl) return { kind: 'none' as const, value: null };
  if (rawUrl.startsWith(WASAPFLOW_SCHEME)) return { kind: 'wasapflow' as const, value: rawUrl.slice(WASAPFLOW_SCHEME.length) || null };
  if (rawUrl.startsWith(STORAGE_SCHEME)) return { kind: 'storage' as const, value: rawUrl.slice(STORAGE_SCHEME.length) || null };
  if (rawUrl.startsWith('blob:') || rawUrl.startsWith('data:') || rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) return { kind: 'direct' as const, value: rawUrl };
  return { kind: 'none' as const, value: null };
}

function getCached(cacheKey: string | null): string | null {
  if (!cacheKey) return null;
  const entry = cache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt > Date.now() + CACHE_SAFETY_WINDOW_MS) return entry.url;
  if (entry.revokeOnDelete) URL.revokeObjectURL(entry.url);
  cache.delete(cacheKey);
  return null;
}

function saveCache(cacheKey: string | null, entry: CacheEntry): void {
  if (!cacheKey) return;
  const old = cache.get(cacheKey);
  if (old?.revokeOnDelete && old.url !== entry.url) URL.revokeObjectURL(old.url);
  cache.set(cacheKey, entry);
}

export function useMediaUrl(rawUrl: string | undefined, enabled = true): { objectUrl: string | null; loading: boolean } {
  const media = classify(rawUrl);
  const cacheKey = media.kind === 'none' || !media.value ? null : `${media.kind}:${media.value}`;
  const cached = getCached(cacheKey);
  const direct = media.kind === 'direct' ? media.value : null;

  const [objectUrl, setObjectUrl] = useState<string | null>(direct ?? cached);
  const [loading, setLoading] = useState(Boolean(enabled && media.value && !direct && !cached));
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!media.value) {
      setObjectUrl(null);
      setLoading(false);
      return;
    }

    if (media.kind === 'direct') {
      setObjectUrl(media.value);
      setLoading(false);
      return;
    }

    const existing = getCached(cacheKey);
    if (existing) {
      setObjectUrl(existing);
      setLoading(false);
      return;
    }

    if (!enabled) {
      setObjectUrl(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    (async () => {
      try {
        if (media.kind === 'storage') {
          const { data, error } = await supabase.storage
            .from('whatsapp-media')
            .createSignedUrl(media.value!, SIGNED_URL_TTL_SECONDS);
          if (error || !data?.signedUrl) throw error ?? new Error('Media URL unavailable');
          saveCache(cacheKey, {
            url: data.signedUrl,
            expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
          });
          if (!ctrl.signal.aborted) {
            setObjectUrl(data.signedUrl);
            setLoading(false);
          }
          return;
        }

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) throw new Error('Session unavailable');
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
        const res = await fetch(`${supabaseUrl}/functions/v1/wasapflow-media?id=${encodeURIComponent(media.value!)}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`Media fetch failed (${res.status})`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        saveCache(cacheKey, {
          url,
          expiresAt: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
          revokeOnDelete: true,
        });
        if (!ctrl.signal.aborted) {
          setObjectUrl(url);
          setLoading(false);
        }
      } catch {
        if (!ctrl.signal.aborted) {
          setObjectUrl(null);
          setLoading(false);
        }
      }
    })();

    return () => ctrl.abort();
  }, [cacheKey, enabled, media.kind, media.value]);

  return { objectUrl, loading };
}

