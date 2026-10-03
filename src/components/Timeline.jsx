import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../context.js';
import { INTERACTION_KINDS, LEAD_STATUSES } from '../taxonomy.js';
import { todayISO } from '../filters.js';
import { canEditInteraction } from '../perms.js';
import Recorder, { useSpeechLanguage, whisperLang } from './Recorder.jsx';
import { isMinutes, minutesRow, shareOrCopy, shareText } from '../minutes.js';
import { Icon, Spinner, ConfirmButton, SaveLabel, useJustSaved, formatDate, formatDuration, EmptyState } from './ui.jsx';

const KIND_ICON = { Meeting: 'users', Call: 'phone', 'Site visit': 'pin', Email: 'mail', Message: 'cards', Note: 'edit' };

export default function Timeline({ contact, canAdd, onContactChanged }) {
  const { api, uid, role, memberName, toast, can } = useApp();
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | 'record' | interaction
  const [making, setMaking] = useState(null); // id of the recording entry minutes are being made for

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

  // A recording is saved as soon as Stop is tapped; the editor stays open on that entry.
  const onAutoSaved = async (saved) => {
    setEditing(saved);
    await loadItems();
    await onContactChanged();
  };

  const removeRecording = async (i) => {
    try {
      await api.removeStorageObjects('recordings', [i.audio_path]);
      const updated = await api.updateInteraction(i.id, { audio_path: null, duration_sec: null });
      setItems((list) => list.map((x) => (x.id === i.id ? updated : x)));
      toast('Recording deleted');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  // Recording -> transcript (Whisper) -> minutes (Claude) -> a new Note on this contact.
  const makeMinutes = async (i) => {
    setMaking(i.id);
    try {
      let transcript = i.transcript || '';
      if (!transcript) {
        try {
          const ext = (/\.(\w+)$/.exec(i.audio_path) || [])[1] || 'webm';
          transcript = await api.transcribe(await api.downloadRecording(i.audio_path), null, ext);
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
        contact: { full_name: contact.full_name, company: contact.company, job_title: contact.job_title, lead_status: contact.lead_status },
        today: i.occurred_on,
      });
      await api.insertInteraction({ ...minutesRow(i, ai, transcript), contact_id: contact.id, workspace_id: contact.workspace_id });
      await loadItems();
      toast('Saved. Minutes added as a note.');
    } catch (e) {
      toast(`Could not make minutes: ${e.message}`, 'error');
    } finally {
      setMaking(null);
    }
  };

  const share = async (i) => {
    try {
      const r = await shareOrCopy(i.title || i.kind, shareText(i, contact, formatDate));
      if (r === 'copied') toast('Copied. Paste it into WhatsApp, email or anywhere.');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const remove = async (i) => {
    try {
      await api.deleteInteraction(i);
      setItems((list) => list.filter((x) => x.id !== i.id));
      toast('Entry deleted');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="timeline">
      {canAdd && !editing && (
        <div className="timeline-actions">
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" size={16} /> Add meeting or note
          </button>
          {can('meeting') && (
            <button type="button" className="btn btn-outline" onClick={() => setEditing('record')}>
              <Icon name="mic" size={16} /> Record conversation
            </button>
          )}
        </div>
      )}
      {editing && (
        <InteractionEditor
          contact={contact}
          existing={typeof editing === 'object' ? editing : null}
          autoRecord={editing === 'record'}
          onCancel={() => setEditing(null)}
          onSaved={onSaved}
          onAutoSaved={onAutoSaved}
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

/** When a recording was made: from its file name (…-<ms>.ext), else when the entry was created. */
export function recordedAt(i) {
  const m = /-(\d{13})\.\w+$/.exec(i.audio_path || '');
  const d = m ? new Date(Number(m[1])) : new Date(i.created_at);
  return Number.isNaN(d.getTime()) ? null : d;
}
const formatDateTime = (d) => d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

function Entry({ i, author, canEdit, canMakeMinutes, onEdit, onDelete, onDeleteRecording, making, busy, onMakeMinutes, onShare }) {
  const { ensureSigned, signed } = useApp();
  useEffect(() => { if (i.audio_path) ensureSigned('recordings', [i.audio_path]); }, [i.audio_path, ensureSigned]);
  const audio = i.audio_path ? signed('recordings', i.audio_path) : null;
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
              <button type="button" className="icon-btn" onClick={onEdit} aria-label="Edit entry"><Icon name="edit" size={16} /></button>
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
            {audio ? <audio controls preload="none" src={audio} aria-label={`Recording, ${formatDuration(i.duration_sec)}`} /> : <span className="muted small">Loading recording…</span>}
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

function InteractionEditor({ contact, existing, autoRecord, onCancel, onSaved, onAutoSaved }) {
  const { api, toast, upsertContact, can } = useApp();
  const ai = can('meeting');
  const [lang, setLang] = useSpeechLanguage();
  const [f, setF] = useState(() => ({
    kind: existing?.kind || 'Meeting',
    occurred_on: existing?.occurred_on || todayISO(),
    title: existing?.title || '',
    notes: existing?.notes || '',
    transcript: existing?.transcript || '',
    summary: existing?.summary || '',
    action_items: existing?.action_items || [],
  }));
  const [recording, setRecording] = useState(null); // { blob, ext, duration, url }
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeMsg, setTranscribeMsg] = useState('');
  const [summarising, setSummarising] = useState(false);
  const [suggest, setSuggest] = useState(null); // { follow_up_on, lead_status }
  const [apply, setApply] = useState(true);
  const [saving, setSaving] = useState(false);
  const { ensureSigned, signed } = useApp();

  useEffect(() => { if (existing?.audio_path) ensureSigned('recordings', [existing.audio_path]); }, [existing, ensureSigned]);
  useEffect(() => () => { if (recording?.url) URL.revokeObjectURL(recording.url); }, [recording]);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const [recSaving, setRecSaving] = useState(false);
  const [recError, setRecError] = useState('');

  // Save the recording straight away so it can't be lost; notes can be added after.
  const saveRecording = async (r, fields) => {
    setRecSaving(true);
    setRecError('');
    try {
      let saved = existing;
      if (!saved) {
        saved = await api.insertInteraction({
          kind: fields.kind,
          occurred_on: fields.occurred_on || todayISO(),
          title: fields.title.trim() || 'Recorded conversation',
          notes: fields.notes.trim() || null,
          transcript: fields.transcript.trim() || null,
          contact_id: contact.id,
          workspace_id: contact.workspace_id,
        });
      }
      const path = await api.uploadRecording(contact.workspace_id, contact.id, saved.id, r.blob, r.ext);
      const patch = { audio_path: path, duration_sec: r.duration };
      if (r.liveTranscript && !existing) patch.transcript = fields.transcript.trim() || null;
      saved = await api.updateInteraction(saved.id, patch);
      if (existing?.audio_path && existing.audio_path !== path) {
        api.removeStorageObjects('recordings', [existing.audio_path]).catch(() => {});
      }
      setRecording((cur) => (cur === r ? { ...r, saved: true } : cur));
      if (!fields.title.trim() && !existing) setF((x) => ({ ...x, title: 'Recorded conversation' }));
      toast('Saved. Recording added to the timeline.');
      await onAutoSaved(saved);
    } catch (e) {
      setRecError(`The recording was not saved: ${e.message}`);
      toast(`The recording was not saved: ${e.message}`, 'error');
    } finally {
      setRecSaving(false);
    }
  };

  const onRecorded = (r) => {
    setRecording(r);
    setTranscribeMsg('');
    const fields = r.liveTranscript ? { ...f, transcript: f.transcript ? `${f.transcript}\n\n${r.liveTranscript}` : r.liveTranscript } : f;
    if (r.liveTranscript) setF(fields);
    saveRecording(r, fields);
  };

  const doTranscribe = async () => {
    setTranscribing(true);
    setTranscribeMsg('');
    try {
      const text = await api.transcribe(recording.blob, whisperLang(lang), recording.ext);
      setF((x) => ({ ...x, transcript: text }));
      toast('Transcript ready');
    } catch (e) {
      setTranscribeMsg(e.code === 'not_configured'
        ? 'Server transcription is not set up for Nomiqo yet (it needs the AI Gateway key). Use the live transcript or type your notes instead.'
        : `Transcription failed: ${e.message}`);
    } finally {
      setTranscribing(false);
    }
  };

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
      ...(recording ? { duration_sec: recording.duration } : {}),
    };
    try {
      let saved = existing
        ? await api.updateInteraction(existing.id, row)
        : await api.insertInteraction({ ...row, contact_id: contact.id, workspace_id: contact.workspace_id });

      if (recording && !recording.saved) {
        try {
          const path = await api.uploadRecording(contact.workspace_id, contact.id, saved.id, recording.blob, recording.ext);
          if (existing?.audio_path && existing.audio_path !== path) {
            await api.removeStorageObjects('recordings', [existing.audio_path]).catch(() => {});
          }
          saved = await api.updateInteraction(saved.id, { audio_path: path });
        } catch (err) {
          toast(`Entry saved, but the recording did not upload: ${err.message}`, 'error');
        }
      }

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

  const existingAudio = existing?.audio_path ? signed('recordings', existing.audio_path) : null;

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

      <div className="field">
        <span className="label">Recording</span>
        {existingAudio && !recording && (
          <div className="entry-audio"><audio controls src={existingAudio} aria-label="Saved recording" /> <span className="muted small">Recording a new one replaces it.</span></div>
        )}
        {recording ? (
          <div className="rec-done">
            <audio controls src={recording.url} aria-label="New recording" />
            <span className="mono small">{formatDuration(recording.duration)}</span>
            {ai && (
              <button type="button" className="btn btn-outline btn-sm" onClick={doTranscribe} disabled={transcribing}>
                {transcribing ? <><Spinner /> Transcribing…</> : <><Icon name="edit" size={14} /> Transcribe recording</>}
              </button>
            )}
            {recSaving ? <span className="small muted"><Spinner /> Saving recording…</span>
              : recording.saved ? <span className="small rec-saved"><Icon name="check" size={14} /> Saved</span>
                : <button type="button" className="btn btn-outline btn-sm" onClick={() => saveRecording(recording, f)}>Try saving again</button>}
          </div>
        ) : can('meeting') ? (
          <Recorder onRecorded={onRecorded} lang={lang} setLang={setLang} autoStart={autoRecord} />
        ) : !existingAudio && <span className="muted small">Recording is turned off for your account.</span>}
        {recError && <p className="form-error" role="alert">{recError}</p>}
        {transcribeMsg && <p className="notice notice-warn">{transcribeMsg}</p>}
      </div>

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
