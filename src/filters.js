// Pure filtering, search, grouping and counting logic for the contact list.
// No React, no I/O: everything here is unit tested in filters.test.js.

import {
  CONTACT_TYPES, INDUSTRIES, BUSINESS_CATEGORIES, JOB_FUNCTIONS, SENIORITIES,
  RELATIONSHIPS, LEAD_STATUSES, OPPORTUNITIES, LEAD_SOURCES, PRIORITIES,
  LAST_CONTACT_BUCKETS, FOLLOW_UP_BUCKETS, DATE_ADDED_BUCKETS,
} from './taxonomy.js';

export const NOT_SET = 'Not set';

// ---------------------------------------------------------------------------
// Dates (all as local YYYY-MM-DD strings, which compare correctly as strings)
// ---------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');

export function toISODate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(now = new Date()) {
  return toISODate(now);
}

function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, days) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function addMonths(iso, months) {
  const d = parseISO(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISODate(d);
}

/** Monday of the week containing `iso`. */
export function startOfWeek(iso) {
  const d = parseISO(iso);
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - dow);
  return toISODate(d);
}

export function startOfMonth(iso) {
  return iso.slice(0, 8) + '01';
}

/** Local calendar date of a timestamp (timestamptz string or Date) or a plain date. */
export function localDate(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return toISODate(d);
}

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

/** Last Contact buckets a contact falls in. Windows are cumulative (7 Days includes Today). */
export function lastContactBuckets(contact, today) {
  const last = localDate(contact.last_contacted_on);
  if (!last) return ['Never Contacted'];
  const out = [];
  if (last === today) out.push('Today');
  if (last >= addDays(today, -7)) out.push('7 Days');
  if (last >= addDays(today, -30)) out.push('30 Days');
  if (last >= addDays(today, -90)) out.push('90 Days');
  if (last <= addMonths(today, -6)) out.push('6+ Months');
  return out;
}

export function followUpBuckets(contact, today) {
  const next = localDate(contact.next_follow_up_on);
  if (!next) return ['No Follow-up'];
  const out = [];
  if (next <= today) out.push('Follow-up Due');
  if (next === today) out.push('Follow-up Today');
  if (next > today) out.push('Upcoming');
  if (next < today) out.push('Overdue');
  return out;
}

/** Date Added buckets (Custom Range is handled separately with explicit dates). */
export function dateAddedBuckets(contact, today) {
  const added = localDate(contact.created_at);
  if (!added) return [];
  const out = [];
  if (added === today) out.push('Today');
  if (added >= startOfWeek(today) && added <= today) out.push('This Week');
  if (added >= startOfMonth(today) && added <= today) out.push('This Month');
  return out;
}

export function inDateRange(contact, from, to) {
  const added = localDate(contact.created_at);
  if (!added) return false;
  if (from && added < from) return false;
  if (to && added > to) return false;
  return true;
}

/** 'overdue' | 'today' | null, for the status pill on a row. */
export function followUpState(contact, today) {
  const next = localDate(contact.next_follow_up_on);
  if (!next) return null;
  if (next < today) return 'overdue';
  if (next === today) return 'today';
  return null;
}

// ---------------------------------------------------------------------------
// Search (FR-17)
// ---------------------------------------------------------------------------

const SEARCH_TEXT_FIELDS = [
  'full_name', 'job_title', 'company', 'department', 'website', 'address',
  'city', 'region', 'country', 'notes', 'card_text',
];

export function searchText(contact) {
  const parts = SEARCH_TEXT_FIELDS.map((f) => contact[f] || '');
  for (const e of contact.emails || []) parts.push(e);
  for (const p of contact.phones || []) {
    if (!p || !p.number) continue;
    parts.push(p.number, p.number.replace(/[^\d+]/g, ''));
  }
  for (const t of contact.tags || []) parts.push(t);
  return parts.join(' \u0001 ').normalize('NFKC').toLowerCase();
}

export function tokenize(query) {
  // NFKC folds full-width letters and digits (common on Chinese cards) to normal ones.
  return String(query || '').normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);
}

/** True when every word of the query appears somewhere in the searchable fields. */
export function matchesSearch(contact, query, text) {
  const words = tokenize(query);
  if (!words.length) return true;
  const hay = text ?? searchText(contact);
  return words.every((w) => hay.includes(w));
}

