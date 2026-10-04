// To Do List logic: priorities, statuses, due dates, repeats, reminders,
// My Day, filtering and the Quick Add parser ("Call Peter tomorrow 10am").
// No React, no I/O: everything here is unit tested in todo.test.js.
// Dates are local YYYY-MM-DD strings and times local HH:MM, as stored.

import { addDays, addMonths, localDate, startOfWeek, toISODate } from './filters.js';

export const PRIORITIES = [
  { value: 'Urgent', tone: 'danger', rank: 0 },
  { value: 'High', tone: 'hot', rank: 1 },
  { value: 'Normal', tone: 'neutral', rank: 2 },
  { value: 'Low', tone: 'ok', rank: 3 },
];
const RANK = Object.fromEntries(PRIORITIES.map((p) => [p.value, p.rank]));
export const priorityTone = (p) => PRIORITIES.find((x) => x.value === p)?.tone || 'neutral';

export const STATUSES = [
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'done', label: 'Done' },
];
export const statusLabel = (s) => STATUSES.find((x) => x.value === s)?.label || 'To Do';

export const CATEGORIES = ['Work', 'Personal', 'Finance', 'Family', 'Health', 'Errands'];

/** Reminder choices, in minutes before the deadline. */
export const REMINDER_CHOICES = [
  { value: 0, label: 'At due time' },
  { value: 5, label: '5 minutes before' },
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 120, label: '2 hours before' },
  { value: 1440, label: '1 day before' },
  { value: 2880, label: '2 days before' },
  { value: 10080, label: '1 week before' },
];
export function reminderLabel(m) {
  const hit = REMINDER_CHOICES.find((c) => c.value === m);
  if (hit) return hit.label;
  if (m % 1440 === 0) return `${m / 1440} days before`;
  if (m % 60 === 0) return `${m / 60} hours before`;
  return `${m} minutes before`;
}

/** A task with no time is due at 09:00 as far as reminders go. */
export const DEFAULT_REMINDER_TIME = '09:00';

/**
 * Reminders picked for a new task from its priority: a timed task gets one at
 * the time and 15 minutes before, an Urgent or High one earlier warnings too.
 */
export function smartReminders(priority, hasTime) {
  const r = hasTime ? [15, 0] : [0];
  if (priority === 'High') r.unshift(hasTime ? 60 : 1440);
  if (priority === 'Urgent') r.unshift(1440, ...(hasTime ? [60] : []));
  return [...new Set(r)].sort((a, b) => b - a);
}

// ---------------------------------------------------------------------------
// Dates and times
// ---------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');
const isoDay = (iso) => new Date(`${iso}T00:00:00`).getDay(); // 0 = Sunday
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const hhmm = (t) => (t ? String(t).slice(0, 5) : '');
export const nowHHMM = (now) => `${pad(now.getHours())}:${pad(now.getMinutes())}`;

/** "10:00" -> "10am", "15:30" -> "3:30pm". */
export function formatTime(t) {
  if (!t) return '';
  const [h, m] = hhmm(t).split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 || 12;
  return m ? `${h12}:${pad(m)}${suffix}` : `${h12}${suffix}`;
}

/** "Today", "Tomorrow", "Yesterday", "Fri" (this coming week), else "10 Oct" (with the year when it isn't this year). */
export function formatDay(iso, today) {
  if (!iso) return '';
  if (iso === today) return 'Today';
  if (iso === addDays(today, 1)) return 'Tomorrow';
  if (iso === addDays(today, -1)) return 'Yesterday';
  if (iso > today && iso <= addDays(today, 6)) return WEEKDAY_SHORT[isoDay(iso)];
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTH_SHORT[m - 1]}${String(y) !== today.slice(0, 4) ? ` ${y}` : ''}`;
}

/** "Fri 2 Oct" (with the year when it isn't this year). */
export function formatLongDay(iso, today) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${WEEKDAY_SHORT[isoDay(iso)]} ${d} ${MONTH_SHORT[m - 1]}${String(y) !== String(today).slice(0, 4) ? ` ${y}` : ''}`;
}

export function dueLabel(task, today) {
  if (!task.due_on) return '';
  const day = formatDay(task.due_on, today);
  return task.due_time ? `${day} ${formatTime(task.due_time)}` : day;
}

