import { describe, expect, it, vi } from 'vitest';
import { isMinutes, minutesRow, shareOrCopy, shareText } from './minutes.js';

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
