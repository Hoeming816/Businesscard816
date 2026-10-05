// "Save to Phone Contacts": a stored card as a vCard 3.0 (.vcf) file, which
// iPhone and Android open straight into their Contacts app.

import { downloadText } from './csv.js';

// Our phone labels -> vCard TEL types.
const TEL_TYPES = {
  Mobile: 'CELL,VOICE',
  Office: 'WORK,VOICE',
  Direct: 'WORK,VOICE',
  Fax: 'WORK,FAX',
  Other: 'VOICE',
};

/** Escape a vCard text value (RFC 6350 §3.4). */
export function vEscape(v) {
  return String(v ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/** Fold lines longer than 75 bytes (UTF-8 safe, never splitting a character). */
export function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = parts.length ? 74 : 75; // continuation lines start with a space
    if (bytes + n > limit) {
      parts.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

const clean = (v) => String(v ?? '').trim();

/** The contact as vCard text. */
export function toVcard(c = {}) {
  const name = clean(c.full_name);
  const company = clean(c.company);
  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  // The whole name goes in the given-name slot so it shows exactly as printed
  // (card names mix family-first and given-first orders, and Chinese).
  lines.push(`N:;${vEscape(name)};;;`);
  lines.push(`FN:${vEscape(name || company || 'Contact')}`);
  if (company || clean(c.department)) lines.push(`ORG:${vEscape(company)}${clean(c.department) ? `;${vEscape(clean(c.department))}` : ''}`);
  if (clean(c.job_title)) lines.push(`TITLE:${vEscape(clean(c.job_title))}`);
  for (const e of (c.emails || []).map(clean).filter(Boolean)) lines.push(`EMAIL;TYPE=INTERNET,WORK:${vEscape(e)}`);
  for (const p of c.phones || []) {
    const number = clean(p && p.number);
    if (!number) continue;
    lines.push(`TEL;TYPE=${TEL_TYPES[p.label] || 'VOICE'}:${vEscape(number)}`);
  }
  if (clean(c.website)) lines.push(`URL:${vEscape(clean(c.website))}`);
  const adr = [c.address, c.city, c.region, c.country].map(clean);
  if (adr.some(Boolean)) {
    // Street holds the full printed address; city/region/country as split out.
    lines.push(`ADR;TYPE=WORK:;;${adr[0] ? vEscape(adr[0]) : ''};${vEscape(adr[1])};${vEscape(adr[2])};;${vEscape(adr[3])}`);
  }
  lines.push('END:VCARD');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** A safe file name like "Tan Wei Ming.vcf". */
export function vcardFileName(c = {}) {
  const base = clean(c.full_name) || clean(c.company) || 'contact';
  return `${base.replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'contact'}.vcf`;
}

const isIOS = () => typeof navigator !== 'undefined'
  && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/**
 * Hand the vCard to the phone. iPhone Safari shows the contact with
 * "Create New Contact" when it opens the file itself; everywhere else the
 * .vcf downloads and opens in the Contacts app when tapped.
 */
export function saveToPhoneContacts(contact) {
  const text = toVcard(contact);
  const type = 'text/vcard;charset=utf-8';
  if (isIOS()) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return;
  }
  downloadText(vcardFileName(contact), text, type);
}
