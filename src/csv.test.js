import { describe, it, expect } from 'vitest';
import { toCsv, csvCell } from './csv.js';

describe('csv export', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('x\ny')).toBe('"x\ny"');
    expect(csvCell(null)).toBe('');
  });
  it('neutralises formula injection', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+63 917')).toBe("'+63 917");
  });
  it('exports only shared cards and the caller\'s own private cards', () => {
    const rows = [
      { full_name: 'Shared', is_private: false, created_by: 'b' },
      { full_name: 'Mine', is_private: true, created_by: 'a' },
      { full_name: 'Theirs', is_private: true, created_by: 'b' },
    ];
    const out = toCsv(rows, { uid: 'a', ownerName: (id) => (id === 'a' ? 'Me' : 'Them') });
    const lines = out.trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(out).toContain('Shared');
    expect(out).toContain('Mine');
    expect(out).not.toContain('Theirs');
  });
  it('joins arrays and phones', () => {
    const out = toCsv([{ full_name: 'A', emails: ['a@x.example', 'b@x.example'], phones: [{ label: 'Mobile', number: '123' }] }], { uid: 'u' });
    expect(out).toContain('a@x.example; b@x.example');
    expect(out).toContain('Mobile: 123');
  });
});
