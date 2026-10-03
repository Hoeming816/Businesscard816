import { describe, it, expect } from 'vitest';
import {
  NOT_SET, addDays, addMonths, startOfWeek, startOfMonth, localDate, todayISO,
  lastContactBuckets, followUpBuckets, dateAddedBuckets, inDateRange, followUpState,
  searchText, matchesSearch, tokenize, matchesVisibility,
  emptyFilters, normalizeFilters, applyFilters, facetCounts, activeFilterCount,
  categoryOptions, fieldSuggestions, CATEGORY_BY_KEY, FILTER_CATEGORIES,
  groupContacts, GROUP_BY_OPTIONS, findDuplicates, norm,
} from './filters.js';
import { INDUSTRIES, PRIORITIES } from './taxonomy.js';

// Fixed "today": Wednesday 15 October 2025.
const TODAY = '2025-10-15';
const ME = 'user-me';
const OTHER = 'user-other';
const ctx = { uid: ME, today: TODAY };

let seq = 0;
function mk(over = {}) {
  seq += 1;
  return {
    id: `c${seq}`,
    created_by: ME,
    is_private: false,
    full_name: '',
    emails: [],
    phones: [],
    tags: [],
    opportunities: [],
    created_at: '2025-01-01T10:00:00',
    ...over,
  };
}

function withSel(sel, extra = {}) {
  const f = emptyFilters();
  Object.assign(f.sel, sel);
  return { ...f, ...extra };
}

describe('date helpers', () => {
  it('formats today as local YYYY-MM-DD', () => {
    expect(todayISO(new Date(2025, 9, 15, 23, 59))).toBe('2025-10-15');
  });
  it('adds days across month and year boundaries', () => {
    expect(addDays('2025-10-15', -7)).toBe('2025-10-08');
    expect(addDays('2025-03-01', -1)).toBe('2025-02-28');
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01');
  });
  it('adds months and clamps to month end', () => {
    expect(addMonths('2025-10-15', -6)).toBe('2025-04-15');
    expect(addMonths('2025-08-31', -6)).toBe('2025-02-28');
    expect(addMonths('2025-03-31', 1)).toBe('2025-04-30');
  });
  it('starts the week on Monday', () => {
    expect(startOfWeek('2025-10-15')).toBe('2025-10-13'); // Wed -> Mon
    expect(startOfWeek('2025-10-13')).toBe('2025-10-13'); // Mon
    expect(startOfWeek('2025-10-19')).toBe('2025-10-13'); // Sun -> previous Mon
    expect(startOfWeek('2025-10-01')).toBe('2025-09-29'); // crosses month
  });
  it('starts the month on the 1st', () => {
    expect(startOfMonth('2025-10-15')).toBe('2025-10-01');
  });
  it('localDate passes plain dates through and converts timestamps', () => {
    expect(localDate('2025-10-15')).toBe('2025-10-15');
    expect(localDate('2025-10-15T08:30:00')).toBe('2025-10-15');
    expect(localDate(null)).toBe(null);
    expect(localDate('garbage')).toBe(null);
  });
});

