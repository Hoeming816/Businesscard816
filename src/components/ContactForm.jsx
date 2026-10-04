import { useId, useMemo, useState } from 'react';
import { CLASSIFICATION_FIELDS, OPPORTUNITIES, PHONE_LABELS } from '../taxonomy.js';
import { fieldSuggestions, norm } from '../filters.js';
import { Icon } from './ui.jsx';

/**
 * Editable form for every contact field. Classification fields accept the
 * standard values, custom values already used in the workspace, or new text
 * (input + datalist).
 */
export default function ContactForm({ draft, setDraft, contacts, readOnly = false, sections = ['card', 'class', 'rel'] }) {
  const uid = useId().replace(/:/g, '');
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  const suggestions = useMemo(() => {
    const out = {};
    for (const [field, def] of Object.entries(CLASSIFICATION_FIELDS)) out[field] = fieldSuggestions(contacts, field, def.values);
    out.company = fieldSuggestions(contacts, 'company');
    out.country = fieldSuggestions(contacts, 'country');
    out.region = fieldSuggestions(contacts, 'region');
    out.city = fieldSuggestions(contacts, 'city');
    out.tags = fieldSuggestions(contacts, 'tags');
    out.opportunities = fieldSuggestions(contacts, 'opportunities', OPPORTUNITIES);
    return out;
  }, [contacts]);

  const text = (k, label, opts = {}) => (
    <div className={`field ${opts.span ? `span-${opts.span}` : ''}`}>
      <label htmlFor={`${uid}-${k}`}>{label}</label>
      <input
        id={`${uid}-${k}`}
        type={opts.type || 'text'}
        value={draft[k] ?? ''}
        onChange={set(k)}
        readOnly={readOnly}
        list={opts.list ? `${uid}-dl-${k}` : undefined}
        autoComplete="off"
        inputMode={opts.inputMode}
        className={opts.mono ? 'mono' : undefined}
      />
      {opts.list && (
        <datalist id={`${uid}-dl-${k}`}>
          {opts.list.map((v) => <option key={v} value={v} />)}
        </datalist>
      )}
    </div>
  );

  const classField = (k) => {
    const def = CLASSIFICATION_FIELDS[k];
    return text(k, def.label, { list: suggestions[k] });
  };

  // Contact type with a one-tap "Prospect" mark beside it.
  const isProspect = draft.contact_type === 'Prospect';
  const contactTypeField = () => (
    <div className="field">
      <label htmlFor={`${uid}-contact_type`}>{CLASSIFICATION_FIELDS.contact_type.label}</label>
      <div className="type-row">
        <input
          id={`${uid}-contact_type`}
          value={draft.contact_type ?? ''}
          onChange={set('contact_type')}
          readOnly={readOnly}
          list={`${uid}-dl-contact_type`}
          autoComplete="off"
        />
        {!readOnly && (
          <button
            type="button"
            className={`btn btn-sm ${isProspect ? 'btn-primary' : 'btn-outline'} prospect-toggle`}
            aria-pressed={isProspect}
            onClick={() => setDraft((d) => ({ ...d, contact_type: isProspect ? '' : 'Prospect' }))}
          >
            {isProspect && <Icon name="check" size={14} />} Prospect
          </button>
        )}
      </div>
      <datalist id={`${uid}-dl-contact_type`}>
        {(suggestions.contact_type || []).map((v) => <option key={v} value={v} />)}
      </datalist>
    </div>
  );

  return (
    <div className={`contact-form ${readOnly ? 'is-readonly' : ''}`}>
      {sections.includes('card') && (
        <fieldset className="form-section">
          <legend>From the card</legend>
          <div className="grid-2">
            {text('full_name', 'Full name', { span: 2 })}
            {text('job_title', 'Job title')}
            {text('department', 'Department')}
            {text('company', 'Company', { span: 2, list: suggestions.company })}
          </div>

          <div className="field">
            <span className="label" id={`${uid}-emails`}>Emails</span>
            <div className="multi" role="group" aria-labelledby={`${uid}-emails`}>
              {draft.emails.map((e, i) => (
                <div className="multi-row" key={i}>
                  <input
                    type="email"
                    className="mono"
                    aria-label={`Email ${i + 1}`}
                    value={e}
                    readOnly={readOnly}
                    inputMode="email"
                    autoComplete="off"
                    onChange={(ev) => setDraft((d) => ({ ...d, emails: d.emails.map((x, j) => (j === i ? ev.target.value : x)) }))}
                  />
                  {!readOnly && draft.emails.length > 1 && (
                    <button type="button" className="icon-btn" aria-label={`Remove email ${i + 1}`}
                      onClick={() => setDraft((d) => ({ ...d, emails: d.emails.filter((_, j) => j !== i) }))}>
                      <Icon name="x" size={16} />
                    </button>
                  )}
                </div>
              ))}
              {!readOnly && (
                <button type="button" className="link small" onClick={() => setDraft((d) => ({ ...d, emails: [...d.emails, ''] }))}>
                  <Icon name="plus" size={14} /> Add email
                </button>
              )}
            </div>
          </div>

          <div className="field">
            <span className="label" id={`${uid}-phones`}>Phones</span>
            <div className="multi" role="group" aria-labelledby={`${uid}-phones`}>
              {draft.phones.map((p, i) => (
                <div className="multi-row" key={i}>
                  <select
                    aria-label={`Phone ${i + 1} label`}
                    value={p.label}
                    disabled={readOnly}
                    onChange={(ev) => setDraft((d) => ({ ...d, phones: d.phones.map((x, j) => (j === i ? { ...x, label: ev.target.value } : x)) }))}
                  >
                    {[...new Set([...PHONE_LABELS, p.label])].map((l) => <option key={l}>{l}</option>)}
                  </select>
                  <input
                    type="tel"
                    className="mono"
                    aria-label={`Phone ${i + 1} number`}
                    value={p.number}
                    readOnly={readOnly}
                    onChange={(ev) => setDraft((d) => ({ ...d, phones: d.phones.map((x, j) => (j === i ? { ...x, number: ev.target.value } : x)) }))}
                  />
                  {!readOnly && draft.phones.length > 1 && (
                    <button type="button" className="icon-btn" aria-label={`Remove phone ${i + 1}`}
                      onClick={() => setDraft((d) => ({ ...d, phones: d.phones.filter((_, j) => j !== i) }))}>
                      <Icon name="x" size={16} />
                    </button>
                  )}
                </div>
              ))}
              {!readOnly && (
                <button type="button" className="link small" onClick={() => setDraft((d) => ({ ...d, phones: [...d.phones, { label: 'Office', number: '' }] }))}>
                  <Icon name="plus" size={14} /> Add phone
                </button>
              )}
            </div>
          </div>

          <div className="grid-2">
            {text('website', 'Website', { span: 2, mono: true, inputMode: 'url' })}
            {text('address', 'Address', { span: 2 })}
            {text('city', 'City', { list: suggestions.city })}
            {text('region', 'Region / State', { list: suggestions.region })}
            {text('country', 'Country', { list: suggestions.country })}
          </div>
          <div className="field">
            <label htmlFor={`${uid}-card_text`}>Card text</label>
            <textarea id={`${uid}-card_text`} rows={3} value={draft.card_text} onChange={set('card_text')} readOnly={readOnly} className="mono small" />
          </div>
        </fieldset>
      )}

      {sections.includes('class') && (
        <fieldset className="form-section">
          <legend>Classification</legend>
          <div className="grid-2">
            {contactTypeField()}
            {classField('industry')}
            {classField('business_category')}
            {classField('job_function')}
            {classField('seniority')}
          </div>
          <ChipPicker
            label="Business opportunities"
            values={draft.opportunities}
            options={suggestions.opportunities}
            readOnly={readOnly}
            onChange={(v) => setDraft((d) => ({ ...d, opportunities: v }))}
            showOptions
          />
          <ChipPicker
            label="Tags"
            values={draft.tags}
            options={suggestions.tags}
            readOnly={readOnly}
            onChange={(v) => setDraft((d) => ({ ...d, tags: v }))}
          />
        </fieldset>
      )}

      {sections.includes('rel') && (
        <fieldset className="form-section">
          <legend>Relationship</legend>
          <div className="grid-2">
            {classField('relationship')}
            {classField('lead_status')}
            {classField('lead_source')}
            {classField('priority')}
            {text('last_contacted_on', 'Last contacted', { type: 'date' })}
            {text('next_follow_up_on', 'Next follow-up', { type: 'date' })}
          </div>
          <div className="field">
            <label htmlFor={`${uid}-notes`}>Notes</label>
            <textarea id={`${uid}-notes`} rows={3} value={draft.notes} onChange={set('notes')} readOnly={readOnly} />
          </div>
        </fieldset>
      )}
    </div>
  );
}

