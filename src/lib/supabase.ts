import { createClient } from '@supabase/supabase-js';

const env = import.meta.env;

const supabaseUrl = (env.VITE_SUPABASE_URL || env.SUPABASE_URL) as string | undefined;
const supabaseKey = (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY) as string | undefined;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase URL or publishable/anon key. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY if Bolt does not expose SUPABASE_URL automatically.');
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