describe('search (FR-17)', () => {
  const c = mk({
    full_name: 'Maria Clara Santos',
    job_title: 'Procurement Manager',
    company: 'Luzon Fiber Corp',
    department: 'Supply Chain',
    website: 'luzonfiber.example.com',
    address: '12 Ayala Avenue',
    city: 'Makati',
    region: 'Metro Manila',
    country: 'Philippines',
    notes: 'Met at the Manila Telco Expo',
    card_text: 'ISO 9001 certified',
    emails: ['maria.santos@luzonfiber.example.com'],
    phones: [{ label: 'Mobile', number: '+63 917 555 0101' }],
    tags: ['vip', 'expo-2025'],
  });

  it.each([
    ['name', 'clara'],
    ['title', 'procurement'],
    ['company', 'luzon fiber'],
    ['department', 'supply'],
    ['website', 'luzonfiber.example'],
    ['address', 'ayala'],
    ['city', 'makati'],
    ['region', 'metro'],
    ['country', 'philippines'],
    ['notes', 'telco expo'],
    ['card text', 'iso 9001'],
    ['email', 'maria.santos@'],
    ['phone as printed', '917 555'],
    ['phone digits only', '9175550101'],
    ['tag', 'vip'],
  ])('matches on %s', (_label, q) => {
    expect(matchesSearch(c, q)).toBe(true);
  });

  it('requires every word to match (AND)', () => {
    expect(matchesSearch(c, 'maria makati')).toBe(true);
    expect(matchesSearch(c, 'maria singapore')).toBe(false);
  });
  it('is case-insensitive and ignores extra whitespace', () => {
    expect(matchesSearch(c, '  MARIA   Santos ')).toBe(true);
    expect(tokenize('  a  b ')).toEqual(['a', 'b']);
  });
  it('matches Chinese names, companies and full-width text', () => {
    const zh = mk({ full_name: 'Tan Wei Ming (陈伟明)', company: '亚斯本通讯科技有限公司', card_text: 'ＴＥＬ：＋６３ ９１７' });
    expect(matchesSearch(zh, '陈伟明')).toBe(true);
    expect(matchesSearch(zh, '伟明')).toBe(true);
    expect(matchesSearch(zh, '通讯 tan')).toBe(true);
    expect(matchesSearch(zh, 'tel')).toBe(true);
    expect(matchesSearch(zh, '９１７')).toBe(true);
    expect(matchesSearch(zh, '李')).toBe(false);
  });
  it('empty query matches everything', () => {
    expect(matchesSearch(mk(), '')).toBe(true);
    expect(matchesSearch(mk(), '   ')).toBe(true);
  });
  it('does not search classification fields that are not in FR-17', () => {
    expect(matchesSearch(mk({ industry: 'Telecom' }), 'telecom')).toBe(false);
  });
  it('tolerates missing arrays and phones without numbers', () => {
    const bare = { full_name: 'X', phones: [{ label: 'Mobile' }] };
    expect(searchText(bare)).toContain('x');
    expect(matchesSearch(bare, 'x')).toBe(true);
  });
});

describe('visibility (FR-18)', () => {
  const sharedMine = mk({ created_by: ME, is_private: false });
  const privateMine = mk({ created_by: ME, is_private: true });
  const sharedOther = mk({ created_by: OTHER, is_private: false });
  const all = [sharedMine, privateMine, sharedOther];
  const pick = (v) => all.filter((c) => matchesVisibility(c, v, ME));

  it('All', () => expect(pick('all')).toEqual(all));
  it('Shared', () => expect(pick('shared')).toEqual([sharedMine, sharedOther]));
  it('Private', () => expect(pick('private')).toEqual([privateMine]));
  it('Added by me', () => expect(pick('mine')).toEqual([sharedMine, privateMine]));
  it('applyFilters honours visibility', () => {
    expect(applyFilters(all, { ...emptyFilters(), visibility: 'shared' }, ctx)).toHaveLength(2);
  });
});

