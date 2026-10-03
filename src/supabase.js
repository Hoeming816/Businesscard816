import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(url && anonKey);

// The sign-in lasts only while the app (or browser tab) stays open: the session
// lives in sessionStorage, so closing the app signs the person out.
const memory = new Map();
const sessionStore = {
  getItem(k) { try { return sessionStorage.getItem(k); } catch { return memory.get(k) ?? null; } },
  setItem(k, v) { try { sessionStorage.setItem(k, v); } catch { memory.set(k, v); } },
  removeItem(k) { try { sessionStorage.removeItem(k); } catch { memory.delete(k); } },
};

// Sessions saved by earlier versions in localStorage would otherwise linger; drop them.
try {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) localStorage.removeItem(k);
  }
} catch { /* storage unavailable */ }

export const supabase = createClient(url || 'http://localhost:54321', anonKey || 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, storage: sessionStore },
});

export const USERNAME_DOMAIN = import.meta.env.VITE_USERNAME_DOMAIN || 'users.cardfile.app';
