import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const hostname = (() => {
  try { return url ? new URL(url).hostname : null; } catch { return null; }
})();

if (typeof window !== 'undefined') {
  console.info('[supabase] hostname:', hostname, '| urlValid:', Boolean(hostname), '| keyConfigured:', Boolean(key));
}

export const supabase = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
