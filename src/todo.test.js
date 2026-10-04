import { describe, expect, it } from 'vitest';
import {
  carriedFrom, cleanTask, completion, formatLongDay, dueLabel, dueReminders, filterTasks, firstDate, formatTime, groupTasks, isOverdue,
  myDay, nextDate, occurrences, parseQuickAdd, repeatLabel, rollForward, smartReminders,
} from './todo.js';

// Sunday 4 October 2026, 09:30 local time.
const NOW = new Date(2026, 9, 4, 9, 30);
const TODAY = '2026-10-04';
const p = (text) => parseQuickAdd(text, NOW);

describe('quick add', () => {
  it('reads a day and a time and adds reminders', () => {
    const t = p('Call Peter tomorrow 10am');
    expect(t).toMatchObject({ title: 'Call Peter', due_on: '2026-10-05', due_time: '10:00', priority: 'Normal' });
    expect(t.reminders).toEqual([15, 0]);
  });
  it('drops "remind me to" and reads a weekday', () => {
    expect(p('Remind me to send quotation Friday')).toMatchObject({ title: 'Send quotation', due_on: '2026-10-09', due_time: null });
    expect(p('remind me to pay rent on Monday')).toMatchObject({ title: 'Pay rent', due_on: '2026-10-05' });
    expect(p('Pay supplier next friday')).toMatchObject({ title: 'Pay supplier', due_on: '2026-10-09' });
    expect(p('Board meeting this saturday').due_on).toBe('2026-10-10');
    expect(p('Board meeting this sunday').due_on).toBe(TODAY);
  });
  it('keeps ordinary words that look like short day names', () => {
    expect(p('Buy sun cream').title).toBe('Buy sun cream');
    expect(p('Buy sun cream').due_on).toBeNull();
    expect(p('Fix the sat nav on sat').title).toBe('Fix the sat nav');
  });
  it('reads times in many forms', () => {
    expect(p('Lunch with Ana at 12:30').due_time).toBe('12:30');
    expect(p('Call at 3').due_time).toBe('15:00');
    expect(p('Call at 9').due_time).toBe('09:00');
    expect(p('Gym 7pm')).toMatchObject({ title: 'Gym', due_on: TODAY, due_time: '19:00' });
    expect(p('Standup 8am').due_on).toBe('2026-10-05'); // 8am today has passed
    expect(p('Call mum tonight')).toMatchObject({ title: 'Call mum', due_on: TODAY, due_time: '20:00' });
    expect(p('Review deck tomorrow morning')).toMatchObject({ title: 'Review deck', due_on: '2026-10-05', due_time: '09:00' });
    expect(p('Site visit 2.30pm friday')).toMatchObject({ title: 'Site visit', due_on: '2026-10-09', due_time: '14:30' });
  });
  it('reads dates', () => {
    expect(p('Renew licence 15 Oct').due_on).toBe('2026-10-15');
    expect(p('Renew licence on October 15th').due_on).toBe('2026-10-15');
    expect(p('Tax return March 31').due_on).toBe('2027-03-31');
    expect(p('Invoice 2026-11-02').due_on).toBe('2026-11-02');
    expect(p('Send report in 3 days').due_on).toBe('2026-10-07');
    expect(p('Plan trip in two weeks').due_on).toBe('2026-10-18');
    expect(p('Pay bill on the 20th').due_on).toBe('2026-10-20');
    expect(p('Pay bill on the 2nd').due_on).toBe('2026-11-02');
    expect(p('Quarter review next week').due_on).toBe('2026-10-05');
    expect(p('Close books end of month').due_on).toBe('2026-10-31');
    expect(p('Wash car day after tomorrow').due_on).toBe('2026-10-06');
  });
  it('reads repeats', () => {
    expect(p('Take vitamins every day 8pm')).toMatchObject({ title: 'Take vitamins', due_on: TODAY, due_time: '20:00', repeat: { freq: 'daily', interval: 1 } });
    expect(p('Team standup every weekday 9am')).toMatchObject({ due_on: '2026-10-05', repeat: { freq: 'weekly', days: [1, 2, 3, 4, 5] } });
    expect(p('Gym every mon and thu')).toMatchObject({ title: 'Gym', due_on: '2026-10-05', repeat: { freq: 'weekly', days: [1, 4] } });
    expect(p('Pay rent every month on the 1st')).toMatchObject({ title: 'Pay rent', due_on: '2026-11-01', repeat: { freq: 'monthly', day: 1 } });
    expect(p('Water plants every 3 days').repeat).toEqual({ freq: 'daily', interval: 3 });
    expect(p('Insurance yearly').repeat).toEqual({ freq: 'yearly', interval: 1 });
    expect(p('Weekly report friday')).toMatchObject({ title: 'Report', due_on: '2026-10-09', repeat: { freq: 'weekly' } });
  });
  it('reads priority, tags and category', () => {
    expect(p('Urgent: call the bank')).toMatchObject({ title: 'Call the bank', priority: 'Urgent' });
    expect(p('Fix leak asap')).toMatchObject({ title: 'Fix leak', priority: 'Urgent' });
    expect(p('Prepare slides !high')).toMatchObject({ title: 'Prepare slides', priority: 'High' });
    expect(p('Book flights #travel #family @personal')).toMatchObject({ title: 'Book flights', tags: ['travel', 'family'], category: 'Personal' });
    expect(p('Quote for ABC tomorrow !!!').reminders).toEqual([1440, 0]);
  });
  it('keeps the text when nothing is left', () => {
    expect(p('tomorrow').title).toBe('Tomorrow');
    expect(p('  plain task  ')).toMatchObject({ title: 'Plain task', due_on: null, reminders: [] });
  });
});

