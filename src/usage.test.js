import { describe, it, expect } from 'vitest';
import { usageFrequency, daysAgo } from './components/SuperAdmin.jsx';

describe('usage frequency', () => {
  it('labels by active days in the last 30', () => {
    expect(usageFrequency(20).label).toBe('Daily');
    expect(usageFrequency(15).label).toBe('Daily');
    expect(usageFrequency(5).label).toBe('Weekly');
    expect(usageFrequency(1).label).toBe('Now and then');
    expect(usageFrequency(0).label).toBe('Not in 30 days');
    expect(usageFrequency('3').label).toBe('Now and then');
  });
  it('says how long ago a day was', () => {
    const today = new Date('2026-11-17T10:00:00Z');
    expect(daysAgo('2026-11-17', today)).toBe('Today');
    expect(daysAgo('2026-11-16', today)).toBe('Yesterday');
    expect(daysAgo('2026-11-10', today)).toBe('7 days ago');
    expect(daysAgo('2026-09-01', today)).toMatch(/2026/);
  });
});
