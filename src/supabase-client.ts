import { createClient } from '@supabase/supabase-js';

const env = (import.meta as any).env || {};

export const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
export const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase frontend environment is not configured.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
