import { describe, it, expect } from 'vitest';
import { fold, toVcard, vcardFileName, vEscape } from './vcard.js';

const unfold = (t) => t.replace(/\r\n /g, '');

describe('toVcard', () => {
  const contact = {
    full_name: 'Tan Wei Ming (陈伟明)',
    job_title: 'Sales Director',
    company: 'Aspencom Tech, Inc.',
    department: 'Sales',
    emails: ['wm.tan@aspencom.example.com', ''],
    phones: [
      { label: 'Mobile', number: '+65 9123 4567' },
      { label: 'Office', number: '+65 6123 4567' },
      { label: 'Fax', number: '+65 6123 0000' },
      { label: 'Direct', number: '' },
    ],
    website: 'www.aspencom.example.com',
    address: '1 Raffles Place; #20-01',
    city: 'Singapore',
    country: 'Singapore',
  };
  const out = toVcard(contact);
  const lines = unfold(out).split('\r\n');

  it('is a vCard 3.0 with CRLF line ends', () => {
    expect(lines[0]).toBe('BEGIN:VCARD');
    expect(lines[1]).toBe('VERSION:3.0');
    expect(out.endsWith('END:VCARD\r\n')).toBe(true);
  });
  it('carries name, company, title, email and phones', () => {
    expect(lines).toContain('FN:Tan Wei Ming (陈伟明)');
    expect(lines).toContain('N:;Tan Wei Ming (陈伟明);;;');
    expect(lines).toContain('ORG:Aspencom Tech\\, Inc.;Sales');
    expect(lines).toContain('TITLE:Sales Director');
    expect(lines.filter((l) => l.startsWith('EMAIL'))).toEqual(['EMAIL;TYPE=INTERNET,WORK:wm.tan@aspencom.example.com']);
    expect(lines).toContain('TEL;TYPE=CELL,VOICE:+65 9123 4567');
    expect(lines).toContain('TEL;TYPE=WORK,VOICE:+65 6123 4567');
    expect(lines).toContain('TEL;TYPE=WORK,FAX:+65 6123 0000');
    expect(lines.filter((l) => l.startsWith('TEL'))).toHaveLength(3);
  });
  it('escapes address separators', () => {
    expect(lines).toContain('ADR;TYPE=WORK:;;1 Raffles Place\\; #20-01;Singapore;;;Singapore');
  });
  it('falls back to the company when there is no name', () => {
    expect(toVcard({ company: 'Acme' })).toContain('FN:Acme');
  });
});

describe('helpers', () => {
  it('escapes text', () => expect(vEscape('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne'));
  it('folds long lines without splitting characters', () => {
    const long = `NOTE:${'陈'.repeat(60)}`;
    const folded = fold(long);
    for (const l of folded.split('\r\n')) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(long);
  });
  it('makes a safe file name', () => {
    expect(vcardFileName({ full_name: 'A/B: C' })).toBe('A B C.vcf');
    expect(vcardFileName({})).toBe('contact.vcf');
  });
});
