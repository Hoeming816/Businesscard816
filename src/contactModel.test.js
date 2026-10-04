import { describe, it, expect } from 'vitest';
import { toDraft, fromDraft, draftFromScan, diff, blankDraft, findSameName, overwritePatch } from './contactModel.js';

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

describe('overwriting an existing card', () => {
  const old = {
    id: 'c1', created_by: 'me', full_name: 'Gabriel Uy', job_title: 'Manager', company: 'Old Co', city: 'Cebu',
    emails: ['old@x.example'], phones: [{ label: 'Mobile', number: '1' }], notes: 'met at expo', lead_status: 'Won',
    tags: ['a'], updated_at: '2026-01-01',
  };
  it('matches the same name ignoring case, spaces and full-width letters, own cards only', () => {
    const list = [old, { ...old, id: 'c2', created_by: 'other' }, { ...old, id: 'c3', full_name: 'Gabriel Uy Jr' }];
    expect(findSameName(list, '  gabriel   UY ', 'me').map((c) => c.id)).toEqual(['c1']);
    expect(findSameName(list, 'Ｇａｂｒｉｅｌ Uy', 'me').map((c) => c.id)).toEqual(['c1']);
    expect(findSameName(list, '', 'me')).toEqual([]);
  });
  it('new card details win, blanks keep the old value, notes and pipeline are kept', () => {
    const row = fromDraft({ ...blankDraft(), full_name: 'gabriel  uy', job_title: 'Founder', company: 'Uy Smart', emails: ['new@x.example'], notes: 'typed', lead_status: 'New' });
    const p = overwritePatch(old, row);
    expect(p).toMatchObject({ job_title: 'Founder', company: 'Uy Smart', emails: ['new@x.example'] });
    expect(p).not.toHaveProperty('city');
    expect(p).not.toHaveProperty('notes');
    expect(p).not.toHaveProperty('lead_status');
    expect(p).not.toHaveProperty('full_name');
    expect(p).not.toHaveProperty('phones');
  });

  it('does not take the contact type from a scanned card', () => {
    expect(draftFromScan({ full_name: 'Z', contact_type: 'Prospect' }).contact_type).toBe(blankDraft().contact_type);
  });
});