// ---------------------------------------------------------------------------
// Visibility (FR-18)
// ---------------------------------------------------------------------------

export const VISIBILITY_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'shared', label: 'Shared' },
  { value: 'private', label: 'Private' },
  { value: 'mine', label: 'Added by me' },
];

export function matchesVisibility(contact, visibility, uid) {
  switch (visibility) {
    case 'shared': return !contact.is_private;
    case 'private': return !!contact.is_private && contact.created_by === uid;
    case 'mine': return contact.created_by === uid;
    default: return true;
  }
}

// ---------------------------------------------------------------------------
// Filter categories (FR-19)
// ---------------------------------------------------------------------------

export const norm = (v) => String(v ?? '').trim().toLowerCase();

/**
 * kind:
 *  field    single text column, standard values + custom
 *  array    text[] column
 *  free     single text column without a standard list (company, location parts)
 *  bucket   computed buckets
 */
export const FILTER_CATEGORIES = [
  { key: 'contact_type', label: 'Contact Type', kind: 'field', field: 'contact_type', values: CONTACT_TYPES },
  { key: 'industry', label: 'Industry', kind: 'field', field: 'industry', values: INDUSTRIES },
  { key: 'business_category', label: 'Business Category', kind: 'field', field: 'business_category', values: BUSINESS_CATEGORIES },
  { key: 'job_function', label: 'Job Function', kind: 'field', field: 'job_function', values: JOB_FUNCTIONS },
  { key: 'seniority', label: 'Seniority', kind: 'field', field: 'seniority', values: SENIORITIES },
  { key: 'company', label: 'Company', kind: 'free', field: 'company' },
  { key: 'country', label: 'Country', kind: 'free', field: 'country', group: 'location' },
  { key: 'region', label: 'Region / State', kind: 'free', field: 'region', group: 'location' },
  { key: 'city', label: 'City', kind: 'free', field: 'city', group: 'location' },
  { key: 'relationship', label: 'Relationship', kind: 'field', field: 'relationship', values: RELATIONSHIPS },
  { key: 'lead_status', label: 'Lead Status', kind: 'field', field: 'lead_status', values: LEAD_STATUSES },
  { key: 'opportunities', label: 'Business Opportunity', kind: 'array', field: 'opportunities', values: OPPORTUNITIES },
  { key: 'lead_source', label: 'Lead Source', kind: 'field', field: 'lead_source', values: LEAD_SOURCES },
  { key: 'last_contact', label: 'Last Contact', kind: 'bucket', values: LAST_CONTACT_BUCKETS },
  { key: 'follow_up', label: 'Follow-up Status', kind: 'bucket', values: FOLLOW_UP_BUCKETS },
  { key: 'priority', label: 'Priority', kind: 'field', field: 'priority', values: PRIORITIES },
  { key: 'tags', label: 'Tags', kind: 'array', field: 'tags', values: [] },
  { key: 'date_added', label: 'Date Added', kind: 'bucket', values: DATE_ADDED_BUCKETS },
];

export const CATEGORY_BY_KEY = Object.fromEntries(FILTER_CATEGORIES.map((c) => [c.key, c]));

export function emptyFilters() {
  return {
    q: '',
    visibility: 'all',
    sel: Object.fromEntries(FILTER_CATEGORIES.map((c) => [c.key, []])),
    dateFrom: '',
    dateTo: '',
    groupBy: 'none',
  };
}

/** Merge a persisted (possibly stale) filter object onto a clean default. */
export function normalizeFilters(saved) {
  const base = emptyFilters();
  if (!saved || typeof saved !== 'object') return base;
  const out = { ...base };
  if (typeof saved.q === 'string') out.q = saved.q;
  // Visibility is no longer offered (every card is the owner's own), so an old saved choice is dropped.
  if (typeof saved.dateFrom === 'string') out.dateFrom = saved.dateFrom;
  if (typeof saved.dateTo === 'string') out.dateTo = saved.dateTo;
  if (GROUP_BY_OPTIONS.some((o) => o.value === saved.groupBy)) out.groupBy = saved.groupBy;
  for (const c of FILTER_CATEGORIES) {
    const v = saved.sel && saved.sel[c.key];
    out.sel[c.key] = Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  }
  return out;
}

