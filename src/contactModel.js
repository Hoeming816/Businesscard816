// Converting between contact rows, editable drafts and scanner output.

export const TEXT_FIELDS = [
  'full_name', 'job_title', 'company', 'department', 'website', 'address', 'city', 'region', 'country', 'card_text',
  'contact_type', 'industry', 'business_category', 'job_function', 'seniority',
  'relationship', 'lead_status', 'lead_source', 'priority', 'notes',
];
export const DATE_FIELDS = ['last_contacted_on', 'next_follow_up_on'];
export const MAX_TAGS_FROM_SCAN = 5;

export function blankDraft() {
  const d = {};
  for (const f of TEXT_FIELDS) d[f] = '';
  for (const f of DATE_FIELDS) d[f] = '';
  d.emails = [''];
  d.phones = [{ label: 'Mobile', number: '' }];
  d.opportunities = [];
  d.tags = [];
  return d;
}

export function toDraft(c = {}) {
  const d = blankDraft();
  for (const f of TEXT_FIELDS) d[f] = c[f] ?? '';
  for (const f of DATE_FIELDS) d[f] = c[f] ?? '';
  d.emails = c.emails && c.emails.length ? [...c.emails] : [''];
  d.phones = c.phones && c.phones.length ? c.phones.map((p) => ({ label: p.label || 'Mobile', number: p.number || '' })) : [{ label: 'Mobile', number: '' }];
  d.opportunities = [...(c.opportunities || [])];
  d.tags = [...(c.tags || [])];
  return d;
}

const uniq = (arr) => {
  const seen = new Set();
  return arr.filter((v) => {
    const k = v.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/** Draft -> DB columns (trimmed, empty -> null, arrays cleaned). */
export function fromDraft(d) {
  const row = {};
  for (const f of TEXT_FIELDS) {
    const v = String(d[f] ?? '').trim();
    row[f] = v || (f === 'full_name' ? '' : null);
  }
  for (const f of DATE_FIELDS) row[f] = d[f] || null;
  row.emails = uniq((d.emails || []).map((e) => String(e).trim()).filter(Boolean));
  row.phones = (d.phones || [])
    .map((p) => ({ label: p.label || 'Other', number: String(p.number || '').trim() }))
    .filter((p) => p.number);
  row.opportunities = uniq((d.opportunities || []).map((v) => String(v).trim()).filter(Boolean));
  row.tags = uniq((d.tags || []).map((v) => String(v).trim()).filter(Boolean));
  return row;
}

/** Merge scanner output into a draft (scanner values win when present). */
export function draftFromScan(card, base = blankDraft()) {
  const d = { ...base };
  for (const f of TEXT_FIELDS) {
    if (f in card && card[f] != null && String(card[f]).trim()) d[f] = String(card[f]).trim();
  }
  if (Array.isArray(card.emails) && card.emails.length) d.emails = card.emails.filter(Boolean);
  if (Array.isArray(card.phones) && card.phones.length) {
    d.phones = card.phones.filter((p) => p && p.number).map((p) => ({ label: p.label || 'Other', number: p.number }));
  }
  if (Array.isArray(card.opportunities)) d.opportunities = card.opportunities.filter(Boolean);
  if (Array.isArray(card.tags)) d.tags = card.tags.filter(Boolean).slice(0, MAX_TAGS_FROM_SCAN);
  if (!d.emails.length) d.emails = [''];
  if (!d.phones.length) d.phones = [{ label: 'Mobile', number: '' }];
  return d;
}

/** Only the columns that differ between a contact and a row from fromDraft(). */
export function diff(contact, row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (JSON.stringify(contact[k] ?? null) !== JSON.stringify(v ?? null)) out[k] = v;
  }
  return out;
}
