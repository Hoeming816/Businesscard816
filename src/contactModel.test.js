import { describe, it, expect } from 'vitest';
import { toDraft, fromDraft, draftFromScan, diff, blankDraft } from './contactModel.js';

describe('contact drafts', () => {
  it('round-trips a contact', () => {
    const c = { full_name: 'A', company: 'B', emails: ['a@b.example'], phones: [{ label: 'Office', number: '1' }], tags: ['x'], opportunities: ['CCTV'], industry: 'IT', last_contacted_on: '2025-01-02' };
    const row = fromDraft(toDraft(c));
    expect(row.full_name).toBe('A');
    expect(row.emails).toEqual(['a@b.example']);
    expect(row.phones).toEqual([{ label: 'Office', number: '1' }]);
    expect(row.job_title).toBe(null);
    expect(row.last_contacted_on).toBe('2025-01-02');
    expect(row.next_follow_up_on).toBe(null);
  });
  it('drops empty phones/emails and de-duplicates tags', () => {
    const d = { ...blankDraft(), emails: [' ', 'x@y.example', 'X@y.example'], phones: [{ label: 'Mobile', number: ' ' }], tags: ['a', 'A', ' b '] };
    const row = fromDraft(d);
    expect(row.emails).toEqual(['x@y.example']);
    expect(row.phones).toEqual([]);
    expect(row.tags).toEqual(['a', 'b']);
  });
  it('merges scanner output and caps tags at 5', () => {
    const d = draftFromScan({ full_name: 'Z', emails: [], phones: [{ label: 'Fax', number: '9' }], tags: ['1', '2', '3', '4', '5', '6'], industry: null });
    expect(d.full_name).toBe('Z');
    expect(d.emails).toEqual(['']);
    expect(d.phones).toEqual([{ label: 'Fax', number: '9' }]);
    expect(d.tags).toHaveLength(5);
    expect(d.industry).toBe('');
  });
  it('diff returns only changed columns', () => {
    expect(diff({ a: 1, b: [1], c: null }, { a: 1, b: [2], c: undefined })).toEqual({ b: [2] });
  });
});