/** Values of one category that a contact has (as displayed strings). */
export function contactValues(contact, cat, today) {
  switch (cat.kind) {
    case 'field':
    case 'free': {
      const v = contact[cat.field];
      return v && String(v).trim() ? [String(v).trim()] : [];
    }
    case 'array':
      return (contact[cat.field] || []).filter((v) => v && String(v).trim()).map((v) => String(v).trim());
    case 'bucket':
      if (cat.key === 'last_contact') return lastContactBuckets(contact, today);
      if (cat.key === 'follow_up') return followUpBuckets(contact, today);
      if (cat.key === 'date_added') return dateAddedBuckets(contact, today);
      return [];
    default:
      return [];
  }
}

function matchesCategory(contact, cat, selected, filters, today) {
  if (!selected || !selected.length) return true;
  if (cat.key === 'date_added') {
    const buckets = dateAddedBuckets(contact, today);
    return selected.some((s) =>
      s === 'Custom Range' ? inDateRange(contact, filters.dateFrom, filters.dateTo) : buckets.includes(s));
  }
  const have = new Set(contactValues(contact, cat, today).map(norm));
  return selected.some((s) => have.has(norm(s)));
}

/** Number of categories with at least one selected value. */
export function activeFilterCount(filters) {
  let n = 0;
  for (const c of FILTER_CATEGORIES) if (filters.sel[c.key] && filters.sel[c.key].length) n++;
  if (filters.visibility && filters.visibility !== 'all') n++;
  return n;
}

/**
 * Apply search, visibility and every category filter.
 * ctx: { uid, today }
 */
export function applyFilters(contacts, filters, ctx) {
  const today = ctx.today || todayISO();
  return contacts.filter((c) =>
    matchesVisibility(c, filters.visibility, ctx.uid)
    && matchesSearch(c, filters.q)
    && FILTER_CATEGORIES.every((cat) => matchesCategory(c, cat, filters.sel[cat.key], filters, today)));
}

/**
 * Live counts (FR-20). The count for a value is the number of contacts that
 * would match if that value were selected, given every *other* category's
 * selection (standard facet counting). Returns { [catKey]: Map<normValue, count> }.
 */
export function facetCounts(contacts, filters, ctx) {
  const today = ctx.today || todayISO();
  const counts = Object.fromEntries(FILTER_CATEGORIES.map((c) => [c.key, new Map()]));
  for (const c of contacts) {
    if (!matchesVisibility(c, filters.visibility, ctx.uid)) continue;
    if (!matchesSearch(c, filters.q)) continue;
    const failing = [];
    for (const cat of FILTER_CATEGORIES) {
      if (!matchesCategory(c, cat, filters.sel[cat.key], filters, today)) {
        failing.push(cat.key);
        if (failing.length > 1) break;
      }
    }
    if (failing.length > 1) continue;
    for (const cat of FILTER_CATEGORIES) {
      if (failing.length === 1 && failing[0] !== cat.key) continue;
      const m = counts[cat.key];
      const seen = new Set();
      for (const v of contactValues(c, cat, today)) {
        const k = norm(v);
        if (seen.has(k)) continue;
        seen.add(k);
        m.set(k, (m.get(k) || 0) + 1);
      }
      if (cat.key === 'date_added' && (filters.dateFrom || filters.dateTo) && inDateRange(c, filters.dateFrom, filters.dateTo)) {
        m.set(norm('Custom Range'), (m.get(norm('Custom Range')) || 0) + 1);
      }
    }
  }
  return counts;
}

/**
 * Options to show for a category: standard values in order, then custom
 * values found in the workspace A–Z (case-insensitive de-duplication; the
 * standard spelling wins).
 */
export function categoryOptions(contacts, cat, extra = {}) {
  if (cat.kind === 'bucket') return [...cat.values];
  const std = cat.values || [];
  const stdKeys = new Set(std.map(norm));
  const custom = new Map();
  const scope = extra.where ? contacts.filter(extra.where) : contacts;
  for (const c of scope) {
    for (const v of contactValues(c, cat)) {
      const k = norm(v);
      if (!stdKeys.has(k) && !custom.has(k)) custom.set(k, v);
    }
  }
  const customSorted = [...custom.values()].sort(compareText);
  return [...std, ...customSorted];
}

