import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../context.js';
import { INTERACTION_KINDS, LEAD_STATUSES } from '../taxonomy.js';
import { todayISO } from '../filters.js';
import { canEditInteraction } from '../perms.js';
import { PART_SEC, audioParts, clock, earlierActions, isMinutes, meetingTimes, minutesColumns, minutesLanguage, minutesRow, normaliseMinutes, outstanding, recordedAt, shareOrCopy, shareText } from '../minutes.js';
import { Icon, Spinner, ConfirmButton, SaveLabel, useJustSaved, formatDate, formatDuration, EmptyState } from './ui.jsx';
import RecordingAudio from './RecordingAudio.jsx';

const KIND_ICON = { Meeting: 'users', Call: 'phone', 'Site visit': 'pin', Email: 'mail', Message: 'cards', Note: 'edit' };

export default function Timeline({ contact, canAdd, onContactChanged }) {
  const { api, uid, role, memberName, toast, can } = useApp();
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | interaction

  const loadItems = useCallback(async () => {
    try {
      setItems(await api.listInteractions(contact.id));
      setError('');
    } catch (e) {
      setError(e.message);
      setItems([]);
    }
  }, [api, contact.id]);

  useEffect(() => { loadItems(); }, [loadItems]);

  const onSaved = async (saved, { bumped }) => {
    setEditing(null);
    await loadItems();
    if (bumped) await onContactChanged();
  };

  const { making, makeMinutes, share, removeRecording, remove } = useEntryActions({ reload: loadItems, contactFor: () => contact });

  return (
    <div className="timeline">
      {canAdd && !editing && (
        <div className="timeline-actions">
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" size={16} /> Add meeting or note
          </button>
        </div>
      )}
      {editing && (
        <InteractionEditor
          contact={contact}
          existing={typeof editing === 'object' ? editing : null}
          onCancel={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}

      {items === null && <div className="loading-block"><Spinner /> Loading history…</div>}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {items && !items.length && !editing && (
        <EmptyState icon="history" title="No history yet">
          {canAdd ? 'Log meetings, calls and site visits here so the whole team knows where this lead stands.' : 'Nobody has logged a meeting or note for this contact yet.'}
        </EmptyState>
      )}

      {items && items.length > 0 && (
        <ol className="entries">
          {items.map((i) => (
            editing && editing.id === i.id ? null : (
              <Entry
                key={i.id}
                i={i}
                author={i.created_by === uid ? 'You' : memberName(i.created_by)}
                canEdit={canEditInteraction(i, contact, role, uid)}
                canMakeMinutes={can('meeting')}
                onEdit={() => setEditing(i)}
                onDelete={() => remove(i)}
                onDeleteRecording={() => removeRecording(i)}
                making={making === i.id}
                busy={making !== null}
                onMakeMinutes={() => makeMinutes(i)}
                onShare={() => share(i)}
              />
            )
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * What can be done to a saved entry: make AI minutes from its recording, share
 * it, delete its recording or delete it. contactFor(entry) gives its card, or
 * null for a meeting recorded without one.
 */
export function useEntryActions({ reload, contactFor }) {
  const { api, toast } = useApp();
  const [making, setMaking] = useState(null); // id of the entry minutes are being made for

  const removeRecording = async (i) => {
    try {
      await api.removeStorageObjects('recordings', audioParts(i));
      await api.updateInteraction(i.id, { audio_path: null, duration_sec: null });
      await reload();
      toast('Recording deleted');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const [stage, setStage] = useState(''); // what making minutes is doing now, for the button

  // A long recording is several files: transcribe each and put the timed lines back in order.
  const transcribeRecording = async (i, output) => {
    const parts = audioParts(i);
    const texts = [];
    let segments;
    for (let k = 0; k < parts.length; k++) {
      setStage(parts.length > 1 ? `Transcribing part ${k + 1} of ${parts.length}…` : 'Transcribing…');
      const ext = (/\.(\w+)$/.exec(parts[k]) || [])[1] || 'webm';
      const r = await api.transcribe(await api.downloadRecording(parts[k]), null, ext, output);
      if (r.text) texts.push(r.text);
      if (Array.isArray(r.segments)) segments = [...(segments || []), ...r.segments.map((x) => ({ ...x, t: (x.t || 0) + k * PART_SEC }))];
    }
    return { text: texts.join('\n'), segments };
  };

  // A typed meeting: recording -> timed transcript -> minutes (Claude), saved on the meeting itself.
  const makeMeetingMinutes = async (i, contact) => {
    const output = minutesLanguage();
    let transcript = i.transcript || '';
    let segments = i.segments;
    if (Array.isArray(segments) && segments.length && (i.minutes?.language || 'English') !== output) {
      // Written again in another language: the transcript follows.
      setStage('Translating…');
      ({ text: transcript, segments } = await api.translateTranscript(segments, output));
      await api.updateInteraction(i.id, { transcript, segments });
    }
    if (i.audio_path && !Array.isArray(segments)) {
      try {
        const r = await transcribeRecording(i, output);
        if (r.text) ({ text: transcript, segments } = r);
      } catch (e) {
        if (e.code !== 'not_configured') throw e;
        if (!transcript && !i.notes) {
          throw new Error('Turning a recording into text needs transcription switched on. Ask your admin to add the AI_GATEWAY_API_KEY secret in Supabase.');
        }
      }
      if (!transcript && !i.notes) throw new Error('No speech was found in this recording.');
      if (Array.isArray(segments)) await api.updateInteraction(i.id, { transcript, segments });
    }
    setStage('Writing minutes…');
    const t = meetingTimes(i);
    // Open action items from earlier meetings, for "Outstanding from previous meetings".
    let list = [];
    let earlier = [];
    try {
      list = await api.listWorkspaceInteractions(i.workspace_id);
      earlier = earlierActions(list, i);
    } catch {
      // minutes still work without the follow-up section
    }
    const ai = await api.meetingMinutes({
      earlier_actions: earlier.map(({ meeting_type: _t, ...a }) => a),
      title: i.title || '',
      meeting_type: i.meeting_type,
      date: i.occurred_on,
      time: t ? `${clock(t.start)}–${clock(t.end)}` : '',
      notes: i.notes || '',
      transcript,
      output,
      contact: contact ? { full_name: contact.full_name, company: contact.company, job_title: contact.job_title } : {},
    });
    const followUp = outstanding(i, earlier, ai.follow_up || []);
    await api.updateInteraction(i.id, minutesColumns(normaliseMinutes({ ...ai, language: output, follow_up: followUp })));
    // Items this meeting says are done are ticked off in the meeting they came from.
    await markDone(list, followUp.filter((f) => f.state === 'Completed').map((f) => f.ref));
  };

  const markDone = async (list, refs) => {
    const byMeeting = new Map();
    for (const ref of refs) {
      const [id, k] = ref.split(':');
      byMeeting.set(id, [...(byMeeting.get(id) || []), Number(k)]);
    }
    for (const [id, ks] of byMeeting) {
      try {
        const row = list.find((x) => x.id === id);
        if (!row?.minutes) continue;
        const m = normaliseMinutes(row.minutes);
        m.action_items = m.action_items.map((a, k) => (ks.includes(k) ? { ...a, status: 'Done' } : a));
        await api.updateInteraction(id, minutesColumns(m));
      } catch {
        // leave it open; it can be ticked by hand
      }
    }
  };

  // Recording -> transcript -> minutes (Claude) -> a new Note next to it.
  const makeMinutes = async (i) => {
    const contact = contactFor(i);
    setMaking(i.id);
    try {
      if (i.meeting_type) {
        await makeMeetingMinutes(i, contact);
        await reload();
        toast('Saved. Minutes are ready.');
        return;
      }
      let transcript = i.transcript || '';
      if (!transcript) {
        try {
          transcript = (await transcribeRecording(i, minutesLanguage())).text;
        } catch (e) {
          if (e.code !== 'not_configured') throw e;
          if (!i.notes) {
            throw new Error('Turning a recording into text needs transcription switched on. Ask your admin to add the AI_GATEWAY_API_KEY secret in Supabase.');
          }
        }
        if (!transcript && !i.notes) throw new Error('No speech was found in this recording.');
        if (transcript) await api.updateInteraction(i.id, { transcript });
      }
      const ai = await api.summarise({
        notes: i.notes || '',
        transcript,
        kind: i.kind,
        contact: contact
          ? { full_name: contact.full_name, company: contact.company, job_title: contact.job_title, lead_status: contact.lead_status }
          : {},
        today: i.occurred_on,
        output: minutesLanguage(),
      });
      await api.insertInteraction({ ...minutesRow(i, ai, transcript), contact_id: i.contact_id || null, workspace_id: i.workspace_id });
      await reload();
      toast('Saved. Minutes added as a note.');
    } catch (e) {
      toast(`Could not make minutes: ${e.message}`, 'error');
    } finally {
      setMaking(null);
      setStage('');
    }
  };

  const share = async (i) => {
    try {
      const r = await shareOrCopy(i.title || i.kind, shareText(i, contactFor(i), formatDate));
      if (r === 'copied') toast('Copied. Paste it into WhatsApp, email or anywhere.');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const remove = async (i) => {
    try {
      await api.deleteInteraction(i);
      await reload();
      toast('Entry deleted');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return { making, stage, makeMinutes, share, removeRecording, remove };
}

const formatDateTime = (d) => d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export function Entry({ i, author, canEdit, canMakeMinutes, onEdit, onDelete, onDeleteRecording, making, busy, onMakeMinutes, onShare }) {
  return (
    <li className={`entry kind-${i.kind.replace(/\s/g, '-').toLowerCase()}${isMinutes(i) ? ' entry-minutes' : ''}`}>
      <span className="entry-icon" aria-hidden="true"><Icon name={KIND_ICON[i.kind] || 'edit'} size={16} /></span>
      <div className="entry-body">
        <div className="entry-head">
          <span className="entry-kind">{i.kind}</span>
          <time className="mono small" dateTime={i.occurred_on}>{formatDate(i.occurred_on)}</time>
          <span className="muted small">· {author}</span>
          {canEdit && (
            <span className="entry-tools">
              {onEdit && <button type="button" className="icon-btn" onClick={onEdit} aria-label="Edit entry"><Icon name="edit" size={16} /></button>}
              <ConfirmButton className="icon-btn" icon="trash" confirmLabel="Delete" message="Delete entry?" onConfirm={onDelete}>
                <span className="sr-only">Delete entry</span>
              </ConfirmButton>
            </span>
          )}
        </div>
        {i.title && <h4 className="entry-title">{i.title}</h4>}
        {i.notes && !isMinutes(i) && <p className="entry-notes">{i.notes}</p>}
        {i.summary && (
          <div className="entry-summary">
            <span className="label"><Icon name="sparkles" size={13} /> Summary</span>
            <p>{i.summary}</p>
          </div>
        )}
        {i.notes && isMinutes(i) && <p className="entry-notes">{i.notes}</p>}
        {i.action_items && i.action_items.length > 0 && (
          <div className="entry-actions">
            <span className="label">Action items</span>
            <ul>{i.action_items.map((a, k) => <li key={k}>{a}</li>)}</ul>
          </div>
        )}
        {i.audio_path && (
          <div className="entry-audio">
            <span className="rec-meta small">
              <Icon name="mic" size={13} /> Recorded {recordedAt(i) ? formatDateTime(recordedAt(i)) : ''}
              {i.duration_sec != null && <span className="mono muted"> · {formatDuration(i.duration_sec)}</span>}
            </span>
            <RecordingAudio paths={audioParts(i)} duration={i.duration_sec} preload="none" />
            {canEdit && canMakeMinutes && (
              <button type="button" className="btn btn-outline btn-sm" onClick={onMakeMinutes} disabled={busy}>
                {making ? <><Spinner /> Making minutes…</> : <><Icon name="sparkles" size={14} /> Make minutes with AI</>}
              </button>
            )}
            {canEdit && (
              <ConfirmButton className="btn btn-ghost btn-sm" icon="trash" confirmLabel="Delete recording" message="Delete this recording? The entry and its notes stay." onConfirm={onDeleteRecording}>
                Delete recording
              </ConfirmButton>
            )}
          </div>
        )}
        {i.transcript && (
          <details className="entry-transcript">
            <summary>Transcript</summary>
            <p>{i.transcript}</p>
          </details>
        )}
        {(i.summary || isMinutes(i)) && (
          <button type="button" className="btn btn-ghost btn-sm entry-share" onClick={onShare}>
            <Icon name="send" size={14} /> Share{isMinutes(i) ? ' minutes' : ''}
          </button>
        )}
      </div>
    </li>
  );
}

function InteractionEditor({ contact, existing, onCancel, onSaved }) {
  const { api, toast, upsertContact, can } = useApp();
  const ai = can('meeting');
  const [f, setF] = useState(() => ({
    kind: existing?.kind || 'Meeting',
    occurred_on: existing?.occurred_on || todayISO(),
    title: existing?.title || '',
    notes: existing?.notes || '',
    transcript: existing?.transcript || '',
    summary: existing?.summary || '',
    action_items: existing?.action_items || [],
  }));
  const [summarising, setSummarising] = useState(false);
  const [suggest, setSuggest] = useState(null); // { follow_up_on, lead_status }
  const [apply, setApply] = useState(true);
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const doSummarise = async () => {
    if (!f.notes.trim() && !f.transcript.trim()) {
      toast('Add notes or a transcript first', 'error');
      return;
    }
    setSummarising(true);
    try {
      const r = await api.summarise({
        notes: f.notes,
        transcript: f.transcript,
        kind: f.kind,
        contact: { full_name: contact.full_name, company: contact.company, job_title: contact.job_title, lead_status: contact.lead_status },
        today: todayISO(),
        output: minutesLanguage(),
      });
      setF((x) => ({ ...x, summary: r.summary, action_items: r.action_items }));
      setSuggest(r.follow_up_on || r.lead_status ? { follow_up_on: r.follow_up_on, lead_status: r.lead_status } : null);
      setApply(true);
    } catch (e) {
      toast(`Summary failed: ${e.message}`, 'error');
    } finally {
      setSummarising(false);
    }
  };

  const [justSaved, markSaved] = useJustSaved();
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const row = {
      kind: f.kind,
      occurred_on: f.occurred_on || todayISO(),
      title: f.title.trim() || null,
      notes: f.notes.trim() || null,
      transcript: f.transcript.trim() || null,
      summary: f.summary.trim() || null,
      action_items: f.action_items.map((a) => a.trim()).filter(Boolean),
    };
    try {
      const saved = existing
        ? await api.updateInteraction(existing.id, row)
        : await api.insertInteraction({ ...row, contact_id: contact.id, workspace_id: contact.workspace_id });

      let bumped = row.kind !== 'Note';
      if (suggest && apply) {
        const p = {};
        if (suggest.follow_up_on) p.next_follow_up_on = suggest.follow_up_on;
        if (suggest.lead_status) p.lead_status = suggest.lead_status;
        if (Object.keys(p).length) {
          try {
            const updated = await api.updateContact(contact.id, p);
            if (updated) upsertContact(updated);
            bumped = true;
          } catch (err) {
            toast(`Could not update the contact: ${err.message}`, 'error');
          }
        }
      }
      setSaving(false);
      markSaved();
      await new Promise((r) => setTimeout(r, 900)); // let the button show "Saved" before the form closes
      await onSaved(saved, { bumped });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="editor panel" onSubmit={save} aria-label={existing ? 'Edit entry' : 'New entry'}>
      <div className="grid-3">
        <div className="field">
          <label htmlFor="int-kind">Type</label>
          <select id="int-kind" value={f.kind} onChange={set('kind')}>
            {INTERACTION_KINDS.map((k) => <option key={k}>{k}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="int-date">Date</label>
          <input id="int-date" type="date" value={f.occurred_on} onChange={set('occurred_on')} required />
        </div>
        <div className="field span-3-sm">
          <label htmlFor="int-title">Title</label>
          <input id="int-title" value={f.title} onChange={set('title')} placeholder="e.g. Site survey debrief" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="int-notes">Your notes</label>
        <textarea id="int-notes" rows={4} value={f.notes} onChange={set('notes')} />
      </div>

      {/* New recordings can no longer be made from Notes & meetings; earlier ones stay playable. */}
      {existing?.audio_path && (
        <div className="field">
          <span className="label">Recording</span>
          <div className="entry-audio"><RecordingAudio paths={audioParts(existing)} duration={existing.duration_sec} label="Saved recording" /></div>
        </div>
      )}

      <div className="field">
        <label htmlFor="int-transcript">Transcript</label>
        <textarea id="int-transcript" rows={f.transcript ? 5 : 2} value={f.transcript} onChange={set('transcript')} />
      </div>

      <div className="ai-box">
        <div className="ai-head">
          <span className="label"><Icon name="sparkles" size={14} /> AI summary</span>
          {ai && (
            <button type="button" className="btn btn-outline btn-sm" onClick={doSummarise} disabled={summarising}>
              {summarising ? <><Spinner /> Summarising…</> : <><Icon name="sparkles" size={14} /> Summarise with AI</>}
            </button>
          )}
        </div>
        <div className="field">
          <label htmlFor="int-summary" className="sr-only">Summary</label>
          <textarea id="int-summary" rows={f.summary ? 4 : 2} value={f.summary} onChange={set('summary')} placeholder="A short summary of the conversation" />
        </div>
        <div className="field">
          <span className="label">Action items</span>
          <ul className="action-edit">
            {f.action_items.map((a, k) => (
              <li key={k}>
                <input aria-label={`Action item ${k + 1}`} value={a} onChange={(e) => setF((x) => ({ ...x, action_items: x.action_items.map((y, j) => (j === k ? e.target.value : y)) }))} />
                <button type="button" className="icon-btn" aria-label={`Remove action item ${k + 1}`} onClick={() => setF((x) => ({ ...x, action_items: x.action_items.filter((_, j) => j !== k) }))}><Icon name="x" size={14} /></button>
              </li>
            ))}
          </ul>
          <button type="button" className="link small" onClick={() => setF((x) => ({ ...x, action_items: [...x.action_items, ''] }))}><Icon name="plus" size={13} /> Add action item</button>
        </div>
        {suggest && (
          <div className="suggest">
            <p className="small">
              Suggested:{' '}
              {suggest.follow_up_on && <>follow up on <strong>{formatDate(suggest.follow_up_on)}</strong></>}
              {suggest.follow_up_on && suggest.lead_status && ' · '}
              {suggest.lead_status && <>lead status <strong>{suggest.lead_status}</strong>{!LEAD_STATUSES.includes(suggest.lead_status) && ' (custom)'}</>}
            </p>
            <label className="check">
              <input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} />
              Apply follow-up date and lead status to contact
            </label>
          </div>
        )}
      </div>

      <div className="save-bar is-dirty">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving || justSaved}><SaveLabel saving={saving} saved={justSaved}>{existing ? 'Save entry' : 'Add to timeline'}</SaveLabel></button>
      </div>
    </form>
  );
}