/** Multi-value picker: toggle known options, or type a new value. */
function ChipPicker({ label, values, options, onChange, readOnly, showOptions = false }) {
  const id = useId().replace(/:/g, '');
  const [input, setInput] = useState('');
  const has = (v) => values.some((x) => norm(x) === norm(v));
  const add = (v) => {
    const t = v.trim();
    if (!t || has(t)) return;
    const canonical = options.find((o) => norm(o) === norm(t)) || t;
    onChange([...values, canonical]);
  };
  const remove = (v) => onChange(values.filter((x) => norm(x) !== norm(v)));
  const shown = showOptions ? [...new Set([...options, ...values])] : values;

  return (
    <div className="field">
      <span className="label" id={`${id}-l`}>{label}</span>
      <div className="chips" role="group" aria-labelledby={`${id}-l`}>
        {shown.map((v) => {
          const on = has(v);
          if (readOnly && !on) return null;
          return (
            <button
              key={v}
              type="button"
              className={`chip ${on ? 'is-on' : ''}`}
              aria-pressed={on}
              disabled={readOnly}
              onClick={() => (on ? remove(v) : add(v))}
            >
              {on && <Icon name="check" size={12} strokeWidth={2.4} />} {v}
            </button>
          );
        })}
        {readOnly && !values.length && <span className="muted small">None</span>}
      </div>
      {!readOnly && (
        <div className="chip-add">
          <input
            aria-label={`Add ${label.toLowerCase()}`}
            placeholder={`Add ${label.toLowerCase().replace(/s$/, '')}…`}
            value={input}
            list={`${id}-dl`}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                add(input);
                setInput('');
              }
            }}
          />
          <datalist id={`${id}-dl`}>
            {options.filter((o) => !has(o)).map((o) => <option key={o} value={o} />)}
          </datalist>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { add(input); setInput(''); }} disabled={!input.trim()}>
            Add
          </button>
        </div>
      )}
    </div>
  );
}