describe('repeats', () => {
  it('moves to the next date', () => {
    expect(nextDate('2026-10-04', { freq: 'daily', interval: 2 })).toBe('2026-10-06');
    expect(nextDate('2026-10-09', { freq: 'weekly', interval: 1, days: [1, 2, 3, 4, 5] })).toBe('2026-10-12');
    expect(nextDate('2026-10-05', { freq: 'weekly', interval: 1, days: [1, 4] })).toBe('2026-10-08');
    expect(nextDate('2026-10-08', { freq: 'weekly', interval: 2, days: [1, 4] })).toBe('2026-10-19');
    expect(nextDate('2026-01-31', { freq: 'monthly', interval: 1, day: 31 })).toBe('2026-02-28');
    expect(nextDate('2026-02-28', { freq: 'monthly', interval: 1, day: 31 })).toBe('2026-03-31');
    expect(nextDate('2026-10-04', { freq: 'yearly', interval: 1 })).toBe('2027-10-04');
  });
  it('a late repeating task moves past today', () => {
    expect(rollForward('2026-09-28', { freq: 'daily', interval: 1 }, TODAY)).toBe('2026-10-05');
    expect(rollForward('2026-09-28', { freq: 'weekly', interval: 1 }, TODAY)).toBe('2026-10-05');
  });
  it('starts on a matching day', () => {
    expect(firstDate(TODAY, { freq: 'weekly', days: [1] })).toBe('2026-10-05');
    expect(firstDate(TODAY, { freq: 'daily' })).toBe(TODAY);
  });
  it('done on a repeating task rolls it on and unticks its checklist', () => {
    const t = { due_on: '2026-10-04', repeat: { freq: 'weekly', interval: 1 }, done_count: 2, subtasks: [{ id: 'a', text: 'x', done: true }] };
    expect(completion(t, TODAY)).toEqual({ due_on: '2026-10-11', status: 'todo', done_count: 3, subtasks: [{ id: 'a', text: 'x', done: false }] });
    expect(completion({ due_on: '2026-10-04' }, TODAY)).toEqual({ status: 'done' });
  });
  it('appears on every date in a range', () => {
    const t = { due_on: '2026-10-01', repeat: { freq: 'weekly', interval: 1 } };
    expect(occurrences(t, '2026-10-01', '2026-10-31')).toEqual(['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29']);
    expect(occurrences({ due_on: '2026-10-08' }, '2026-10-01', '2026-10-31')).toEqual(['2026-10-08']);
    expect(occurrences({ due_on: null }, '2026-10-01', '2026-10-31')).toEqual([]);
  });
  it('has readable labels', () => {
    expect(repeatLabel({ freq: 'daily', interval: 1 })).toBe('Every day');
    expect(repeatLabel({ freq: 'weekly', interval: 1, days: [1, 2, 3, 4, 5] })).toBe('Every weekday');
    expect(repeatLabel({ freq: 'weekly', interval: 2, days: [1, 4] })).toBe('Every 2 weeks on Mon, Thu');
    expect(repeatLabel({ freq: 'monthly', interval: 1 })).toBe('Every month');
  });
});

