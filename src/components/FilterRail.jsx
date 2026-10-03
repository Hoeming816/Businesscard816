import { useMemo, useState } from 'react';
import {
  FILTER_CATEGORIES, CATEGORY_BY_KEY, VISIBILITY_OPTIONS, categoryOptions, norm, emptyFilters, activeFilterCount,
} from '../filters.js';
import { load, save } from '../storage.js';
import { Icon } from './ui.jsx';

const OPEN_KEY = 'cardfile.filterSections';
const SHOW_LIMIT = 8;

// Location is rendered as one cascading section; these keys are folded into it.
const SECTIONS = [
  ...FILTER_CATEGORIES.filter((c) => !c.group && c.key !== 'company' && c.key !== 'tags' && c.key !== 'date_added')
    .slice(0, 5).map((c) => ({ key: c.key, label: c.label })),
  { key: 'company', label: 'Company' },
  { key: 'location', label: 'Location' },
  ...['relationship', 'lead_status', 'opportunities', 'lead_source', 'last_contact', 'follow_up', 'priority', 'tags', 'date_added']
    .map((k) => ({ key: k, label: CATEGORY_BY_KEY[k].label })),
];

export default function FilterRail({ contacts, filters, setFilters, counts, drawer, onClose, id }) {
  const [open, setOpen] = useState(() => load(OPEN_KEY, { contact_type: true, industry: true, lead_status: true, follow_up: true }));
  const toggleOpen = (k) => setOpen((o) => {
    const next = { ...o, [k]: !o[k] };
    save(OPEN_KEY, next);
    return next;
  });

  const setSel = (key, values) => setFilters((f) => {
    const sel = { ...f.sel, [key]: values };
    // Cascade: dropping a country/region prunes now-impossible children.
    if (key === 'country' || key === 'region') {
      const inScope = (c) => (!sel.country.length || sel.country.some((v) => norm(v) === norm(c.country)))
        && (key === 'country' || !sel.region.length || sel.region.some((v) => norm(v) === norm(c.region)));
      const scoped = contacts.filter(inScope);
      if (key === 'country') {
        const regions = new Set(scoped.map((c) => norm(c.region)));
        sel.region = sel.region.filter((v) => regions.has(norm(v)));
      }
      const scoped2 = scoped.filter((c) => !sel.region.length || sel.region.some((v) => norm(v) === norm(c.region)));
      const cities = new Set(scoped2.map((c) => norm(c.city)));
      sel.city = sel.city.filter((v) => cities.has(norm(v)));
    }
    return { ...f, sel };
  });

  const toggleValue = (key, value) => {
    const cur = filters.sel[key] || [];
    const has = cur.some((v) => norm(v) === norm(value));
    setSel(key, has ? cur.filter((v) => norm(v) !== norm(value)) : [...cur, value]);
  };

  const n = activeFilterCount(filters);
  const clearAll = () => setFilters((f) => ({ ...emptyFilters(), q: f.q, groupBy: f.groupBy }));

  return (
    <aside
      id={id}
      className={`rail ${drawer ? 'is-open' : ''}`}
      aria-label="Filters"
      role={drawer ? 'dialog' : undefined}
      aria-modal={drawer ? 'true' : undefined}
    >
      <div className="rail-head">
        <h2 className="rail-title">Filters {n > 0 && <span className="count-badge">{n}</span>}</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={clearAll} disabled={n === 0 && !filters.dateFrom && !filters.dateTo}>
          Clear all
        </button>
        <button type="button" className="icon-btn rail-close" onClick={onClose} aria-label="Close filters">
          <Icon name="x" />
        </button>
      </div>

      <div className="rail-body">
        <fieldset className="seg" aria-label="Visibility">
          <legend className="sr-only">Visibility</legend>
          {VISIBILITY_OPTIONS.map((o) => (
            <label key={o.value} className={`seg-item ${filters.visibility === o.value ? 'is-active' : ''}`}>
              <input
                type="radio"
                name="visibility"
                value={o.value}
                checked={filters.visibility === o.value}
                onChange={() => setFilters((f) => ({ ...f, visibility: o.value }))}
              />
              {o.label}
            </label>
          ))}
        </fieldset>

        {SECTIONS.map((s) => {
          const active = s.key === 'location'
            ? ['country', 'region', 'city'].reduce((a, k) => a + filters.sel[k].length, 0)
            : filters.sel[s.key].length;
          const isOpen = !!open[s.key] || active > 0;
          return (
            <section key={s.key} className={`facet ${active ? 'is-active' : ''}`}>
              <h3 className="facet-h">
                <button type="button" className="facet-toggle" aria-expanded={isOpen} onClick={() => toggleOpen(s.key)}>
                  <span>{s.label}</span>
                  {active > 0 && <span className="count-badge">{active}</span>}
                  <Icon name="chevronDown" size={16} className="facet-caret" />
                </button>
              </h3>
              {isOpen && (
                <div className="facet-body">
                  {s.key === 'company' ? (
                    <CompanyFacet contacts={contacts} selected={filters.sel.company} counts={counts.company} onToggle={(v) => toggleValue('company', v)} />
                  ) : s.key === 'location' ? (
                    <LocationFacet contacts={contacts} filters={filters} counts={counts} onToggle={toggleValue} />
                  ) : (
                    <ValueList
                      name={s.key}
                      options={categoryOptions(contacts, CATEGORY_BY_KEY[s.key])}
                      selected={filters.sel[s.key]}
                      counts={counts[s.key]}
                      onToggle={(v) => toggleValue(s.key, v)}
                      hideZeroCustom={CATEGORY_BY_KEY[s.key].kind !== 'bucket'}
                      standard={CATEGORY_BY_KEY[s.key].values}
                      alwaysShow={s.key === 'date_added' ? ['Custom Range'] : []}
                    />
                  )}
                  {s.key === 'date_added' && filters.sel.date_added.includes('Custom Range') && (
                    <div className="date-range">
                      <label>
                        <span>From</span>
                        <input type="date" value={filters.dateFrom} max={filters.dateTo || undefined}
                          onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} />
                      </label>
                      <label>
                        <span>To</span>
                        <input type="date" value={filters.dateTo} min={filters.dateFrom || undefined}
                          onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))} />
                      </label>
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {drawer && (
        <div className="rail-foot">
          <button type="button" className="btn btn-primary btn-block" onClick={onClose}>Show results</button>
        </div>
      )}
    </aside>
  );
}

function ValueList({ name, options, selected, counts, onToggle, hideZeroCustom, standard = [], alwaysShow = [] }) {
  const [all, setAll] = useState(false);
  const selKeys = new Set(selected.map(norm));
  const stdKeys = new Set(standard.map(norm));
  const visible = options.filter((o) => {
    const k = norm(o);
    if (selKeys.has(k) || alwaysShow.includes(o)) return true;
    if (hideZeroCustom && !stdKeys.has(k)) return (counts.get(k) || 0) > 0;
    return true;
  });
  if (!visible.length) return <p className="help">No values yet.</p>;
  const shown = all ? visible : visible.slice(0, SHOW_LIMIT);
  return (
    <>
      <ul className="values">
        {shown.map((o) => {
          const k = norm(o);
          const c = counts.get(k) || 0;
          const checked = selKeys.has(k);
          return (
            <li key={k}>
              <label className={`value ${checked ? 'is-checked' : ''} ${!c && !checked ? 'is-zero' : ''}`}>
                <input type="checkbox" name={name} checked={checked} onChange={() => onToggle(o)} />
                <span className="value-label">{o}</span>
                <span className="value-count">{c}</span>
              </label>
            </li>
          );
        })}
      </ul>
      {visible.length > SHOW_LIMIT && (
        <button type="button" className="link small" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${visible.length}`}
        </button>
      )}
    </>
  );
}

function CompanyFacet({ contacts, selected, counts, onToggle }) {
  const [q, setQ] = useState('');
  const options = useMemo(() => categoryOptions(contacts, CATEGORY_BY_KEY.company), [contacts]);
  const selKeys = new Set(selected.map(norm));
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matching = options.filter((o) => !selKeys.has(norm(o)) && words.every((w) => o.toLowerCase().includes(w)) && (counts.get(norm(o)) || 0) > 0);
  return (
    <div className="company-facet">
      <div className="input-icon">
        <Icon name="search" size={15} />
        <input type="search" placeholder="Search companies" aria-label="Search companies" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {selected.length > 0 && (
        <div className="chips" aria-label="Selected companies">
          {selected.map((s) => (
            <button key={s} type="button" className="chip is-on" onClick={() => onToggle(s)} aria-label={`Remove ${s}`}>
              {s} <span className="chip-count">{counts.get(norm(s)) || 0}</span> <Icon name="x" size={12} />
            </button>
          ))}
        </div>
      )}
      <ul className="values values-scroll">
        {matching.slice(0, 60).map((o) => (
          <li key={o}>
            <label className="value">
              <input type="checkbox" checked={false} onChange={() => onToggle(o)} />
              <span className="value-label">{o}</span>
              <span className="value-count">{counts.get(norm(o)) || 0}</span>
            </label>
          </li>
        ))}
        {!matching.length && <li className="help">No matching companies.</li>}
      </ul>
      {matching.length > 60 && <p className="help">Showing 60 of {matching.length}. Refine the search.</p>}
    </div>
  );
}

function LocationFacet({ contacts, filters, counts, onToggle }) {
  const { country, region } = filters.sel;
  const inCountry = (c) => country.some((v) => norm(v) === norm(c.country));
  const inRegion = (c) => region.some((v) => norm(v) === norm(c.region));
  const countries = categoryOptions(contacts, CATEGORY_BY_KEY.country);
  const regions = country.length ? categoryOptions(contacts, CATEGORY_BY_KEY.region, { where: inCountry }) : [];
  const cities = region.length
    ? categoryOptions(contacts, CATEGORY_BY_KEY.city, { where: (c) => inCountry(c) && inRegion(c) })
    : [];
  return (
    <div className="location-facet">
      <p className="facet-sub">Country</p>
      <ValueList name="country" options={countries} selected={filters.sel.country} counts={counts.country} onToggle={(v) => onToggle('country', v)} hideZeroCustom />
      {country.length > 0 && (
        <div className="cascade">
          <p className="facet-sub">Region / State</p>
          <ValueList name="region" options={regions} selected={filters.sel.region} counts={counts.region} onToggle={(v) => onToggle('region', v)} />
        </div>
      )}
      {region.length > 0 && (
        <div className="cascade cascade-2">
          <p className="facet-sub">City</p>
          <ValueList name="city" options={cities} selected={filters.sel.city} counts={counts.city} onToggle={(v) => onToggle('city', v)} />
        </div>
      )}
      {!country.length && <p className="help">Pick a country to narrow by region and city.</p>}
    </div>
  );
}
