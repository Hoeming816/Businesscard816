import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakeStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
};

describe('Keep me signed in', () => {
  let mod;
  beforeEach(async () => {
    vi.resetModules();
    globalThis.localStorage = fakeStorage();
    globalThis.sessionStorage = fakeStorage();
    mod = await import('./supabase.js');
  });

  it('keeps the session only for this visit by default', () => {
    mod.authStorage.setItem('sb-x-auth-token', 'tok');
    expect(sessionStorage.getItem('sb-x-auth-token')).toBe('tok');
    expect(localStorage.getItem('sb-x-auth-token')).toBeNull();
  });

  it('keeps the session across visits when ticked, until turned off', () => {
    mod.setKeepSignedIn(true);
    mod.authStorage.setItem('sb-x-auth-token', 'tok');
    expect(localStorage.getItem('sb-x-auth-token')).toBe('tok');
    expect(mod.authStorage.getItem('sb-x-auth-token')).toBe('tok');
    mod.authStorage.removeItem('sb-x-auth-token');
    mod.setKeepSignedIn(false);
    expect(localStorage.getItem('sb-x-auth-token')).toBeNull();
    expect(localStorage.getItem('nomiqo.keepSignedIn')).toBeNull();
  });

  it('drops a leftover saved session on start-up unless kept', async () => {
    localStorage.setItem('sb-x-auth-token', 'old');
    vi.resetModules();
    await import('./supabase.js');
    expect(localStorage.getItem('sb-x-auth-token')).toBeNull();

    localStorage.setItem('nomiqo.keepSignedIn', '1');
    localStorage.setItem('sb-x-auth-token', 'kept');
    vi.resetModules();
    const again = await import('./supabase.js');
    expect(again.authStorage.getItem('sb-x-auth-token')).toBe('kept');
  });
});
