import { describe, expect, it } from 'vitest';
import {
  cleanNote, cleanTags, cleanTopicName, extractTags, filterNotes, findTopic, isEmptyNote, looksActionable, mergeActions,
  noteHeading, notePreview, pendingActions, quickNote, safeFileName, shareText, sortNotes,
} from './notes.js';

describe('quick notes', () => {
  it('reads #tags from text', () => {
    expect(extractTags('Call #Acme about #work and #work again, not a#tag')).toEqual(['Acme', 'work']);
    expect(extractTags('#客户 meeting')).toEqual(['客户']);
    expect(cleanTags([' #Work', 'work', '', 'Idea'])).toEqual(['Work', 'Idea']);
  });

  it('turns a typed line into a note, the first line a title when there are more', () => {
    expect(quickNote('Gate code 4471 #Work')).toEqual({ title: null, body: 'Gate code 4471 #Work', tags: ['Work'] });
    expect(quickNote('Cebu trip\nBook hotel\nPack sunscreen')).toEqual({ title: 'Cebu trip', body: 'Book hotel\nPack sunscreen', tags: [] });
  });

  it('names a note by its title, first line, checklist or photo', () => {
    expect(noteHeading({ title: ' Wi-Fi ', body: 'x' })).toBe('Wi-Fi');
    expect(noteHeading({ body: '\nFirst line\nsecond' })).toBe('First line');
    expect(notePreview({ body: '\nFirst line\nsecond' })).toBe('second');
    expect(noteHeading({ checklist: [{ text: 'Eggs' }] })).toBe('Eggs');
    expect(noteHeading({ files: [{ type: 'image/jpeg', name: 'a.jpg' }] })).toBe('Photo');
  });

  it('cleans a note before saving and spots empty ones', () => {
    const n = cleanNote({ title: '  ', body: 'hi  ', checklist: [{ text: ' a ' }, { text: '' }], color: 'orange', tags: ['#x'] });
    expect(n.title).toBeNull();
    expect(n.body).toBe('hi');
    expect(n.checklist).toHaveLength(1);
    expect(n.color).toBeNull();
    expect(n.tags).toEqual(['x']);
    expect(isEmptyNote({ title: ' ', body: '', checklist: [{ text: ' ' }], files: [] })).toBe(true);
    expect(isEmptyNote({ files: [{ path: 'p' }] })).toBe(false);
  });

  it('filters by view, topic and words, and sorts pinned first', () => {
    const notes = [
      { id: 'a', body: 'Hotel booking', topic_id: 't1', updated_at: '2026-10-01' },
      { id: 'b', body: 'Gate code', pinned: true, updated_at: '2026-09-01' },
      { id: 'c', body: 'Old', archived_at: '2026-01-01', updated_at: '2026-01-01' },
      { id: 'd', body: 'Gone', deleted_at: '2026-10-02', updated_at: '2026-10-02' },
    ];
    const topics = [{ id: 't1', name: 'Cebu trip' }];
    expect(sortNotes(filterNotes(notes, {}, topics)).map((n) => n.id)).toEqual(['b', 'a']);
    expect(filterNotes(notes, { q: 'cebu' }, topics).map((n) => n.id)).toEqual(['a']);
    expect(filterNotes(notes, { topic: 't1' }, topics).map((n) => n.id)).toEqual(['a']);
    expect(filterNotes(notes, { view: 'archived' }).map((n) => n.id)).toEqual(['c']);
    expect(filterNotes(notes, { view: 'trash' }).map((n) => n.id)).toEqual(['d']);
  });

  it('matches spoken topic names loosely', () => {
    const topics = [{ id: '1', name: 'Inventory Management software' }];
    expect(findTopic(topics, '"inventory management  Software"')?.id).toBe('1');
    expect(findTopic(topics, 'Cebu')).toBeNull();
    expect(cleanTopicName(' "Inventory Management software". ')).toBe('Inventory Management software');
  });

  it('only asks AI about notes that look like they hold a to-do', () => {
    expect(looksActionable('Need to call James tomorrow about the CCTV quotation.')).toBe(true);
    expect(looksActionable('明天打电话给James')).toBe(true);
    expect(looksActionable('Tawagan si James bukas')).toBe(true);
    expect(looksActionable('Wi-Fi password is on the router label')).toBe(false);
  });

  it('keeps added and dismissed offers, replaces waiting ones', () => {
    const old = [
      { id: '1', title: 'Call James', task_id: 't9' },
      { id: '2', title: 'Old idea', dismissed: true },
      { id: '3', title: 'Buy cables' },
    ];
    const merged = mergeActions(old, [{ title: 'call james', due_on: '2026-10-05' }, { title: 'Send quote', due_on: null }]);
    expect(merged.map((a) => a.title)).toEqual(['Call James', 'Old idea', 'Send quote']);
    expect(pendingActions({ actions: merged }).map((a) => a.title)).toEqual(['Send quote']);
  });

  it('writes a note out as text for sharing', () => {
    expect(shareText({ title: 'Packing', body: 'For Cebu', checklist: [{ text: 'Passport', done: true }, { text: 'Charger' }], tags: ['Personal'] }, 'Cebu trip'))
      .toBe('Cebu trip · Packing\n\nFor Cebu\n\n☑ Passport\n☐ Charger\n\n#Personal');
  });

  it('makes storage-safe file names', () => {
    expect(safeFileName('Quote (final) v2.pdf')).toBe('Quote-final-v2.pdf');
    expect(safeFileName('报价.pdf', 'file')).toBe('file.pdf');
    expect(safeFileName('', 'photo.jpg')).toBe('photo.jpg');
  });
});
