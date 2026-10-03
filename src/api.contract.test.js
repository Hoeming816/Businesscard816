import { describe, it, expect } from 'vitest';
import * as real from './api.js';
import * as demo from './demo/api.js';

describe('demo api', () => {
  it('implements exactly the same surface as api.js', () => {
    expect(Object.keys(demo).sort()).toEqual(Object.keys(real).sort());
    for (const k of Object.keys(real)) expect(typeof demo[k]).toBe(typeof real[k]);
  });
  it('seeds about 40 contacts the demo user can see', async () => {
    const list = await demo.listContacts('w-north');
    expect(list.length).toBeGreaterThanOrEqual(38);
    expect(list.every((c) => !c.is_private || c.created_by === 'u-alex')).toBe(true);
  });
  it('bumps last contacted on a non-Note entry', async () => {
    const [c] = await demo.listContacts('w-north');
    await demo.updateContact(c.id, { last_contacted_on: '2000-01-01' });
    await demo.insertInteraction({ contact_id: c.id, kind: 'Call', occurred_on: '2001-02-03' });
    expect((await demo.getContact(c.id)).last_contacted_on).toBe('2001-02-03');
    await demo.insertInteraction({ contact_id: c.id, kind: 'Note', occurred_on: '2002-02-03' });
    expect((await demo.getContact(c.id)).last_contacted_on).toBe('2001-02-03');
  });
});
