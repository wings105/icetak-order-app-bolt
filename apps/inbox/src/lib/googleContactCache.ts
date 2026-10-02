import { useEffect, useMemo, useState } from 'react';
import type { Conversation } from '../types';
import { supabase } from './supabase';

export interface GoogleContactCacheRow {
  id: string;
  google_contact_id?: string | null;
  display_name: string;
  given_name?: string | null;
  family_name?: string | null;
  phone_raw: string;
  phone_normalized: string;
  email?: string | null;
  company?: string | null;
  last_synced_at: string;
}

export function normalizePhone(value?: string | null) {
  let digits = String(value ?? '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) digits = `60${digits.slice(1)}`;
  else if (!digits.startsWith('60') && digits.length >= 9 && digits.length <= 10) digits = `60${digits}`;
  return digits;
}

const selectFields = 'id,google_contact_id,display_name,given_name,family_name,phone_raw,phone_normalized,email,company,last_synced_at';

export function useGoogleContactNames(conversations: Conversation[]) {
  const [byPhone, setByPhone] = useState<Record<string, GoogleContactCacheRow>>({});
  const phones = useMemo(() => Array.from(new Set(conversations.map((conversation) => normalizePhone(conversation.customer.phone)).filter(Boolean))), [conversations]);
  const key = phones.join('|');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (phones.length === 0) {
        setByPhone({});
        return;
      }
      const { data, error } = await supabase
        .from('google_contacts_cache')
        .select(selectFields)
        .in('phone_normalized', phones)
        .order('last_synced_at', { ascending: false });
      if (cancelled || error) return;
      const next: Record<string, GoogleContactCacheRow> = {};
      for (const row of (data ?? []) as GoogleContactCacheRow[]) if (!next[row.phone_normalized]) next[row.phone_normalized] = row;
      setByPhone(next);
    }
    void load();
    return () => { cancelled = true; };
  }, [key]);

  return byPhone;
}

export async function searchGoogleContactCache(query: string) {
  const q = query.trim();
  let builder = supabase.from('google_contacts_cache').select(selectFields).order('display_name').limit(80);
  if (q) {
    const normalized = normalizePhone(q);
    builder = builder.or(`display_name.ilike.%${q}%,phone_raw.ilike.%${q}%,phone_normalized.ilike.%${normalized || q}%`);
  }
  const { data, error } = await builder;
  if (error) throw error;
  return (data ?? []) as GoogleContactCacheRow[];
}

export async function getGoogleContactCacheByPhone(phone: string) {
  const phoneNormalized = normalizePhone(phone);
  if (!phoneNormalized) return null;
  const { data, error } = await supabase
    .from('google_contacts_cache')
    .select(selectFields)
    .eq('phone_normalized', phoneNormalized)
    .order('last_synced_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as GoogleContactCacheRow | null;
}

export async function saveGoogleContactCache(input: Partial<GoogleContactCacheRow> & { display_name: string; phone_raw: string }) {
  const displayName = input.display_name.trim();
  const phoneRaw = input.phone_raw.trim();
  const phoneNormalized = normalizePhone(phoneRaw);
  if (!displayName) throw new Error('Nama contact diperlukan.');
  if (!phoneNormalized) throw new Error('Nombor telefon diperlukan.');
  const payload = {
    google_contact_id: input.google_contact_id?.trim() || null,
    display_name: displayName,
    given_name: input.given_name?.trim() || null,
    family_name: input.family_name?.trim() || null,
    phone_raw: phoneRaw,
    phone_normalized: phoneNormalized,
    email: input.email?.trim() || null,
    company: input.company?.trim() || null,
    source: 'google_contacts',
    raw_payload: { source: 'unified_inbox_manual_cache', google_contact_id: input.google_contact_id ?? null, display_name: displayName, phone_raw: phoneRaw },
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (input.id) {
    const { error } = await supabase.from('google_contacts_cache').update(payload).eq('id', input.id);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from('google_contacts_cache').insert(payload);
  if (error) throw error;
}

export async function deleteGoogleContactCache(id: string) {
  const { error } = await supabase.from('google_contacts_cache').delete().eq('id', id);
  if (error) throw error;
}