describe('categories: OR within, AND across (FR-19)', () => {
  const a = mk({ full_name: 'A', industry: 'Telecom', contact_type: 'Customer', opportunities: ['CCTV', 'Wi-Fi'], tags: ['vip'] });
  const b = mk({ full_name: 'B', industry: 'IT', contact_type: 'Prospect', opportunities: ['Firewall'] });
  const c = mk({ full_name: 'C', industry: 'Telecom', contact_type: 'Prospect', opportunities: [] , tags: ['VIP', 'expo'] });
  const d = mk({ full_name: 'D', industry: 'construction ', contact_type: null });
  const all = [a, b, c, d];
  const names = (list) => list.map((x) => x.full_name);

  it('no filters returns everything', () => {
    expect(applyFilters(all, emptyFilters(), ctx)).toHaveLength(4);
  });
  it('OR within one category', () => {
    expect(names(applyFilters(all, withSel({ industry: ['Telecom', 'IT'] }), ctx))).toEqual(['A', 'B', 'C']);
  });
  it('AND across categories', () => {
    expect(names(applyFilters(all, withSel({ industry: ['Telecom'], contact_type: ['Prospect'] }), ctx))).toEqual(['C']);
  });
  it('matches case-insensitively and trims', () => {
    expect(names(applyFilters(all, withSel({ industry: ['Construction'] }), ctx))).toEqual(['D']);
  });
  it('array categories match any element (OR)', () => {
    expect(names(applyFilters(all, withSel({ opportunities: ['Wi-Fi', 'Firewall'] }), ctx))).toEqual(['A', 'B']);
  });
  it('tags match case-insensitively', () => {
    expect(names(applyFilters(all, withSel({ tags: ['vip'] }), ctx))).toEqual(['A', 'C']);
  });
  it('combines with search', () => {
    expect(names(applyFilters(all, withSel({ industry: ['Telecom'] }, { q: 'c' }), ctx))).toEqual(['C']);
  });
  it('location parts AND together (cascade)', () => {
    const p = mk({ full_name: 'P', country: 'Philippines', region: 'Metro Manila', city: 'Makati' });
    const q = mk({ full_name: 'Q', country: 'Philippines', region: 'Cebu', city: 'Cebu City' });
    const s = mk({ full_name: 'S', country: 'Singapore', city: 'Singapore' });
    const list = [p, q, s];
    expect(names(applyFilters(list, withSel({ country: ['Philippines'] }), ctx))).toEqual(['P', 'Q']);
    expect(names(applyFilters(list, withSel({ country: ['Philippines'], region: ['Cebu'] }), ctx))).toEqual(['Q']);
    expect(names(applyFilters(list, withSel({ country: ['Philippines', 'Singapore'], city: ['Makati', 'Singapore'] }), ctx))).toEqual(['P', 'S']);
  });
  it('company filter', () => {
    const list = [mk({ full_name: 'X', company: 'Acme' }), mk({ full_name: 'Y', company: 'Globex' })];
    expect(names(applyFilters(list, withSel({ company: ['acme'] }), ctx))).toEqual(['X']);
  });
});

describe('Last Contact buckets', () => {
  const lc = (date) => lastContactBuckets({ last_contacted_on: date }, TODAY);
  it('Never Contacted when empty', () => expect(lc(null)).toEqual(['Never Contacted']));
  it('Today is in every recent window', () => expect(lc(TODAY)).toEqual(['Today', '7 Days', '30 Days', '90 Days']));
  it('7 days ago is inside 7 Days', () => expect(lc('2025-10-08')).toEqual(['7 Days', '30 Days', '90 Days']));
  it('8 days ago is outside 7 Days', () => expect(lc('2025-10-07')).toEqual(['30 Days', '90 Days']));
  it('30 days boundary', () => {
    expect(lc('2025-09-15')).toEqual(['30 Days', '90 Days']);
    expect(lc('2025-09-14')).toEqual(['90 Days']);
  });
  it('90 days boundary', () => {
    expect(lc('2025-07-17')).toEqual(['90 Days']);
    expect(lc('2025-07-16')).toEqual([]);
  });
  it('6+ Months', () => {
    expect(lc('2025-04-15')).toEqual(['6+ Months']);
    expect(lc('2025-04-16')).toEqual([]);
    expect(lc('2023-01-01')).toEqual(['6+ Months']);
  });
  it('filters via applyFilters', () => {
    const list = [mk({ full_name: 'N' }), mk({ full_name: 'T', last_contacted_on: TODAY }), mk({ full_name: 'O', last_contacted_on: '2024-01-01' })];
    expect(applyFilters(list, withSel({ last_contact: ['Never Contacted', '6+ Months'] }), ctx).map((x) => x.full_name)).toEqual(['N', 'O']);
  });
});

