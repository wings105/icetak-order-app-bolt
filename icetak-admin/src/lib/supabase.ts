import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const env = (import.meta as any).env || {};
const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
const key = env.VITE_SUPABASE_ANON_KEY
  || env.SUPABASE_ANON_KEY
  || env.VITE_SUPABASE_PUBLISHABLE_KEY
  || env.SUPABASE_PUBLISHABLE_KEY
  || '';

const sharedClient = (globalThis as typeof globalThis & {
  __ICETAK_SUPABASE__?: SupabaseClient;
}).__ICETAK_SUPABASE__;

export const supabase = sharedClient || createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});
