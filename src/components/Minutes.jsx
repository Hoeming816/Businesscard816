import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../context.js';
import { isMinutes } from '../minutes.js';
import { todayISO } from '../filters.js';
import { canEditInteraction } from '../perms.js';
import ContactDetail from './ContactDetail.jsx';
import Recorder, { useSpeechLanguage } from './Recorder.jsx';
import { Entry, useEntryActions } from './Timeline.jsx';
import { Icon, EmptyState, Spinner, formatDate, formatDuration } from './ui.jsx';

const SHOW = [
  { value: 'all', label: 'All' },
  { value: 'minutes', label: 'AI minutes' },
  { value: 'recordings', label: 'Recordings' },
];

/**
 * Record a meeting (with or without a contact), and every note, meeting,
 * recording and AI minutes across your contacts, newest first.
 */
export default function Minutes() {
  const { api, uid, role, workspace, contacts, can } = useApp();
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [show, setShow] = useState('all');
  const [open, setOpen] = useState(null); // contact id
  const [expanded, setExpanded] = useState(null); // entry id
  const [recording, setRecording] = useState(false);

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
  const { making, makeMinutes, share, removeRecording, remove } = useEntryActions({ reload: load, contactFor: (i) => byId.get(i.contact_id) || null });

  return (
    <section className="minutes-page" aria-labelledby="minutes-title">
      <div className="results-head">
        <div className="results-title-row">
          <h1 id="minutes-title" className="h1">Meeting minutes</h1>
          <span className="result-count mono" aria-live="polite">{items ? `${rows.length} of ${items.length}` : ''}</span>
        </div>
        {can('recording') && !recording && (
          <button type="button" className="btn btn-primary btn-lg record-meeting-btn" onClick={() => setRecording(true)}>
            <Icon name="mic" size={18} /> Record meeting
          </button>
        )}
        {recording && (
          <MeetingRecorder
            contacts={contacts}
            onCancel={() => setRecording(false)}
            onSaved={async (saved) => { setRecording(false); setShow('all'); setQ(''); await load(); setExpanded(saved.id); }}
          />
        )}
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
          {items.length ? 'Try another search or show All.' : can('recording') ? 'Tap Record meeting to record one. Notes you add to a contact appear here too.' : 'Notes and meetings you add to a contact appear here.'}
        </EmptyState>
      )}

      {rows.length > 0 && (
        <ul className="minutes-list">
          {rows.map((i) => {
            const c = byId.get(i.contact_id);
            const text = i.summary || i.notes || i.transcript || '';
            const isOpen = expanded === i.id;
            return (
              <li key={i.id} className={isOpen ? 'is-open' : ''}>
                <button type="button" className="minutes-row" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : i.id)}>
                  <span className="minutes-row-head">
                    <strong>{i.title || i.kind}</strong>
                    <time className="mono small" dateTime={i.occurred_on}>{formatDate(i.occurred_on)}</time>
                  </span>
                  <span className="minutes-row-who small">{i.contact_id ? [c?.full_name, c?.company].filter(Boolean).join(' · ') || 'Contact not found' : 'No contact linked'}</span>
                  {text && !isOpen && <span className="minutes-row-text small">{text}</span>}
                  <span className="minutes-row-tags small">
                    {isMinutes(i) && <span className="minutes-tag"><Icon name="sparkles" size={12} /> AI minutes</span>}
                    {i.audio_path && <span className="minutes-tag"><Icon name="mic" size={12} /> Recording</span>}
                    {!isMinutes(i) && <span className="minutes-tag">{i.kind}</span>}
                  </span>
                </button>
                {isOpen && (
                  <div className="minutes-open">
                    <ol className="entries">
                      <Entry
                        i={i}
                        author="You"
                        canEdit={canEditInteraction(i, c, role, uid)}
                        canMakeMinutes={can('ai_minutes')}
                        onEdit={c ? () => setOpen(c.id) : null}
                        onDelete={() => { setExpanded(null); remove(i); }}
                        onDeleteRecording={() => removeRecording(i)}
                        making={making === i.id}
                        busy={making !== null}
                        onMakeMinutes={() => makeMinutes(i)}
                        onShare={() => share(i)}
                      />
                    </ol>
                    {c && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(c.id)}>
                        <Icon name="cards" size={14} /> Open {c.full_name || 'contact'}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {contact && <ContactDetail contact={contact} initialTab="notes" onClose={() => { setOpen(null); load(); }} />}
    </section>
  );
}

/** Starts a new meeting: title, optional contact, then the recorder. Saved as soon as it stops. */
function MeetingRecorder({ contacts, onCancel, onSaved }) {
  const { api, uid, workspace, toast } = useApp();
  const [lang, setLang] = useSpeechLanguage();
  const [title, setTitle] = useState('');
  const [contactId, setContactId] = useState('');
  const [last, setLast] = useState(null); // the recording, kept to retry a failed save
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const mine = useMemo(() => contacts.filter((c) => c.created_by === uid)
    .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')), [contacts, uid]);

  const save = async (r) => {
    setSaving(true);
    setErr('');
    try {
      const c = mine.find((x) => x.id === contactId) || null;
      let saved = r.saved || await api.insertInteraction({
        kind: 'Meeting',
        occurred_on: todayISO(),
        title: title.trim() || 'Meeting',
        transcript: r.liveTranscript || null,
        contact_id: c ? c.id : null,
        workspace_id: c ? c.workspace_id : workspace.id,
      });
      r.saved = saved;
      const path = await api.uploadRecording(saved.workspace_id, c ? c.id : `m-${uid}`, saved.id, r.blob, r.ext);
      saved = await api.updateInteraction(saved.id, { audio_path: path, duration_sec: r.duration });
      toast('Saved. Meeting recorded.');
      await onSaved(saved);
    } catch (e) {
      setErr(`The recording was not saved: ${e.message}`);
      toast(`The recording was not saved: ${e.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };
  const onRecorded = (r) => { setLast(r); save(r); };

  return (
    <div className="panel meeting-recorder">
      <div className="field">
        <label htmlFor="meet-title">Meeting title</label>
        <input id="meet-title" type="text" placeholder="Meeting" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!!last} />
      </div>
      <div className="field">
        <label htmlFor="meet-contact">Contact <span className="muted small">(optional)</span></label>
        <select id="meet-contact" value={contactId} onChange={(e) => setContactId(e.target.value)} disabled={!!last}>
          <option value="">No contact</option>
          {mine.map((c) => <option key={c.id} value={c.id}>{[c.full_name, c.company].filter(Boolean).join(' · ') || 'Unnamed card'}</option>)}
        </select>
      </div>
      <div className="field">
        <span className="label">Recording</span>
        {last ? (
          <div className="rec-done">
            <audio controls src={last.url} aria-label="New recording" />
            <span className="mono small">{formatDuration(last.duration)}</span>
            {saving ? <span className="small muted"><Spinner /> Saving recording…</span>
              : <button type="button" className="btn btn-outline btn-sm" onClick={() => save(last)}>Try saving again</button>}
          </div>
        ) : (
          <Recorder onRecorded={onRecorded} lang={lang} setLang={setLang} />
        )}
        {err && <p className="form-error" role="alert">{err}</p>}
      </div>
      {!saving && (
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>{last ? 'Discard' : 'Cancel'}</button>
        </div>
      )}
    </div>
  );
}