describe('Follow-up buckets', () => {
  const fu = (date) => followUpBuckets({ next_follow_up_on: date }, TODAY);
  it('No Follow-up', () => expect(fu(null)).toEqual(['No Follow-up']));
  it('today is Due and Today', () => expect(fu(TODAY)).toEqual(['Follow-up Due', 'Follow-up Today']));
  it('past is Due and Overdue', () => expect(fu('2025-10-14')).toEqual(['Follow-up Due', 'Overdue']));
  it('future is Upcoming', () => expect(fu('2025-10-16')).toEqual(['Upcoming']));
  it('row pill state', () => {
    expect(followUpState({ next_follow_up_on: '2025-10-01' }, TODAY)).toBe('overdue');
    expect(followUpState({ next_follow_up_on: TODAY }, TODAY)).toBe('today');
    expect(followUpState({ next_follow_up_on: '2025-11-01' }, TODAY)).toBe(null);
    expect(followUpState({}, TODAY)).toBe(null);
  });
});

describe('Date Added buckets', () => {
  const da = (ts) => dateAddedBuckets({ created_at: ts }, TODAY);
  it('Today', () => expect(da('2025-10-15T09:00:00')).toEqual(['Today', 'This Week', 'This Month']));
  it('This Week starts Monday', () => {
    expect(da('2025-10-13T00:00:00')).toEqual(['This Week', 'This Month']);
    expect(da('2025-10-12T23:59:00')).toEqual(['This Month']);
  });
  it('This Month', () => {
    expect(da('2025-10-01T08:00:00')).toEqual(['This Month']);
    expect(da('2025-09-30T08:00:00')).toEqual([]);
  });
  it('week spanning months still counts last month days in This Week only', () => {
    const today = '2025-10-01'; // Wednesday; week starts Mon 29 Sep
    expect(dateAddedBuckets({ created_at: '2025-09-29T10:00:00' }, today)).toEqual(['This Week']);
  });
  it('Custom Range inclusive, open-ended', () => {
    const c = { created_at: '2025-06-10T12:00:00' };
    expect(inDateRange(c, '2025-06-10', '2025-06-10')).toBe(true);
    expect(inDateRange(c, '2025-06-11', '')).toBe(false);
    expect(inDateRange(c, '', '2025-06-09')).toBe(false);
    expect(inDateRange(c, '', '')).toBe(true);
  });
  it('Custom Range via applyFilters, OR with other buckets', () => {
    const list = [
      mk({ full_name: 'Old', created_at: '2025-06-10T12:00:00' }),
      mk({ full_name: 'New', created_at: '2025-10-15T12:00:00' }),
      mk({ full_name: 'Mid', created_at: '2025-08-01T12:00:00' }),
    ];
    const f = withSel({ date_added: ['Custom Range', 'Today'] }, { dateFrom: '2025-06-01', dateTo: '2025-06-30' });
    expect(applyFilters(list, f, ctx).map((x) => x.full_name)).toEqual(['Old', 'New']);
  });
});

describe('facet counts (FR-20)', () => {
  const list = [
    mk({ industry: 'Telecom', priority: 'High', tags: ['vip'] }),
    mk({ industry: 'Telecom', priority: 'Low' }),
    mk({ industry: 'IT', priority: 'High', tags: ['vip', 'VIP'] }),
    mk({ industry: null, priority: 'High', is_private: true, created_by: OTHER }),
  ];
  it('counts every value with no filters', () => {
    const c = facetCounts(list, emptyFilters(), ctx);
    expect(c.industry.get('telecom')).toBe(2);
    expect(c.industry.get('it')).toBe(1);
    expect(c.priority.get('high')).toBe(3);
    expect(c.tags.get('vip')).toBe(2); // de-duplicated within a contact
    expect(c.last_contact.get(norm('Never Contacted'))).toBe(4);
  });
  it('a category\'s own selection does not narrow its own counts', () => {
    const c = facetCounts(list, withSel({ industry: ['IT'] }), ctx);
    expect(c.industry.get('telecom')).toBe(2);
    expect(c.industry.get('it')).toBe(1);
    // other categories are narrowed by industry = IT
    expect(c.priority.get('high')).toBe(1);
    expect(c.priority.get('low')).toBeUndefined();
  });
  it('respects search and visibility', () => {
    const c = facetCounts(list, { ...emptyFilters(), visibility: 'shared' }, ctx);
    expect(c.priority.get('high')).toBe(2);
  });
  it('counts Custom Range when dates are set', () => {
    const l = [mk({ created_at: '2025-06-10T12:00:00' }), mk({ created_at: '2025-08-10T12:00:00' })];
    const c = facetCounts(l, { ...emptyFilters(), dateFrom: '2025-06-01', dateTo: '2025-06-30' }, ctx);
    expect(c.date_added.get(norm('Custom Range'))).toBe(1);
  });
  it('active filter count', () => {
    expect(activeFilterCount(emptyFilters())).toBe(0);
    expect(activeFilterCount(withSel({ industry: ['IT', 'Telecom'], tags: ['x'] }))).toBe(2);
    expect(activeFilterCount({ ...emptyFilters(), visibility: 'mine' })).toBe(1);
  });
  it('facet counts equal filtered totals for a single selection', () => {
    const c = facetCounts(list, emptyFilters(), ctx);
    for (const v of PRIORITIES) {
      const n = applyFilters(list, withSel({ priority: [v] }), ctx).length;
      expect(c.priority.get(norm(v)) || 0).toBe(n);
    }
  });
});