/** Workspace values for a contact column (standard + custom), for datalists in forms. */
export function fieldSuggestions(contacts, field, standard = []) {
  const stdKeys = new Set(standard.map(norm));
  const custom = new Map();
  for (const c of contacts) {
    const raw = c[field];
    const list = Array.isArray(raw) ? raw : [raw];
    for (const v of list) {
      if (!v || !String(v).trim()) continue;
      const k = norm(v);
      if (!stdKeys.has(k) && !custom.has(k)) custom.set(k, String(v).trim());
    }
  }
  return [...standard, ...[...custom.values()].sort(compareText)];
}

export function compareText(a, b) {
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
}

// ---------------------------------------------------------------------------
// Grouping (FR-21)
// ---------------------------------------------------------------------------

export const GROUP_BY_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'industry', label: 'Industry', field: 'industry', values: INDUSTRIES },
  { value: 'contact_type', label: 'Contact Type', field: 'contact_type', values: CONTACT_TYPES },
  { value: 'business_category', label: 'Business Category', field: 'business_category', values: BUSINESS_CATEGORIES },
  { value: 'job_function', label: 'Job Function', field: 'job_function', values: JOB_FUNCTIONS },
  { value: 'seniority', label: 'Seniority', field: 'seniority', values: SENIORITIES },
  { value: 'company', label: 'Company', field: 'company', values: [] },
  { value: 'country', label: 'Country', field: 'country', values: [] },
  { value: 'lead_status', label: 'Lead Status', field: 'lead_status', values: LEAD_STATUSES },
  { value: 'priority', label: 'Priority', field: 'priority', values: PRIORITIES },
  { value: 'name', label: 'Name (A–Z)' },
];

export function byName(a, b) {
  return compareText(a.full_name || '￿', b.full_name || '￿');
}

export function byNewest(a, b) {
  return String(b.created_at || '').localeCompare(String(a.created_at || ''));
}

/**
 * Group contacts. Returns [{ key, label, items }].
 * Standard values in defined order, custom values A–Z, "Not set" last.
 * Without grouping, a single group (key 'all') sorted newest first.
 */
export function groupContacts(contacts, groupBy) {
  const opt = GROUP_BY_OPTIONS.find((o) => o.value === groupBy);
  if (!opt || opt.value === 'none') {
    return [{ key: 'all', label: '', items: [...contacts].sort(byNewest) }];
  }

  const buckets = new Map(); // normKey -> { label, items }
  const add = (k, label, c) => {
    if (!buckets.has(k)) buckets.set(k, { label, items: [] });
    buckets.get(k).items.push(c);
  };

  if (opt.value === 'name') {
    for (const c of contacts) {
      const first = (c.full_name || '').trim().charAt(0).toUpperCase();
      if (!first) add('\u0000notset', NOT_SET, c);
      else if (/[A-Z]/.test(first)) add(first.toLowerCase(), first, c);
      else add('#', '#', c);
    }
  } else {
    const stdMap = new Map(opt.values.map((v) => [norm(v), v]));
    for (const c of contacts) {
      const raw = c[opt.field];
      const v = raw && String(raw).trim();
      if (!v) add('\u0000notset', NOT_SET, c);
      else {
        const k = norm(v);
        add(k, stdMap.get(k) || v, c);
      }
    }
  }

  const stdOrder = new Map((opt.values || []).map((v, i) => [norm(v), i]));
  const rank = (k) => {
    if (k === '\u0000notset') return [3, ''];
    if (k === '#') return [2, ''];
    if (stdOrder.has(k)) return [0, stdOrder.get(k)];
    return [1, buckets.get(k).label];
  };

  return [...buckets.keys()]
    .sort((a, b) => {
      const [ra, va] = rank(a);
      const [rb, vb] = rank(b);
      if (ra !== rb) return ra - rb;
      if (ra === 0) return va - vb;
      return compareText(va, vb);
    })
    .map((k) => ({ key: k, label: buckets.get(k).label, items: buckets.get(k).items.sort(byName) }));
}

// ---------------------------------------------------------------------------
// Duplicates (FR-11)
// ---------------------------------------------------------------------------

export function findDuplicates(contacts, draft, ignoreId) {
  const emails = new Set((draft.emails || []).map(norm).filter(Boolean));
  const name = norm(draft.full_name);
  const company = norm(draft.company);
  return contacts.filter((c) => {
    if (ignoreId && c.id === ignoreId) return false;
    if ((c.emails || []).some((e) => emails.has(norm(e)))) return true;
    return !!name && !!company && norm(c.full_name) === name && norm(c.company) === company;
  });
}