describe('due dates and reminders', () => {
  it('labels', () => {
    expect(formatTime('10:00')).toBe('10am');
    expect(formatTime('15:30:00')).toBe('3:30pm');
    expect(formatTime('00:15')).toBe('12:15am');
    expect(dueLabel({ due_on: TODAY, due_time: '14:00' }, TODAY)).toBe('Today 2pm');
    expect(dueLabel({ due_on: '2026-10-05' }, TODAY)).toBe('Tomorrow');
    expect(dueLabel({ due_on: '2026-10-08' }, TODAY)).toBe('Thu');
    expect(dueLabel({ due_on: '2026-12-25' }, TODAY)).toBe('25 Dec');
    expect(dueLabel({ due_on: '2027-01-02' }, TODAY)).toBe('2 Jan 2027');
  });
  it('overdue', () => {
    expect(isOverdue({ due_on: '2026-10-03' }, NOW)).toBe(true);
    expect(isOverdue({ due_on: TODAY }, NOW)).toBe(false);
    expect(isOverdue({ due_on: TODAY, due_time: '09:00' }, NOW)).toBe(true);
    expect(isOverdue({ due_on: TODAY, due_time: '10:00' }, NOW)).toBe(false);
    expect(isOverdue({ due_on: '2026-10-03', status: 'done' }, NOW)).toBe(false);
  });
  it('smart reminders follow priority', () => {
    expect(smartReminders('Normal', true)).toEqual([15, 0]);
    expect(smartReminders('High', true)).toEqual([60, 15, 0]);
    expect(smartReminders('Urgent', true)).toEqual([1440, 60, 15, 0]);
    expect(smartReminders('Normal', false)).toEqual([0]);
    expect(smartReminders('High', false)).toEqual([1440, 0]);
  });
  it('fires each reminder once, and not long after', () => {
    const t = { id: 't1', due_on: TODAY, due_time: '09:40', reminders: [15, 0] };
    const shown = new Set();
    const due = dueReminders([t], NOW, shown);
    expect(due.map((r) => r.minutes)).toEqual([15]);
    due.forEach((r) => r.keys.forEach((k) => shown.add(k)));
    expect(dueReminders([t], NOW, shown)).toEqual([]);
    expect(dueReminders([t], new Date(2026, 9, 4, 9, 41), shown).map((r) => r.minutes)).toEqual([0]);
    expect(dueReminders([{ ...t, due_time: '07:00' }], NOW, new Set())).toEqual([]);
    expect(dueReminders([{ ...t, status: 'done' }], new Date(2026, 9, 4, 9, 41), new Set())).toEqual([]);
    // opened late: one message per task for the reminders it missed
    const late = dueReminders([t], new Date(2026, 9, 4, 9, 50), new Set());
    expect(late.map((r) => [r.minutes, r.keys.length])).toEqual([[0, 2]]);
    // no time: reminders count from 09:00
    expect(dueReminders([{ id: 't2', due_on: TODAY, reminders: [0] }], NOW, new Set()).length).toBe(1);
  });
});

