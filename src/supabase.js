import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(url && anonKey);

// By default the sign-in lasts only while the app (or browser tab) stays open:
// the session lives in sessionStorage, so closing the app signs the person out.
// With "Keep me signed in" ticked it lives in localStorage instead and survives
// closing the app, until the person signs out.
const KEEP_KEY = 'nomiqo.keepSignedIn';
const keep = () => { try { return localStorage.getItem(KEEP_KEY) === '1'; } catch { return false; } };
export function setKeepSignedIn(on) {
  try { if (on) localStorage.setItem(KEEP_KEY, '1'); else localStorage.removeItem(KEEP_KEY); } catch { /* storage unavailable */ }
}
const memory = new Map();
const store = () => (keep() ? localStorage : sessionStorage);
export const authStorage = {
  getItem(k) { try { return store().getItem(k); } catch { return memory.get(k) ?? null; } },
  setItem(k, v) { try { store().setItem(k, v); } catch { memory.set(k, v); } },
  removeItem(k) { try { store().removeItem(k); } catch { memory.delete(k); } },
};

// A session left in localStorage without "Keep me signed in" (older versions
// stored it there) would otherwise linger; drop it.
try {
  if (!keep()) {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) localStorage.removeItem(k);
    }
  }
} catch { /* storage unavailable */ }

export const supabase = createClient(url || 'http://localhost:54321', anonKey || 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, storage: authStorage },
});

export const USERNAME_DOMAIN = import.meta.env.VITE_USERNAME_DOMAIN || 'users.cardfile.app';
