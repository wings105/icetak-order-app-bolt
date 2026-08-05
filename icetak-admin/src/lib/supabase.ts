import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const sharedClient = (globalThis as typeof globalThis & {
  __ICETAK_SUPABASE__?: SupabaseClient;
}).__ICETAK_SUPABASE__;

export const supabase = sharedClient || createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});
