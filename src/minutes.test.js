import { describe, expect, it, vi } from 'vitest';
import { actionLine, allActions, earlierActions, outstanding, decisionLabel, dueState, hasMinutes, isMinutes, lineTime, minutesColumns, minutesRow, minutesText, normaliseMinutes, shareOrCopy, shareText } from './minutes.js';

const rec = { kind: 'Meeting', title: 'Recorded conversation', occurred_on: '2026-10-03' };
const ai = { summary: '讨论了网络升级。', key_points: ['两个站点', 'Wi-Fi 不稳定'], action_items: ['Send quote'] };

describe('minutesRow', () => {
  it('saves the minutes as a Note dated like the recording', () => {
    const row = minutesRow(rec, ai, 'transcript');
    expect(row).toMatchObject({ kind: 'Note', occurred_on: '2026-10-03', title: 'Minutes: Meeting', summary: '讨论了网络升级。', action_items: ['Send quote'], transcript: 'transcript' });
    expect(row.notes).toBe('Key points\n• 两个站点\n• Wi-Fi 不稳定');
    expect(isMinutes(row)).toBe(true);
  });
  it('uses a real title when the recording has one', () => {
    expect(minutesRow({ ...rec, title: 'Site walk' }, { summary: 'x' }).title).toBe('Minutes: Site walk');
    expect(minutesRow(rec, { summary: 'x' }).notes).toBeNull();
  });
});

describe('shareText', () => {
  it('lists title, date, contact, summary, key points and actions', () => {
    const t = shareText(minutesRow(rec, ai), { full_name: 'Maria Tan', company: 'Acme' }, (d) => d);
    expect(t).toBe('Minutes: Meeting\n2026-10-03 · Maria Tan, Acme\n\nSummary\n讨论了网络升级。\n\nKey points\n• 两个站点\n• Wi-Fi 不稳定\n\nAction items\n• Send quote');
  });
});

describe('shareOrCopy', () => {
  it('uses the share sheet when there is one', async () => {
    const share = vi.fn().mockResolvedValue();
    expect(await shareOrCopy('T', 'x', { share })).toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 'T', text: 'x' });
  });
  it('treats closing the sheet as cancelled', async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error('no'), { name: 'AbortError' }));
    expect(await shareOrCopy('T', 'x', { share })).toBe('cancelled');
  });
  it('copies when there is no share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue();
    expect(await shareOrCopy('T', 'x', { clipboard: { writeText } })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('x');
  });
});

describe('typed meeting minutes', () => {
  const ai = {
    quick_summary: ['Supplier A chosen', ' '],
    chairperson: 'Alex', attendees: ['Alex', 'Peter'], location: '',
    agenda: ['Supplier'], discussion: [{ topic: 'Supplier', points: ['Best lead time'] }, { topic: '', points: [] }],
    decisions: ['Proceed with Supplier A.'],
    action_items: [{ action: 'Submit BOM', assigned_to: 'Peter', due: '2026-10-07', priority: 'High' }, { action: 'x', due: 'Wednesday', priority: 'Urgent' }, { action: '' }],
    issues: [], next_steps: [], next_meeting: '2026-10-10',
  };
  const m = normaliseMinutes(ai);

  it('cleans the AI reply and starts every action item Open', () => {
    expect(m.quick_summary).toEqual(['Supplier A chosen']);
    expect(m.discussion).toHaveLength(1);
    expect(m.action_items).toEqual([
      { action: 'Submit BOM', assigned_to: 'Peter', due: '2026-10-07', priority: 'High', status: 'Open' },
      { action: 'x', assigned_to: '', due: '', priority: 'Medium', status: 'Open' },
    ]);
    expect(normaliseMinutes().decisions).toEqual([]);
  });

  it('numbers decisions and writes action lines', () => {
    expect(decisionLabel(0)).toBe('Decision 01');
    expect(decisionLabel(11)).toBe('Decision 12');
    expect(actionLine(m.action_items[0])).toBe('Submit BOM · Assigned to: Peter · Due: 2026-10-07 · Priority: High · Status: Open');
  });

  it('keeps summary and action_items in step for search and the contact history', () => {
    const cols = minutesColumns(m);
    expect(cols.minutes).toBe(m);
    expect(cols.summary).toBe('• Supplier A chosen');
    expect(cols.action_items[0]).toMatch(/^Submit BOM/);
    expect(hasMinutes({ kind: 'Meeting', minutes: m })).toBe(true);
    expect(hasMinutes({ kind: 'Meeting' })).toBe(false);
  });

  it('flags overdue and due-soon actions', () => {
    expect(dueState({ due: '2026-10-01', status: 'Open' }, '2026-10-03')).toBe('overdue');
    expect(dueState({ due: '2026-10-06', status: 'Open' }, '2026-10-03')).toBe('soon');
    expect(dueState({ due: '2026-10-07', status: 'Open' }, '2026-10-03')).toBe('');
    expect(dueState({ due: '2026-10-01', status: 'Done' }, '2026-10-03')).toBe('done');
    expect(dueState({ due: '', status: 'Open' }, '2026-10-03')).toBe('');
  });

  it('times transcript lines from the recording start, or from 0:00', () => {
    const end = new Date(2026, 9, 3, 10, 30, 0).getTime();
    const i = { audio_path: `w/c/i-${end}.webm`, duration_sec: 600 };
    expect(lineTime(i, 0)).toBe('10:20');
    expect(lineTime(i, 245)).toBe('10:24');
    expect(lineTime({}, 245)).toBe('4:05');
  });

  it('shares the formal minutes', () => {
    const t = minutesText({ title: 'Fibre rollout', meeting_type: 'Project Meeting', occurred_on: '2026-10-03', minutes: m }, null, (d) => d);
    expect(t).toContain('MEETING MINUTES\n\nMeeting: Fibre rollout\nType: Project Meeting\nDate: 2026-10-03\nChairperson: Alex\nAttendees: Alex, Peter');
    expect(t).toContain('DECISIONS MADE\nDecision 01: Proceed with Supplier A.');
    expect(t).toContain('ACTION ITEMS\n1. Submit BOM · Assigned to: Peter');
    expect(t).toContain('NEXT MEETING\n2026-10-10');
    expect(shareText({ minutes: m, occurred_on: '2026-10-03' }, null, (d) => d)).toMatch(/^MEETING MINUTES/);
  });
});