export const isDone = (t) => t.status === 'done';

/** Missed: a dated task whose day has gone, or a timed one whose time has passed. */
export function isOverdue(task, now = new Date()) {
  if (isDone(task) || !task.due_on) return false;
  const today = toISODate(now);
  if (task.due_on < today) return true;
  if (task.due_on > today || !task.due_time) return false;
  return hhmm(task.due_time) < nowHHMM(now);
}

/** Whole days a task is late by (0 when due today). */
export function daysLate(task, today) {
  if (!task.due_on || task.due_on >= today) return 0;
  return Math.round((new Date(`${today}T00:00:00`) - new Date(`${task.due_on}T00:00:00`)) / 86400000);
}

// ---------------------------------------------------------------------------
// Repeats: { freq: daily | weekly | monthly | yearly, interval, days?: [0-6], day?: 1-31 }
// ---------------------------------------------------------------------------

export const REPEAT_PRESETS = [
  { value: '', label: 'Does not repeat' },
  { value: 'daily', label: 'Every day', repeat: { freq: 'daily', interval: 1 } },
  { value: 'weekdays', label: 'Every weekday (Mon to Fri)', repeat: { freq: 'weekly', interval: 1, days: [1, 2, 3, 4, 5] } },
  { value: 'weekly', label: 'Every week', repeat: { freq: 'weekly', interval: 1 } },
  { value: 'monthly', label: 'Every month', repeat: { freq: 'monthly', interval: 1 } },
  { value: 'yearly', label: 'Every year', repeat: { freq: 'yearly', interval: 1 } },
  { value: 'custom', label: 'Custom…' },
];

export function normaliseRepeat(r) {
  if (!r || !['daily', 'weekly', 'monthly', 'yearly'].includes(r.freq)) return null;
  const out = { freq: r.freq, interval: Math.min(99, Math.max(1, Math.round(Number(r.interval) || 1))) };
  if (r.freq === 'weekly' && Array.isArray(r.days)) {
    const days = [...new Set(r.days.map(Number).filter((d) => d >= 0 && d <= 6))].sort();
    if (days.length) out.days = days;
  }
  if (r.freq === 'monthly' && r.day >= 1 && r.day <= 31) out.day = Math.round(r.day);
  return out;
}

export function repeatPreset(r) {
  const n = normaliseRepeat(r);
  if (!n) return '';
  if (n.interval === 1) {
    if (n.freq === 'daily') return 'daily';
    if (n.freq === 'weekly' && !n.days) return 'weekly';
    if (n.freq === 'weekly' && n.days.join() === '1,2,3,4,5') return 'weekdays';
    if (n.freq === 'monthly') return 'monthly';
    if (n.freq === 'yearly') return 'yearly';
  }
  return 'custom';
}

const UNIT = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };
export function repeatLabel(r) {
  const n = normaliseRepeat(r);
  if (!n) return '';
  const preset = repeatPreset(n);
  if (preset === 'weekdays') return 'Every weekday';
  const every = n.interval === 1 ? `Every ${UNIT[n.freq]}` : `Every ${n.interval} ${UNIT[n.freq]}s`;
  if (n.freq === 'weekly' && n.days) {
    return `${every} on ${n.days.map((d) => WEEKDAY_SHORT[d]).join(', ')}`;
  }
  return n.interval === 1 && n.freq === 'daily' ? 'Every day' : every;
}

/** The occurrence after `iso`. */
export function nextDate(iso, repeat) {
  const r = normaliseRepeat(repeat);
  if (!r) return null;
  if (r.freq === 'daily') return addDays(iso, r.interval);
  if (r.freq === 'yearly') return addMonths(iso, 12 * r.interval);
  if (r.freq === 'monthly') {
    const next = addMonths(iso, r.interval);
    if (!r.day) return next;
    const last = new Date(Number(next.slice(0, 4)), Number(next.slice(5, 7)), 0).getDate();
    return `${next.slice(0, 8)}${pad(Math.min(r.day, last))}`;
  }
  if (!r.days) return addDays(iso, 7 * r.interval);
  // Weekly on chosen days; weeks run Monday to Sunday.
  const dow = isoDay(iso);
  const order = (d) => (d + 6) % 7; // Monday = 0
  const later = r.days.filter((d) => order(d) > order(dow)).sort((a, b) => order(a) - order(b));
  if (later.length) return addDays(iso, order(later[0]) - order(dow));
  const first = [...r.days].sort((a, b) => order(a) - order(b))[0];
  return addDays(startOfWeek(iso), 7 * r.interval + order(first));
}

