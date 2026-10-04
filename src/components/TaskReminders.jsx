import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context.js';
import { toISODate } from '../filters.js';
import { completion, dueReminders, formatTime, reminderBoard, reminderText } from '../todo.js';
import { Icon } from './ui.jsx';

const SHOWN_KEY = 'nomiqo.remindersShown';
const CHECK_MS = 20 * 1000;

const loadShown = () => { try { return new Set(JSON.parse(localStorage.getItem(SHOWN_KEY) || '[]')); } catch { return new Set(); } };
const saveShown = (set) => { try { localStorage.setItem(SHOWN_KEY, JSON.stringify([...set].slice(-300))); } catch { /* per-device only */ } };

// Reminders put away with "OK" on this device; a later reminder for the same task shows again.
const DISMISSED_KEY = 'nomiqo.remindersDismissed';
const DISMISS_EVENT = 'nomiqo-reminders-dismissed';
const loadDismissed = () => { try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]')); } catch { return new Set(); } };

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
        r.keys.forEach((k) => shown.add(k));
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

/** Reminders that have gone off (and the ones still to come today), kept up to date every half minute. App shares it as `reminders`. */
export function useReminderBoard(tasks) {
  const [now, setNow] = useState(() => new Date());
  const [dismissed, setDismissed] = useState(loadDismissed);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const id = setInterval(tick, 30 * 1000);
    const onDismiss = () => setDismissed(loadDismissed());
    window.addEventListener(DISMISS_EVENT, onDismiss);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); window.removeEventListener(DISMISS_EVENT, onDismiss); document.removeEventListener('visibilitychange', tick); };
  }, []);
  const dismiss = (key) => {
    const set = loadDismissed();
    set.add(key);
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set].slice(-300))); } catch { /* per-device only */ }
    setDismissed(set);
    window.dispatchEvent(new Event(DISMISS_EVENT));
  };
  return { ...reminderBoard(tasks, now, dismissed), now, dismiss };
}

/** The reminders list on the home page and in Notifications: tick when done, OK to put one away. */
export function ReminderList({ board, showLater = true }) {
  const { api, toast, upsertTask } = useApp();
  const [busy, setBusy] = useState('');
  const today = toISODate(board.now);
  const done = async (task) => {
    setBusy(task.id);
    try {
      upsertTask(await api.updateTask(task.id, completion(task, today)));
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };
  const later = showLater ? board.later : [];
  if (!board.active.length && !later.length) return null;
  return (
    <ul className="reminder-list">
      {board.active.map((r) => (
        <li key={r.key} className="reminder-item">
          <span className="reminder-icon" aria-hidden="true"><Icon name="bell" size={17} /></span>
          <span className="grow">
            <strong>{r.task.title}</strong>
            <span className="block small muted">{reminderText(r.task, today) || 'Reminder'}</span>
          </span>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy === r.task.id} onClick={() => done(r.task)}>
            <Icon name="check" size={15} /> Done
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => board.dismiss(r.key)} aria-label={`OK, hide the reminder for ${r.task.title}`}>OK</button>
        </li>
      ))}
      {later.map((r) => (
        <li key={r.key} className="reminder-item is-later">
          <span className="reminder-icon" aria-hidden="true"><Icon name="clock" size={17} /></span>
          <span className="grow">
            {r.task.title}
            <span className="block small muted">Reminder at {formatTime(`${String(r.at.getHours()).padStart(2, '0')}:${String(r.at.getMinutes()).padStart(2, '0')}`)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
