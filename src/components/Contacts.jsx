import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useApp } from '../context.js';
import {
  applyFilters, facetCounts, groupContacts, normalizeFilters, activeFilterCount, GROUP_BY_OPTIONS,
  followUpState, todayISO,
} from '../filters.js';
import { toCsv, downloadText } from '../csv.js';
import { load, save } from '../storage.js';
import FilterRail from './FilterRail.jsx';
import ContactDetail from './ContactDetail.jsx';
import { Icon, Pill, EmptyState, Spinner, initials } from './ui.jsx';

const FILTERS_KEY = 'cardfile.filters';
const PAGE = 150;
const SIGN_FIRST = 300;

export default function Contacts() {
  const { uid, contacts, contactsState, contactsError, reloadContacts, ensureSigned, signed, memberName, workspace, setView, role, toast } = useApp();
  const [filters, setFiltersRaw] = useState(() => normalizeFilters(load(FILTERS_KEY)));
  const [drawer, setDrawer] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [openId, setOpenId] = useState(null);
  const deferred = useDeferredValue(filters);

  const setFilters = (fn) => setFiltersRaw((f) => {
    const next = typeof fn === 'function' ? fn(f) : fn;
    save(FILTERS_KEY, next);
    return next;
  });

  const today = todayISO();
  const ctx = useMemo(() => ({ uid, today }), [uid, today]);
  const filtered = useMemo(() => applyFilters(contacts, deferred, ctx), [contacts, deferred, ctx]);
  const counts = useMemo(() => facetCounts(contacts, deferred, ctx), [contacts, deferred, ctx]);
  const groups = useMemo(() => groupContacts(filtered, deferred.groupBy), [filtered, deferred.groupBy]);
  const nActive = activeFilterCount(filters);

  useEffect(() => { setLimit(PAGE); }, [deferred]);

  // Sign thumbnails for the first 300 results, in batches.
  const ordered = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  useEffect(() => {
    ensureSigned('cards', ordered.slice(0, SIGN_FIRST).flatMap((c) => [c.front_path, c.face_path]));
  }, [ordered, ensureSigned]);
  useEffect(() => {
    if (limit > SIGN_FIRST) ensureSigned('cards', ordered.slice(0, limit).flatMap((c) => [c.front_path, c.face_path]));
  }, [limit, ordered, ensureSigned]);

  // Close the drawer with Escape.
  useEffect(() => {
    if (!drawer) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setDrawer(false); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('drawer-open');
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('drawer-open'); };
  }, [drawer]);

  const exportCsv = () => {
    const csv = toCsv(filtered, { uid, ownerName: memberName });
    const slug = (workspace?.name || 'contacts').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    downloadText(`cardfile-${slug}-${today}.csv`, csv);
    toast(`Exported ${filtered.filter((c) => c.created_by === uid).length} contacts`);
  };

  // Render groups up to `limit` rows.
  let budget = limit;
  const visibleGroups = [];
  for (const g of groups) {
    if (budget <= 0) break;
    visibleGroups.push({ ...g, items: g.items.slice(0, budget) });
    budget -= g.items.length;
  }

  const open = openId ? contacts.find((c) => c.id === openId) : null;

  return (
    <div className="contacts-layout">
      {drawer && <div className="drawer-backdrop" onClick={() => setDrawer(false)} aria-hidden="true" />}
      <FilterRail
        id="filter-rail"
        contacts={contacts}
        filters={filters}
        setFilters={setFilters}
        counts={counts}
        drawer={drawer}
        onClose={() => setDrawer(false)}
      />

      <section className="results" aria-labelledby="results-title">
        <div className="results-head">
          <div className="results-title-row">
            <h1 id="results-title" className="h1">Business cards</h1>
            <span className="result-count mono" aria-live="polite">
              {contactsState === 'ready' ? `${filtered.length} of ${contacts.length}` : ''}
            </span>
          </div>
          <div className="toolbar">
            <div className="input-icon search">
              <Icon name="search" size={17} />
              <input
                type="search"
                placeholder="Search name, company, phone, email, tags…"
                aria-label="Search contacts"
                value={filters.q}
                onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
              />
            </div>
            <button
              type="button"
              className={`btn btn-outline filters-btn ${nActive ? 'has-active' : ''}`}
              onClick={() => setDrawer(true)}
              aria-controls="filter-rail"
              aria-expanded={drawer}
            >
              <Icon name="filter" size={16} /> Filters{nActive ? ` (${nActive})` : ''}
            </button>
            <label className="select-inline group-by">
              <span>Group by</span>
              <select value={filters.groupBy} onChange={(e) => setFilters((f) => ({ ...f, groupBy: e.target.value }))}>
                {GROUP_BY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.value === 'none' ? 'No grouping' : o.label}</option>)}
              </select>
            </label>
            <button type="button" className="btn btn-outline" onClick={exportCsv} disabled={!filtered.length}>
              <Icon name="download" size={16} /> <span className="hide-sm">Export </span>CSV
            </button>
          </div>
        </div>

        {contactsState === 'loading' && !contacts.length && <div className="loading-block"><Spinner /> Loading contacts…</div>}
        {contactsState === 'error' && (
          <div className="notice notice-error" role="alert">
            Could not load contacts: {contactsError}{' '}
            <button type="button" className="link" onClick={reloadContacts}>Try again</button>
          </div>
        )}
        {contactsState === 'ready' && !contacts.length && (
          <EmptyState
            title="No cards yet"
            action={role === 'viewer' ? null : <button type="button" className="btn btn-primary" onClick={() => setView('scan')}><Icon name="scan" size={16} /> Scan your first card</button>}
          >
            {role === 'viewer' ? 'Cards your team scans will show up here.' : 'Scan a business card and Nomiqo will read and file it for you.'}
          </EmptyState>
        )}
        {contactsState === 'ready' && contacts.length > 0 && !filtered.length && (
          <EmptyState icon="search" title="No contacts match" action={
            <button type="button" className="btn btn-outline" onClick={() => setFilters((f) => ({ ...normalizeFilters(null), groupBy: f.groupBy }))}>Clear search and filters</button>
          }>
            Try fewer words or remove a filter.
          </EmptyState>
        )}

        <div className="groups">
          {visibleGroups.map((g) => (
            <section key={g.key} className={`group ${g.label ? '' : 'group-plain'}`} aria-label={g.label || 'All contacts'}>
              {g.label && (
                <h2 className="group-tab">
                  <span className="group-tab-label">{g.label}</span>
                  <span className="group-tab-count mono">{groups.find((x) => x.key === g.key).items.length}</span>
                </h2>
              )}
              <ul className="rows">
                {g.items.map((c) => (
                  <li key={c.id}>
                    <ContactRow c={c} today={today} uid={uid} thumb={signed('cards', c.front_path)} face={c.face_path ? signed('cards', c.face_path) : null} onOpen={() => setOpenId(c.id)} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        {filtered.length > limit && (
          <div className="more">
            <button type="button" className="btn btn-outline" onClick={() => setLimit((l) => l + PAGE * 2)}>
              Show more ({filtered.length - limit} remaining)
            </button>
          </div>
        )}
      </section>

      {open && <ContactDetail contact={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function ContactRow({ c, today, uid, thumb, face, onOpen }) {
  const fu = followUpState(c, today);
  const phone = (c.phones || []).find((p) => p && p.number);
  const email = (c.emails || [])[0];
  const sub = [c.job_title, c.company].filter(Boolean).join(' · ');
  return (
    <button type="button" className="row" onClick={onOpen}>
      <span className="thumb-col" aria-hidden="true">
        {face && <img className="thumb-face" src={face} alt="" loading="lazy" />}
        <span className="thumb">
          {thumb ? <img src={thumb} alt="" loading="lazy" /> : <span className="thumb-ph">{initials(c.full_name || c.company)}</span>}
        </span>
      </span>
      <span className="row-main">
        <span className="row-name">{c.full_name || <em className="muted">No name</em>}</span>
        {sub && <span className="row-sub">{sub}</span>}
        <span className="row-pills">
          {c.contact_type && <Pill>{c.contact_type}</Pill>}
          {c.lead_status && <Pill tone="accent">{c.lead_status}</Pill>}
          {c.priority && <Pill tone={c.priority === 'High' ? 'hot' : 'neutral'}>{c.priority}</Pill>}
          {fu === 'overdue' && <Pill tone="danger" icon="clock">Follow-up overdue</Pill>}
          {fu === 'today' && <Pill tone="warn" icon="clock">Follow-up today</Pill>}
        </span>
      </span>
      <span className="row-contact mono">
        {phone && <span>{phone.number}</span>}
        {email && <span className="row-email">{email}</span>}
      </span>
      <Icon name="chevronRight" size={18} className="row-chev" />
    </button>
  );
}