describe('options and suggestions (FR-14)', () => {
  const list = [mk({ industry: 'Aerospace' }), mk({ industry: 'telecom' }), mk({ industry: 'agriculture' }), mk({ company: 'Zeta' }), mk({ company: 'alpha' })];
  it('standard values first, then custom A–Z, de-duplicated against standard', () => {
    const opts = categoryOptions(list, CATEGORY_BY_KEY.industry);
    expect(opts.slice(0, INDUSTRIES.length)).toEqual(INDUSTRIES);
    expect(opts.slice(INDUSTRIES.length)).toEqual(['Aerospace', 'agriculture']);
  });
  it('free categories list workspace values A–Z', () => {
    expect(categoryOptions(list, CATEGORY_BY_KEY.company)).toEqual(['alpha', 'Zeta']);
  });
  it('bucket categories list their buckets', () => {
    expect(categoryOptions(list, CATEGORY_BY_KEY.priority)).toEqual(PRIORITIES);
    expect(categoryOptions(list, CATEGORY_BY_KEY.follow_up)).toContain('Overdue');
  });
  it('where clause narrows options (cascading location)', () => {
    const l = [mk({ country: 'Philippines', region: 'Cebu' }), mk({ country: 'Malaysia', region: 'Selangor' })];
    const regions = categoryOptions(l, CATEGORY_BY_KEY.region, { where: (c) => c.country === 'Malaysia' });
    expect(regions).toEqual(['Selangor']);
  });
  it('fieldSuggestions includes array values', () => {
    const l = [mk({ tags: ['b', 'A'] }), mk({ tags: ['a'] })];
    expect(fieldSuggestions(l, 'tags')).toEqual(['A', 'b']);
  });
  it('every filter category from FR-19 is present', () => {
    const labels = FILTER_CATEGORIES.map((c) => c.label);
    for (const l of ['Contact Type', 'Industry', 'Business Category', 'Job Function', 'Seniority', 'Company',
      'Country', 'Relationship', 'Lead Status', 'Business Opportunity', 'Lead Source', 'Last Contact',
      'Follow-up Status', 'Priority', 'Tags', 'Date Added']) {
      expect(labels).toContain(l);
    }
  });
});

