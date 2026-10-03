import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../context.js';
import { allActions, hasMinutes, isMinutes, minutesColumns, normaliseMinutes } from '../minutes.js';
import { MEETING_TYPES } from '../taxonomy.js';
import { todayISO } from '../filters.js';
import { canEditInteraction } from '../perms.js';
import ContactDetail from './ContactDetail.jsx';
import Recorder, { useSpeechLanguage } from './Recorder.jsx';
import { Entry, useEntryActions } from './Timeline.jsx';
import MeetingView from './MeetingView.jsx';
import { Icon, EmptyState, Spinner, ConfirmButton, Pill, formatDate, formatDuration } from './ui.jsx';

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
  const [view, setView] = useState('meetings'); // meetings | followups

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
      if (show === 'minutes' && !hasMinutes(i)) return false;
      if (show === 'recordings' && !i.audio_path) return false;
      if (!needle) return true;
      const c = byId.get(i.contact_id);
      return [i.title, i.kind, i.meeting_type, i.notes, i.summary, i.transcript, i.minutes && JSON.stringify(i.minutes), c?.full_name, c?.company]
        .some((v) => String(v || '').toLowerCase().includes(needle));
    });
  }, [items, show, q, byId]);

  const contact = open ? byId.get(open) : null;
  const openCount = useMemo(() => allActions(items, todayISO()).filter((a) => a.status !== 'Done').length, [items]);
  const { making, stage, makeMinutes, share, removeRecording, remove } = useEntryActions({ reload: load, contactFor: (i) => byId.get(i.contact_id) || null });

  return (
    <section className="minutes-page" aria-labelledby="minutes-title">
      <div className="results-head">
        <div className="results-title-row">
          <h1 id="minutes-title" className="h1">Meeting minutes</h1>
          <span className="result-count mono" aria-live="polite">{items && view === 'meetings' ? `${rows.length} of ${items.length}` : ''}</span>
        </div>
        {can('meeting') && (
          <div className="chips view-switch" role="group" aria-label="View">
            <button type="button" className={`chip ${view === 'meetings' ? 'is-on' : ''}`} aria-pressed={view === 'meetings'} onClick={() => setView('meetings')}>Meetings</button>
            <button type="button" className={`chip ${view === 'followups' ? 'is-on' : ''}`} aria-pressed={view === 'followups'} onClick={() => setView('followups')}>
              Follow-ups{openCount > 0 && <span className="count-badge">{openCount}</span>}
            </button>
          </div>
        )}
        {view === 'meetings' && can('meeting') && !recording && (
          <button type="button" className="btn btn-primary btn-lg record-meeting-btn" onClick={() => setRecording(true)}>
            <Icon name="plus" size={18} /> New Recording
          </button>
        )}
        {recording && (
          <MeetingRecorder
            contacts={contacts}
            onCancel={() => setRecording(false)}
            onSaved={async (saved) => {
              setRecording(false); setShow('all'); setQ('');
              await load();
              setExpanded(saved.id);
              if (saved.meeting_type) makeMinutes(saved); // straight on to transcript and minutes
            }}
          />
        )}
        {view === 'meetings' && <div className="toolbar">
          <div className="input-icon search">
            <Icon name="search" size={17} />
            <input type="search" placeholder="Search minutes, notes, contact or company…" aria-label="Search meeting minutes" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="chips" role="group" aria-label="Show">
            {SHOW.map((s) => (
              <button key={s.value} type="button" className={`chip ${show === s.value ? 'is-on' : ''}`} aria-pressed={show === s.value} onClick={() => setShow(s.value)}>{s.label}</button>
            ))}
          </div>
        </div>}
      </div>

      {view === 'followups' && items && (
        <FollowUps items={items} byId={byId} onChanged={load} onOpen={(id) => { setView('meetings'); setShow('all'); setQ(''); setExpanded(id); }} />
      )}

      {view === 'meetings' && <>
      {items === null && <div className="loading-block"><Spinner /> Loading meeting minutes…</div>}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {items && !rows.length && !error && (
        <EmptyState icon="history" title={items.length ? 'Nothing matches' : 'No meeting minutes yet'}>
          {items.length ? 'Try another search or show All.' : can('meeting') ? 'Tap New Recording to record one. Notes you add to a contact appear here too.' : 'Notes and meetings you add to a contact appear here.'}
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
                    {i.meeting_type && <span className="minutes-tag minutes-tag-type">{i.meeting_type}</span>}
                    {hasMinutes(i) && <span className="minutes-tag"><Icon name="sparkles" size={12} /> AI minutes</span>}
                    {making === i.id && <span className="minutes-tag"><Spinner /> {stage || 'Working…'}</span>}
                    {i.audio_path && <span className="minutes-tag"><Icon name="mic" size={12} /> Recording</span>}
                    {!isMinutes(i) && !i.meeting_type && <span className="minutes-tag">{i.kind}</span>}
                  </span>
                </button>
                {!isOpen && canEditInteraction(i, c, role, uid) && (
                  <span className="minutes-del">
                    <ConfirmButton
                      className="icon-btn"
                      icon="trash"
                      confirmLabel="Delete"
                      message={i.audio_path ? 'Delete it and its recording?' : 'Delete this entry?'}
                      onConfirm={() => remove(i)}
                    >
                      <span className="sr-only">Delete {i.title || i.kind}</span>
                    </ConfirmButton>
                  </span>
                )}
                {isOpen && i.meeting_type && (
                  <div className="minutes-open">
                    <MeetingView
                      i={i}
                      contact={c}
                      canEdit={canEditInteraction(i, c, role, uid)}
                      canMakeMinutes={can('meeting')}
                      making={making === i.id}
                      stage={stage}
                      busy={making !== null}
                      onMakeMinutes={() => makeMinutes(i)}
                      onShare={() => share(i)}
                      onDelete={() => { setExpanded(null); remove(i); }}
                      onDeleteRecording={() => removeRecording(i)}
                      onChanged={load}
                    />
                  </div>
                )}
                {isOpen && !i.meeting_type && (
                  <div className="minutes-open">
                    <ol className="entries">
                      <Entry
                        i={i}
                        author="You"
                        canEdit={canEditInteraction(i, c, role, uid)}
                        canMakeMinutes={can('meeting')}
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

      </>}

      {contact && <ContactDetail contact={contact} initialTab="notes" onClose={() => { setOpen(null); load(); }} />}
    </section>
  );
}

/** Starts a new meeting: its type, then title, optional contact and the recorder. Saved as soon as it stops. */
function MeetingRecorder({ contacts, onCancel, onSaved }) {
  const { api, uid, workspace, toast } = useApp();
  const [lang, setLang] = useSpeechLanguage();
  const [type, setType] = useState(null);
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
        title: title.trim() || type,
        meeting_type: type,
        transcript: r.liveTranscript || null,
        contact_id: c ? c.id : null,
        workspace_id: c ? c.workspace_id : workspace.id,
      });
      r.saved = saved;
      const path = await api.uploadRecording(saved.workspace_id, c ? c.id : `m-${uid}`, saved.id, r.blob, r.ext);
      saved = await api.updateInteraction(saved.id, { audio_path: path, duration_sec: r.duration });
      toast('Saved. Now writing the minutes.');
      await onSaved(saved);
    } catch (e) {
      setErr(`The recording was not saved: ${e.message}`);
      toast(`The recording was not saved: ${e.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };
  const onRecorded = (r) => { setLast(r); save(r); };

  if (!type) {
    return (
      <div className="panel meeting-recorder">
        <h2 className="h3" id="meet-type-q">What type of meeting is this?</h2>
        <div className="meeting-types" role="group" aria-labelledby="meet-type-q">
          {MEETING_TYPES.map((t) => (
            <button key={t.value} type="button" className="meeting-type" onClick={() => setType(t.value)}>
              <strong>{t.value}</strong>
              <span className="small muted">{t.focus}</span>
            </button>
          ))}
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel meeting-recorder">
      <div className="meeting-type-chosen">
        <span className="small muted">Meeting type</span>
        <strong>{type}</strong>
        {!last && <button type="button" className="link small" onClick={() => setType(null)}>Change</button>}
      </div>
      <div className="field">
        <label htmlFor="meet-title">Meeting title</label>
        <input id="meet-title" type="text" placeholder={type} value={title} onChange={(e) => setTitle(e.target.value)} disabled={!!last} />
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

const FU_SHOW = [
  { value: 'open', label: 'Open' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'soon', label: 'Due soon' },
  { value: 'done', label: 'Completed' },
];
const FU_PILL = { overdue: ['danger', 'Overdue'], soon: ['warn', 'Due soon'], done: ['ok', 'Completed'] };

/** Action items from every meeting, to follow up: open, overdue, due soon or completed. */
function FollowUps({ items, byId, onChanged, onOpen }) {
  const { api, uid, role, toast } = useApp();
  const [show, setShow] = useState('open');
  const today = todayISO();
  const all = useMemo(() => allActions(items, today), [items, today]);
  const count = (v) => all.filter((a) => (v === 'open' ? a.status !== 'Done' : a.state === v)).length;
  const rows = all
    .filter((a) => (show === 'open' ? a.status !== 'Done' : a.state === show))
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));

  const setStatus = async (a, done) => {
    const m = normaliseMinutes(a.meeting.minutes);
    m.action_items = m.action_items.map((x, k) => (k === a.index ? { ...x, status: done ? 'Done' : 'Open' } : x));
    try {
      await api.updateInteraction(a.meeting.id, minutesColumns(m));
      await onChanged();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="followups">
      <div className="chips" role="group" aria-label="Show">
        {FU_SHOW.map((s) => (
          <button key={s.value} type="button" className={`chip ${show === s.value ? 'is-on' : ''}`} aria-pressed={show === s.value} onClick={() => setShow(s.value)}>
            {s.label} <span className="muted">{count(s.value)}</span>
          </button>
        ))}
      </div>
      {!rows.length && (
        <EmptyState icon="check" title={all.length ? 'Nothing here' : 'No action items yet'}>
          {all.length ? 'Try another filter.' : 'Action items from your meeting minutes appear here, so nothing agreed gets forgotten.'}
        </EmptyState>
      )}
      {rows.length > 0 && (
        <ul className="actions-list">
          {rows.map((a) => {
            const c = byId.get(a.meeting.contact_id);
            const pill = FU_PILL[a.state];
            return (
              <li key={`${a.meeting.id}:${a.index}`} className={a.status === 'Done' ? 'is-done' : ''}>
                {canEditInteraction(a.meeting, c, role, uid) && (
                  <label className="action-check">
                    <input type="checkbox" checked={a.status === 'Done'} onChange={(e) => setStatus(a, e.target.checked)} />
                    <span className="sr-only">Done: {a.action}</span>
                  </label>
                )}
                <div className="action-body">
                  <strong className="action-text">{a.action}</strong>
                  <span className="action-meta small">
                    <span><Icon name="user" size={12} /> {a.assigned_to || 'Not assigned'}</span>
                    <span><Icon name="calendar" size={12} /> {a.due ? formatDate(a.due) : 'No due date'}</span>
                    <Pill tone={a.priority === 'High' ? 'hot' : 'neutral'}>{a.priority}</Pill>
                    {pill ? <Pill tone={pill[0]}>{pill[1]}</Pill> : <Pill>Open</Pill>}
                  </span>
                  <button type="button" className="link small fu-from" onClick={() => onOpen(a.meeting.id)}>
                    From {a.meeting.title || a.meeting.meeting_type}, {formatDate(a.meeting.occurred_on)}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
