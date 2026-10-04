import { useEffect, useRef } from 'react';
import { useApp } from '../context.js';
import { toISODate } from '../filters.js';
import { dueReminders, reminderText } from '../todo.js';

const SHOWN_KEY = 'nomiqo.remindersShown';
const CHECK_MS = 20 * 1000;

const loadShown = () => { try { return new Set(JSON.parse(localStorage.getItem(SHOWN_KEY) || '[]')); } catch { return new Set(); } };
const saveShown = (set) => { try { localStorage.setItem(SHOWN_KEY, JSON.stringify([...set].slice(-300))); } catch { /* per-device only */ } };

export const canNotify = () => typeof window !== 'undefined' && 'Notification' in window;

/**
 * Task reminders while Nomiqo is open: a message in the app and, when allowed,
 * a phone or computer notification. Each reminder shows once per device.
 */
export default function TaskReminders() {
  const { tasks, toast } = useApp();
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  useEffect(() => {
    const check = () => {
      const shown = loadShown();
      const now = new Date();
      const due = dueReminders(tasksRef.current, now, shown);
      if (!due.length) return;
      const today = toISODate(now);
      for (const r of due) {
        shown.add(r.key);
        const body = reminderText(r.task, today);
        toast(`⏰ ${r.task.title}${body ? `: ${body.toLowerCase()}` : ''}`);
        if (canNotify() && Notification.permission === 'granted') {
          try {
            new Notification(r.task.title, { body, tag: r.key, icon: '/nomiqo-mark-512.png' });
          } catch { /* Android Chrome only notifies from a service worker; the in-app message still shows */ }
        }
      }
      saveShown(shown);
    };
    check();
    const id = setInterval(check, CHECK_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [toast]);

  return null;
}