/** The first date on or after `iso` that fits the repeat (for a new repeating task). */
export function firstDate(iso, repeat) {
  const r = normaliseRepeat(repeat);
  if (!r || r.freq !== 'weekly' || !r.days || r.days.includes(isoDay(iso))) return iso;
  for (let i = 1; i <= 7; i++) {
    const d = addDays(iso, i);
    if (r.days.includes(isoDay(d))) return d;
  }
  return iso;
}

/** Where a repeating task moves when it is done: its next date after today. */
export function rollForward(dueOn, repeat, today) {
  let d = nextDate(dueOn, repeat);
  for (let i = 0; d && d <= today && i < 2000; i++) d = nextDate(d, repeat);
  return d;
}

/** Dates in [from, to] a task falls on: its due date, and the repeats after it. */
export function occurrences(task, from, to) {
  if (!task.due_on || task.due_on > to) return [];
  if (!normaliseRepeat(task.repeat) || isDone(task)) return task.due_on >= from ? [task.due_on] : [];
  const out = [];
  let d = task.due_on;
  for (let i = 0; d && d <= to && i < 1000; i++) {
    if (d >= from) out.push(d);
    d = nextDate(d, task.repeat);
  }
  return out;
}

/** The changes that mark a task done: a repeating one moves on to its next date. */
export function completion(task, today) {
  if (normaliseRepeat(task.repeat) && task.due_on) {
    return {
      due_on: rollForward(task.due_on, task.repeat, today),
      status: 'todo',
      done_count: (task.done_count || 0) + 1,
      subtasks: (task.subtasks || []).map((s) => ({ ...s, done: false })),
    };
  }
  return { status: 'done' };
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

/** When each reminder goes off, as { at: Date, minutes, key }. */
export function reminderTimes(task) {
  if (isDone(task) || !task.due_on || !Array.isArray(task.reminders)) return [];
  const base = new Date(`${task.due_on}T${hhmm(task.due_time) || DEFAULT_REMINDER_TIME}:00`);
  return task.reminders.map((m) => ({
    at: new Date(base.getTime() - m * 60000),
    minutes: m,
    key: `${task.id}|${task.due_on}|${hhmm(task.due_time)}|${m}`,
  }));
}

/**
 * Reminders that are due now and not shown yet, one per task (the latest; `keys`
 * names every reminder it covers). One that went off while the app was closed
 * still shows if it was within `lookbackMin` minutes.
 */
export function dueReminders(tasks, now, shown, lookbackMin = 60) {
  const out = [];
  for (const t of tasks) {
    const due = reminderTimes(t).filter((r) => {
      const ms = now.getTime() - r.at.getTime();
      return ms >= 0 && ms <= lookbackMin * 60000 && !shown.has(r.key);
    });
    if (!due.length) continue;
    const latest = due.reduce((a, b) => (b.at > a.at ? b : a));
    out.push({ task: t, ...latest, keys: due.map((r) => r.key) });
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * For the home page and the bell: `active` holds tasks not done whose reminder has gone off
 * (the latest one per task, unless it was dismissed on this device); `later` holds tasks
 * whose first reminder is still to come today. Both sorted by time.
 */
export function reminderBoard(tasks, now, dismissed = new Set()) {
  const today = toISODate(now);
  const active = [];
  const later = [];
  for (const t of tasks) {
    const times = reminderTimes(t);
    if (!times.length) continue;
    const past = times.filter((r) => r.at <= now);
    if (past.length) {
      const latest = past.reduce((a, b) => (b.at > a.at ? b : a));
      if (!dismissed.has(latest.key)) active.push({ task: t, ...latest });
      continue;
    }
    const next = times.reduce((a, b) => (b.at < a.at ? b : a));
    if (toISODate(next.at) === today) later.push({ task: t, ...next });
  }
  const byTime = (a, b) => a.at - b.at;
  return { active: active.sort(byTime), later: later.sort(byTime) };
}

export function reminderText(task, today) {
  const due = dueLabel(task, today);
  return due ? `Due ${due.replace(/^Today /, 'today at ').replace(/^Today$/, 'today').replace(/^Tomorrow/, 'tomorrow')}` : '';
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export function compareTasks(a, b) {
  const da = a.due_on || '9999-99-99';
  const db = b.due_on || '9999-99-99';
  if (da !== db) return da < db ? -1 : 1;
  const ta = hhmm(a.due_time) || '99:99';
  const tb = hhmm(b.due_time) || '99:99';
  if (ta !== tb) return ta < tb ? -1 : 1;
  const pa = RANK[a.priority] ?? 2;
  const pb = RANK[b.priority] ?? 2;
  if (pa !== pb) return pa - pb;
  return String(a.created_at || '').localeCompare(String(b.created_at || ''));
}

/**
 * The earlier day an unfinished task is carried over from: its missed due date,
 * or the day it was put in My Day. Null when it isn't from an earlier day.
 */
export function carriedFrom(task, today) {
  if (isDone(task)) return null;
  const past = [task.due_on, task.my_day_on].filter((d) => d && d < today).sort();
  if (!past.length || task.due_on === today) return null;
  return past[0];
}

/**
 * My Day: unfinished tasks carried over from earlier days (marked with the day
 * they are from), what is due today or was added to today, and what was
 * finished today.
 */
export function myDay(tasks, now = new Date()) {
  const today = toISODate(now);
  const open = tasks.filter((t) => !isDone(t));
  const earlier = open.filter((t) => carriedFrom(t, today))
    .sort((a, b) => carriedFrom(a, today).localeCompare(carriedFrom(b, today)) || compareTasks(a, b));
  const todayList = open
    .filter((t) => !earlier.includes(t) && (t.due_on === today || t.my_day_on === today))
    .sort(compareTasks);
  const done = tasks
    .filter((t) => (isDone(t) || t.done_count > 0) && t.completed_at && localDate(t.completed_at) === today
      && (isDone(t) || !todayList.includes(t)))
    .sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)));
  return { overdue: earlier, today: todayList, done };
}

export const DUE_FILTERS = [
  { value: 'any', label: 'Any date' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Next 7 days' },
  { value: 'none', label: 'No date' },
];

export function matchesSearch(t, needle) {
  if (!needle) return true;
  const n = needle.trim().toLowerCase();
  if (!n) return true;
  return [t.title, t.notes, t.category, t.assignee_name, t.assigned_by_name, ...(t.tags || []), ...(t.subtasks || []).map((s) => s.text)]
    .some((v) => String(v || '').toLowerCase().includes(n));
}

/**
 * f: { q, status ('open' | 'all' | a status), priority, category, tag,
 *      due ('any' | 'overdue' | 'today' | 'week' | 'none'), who ('all' | 'mine' | 'given' | 'to_me') }
 */
export function filterTasks(tasks, f, uid, now = new Date()) {
  const today = toISODate(now);
  return tasks.filter((t) => {
    const status = f.status || 'open';
    if (status === 'open' && isDone(t)) return false;
    if (status !== 'open' && status !== 'all' && t.status !== status) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (f.category && t.category !== f.category) return false;
    if (f.tag && !(t.tags || []).includes(f.tag)) return false;
    const due = f.due || 'any';
    if (due === 'overdue' && !isOverdue(t, now)) return false;
    if (due === 'today' && t.due_on !== today) return false;
    if (due === 'week' && !(t.due_on && t.due_on >= today && t.due_on <= addDays(today, 6))) return false;
    if (due === 'none' && t.due_on) return false;
    const who = f.who || 'all';
    if (who === 'mine' && (t.created_by !== uid || t.assignee_id)) return false;
    if (who === 'given' && !(t.created_by === uid && t.assignee_id)) return false;
    if (who === 'to_me' && t.assignee_id !== uid) return false;
    return matchesSearch(t, f.q);
  });
}

/** Groups for the list: Overdue, Today, Tomorrow, Next 7 days, Later, No date, Done. */
export function groupTasks(tasks, now = new Date()) {
  const today = toISODate(now);
  const groups = [
    { key: 'overdue', label: 'Overdue', items: [] },
    { key: 'today', label: 'Today', items: [] },
    { key: 'tomorrow', label: 'Tomorrow', items: [] },
    { key: 'week', label: 'Next 7 days', items: [] },
    { key: 'later', label: 'Later', items: [] },
    { key: 'none', label: 'No date', items: [] },
    { key: 'done', label: 'Done', items: [] },
  ];
  const by = Object.fromEntries(groups.map((g) => [g.key, g.items]));
  for (const t of [...tasks].sort(compareTasks)) {
    if (isDone(t)) by.done.push(t);
    else if (!t.due_on) by.none.push(t);
    else if (t.due_on < today) by.overdue.push(t);
    else if (t.due_on === today) by.today.push(t);
    else if (t.due_on === addDays(today, 1)) by.tomorrow.push(t);
    else if (t.due_on <= addDays(today, 6)) by.week.push(t);
    else by.later.push(t);
  }
  by.done.sort((a, b) => String(b.completed_at || '').localeCompare(String(a.completed_at || '')));
  return groups.filter((g) => g.items.length);
}

export const allTags = (tasks) => [...new Set(tasks.flatMap((t) => t.tags || []))].sort((a, b) => a.localeCompare(b));
export const allCategories = (tasks) => [...new Set([...CATEGORIES, ...tasks.map((t) => t.category).filter(Boolean)])];

export function subtaskProgress(t) {
  const s = Array.isArray(t.subtasks) ? t.subtasks : [];
  return { done: s.filter((x) => x.done).length, total: s.length };
}

export const newSubtaskId = () => Math.random().toString(36).slice(2, 10);

/** Cleans a task before it is saved: trims, drops empty subtasks and tags, keeps dates consistent. */
export function cleanTask(t) {
  const repeat = t.due_on ? normaliseRepeat(t.repeat) : null;
  const tags = [...new Set((t.tags || []).map((x) => String(x).trim().replace(/^#/, '')).filter(Boolean))].slice(0, 20);
  return {
    title: String(t.title || '').trim().slice(0, 300),
    notes: String(t.notes || '').trim() || null,
    priority: RANK[t.priority] != null ? t.priority : 'Normal',
    status: STATUSES.some((s) => s.value === t.status) ? t.status : 'todo',
    due_on: t.due_on || null,
    due_time: t.due_on && t.due_time ? hhmm(t.due_time) : null,
    reminders: t.due_on ? [...new Set((t.reminders || []).map(Number).filter((m) => m >= 0))].sort((a, b) => b - a).slice(0, 10) : [],
    repeat,
    subtasks: (t.subtasks || []).map((s) => ({ id: s.id || newSubtaskId(), text: String(s.text || '').trim(), done: !!s.done })).filter((s) => s.text),
    category: String(t.category || '').trim().slice(0, 40) || null,
    tags,
    my_day_on: t.my_day_on || null,
    assignee_id: t.assignee_id || null,
  };
}

// ---------------------------------------------------------------------------
// Quick Add: "Call Peter tomorrow 10am", "Pay rent every month on the 1st !high #home"
// ---------------------------------------------------------------------------

const DAYS = [
  ['sunday', 'sun'], ['monday', 'mon'], ['tuesday', 'tue', 'tues'], ['wednesday', 'wed'],
  ['thursday', 'thu', 'thur', 'thurs'], ['friday', 'fri'], ['saturday', 'sat'],
];
const DAY_FULL = DAYS.map((d) => d[0]).join('|');
const DAY_ANY = DAYS.flat().sort((a, b) => b.length - a.length).join('|');
const dayIndex = (w) => DAYS.findIndex((d) => d.includes(w.toLowerCase()));
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const monthIndex = (w) => MONTHS.indexOf(w.toLowerCase().slice(0, 3));
const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1, other: 2 };
const num = (w) => (/^\d+$/.test(w) ? Number(w) : NUM_WORDS[w.toLowerCase()] || 1);
const ORD = '(?:st|nd|rd|th)?';

function validDate(y, m, d) {
  const dt = new Date(y, m, d);
  return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d ? toISODate(dt) : null;
}

/** The next date (today included) on day `day` of a month, clamped to short months. */
function nextMonthDay(today, day) {
  const y = +today.slice(0, 4);
  const m = +today.slice(5, 7) - 1;
  const on = (yy, mm) => toISODate(new Date(yy, mm, Math.min(day, new Date(yy, mm + 1, 0).getDate())));
  const here = on(y, m);
  return here >= today ? here : on(m === 11 ? y + 1 : y, (m + 1) % 12);
}

/** Next date (today included) that falls on weekday `dow`. */
function upcoming(today, dow, skipToday = false) {
  let diff = (dow - isoDay(today) + 7) % 7;
  if (diff === 0 && skipToday) diff = 7;
  return addDays(today, diff);
}

function to24(h, m, ampm) {
  let hour = Number(h);
  const min = Number(m || 0);
  if (hour > 23 || min > 59) return null;
  const ap = (ampm || '').toLowerCase().replace(/\./g, '');
  if (ap) {
    if (hour < 1 || hour > 12) return null;
    if (ap.startsWith('p') && hour !== 12) hour += 12;
    if (ap.startsWith('a') && hour === 12) hour = 0;
  }
  return `${pad(hour)}:${pad(min)}`;
}

/**
 * Reads a typed or spoken task. Returns the task fields it found, with
 * `title` the rest of the text, and `found` naming what was understood.
 */
export function parseQuickAdd(input, now = new Date()) {
  const today = toISODate(now);
  let s = ` ${String(input || '').replace(/\s+/g, ' ').trim()} `;
  const out = { title: '', due_on: null, due_time: null, priority: 'Normal', repeat: null, tags: [], category: null };
  const found = [];
  const take = (re, fn) => {
    s = s.replace(re, (...m) => (fn(...m) === false ? m[0] : ' '));
  };

  // Lead-ins: "Remind me to send the quotation" -> "send the quotation".
  take(/^\s*(?:please\s+)?(?:(?:can you\s+)?remind me(?:\s+(?:to|about|that i need to|that))?|remember to|don'?t forget to|i (?:need|have) to|need to|todo:?|to do:?)\s+/i, () => {});

  take(/(^|\s)#([\p{L}\p{N}_-]+)/gu, (_, __, tag) => { out.tags.push(tag); });
  take(/(^|\s)@(work|personal|finance|family|health|errands)\b/gi, (_, __, c) => { out.category = c[0].toUpperCase() + c.slice(1).toLowerCase(); });

  // Priority
  take(/(^|\s)(?:!!!|!urgent|p1)(?=\s)/gi, () => { out.priority = 'Urgent'; });
  take(/(^|\s)(?:!!|!high|p2)(?=\s)/gi, () => { out.priority = 'High'; });
  take(/(^|\s)(?:!low|p4)(?=\s)/gi, () => { out.priority = 'Low'; });
  take(/(^|\s)(?:!normal|p3)(?=\s)/gi, () => { out.priority = 'Normal'; });
  take(/[\s,:-]*\b(?:urgent(?:ly)?|asap|as soon as possible)\b[\s,:!-]*/gi, () => { out.priority = 'Urgent'; });
  take(/[\s,(-]*\b(?:(?:high|top) priority|important)\b[\s,)]*/gi, () => { if (out.priority !== 'Urgent') out.priority = 'High'; });
  take(/[\s,(-]*\blow priority\b[\s,)]*/gi, () => { out.priority = 'Low'; });

  // Parts of the day become times: "tomorrow morning" -> "tomorrow 9am".
  const PART = { morning: '9am', afternoon: '2pm', evening: '6pm', night: '8pm', noon: '12pm', midday: '12pm', lunchtime: '12pm', lunch: '12pm' };
  s = s.replace(new RegExp(`\\b(today|tomorrow|tmrw?|${DAY_ANY})\\s+(morning|afternoon|evening|night)\\b`, 'gi'), (_, d, p) => `${d} ${PART[p.toLowerCase()]}`);
  s = s.replace(/\b(?:this|in the)\s+(morning|afternoon|evening)\b/gi, (_, p) => PART[p.toLowerCase()]);
  s = s.replace(/\b(?:at\s+)?(noon|midday|lunchtime)\b/gi, (_, p) => PART[p.toLowerCase()]);
  s = s.replace(/\btonight\b/gi, 'today 8pm');

  // Repeats
  const setRepeat = (r) => { if (!out.repeat) { out.repeat = r; found.push('repeat'); } };
  take(/\b(?:every\s*day|daily|everyday)\b/gi, () => setRepeat({ freq: 'daily', interval: 1 }));
  take(/\b(?:every|on)\s+weekdays?\b|\bevery\s+working\s+day\b/gi, () => setRepeat({ freq: 'weekly', interval: 1, days: [1, 2, 3, 4, 5] }));
  take(/\bevery\s+weekend\b/gi, () => setRepeat({ freq: 'weekly', interval: 1, days: [6, 0] }));
  take(/\bevery\s+(\d+|two|three|four|five|six|other)\s+(day|week|month|year)s?\b/gi, (_, n, u) => setRepeat({ freq: { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' }[u.toLowerCase()], interval: num(n) }));
  take(new RegExp(`\\bevery\\s+((?:${DAY_ANY})(?:\\s*(?:,|and|&)\\s*(?:${DAY_ANY}))*)\\b`, 'gi'), (_, list) => {
    const days = list.split(/\s*(?:,|and|&)\s*/i).map(dayIndex).filter((d) => d >= 0);
    setRepeat({ freq: 'weekly', interval: 1, days });
  });
  let monthDay = 0;
  take(/\b(?:every\s+month|monthly)(?:\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?)?\b/gi, (_, d) => {
    setRepeat({ freq: 'monthly', interval: 1, ...(d ? { day: Number(d) } : {}) });
    if (d) monthDay = Number(d);
  });
  take(/\bevery\s+(\d{1,2})(?:st|nd|rd|th)\b/gi, (_, d) => { setRepeat({ freq: 'monthly', interval: 1, day: Number(d) }); monthDay = Number(d); });
  take(/\b(?:every\s+week|weekly)\b/gi, () => setRepeat({ freq: 'weekly', interval: 1 }));
  take(/\b(?:every\s+year|yearly|annually)\b/gi, () => setRepeat({ freq: 'yearly', interval: 1 }));

  // Dates
  const setDate = (iso) => { if (iso && !out.due_on) { out.due_on = iso; found.push('date'); return true; } return false; };
  const PRE = '(?:\\b(?:on|by|before|due|for|this coming)\\s+)?';
  take(new RegExp(`${PRE}\\b(\\d{4})-(\\d{2})-(\\d{2})\\b`, 'gi'), (_, y, m, d) => setDate(validDate(+y, +m - 1, +d)));
  take(new RegExp(`${PRE}\\b(\\d{1,2})${ORD}\\s+(?:of\\s+)?${MONTH_RE}\\.?(?:,?\\s+(\\d{4}))?\\b`, 'gi'), (_, d, mon, y) => {
    let iso = validDate(y ? +y : +today.slice(0, 4), monthIndex(mon), +d);
    if (iso && !y && iso < today) iso = validDate(+today.slice(0, 4) + 1, monthIndex(mon), +d);
    return setDate(iso);
  });
  take(new RegExp(`${PRE}\\b${MONTH_RE}\\.?\\s+(\\d{1,2})${ORD}(?:,?\\s+(\\d{4}))?\\b`, 'gi'), (_, mon, d, y) => {
    let iso = validDate(y ? +y : +today.slice(0, 4), monthIndex(mon), +d);
    if (iso && !y && iso < today) iso = validDate(+today.slice(0, 4) + 1, monthIndex(mon), +d);
    return setDate(iso);
  });
  take(/(?:\b(?:on|by|before|due)\s+)?\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/gi, (_, d) => +d >= 1 && +d <= 31 && setDate(nextMonthDay(today, +d)));
  take(/(?:\b(?:on|by|before|due|for)\s+)?\b(?:the\s+)?day after tomorrow\b/gi, () => setDate(addDays(today, 2)));
  take(/(?:\b(?:by|before|due|for)\s+)?\b(?:today|tdy)\b/gi, () => setDate(today));
  take(/(?:\b(?:by|before|due|for)\s+)?\b(?:tomorrow|tomorow|tmrw?)\b/gi, () => setDate(addDays(today, 1)));
  take(/\bin\s+(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)\s+(day|week|month|year)s?\b/gi, (_, n, u) => {
    const k = num(n);
    const unit = u.toLowerCase();
    return setDate(unit === 'day' ? addDays(today, k) : unit === 'week' ? addDays(today, 7 * k) : addMonths(today, unit === 'month' ? k : 12 * k));
  });
  take(/(?:\b(?:by|before|due)\s+)?\b(?:the\s+)?end of (?:the\s+)?week\b/gi, () => setDate(upcoming(today, 5)));
  take(/(?:\b(?:by|before|due)\s+)?\b(?:the\s+)?end of (?:the\s+)?month\b/gi, () => {
    const d = new Date(+today.slice(0, 4), +today.slice(5, 7), 0);
    return setDate(toISODate(d));
  });
  take(/(?:\b(?:on|by|for)\s+)?\b(?:this\s+)?weekend\b/gi, () => setDate(upcoming(today, 6)));
  take(/\bnext\s+week\b/gi, () => setDate(addDays(startOfWeek(today), 7)));
  take(/\bnext\s+month\b/gi, () => setDate(addMonths(today, 1)));
  take(new RegExp(`(?:\\b(?:on|by|before|due|for)\\s+)?\\bnext\\s+(${DAY_ANY})\\b`, 'gi'), (_, d) => setDate(upcoming(today, dayIndex(d), true)));
  take(new RegExp(`(?:\\b(?:on|by|before|due|for)\\s+)?\\bthis\\s+(${DAY_ANY})\\b`, 'gi'), (_, d) => setDate(upcoming(today, dayIndex(d))));
  // Short day names only after on/by ("sun" and "sat" are ordinary words too).
  take(new RegExp(`\\b(?:on|by|before|due|for|until)\\s+(${DAY_ANY})\\b`, 'gi'), (_, d) => setDate(upcoming(today, dayIndex(d))));
  take(new RegExp(`\\b(${DAY_FULL})\\b`, 'gi'), (_, d) => setDate(upcoming(today, dayIndex(d))));
  take(/(?:\b(?:on|by|before|due)\s+)?\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (_, a, b, y) => setDate(validDate(+y, +b - 1, +a) || validDate(+y, +a - 1, +b)));

  // Times
  const setTime = (t) => { if (t && !out.due_time) { out.due_time = t; found.push('time'); return true; } return false; };
  take(/(?:\b(?:at|by|before|from|around)\s+|@\s*)?\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?=[\s,.!?]|$)/gi, (_, h, m, ap) => setTime(to24(h, m, ap)));
  take(/(?:\b(?:at|by|before|from|around)\s+|@\s*)?\b(\d{1,2})[:.](\d{2})\b(?!\s*%)/g, (_, h, m) => setTime(to24(h, m)));
  take(/\b(?:at|@|around)\s*(\d{1,2})\b(?!\s*(?:st|nd|rd|th|days?|weeks?|months?|years?|%|[a-z]))/gi, (_, h) => {
    const n = Number(h);
    if (n > 23) return false;
    return setTime(n >= 1 && n <= 6 ? `${pad(n + 12)}:00` : `${pad(n)}:00`);
  });

  if (monthDay && !out.due_on && monthDay <= 31) out.due_on = nextMonthDay(today, monthDay);

  // A time with no day: today if it's still ahead, otherwise tomorrow.
  if (out.due_time && !out.due_on) out.due_on = out.due_time > nowHHMM(now) ? today : addDays(today, 1);
  // A repeat with no day starts at its first date from today.
  if (out.repeat && !out.due_on) out.due_on = firstDate(today, out.repeat);
  else if (out.repeat && out.due_on) out.due_on = firstDate(out.due_on, out.repeat);
  if (out.repeat?.freq === 'monthly' && !out.repeat.day && out.due_on) out.repeat.day = Number(out.due_on.slice(8));

  if (out.priority !== 'Normal') found.push('priority');
  if (out.tags.length) found.push('tags');
  if (out.category) found.push('category');

  let title = s.replace(/\s+/g, ' ').trim()
    .replace(/^(?:[,;:–-]\s*)+/, '')
    .replace(/(?:\s*[,;:–-])+$/, '')
    .replace(/\s+\b(?:on|at|by|before|due|for|from|in|and|the|every|this|next)$/i, '')
    .replace(/(?:\s*[,;:–-])+$/, '')
    .trim();
  if (!title) title = String(input || '').trim();
  out.title = title ? title[0].toUpperCase() + title.slice(1) : '';
  out.reminders = out.due_on ? smartReminders(out.priority, !!out.due_time) : [];
  out.found = found;
  return out;
}
