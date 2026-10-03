import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../context.js';
import { isMinutes } from '../minutes.js';
import ContactDetail from './ContactDetail.jsx';
import { Icon, EmptyState, Spinner, formatDate } from './ui.jsx';

const SHOW = [
  { value: 'all', label: 'All' },
  { value: 'minutes', label: 'AI minutes' },
  { value: 'recordings', label: 'Recordings' },
];

/** Every note, meeting, recording and AI minutes across your contacts, newest first. */
export default function Minutes() {
  const { api, workspace, contacts } = useApp();
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [show, setShow] = useState('all');
  const [open, setOpen] = useState(null); // contact id

  const load = useCallback(async () => {
    try {
      setItems(await api.listWorkspaceInteractions(workspace.id));
      setError('');
    } catch (e) {
      setError(e.message);
      setItems([]);
    }
  }, [api, workspace.id]);
  useEffect(() => { load(); }, [load]);

  const byId = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (items || []).filter((i) => {
      if (show === 'minutes' && !isMinutes(i)) return false;
      if (show === 'recordings' && !i.audio_path) return false;
      if (!needle) return true;
      const c = byId.get(i.contact_id);
      return [i.title, i.kind, i.notes, i.summary, c?.full_name, c?.company].some((v) => String(v || '').toLowerCase().includes(needle));
    });
  }, [items, show, q, byId]);

  const contact = open ? byId.get(open) : null;

  return (
    <section className="minutes-page" aria-labelledby="minutes-title">
      <div className="results-head">
        <div className="results-title-row">
          <h1 id="minutes-title" className="h1">Meeting minutes</h1>
          <span className="result-count mono" aria-live="polite">{items ? `${rows.length} of ${items.length}` : ''}</span>
        </div>
        <div className="toolbar">
          <div className="input-icon search">
            <Icon name="search" size={17} />
            <input type="search" placeholder="Search minutes, notes, contact or company…" aria-label="Search meeting minutes" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="chips" role="group" aria-label="Show">
            {SHOW.map((s) => (
              <button key={s.value} type="button" className={`chip ${show === s.value ? 'is-on' : ''}`} aria-pressed={show === s.value} onClick={() => setShow(s.value)}>{s.label}</button>
            ))}
          </div>
        </div>
      </div>

      {items === null && <div className="loading-block"><Spinner /> Loading meeting minutes…</div>}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {items && !rows.length && !error && (
        <EmptyState icon="history" title={items.length ? 'Nothing matches' : 'No meeting minutes yet'}>
          {items.length ? 'Try another search or show All.' : 'Open a contact, record or note a meeting under Notes & meetings, and it appears here.'}
        </EmptyState>
      )}

      {rows.length > 0 && (
        <ul className="minutes-list">
          {rows.map((i) => {
            const c = byId.get(i.contact_id);
            const text = i.summary || i.notes || i.transcript || '';
            return (
              <li key={i.id}>
                <button type="button" className="minutes-row" onClick={() => setOpen(i.contact_id)} disabled={!c}>
                  <span className="minutes-row-head">
                    <strong>{i.title || i.kind}</strong>
                    <time className="mono small" dateTime={i.occurred_on}>{formatDate(i.occurred_on)}</time>
                  </span>
                  <span className="minutes-row-who small">{[c?.full_name, c?.company].filter(Boolean).join(' · ') || 'Contact not found'}</span>
                  {text && <span className="minutes-row-text small">{text}</span>}
                  <span className="minutes-row-tags small">
                    {isMinutes(i) && <span className="minutes-tag"><Icon name="sparkles" size={12} /> AI minutes</span>}
                    {i.audio_path && <span className="minutes-tag"><Icon name="mic" size={12} /> Recording</span>}
                    {!isMinutes(i) && <span className="minutes-tag">{i.kind}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {contact && <ContactDetail contact={contact} initialTab="notes" onClose={() => { setOpen(null); load(); }} />}
    </section>
  );
}