describe('grouping (FR-21)', () => {
  const list = [
    mk({ full_name: 'Zed', industry: 'Retail' }),
    mk({ full_name: 'amy', industry: 'Telecom' }),
    mk({ full_name: 'Bob', industry: 'Aquaculture' }),
    mk({ full_name: 'Cara', industry: '' }),
    mk({ full_name: 'Dan', industry: 'IT' }),
    mk({ full_name: 'Eve', industry: 'agritech' }),
    mk({ full_name: 'Fay', industry: 'telecom' }),
  ];

  it('standard order, then custom A–Z, Not set last', () => {
    const groups = groupContacts(list, 'industry');
    expect(groups.map((g) => g.label)).toEqual(['Telecom', 'IT', 'Retail', 'agritech', 'Aquaculture', NOT_SET]);
  });
  it('merges case variants under the standard spelling and sorts items by name', () => {
    const tel = groupContacts(list, 'industry').find((g) => g.label === 'Telecom');
    expect(tel.items.map((c) => c.full_name)).toEqual(['amy', 'Fay']);
  });
  it('priority uses High, Medium, Low order', () => {
    const l = [mk({ priority: 'Low' }), mk({ priority: 'High' }), mk({}), mk({ priority: 'Medium' })];
    expect(groupContacts(l, 'priority').map((g) => g.label)).toEqual(['High', 'Medium', 'Low', NOT_SET]);
  });
  it('company groups A–Z with Not set last', () => {
    const l = [mk({ company: 'beta' }), mk({ company: null }), mk({ company: 'Alpha' })];
    expect(groupContacts(l, 'company').map((g) => g.label)).toEqual(['Alpha', 'beta', NOT_SET]);
  });
  it('name groups by first letter, # for others, Not set last', () => {
    const l = [mk({ full_name: 'bea' }), mk({ full_name: '8x8 Rep' }), mk({ full_name: '' }), mk({ full_name: 'Alan' }), mk({ full_name: 'Ben' })];
    const g = groupContacts(l, 'name');
    expect(g.map((x) => x.label)).toEqual(['A', 'B', '#', NOT_SET]);
    expect(g[1].items.map((c) => c.full_name)).toEqual(['bea', 'Ben']);
  });
  it('none returns one group, newest first', () => {
    const l = [mk({ full_name: 'old', created_at: '2025-01-01T00:00:00Z' }), mk({ full_name: 'new', created_at: '2025-05-01T00:00:00Z' })];
    const g = groupContacts(l, 'none');
    expect(g).toHaveLength(1);
    expect(g[0].items.map((c) => c.full_name)).toEqual(['new', 'old']);
  });
  it('offers every FR-21 option', () => {
    expect(GROUP_BY_OPTIONS.map((o) => o.label)).toEqual([
      'None', 'Industry', 'Contact Type', 'Business Category', 'Job Function', 'Seniority',
      'Company', 'Country', 'Lead Status', 'Priority', 'Name (A–Z)',
    ]);
  });
});

describe('persistence', () => {
  it('normalizeFilters repairs stale or partial data', () => {
    const f = normalizeFilters({ q: 'x', visibility: 'bogus', sel: { industry: ['IT', 3], removed: ['y'] }, groupBy: 'nope' });
    expect(f.q).toBe('x');
    expect(f.visibility).toBe('all');
    expect(f.sel.industry).toEqual(['IT']);
    expect(f.sel.removed).toBeUndefined();
    expect(f.sel.tags).toEqual([]);
    expect(f.groupBy).toBe('none');
    expect(normalizeFilters(null)).toEqual(emptyFilters());
    expect(normalizeFilters({ groupBy: 'company' }).groupBy).toBe('company');
  });
});

describe('duplicates (FR-11)', () => {
  const existing = [
    mk({ id: 'e1', full_name: 'Jose Rizal', company: 'Calamba Telecom', emails: ['jose@calamba.example.com'] }),
    mk({ id: 'e2', full_name: 'Ana Cruz', company: 'Pasig Build' }),
  ];
  it('same email, case-insensitive', () => {
    expect(findDuplicates(existing, { emails: ['JOSE@calamba.example.com'] }).map((c) => c.id)).toEqual(['e1']);
  });
  it('same name and company', () => {
    expect(findDuplicates(existing, { full_name: ' ana cruz', company: 'PASIG BUILD ' }).map((c) => c.id)).toEqual(['e2']);
  });
  it('name alone is not a duplicate', () => {
    expect(findDuplicates(existing, { full_name: 'Ana Cruz', company: '' })).toEqual([]);
  });
  it('ignores the record being edited', () => {
    expect(findDuplicates(existing, { emails: ['jose@calamba.example.com'] }, 'e1')).toEqual([]);
  });
});