describe('follow-up tracking', () => {
  const mk = (id, date, type, actions) => ({ id, occurred_on: date, created_at: `${date}T09:00:00Z`, meeting_type: type, title: id, minutes: normaliseMinutes({ action_items: actions }) });
  const items = [
    mk('mon', '2026-09-28', 'Project Meeting', [
      { action: 'Submit BOM', assigned_to: 'Peter', due: '2026-09-30', priority: 'High' },
      { action: 'Site survey', assigned_to: 'Engineering', due: '2026-10-10' },
      { action: 'Old task', status: 'Done' },
    ]),
    mk('sales', '2026-09-29', 'Sales Meeting', [{ action: 'Client approval', assigned_to: 'Sales' }]),
    mk('later', '2026-10-05', 'Project Meeting', [{ action: 'Future thing' }]),
  ];
  const now = { id: 'fri', occurred_on: '2026-10-02', created_at: '2026-10-02T09:00:00Z', meeting_type: 'Project Meeting' };

  it('lists every action with its due state', () => {
    const all = allActions(items, '2026-10-02');
    expect(all).toHaveLength(5);
    expect(all[0]).toMatchObject({ action: 'Submit BOM', index: 0, state: 'overdue' });
    expect(all[2].state).toBe('done');
  });

  it('offers only open items from earlier meetings', () => {
    const e = earlierActions(items, now);
    expect(e.map((a) => a.ref)).toEqual(['sales:0', 'mon:0', 'mon:1']);
    expect(e[1]).toMatchObject({ action: 'Submit BOM', meeting: 'mon', date: '2026-09-28' });
  });

  it('marks earlier items Completed, Overdue or Pending', () => {
    const out = outstanding(now, earlierActions(items, now), [{ ref: 'mon:1', status: 'completed', note: 'Done' }, { ref: 'sales:0', status: 'discussed', note: '' }]);
    expect(out.map((f) => [f.action, f.state])).toEqual([['Client approval', 'Pending'], ['Submit BOM', 'Overdue'], ['Site survey', 'Completed']]);
    // an unmentioned item from another meeting type is left out
    expect(outstanding(now, earlierActions(items, now), []).map((f) => f.action)).toEqual(['Submit BOM', 'Site survey']);
    expect(normaliseMinutes({ follow_up: out }).follow_up).toHaveLength(3);
  });
});

describe('minutes language', () => {
  it('keeps English, Chinese or Tagalog and defaults to English', () => {
    expect(normaliseMinutes({ language: 'Chinese' }).language).toBe('Chinese');
    expect(normaliseMinutes({ language: 'Tagalog' }).language).toBe('Tagalog');
    expect(normaliseMinutes({ language: 'Klingon' }).language).toBe('English');
    expect(normaliseMinutes().language).toBe('English');
  });
});

describe('onDate', () => {
  it('filters by month or day, and lets everything through otherwise', async () => {
    const { onDate } = await import('./minutes.js');
    expect(onDate('2026-10-04', 'month', '2026-10')).toBe(true);
    expect(onDate('2026-09-30', 'month', '2026-10')).toBe(false);
    expect(onDate('2026-10-04', 'day', '2026-10-04')).toBe(true);
    expect(onDate('2026-10-05', 'day', '2026-10-04')).toBe(false);
    expect(onDate('2026-10-05', 'day', '')).toBe(true);
    expect(onDate('2026-10-05', 'any', '2026-01-01')).toBe(true);
    expect(onDate(null, 'month', '2026-10')).toBe(false);
  });
});
