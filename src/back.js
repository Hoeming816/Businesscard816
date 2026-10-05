import { useEffect, useRef, useSyncExternalStore } from 'react';

// Pages with a Back button register it here so the bottom menu bar can offer
// the same Back. The innermost page wins (a meeting over its section): a higher
// `level`, then the most recently opened. Levels matter when a section and a page
// inside it open together (a restored section), since React registers children first.
let stack = [];
const subs = new Set();
const emit = () => subs.forEach((f) => f());

export function pushBack(entry) {
  stack = [...stack, entry];
  emit();
  return () => { stack = stack.filter((e) => e !== entry); emit(); };
}

/** The Back that the menu bar should run, or null when there is none. */
export function currentBack() {
  let top = null;
  for (const e of stack) if (!top || (e.level || 0) >= (top.level || 0)) top = e;
  return top;
}

/** Registers `onBack` while `on` is true; the menu bar shows Back while any is registered. */
export function useBack(onBack, on = true, level = 1) {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => (on ? pushBack({ run: () => ref.current(), level }) : undefined), [on, level]);
}

export function useCurrentBack() {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, currentBack);
}
