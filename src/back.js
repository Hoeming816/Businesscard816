import { useEffect, useRef, useSyncExternalStore } from 'react';

// Pages with a Back button register it here so the bottom menu bar can offer
// the same Back. The most recently opened page wins (a meeting over its section).
let stack = [];
const subs = new Set();
const emit = () => subs.forEach((f) => f());

export function pushBack(entry) {
  stack = [...stack, entry];
  emit();
  return () => { stack = stack.filter((e) => e !== entry); emit(); };
}

/** The Back that the menu bar should run, or null when there is none. */
export function currentBack() { return stack.length ? stack[stack.length - 1] : null; }

/** Registers `onBack` while `on` is true; the menu bar shows Back while any is registered. */
export function useBack(onBack, on = true) {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => (on ? pushBack({ run: () => ref.current() }) : undefined), [on]);
}

export function useCurrentBack() {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, currentBack);
}
