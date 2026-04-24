import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing Supabase env vars. Check .env has VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart `npm run dev`.',
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: 'cc.supabase.auth',
  },
});

// Ensure we have an anonymous session before any DB calls.
// Returns a promise that resolves once signed in. Safe to call repeatedly —
// if a session already exists, it's a no-op.
let _authReady;
export function authReady() {
  if (_authReady) return _authReady;
  _authReady = (async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) return session;
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
    return data.session;
  })();
  return _authReady;
}
