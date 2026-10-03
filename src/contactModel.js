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

/** Same person: names equal ignoring case, spacing and full-width forms. */
export const nameKey = (v) => String(v ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

/** The caller's existing cards for the same person, most recently updated first. */
export function findSameName(contacts, name, uid) {
  const key = nameKey(name);
  if (!key) return [];
  return contacts
    .filter((c) => c.created_by === uid && nameKey(c.full_name) === key)
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
}

// Kept from the existing contact when it has them: your own follow-up work, not the card.
const KEPT_FIELDS = ['relationship', 'lead_status', 'lead_source', 'priority', 'notes', 'last_contacted_on', 'next_follow_up_on'];

/**
 * Patch that overwrites an existing contact's card details with a newly scanned
 * row (from fromDraft). The new card wins wherever it has a value; blanks on the
 * new card keep the old value. Notes, pipeline and dates are kept.
 */
export function overwritePatch(existing, row) {
  const patch = {};
  for (const [k, v] of Object.entries(row)) {
    const empty = v == null || v === '' || (Array.isArray(v) && v.length === 0);
    if (empty) continue;
    if (KEPT_FIELDS.includes(k) && existing[k] != null && existing[k] !== '') continue;
    if (k === 'full_name' && nameKey(v) === nameKey(existing.full_name)) continue; // same person: keep how the name was written
    if (JSON.stringify(existing[k] ?? null) !== JSON.stringify(v)) patch[k] = v;
  }
  return patch;
}