describe('lists', () => {
  const tasks = [
    { id: 'a', title: 'Late', due_on: '2026-10-01', priority: 'Normal', status: 'todo', created_by: 'me' },
    { id: 'b', title: 'Today late', due_on: TODAY, due_time: '15:00', priority: 'Normal', status: 'todo', created_by: 'me' },
    { id: 'c', title: 'Today urgent', due_on: TODAY, priority: 'Urgent', status: 'in_progress', created_by: 'me', tags: ['abc'] },
    { id: 'd', title: 'Picked for today', my_day_on: TODAY, priority: 'Low', status: 'todo', created_by: 'me', category: 'Work' },
    { id: 'e', title: 'Next week', due_on: '2026-10-09', priority: 'High', status: 'waiting', created_by: 'me', assignee_id: 'bob', assignee_name: 'Bob' },
    { id: 'f', title: 'Done today', due_on: TODAY, status: 'done', completed_at: new Date(2026, 9, 4, 8).toISOString(), created_by: 'me' },
    { id: 'g', title: 'From Ana', status: 'todo', created_by: 'ana', assignee_id: 'me', notes: 'quotation for Acme' },
    { id: 'h', title: 'Picked yesterday', my_day_on: '2026-10-03', due_on: '2026-10-20', status: 'todo', created_by: 'me' },
  ];
  it('my day', () => {
    const d = myDay(tasks, NOW);
    expect(d.overdue.map((t) => t.id)).toEqual(['a', 'h']);
    expect(carriedFrom(tasks[0], TODAY)).toBe('2026-10-01');
    expect(carriedFrom(tasks[7], TODAY)).toBe('2026-10-03');
    expect(carriedFrom(tasks[1], TODAY)).toBeNull();
    expect(formatLongDay('2026-10-03', TODAY)).toBe('Sat 3 Oct');
    expect(d.today.map((t) => t.id)).toEqual(['b', 'c', 'd']);
    expect(d.done.map((t) => t.id)).toEqual(['f']);
  });
  it('filters', () => {
    const ids = (f) => filterTasks(tasks, f, 'me', NOW).map((t) => t.id);
    expect(ids({})).toEqual(['a', 'b', 'c', 'd', 'e', 'g', 'h']);
    expect(ids({ status: 'all' })).toHaveLength(8);
    expect(ids({ status: 'done' })).toEqual(['f']);
    expect(ids({ priority: 'Urgent' })).toEqual(['c']);
    expect(ids({ due: 'overdue' })).toEqual(['a']);
    expect(ids({ due: 'week' })).toEqual(['b', 'c', 'e']);
    expect(ids({ due: 'none' })).toEqual(['d', 'g']);
    expect(ids({ tag: 'abc' })).toEqual(['c']);
    expect(ids({ category: 'Work' })).toEqual(['d']);
    expect(ids({ who: 'given' })).toEqual(['e']);
    expect(ids({ who: 'to_me' })).toEqual(['g']);
    expect(ids({ q: 'acme' })).toEqual(['g']);
    expect(ids({ q: 'bob' })).toEqual(['e']);
  });
  it('groups', () => {
    expect(groupTasks(tasks, NOW).map((g) => [g.key, g.items.map((t) => t.id)])).toEqual([
      ['overdue', ['a']], ['today', ['b', 'c']], ['week', ['e']], ['later', ['h']], ['none', ['g', 'd']], ['done', ['f']],
    ]);
  });
  it('cleans a task before saving', () => {
    expect(cleanTask({ title: '  x ', due_time: '10:00', reminders: [5], repeat: { freq: 'daily' }, tags: ['#a', 'a', ' '], subtasks: [{ text: ' ' }, { id: 's', text: 'y' }] }))
      .toMatchObject({ title: 'x', due_on: null, due_time: null, reminders: [], repeat: null, tags: ['a'], subtasks: [{ id: 's', text: 'y', done: false }] });
  });
});
