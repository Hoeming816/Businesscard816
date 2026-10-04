import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context.js';
import { ACTION_PRIORITIES, ACTION_STATUSES } from '../taxonomy.js';
import { todayISO } from '../filters.js';
import { clock, decisionLabel, dueState, lineTime, meetingTimes, minutesColumns, minutesDoc, minutesFileName, normaliseMinutes } from '../minutes.js';
import { DOCX_TYPE, docxBytes } from '../docx.js';
import { Icon, Spinner, ConfirmButton, Pill, SaveLabel, Tabs, useJustSaved, formatDate, formatDuration } from './ui.jsx';

const TABS = [
  { value: 'mt-summary', label: 'Summary' },
  { value: 'mt-minutes', label: 'Minutes' },
  { value: 'mt-actions', label: 'Actions' },
  { value: 'mt-decisions', label: 'Decisions' },
  { value: 'mt-transcript', label: 'Transcript' },
  { value: 'mt-ask', label: 'Ask AI' },
];

const ASK_IDEAS = [
  'Who is responsible for what?',
  'What deadlines were agreed?',
  'Were any purchasing approvals made?',
  'Draft an email to everyone with the agreed action items.',
  'Create a management report from this meeting.',
];

const DUE_PILL = { overdue: ['danger', 'Overdue'], soon: ['warn', 'Due soon'], done: ['ok', 'Done'] };

/**
 * A typed meeting: its recording and the six AI outputs (summary, formal
 * minutes, action items, decisions, timed transcript, Ask AI), with edit and share.
 */
export default function MeetingView({ i, contact, canEdit, canMakeMinutes, making, stage, busy, onMakeMinutes, onDelete, onDeleteRecording, onChanged }) {
  const { api, toast, ensureSigned, signed } = useApp();
  const [tab, setTab] = useState('mt-summary');
  const [editing, setEditing] = useState(false);
  const audioRef = useRef(null);
  useEffect(() => { if (i.audio_path) ensureSigned('recordings', [i.audio_path]); }, [i.audio_path, ensureSigned]);
  const audio = i.audio_path ? signed('recordings', i.audio_path) : null;
  const m = i.minutes ? normaliseMinutes(i.minutes) : null;
  const t = meetingTimes(i);

  const jump = (sec) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = sec;
    a.play().catch(() => {});
  };

  const setStatus = async (k, status) => {
    const next = { ...m, action_items: m.action_items.map((a, j) => (j === k ? { ...a, status } : a)) };
    try {
      await api.updateInteraction(i.id, minutesColumns(next));
      await onChanged();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  // Shares the minutes as a Word file through the device's share sheet (WhatsApp, Viber,
  // Outlook, Mail…). Where the browser can't share files, the file is downloaded instead.
  const shareMinutes = async () => {
    const name = minutesFileName(i, formatDate);
    const blob = new Blob([docxBytes(minutesDoc({ ...i, minutes: m }, contact, formatDate))], { type: DOCX_TYPE });
    const file = typeof File === 'function' ? new File([blob], name, { type: DOCX_TYPE }) : null;
    if (file && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name.replace(/\.docx$/, '') });
        return;
      } catch (e) {
        if (e?.name === 'AbortError') return;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast(`Downloaded "${name}". Sharing files isn't available in this browser, so attach it in your email or chat app.`);
  };

  if (editing) {
    return <MinutesEditor i={i} minutes={m} onCancel={() => setEditing(false)} onSaved={async () => { setEditing(false); await onChanged(); }} />;
  }

  return (
    <div className="meeting">
      <div className="meeting-head">
        <Pill tone="accent" icon="users">{i.meeting_type}</Pill>
        <span className="small muted">
          {formatDate(i.occurred_on)}
          {t && ` · ${clock(t.start)}–${clock(t.end)}`}
          {contact && ` · ${[contact.full_name, contact.company].filter(Boolean).join(', ')}`}
        </span>
      </div>

      {i.audio_path && (
        <div className="meeting-audio">
          {audio ? <audio ref={audioRef} controls preload="metadata" src={audio} aria-label={`Recording, ${formatDuration(i.duration_sec)}`} /> : <span className="muted small">Loading recording…</span>}
        </div>
      )}

      {making && <p className="notice meeting-making" role="status"><Spinner /> {stage || 'Working…'} This can take a minute.</p>}
      {!m && !making && canEdit && canMakeMinutes && (
        <button type="button" className="btn btn-primary" onClick={onMakeMinutes} disabled={busy}>
          <Icon name="sparkles" size={16} /> Make minutes with AI
        </button>
      )}

      <Tabs tabs={TABS} value={tab} onChange={setTab} label="Meeting" className="meeting-tabs" />
      <div className="meeting-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'mt-summary' && (m?.quick_summary.length ? <Bullets items={m.quick_summary} /> : <NotYet m={m} />)}
        {tab === 'mt-minutes' && (m ? <FormalMinutes i={i} m={m} contact={contact} /> : <NotYet m={m} />)}
        {tab === 'mt-actions' && (m ? (
          <>
            <Actions items={m.action_items} canEdit={canEdit} onStatus={setStatus} />
            {m.follow_up.length > 0 && <Section title="Outstanding from previous meetings"><FollowUp items={m.follow_up} /></Section>}
          </>
        ) : <NotYet m={m} />)}
        {tab === 'mt-decisions' && (m ? <Decisions items={m.decisions} /> : <NotYet m={m} />)}
        {tab === 'mt-transcript' && <Transcript i={i} onJump={audio ? jump : null} />}
        {tab === 'mt-ask' && <AskAI i={i} m={m} contact={contact} />}
      </div>

      <div className="meeting-tools">
        {m && <button type="button" className="btn btn-primary btn-sm" onClick={shareMinutes}><Icon name="send" size={14} /> Share</button>}
        {m && canEdit && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}><Icon name="edit" size={14} /> Edit minutes</button>}
        {m && canEdit && canMakeMinutes && (
          <ConfirmButton className="btn btn-ghost btn-sm" icon="refresh" confirmLabel="Write again" message="Write the minutes again? Your edits are replaced." onConfirm={onMakeMinutes} disabled={busy}>
            Write again
          </ConfirmButton>
        )}
        {canEdit && i.audio_path && (
          <ConfirmButton className="btn btn-ghost btn-sm" icon="trash" confirmLabel="Delete recording" message="Delete the recording? The minutes stay." onConfirm={onDeleteRecording}>
            Delete recording
          </ConfirmButton>
        )}
        {canEdit && (
          <ConfirmButton className="btn btn-danger-ghost btn-sm" icon="trash" confirmLabel="Delete" message="Delete this meeting and its recording?" onConfirm={onDelete}>
            Delete meeting
          </ConfirmButton>
        )}
      </div>
    </div>
  );
}

function NotYet({ m }) {
  return <p className="muted small">{m ? 'Nothing for this section in this meeting.' : 'The AI minutes are not ready yet.'}</p>;
}

function Bullets({ items }) {
  return <ul className="meeting-bullets">{items.map((x, k) => <li key={k}>{x}</li>)}</ul>;
}

function Section({ title, children }) {
  return (
    <section className="fm-section">
      <h5>{title}</h5>
      {children}
    </section>
  );
}

function FormalMinutes({ i, m, contact }) {
  const t = meetingTimes(i);
  const details = [
    ['Meeting', i.title || i.meeting_type],
    ['Type', i.meeting_type],
    ['Date', formatDate(i.occurred_on)],
    ['Time', t && `${clock(t.start)}–${clock(t.end)}`],
    ['Location', m.location],
    ['Chairperson', m.chairperson],
    ['Attendees', m.attendees.join(', ')],
    ['Contact', contact && [contact.full_name, contact.company].filter(Boolean).join(', ')],
  ].filter(([, v]) => v);
  const nextMeeting = /^\d{4}-\d{2}-\d{2}$/.test(m.next_meeting) ? formatDate(m.next_meeting) : m.next_meeting;
  return (
    <article className="formal-minutes">
      <h4>Meeting minutes</h4>
      <dl className="fm-details">
        {details.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      {m.agenda.length > 0 && <Section title="Agenda"><ol>{m.agenda.map((a, k) => <li key={k}>{a}</li>)}</ol></Section>}
      {m.discussion.length > 0 && (
        <Section title="Discussion">
          <ol>
            {m.discussion.map((d, k) => (
              <li key={k}><strong>{d.topic}</strong>{d.points.length > 0 && <ul>{d.points.map((p, j) => <li key={j}>{p}</li>)}</ul>}</li>
            ))}
          </ol>
        </Section>
      )}
      {m.decisions.length > 0 && <Section title="Decisions made"><Decisions items={m.decisions} /></Section>}
      {m.follow_up.length > 0 && <Section title="Outstanding from previous meetings"><FollowUp items={m.follow_up} /></Section>}
      {m.action_items.length > 0 && <Section title="Action items"><Actions items={m.action_items} /></Section>}
      {m.issues.length > 0 && <Section title="Issues / risks"><Bullets items={m.issues} /></Section>}
      {m.next_steps.length > 0 && <Section title="Next steps"><Bullets items={m.next_steps} /></Section>}
      {nextMeeting && <Section title="Next meeting"><p>{nextMeeting}</p></Section>}
    </article>
  );
}

const FOLLOW_TONE = { Completed: ['ok', 'check'], Overdue: ['danger', 'alert'], Pending: ['warn', 'clock'] };

/** Earlier meetings' action items as this meeting found them: Completed, Overdue or Pending. */
export function FollowUp({ items }) {
  return (
    <ul className="follow-up">
      {items.map((f) => (
        <li key={f.ref}>
          <Icon name={FOLLOW_TONE[f.state][1]} size={16} className={`fu-icon fu-${FOLLOW_TONE[f.state][0]}`} />
          <div className="action-body">
            <span><strong>{f.action}</strong>{f.assigned_to && ` — ${f.assigned_to}`} — <Pill tone={FOLLOW_TONE[f.state][0]}>{f.state}</Pill></span>
            <span className="small muted">From {f.meeting}{f.date && `, ${formatDate(f.date)}`}{f.due && ` · due ${formatDate(f.due)}`}</span>
            {f.note && <span className="small">{f.note}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Decisions({ items }) {
  if (!items.length) return <p className="muted small">No decisions were recorded in this meeting.</p>;
  return (
    <ol className="decisions">
      {items.map((d, k) => (
        <li key={k}><span className="decision-no">{decisionLabel(k)}</span><span>{d}</span></li>
      ))}
    </ol>
  );
}

export function Actions({ items, canEdit, onStatus }) {
  const today = todayISO();
  if (!items.length) return <p className="muted small">No action items were agreed in this meeting.</p>;
  return (
    <ul className="actions-list">
      {items.map((a, k) => {
        const due = DUE_PILL[dueState(a, today)];
        return (
          <li key={k} className={a.status === 'Done' ? 'is-done' : ''}>
            {onStatus && canEdit ? (
              <label className="action-check">
                <input type="checkbox" checked={a.status === 'Done'} onChange={(e) => onStatus(k, e.target.checked ? 'Done' : 'Open')} />
                <span className="sr-only">Done</span>
              </label>
            ) : null}
            <div className="action-body">
              <strong className="action-text">{a.action}</strong>
              <span className="action-meta small">
                <span><Icon name="user" size={12} /> {a.assigned_to || 'Not assigned'}</span>
                <span><Icon name="calendar" size={12} /> {a.due ? formatDate(a.due) : 'No due date'}</span>
                <Pill tone={a.priority === 'High' ? 'hot' : 'neutral'}>{a.priority}</Pill>
                {due ? <Pill tone={due[0]}>{due[1]}</Pill> : <Pill>{a.status}</Pill>}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Transcript({ i, onJump }) {
  const segs = Array.isArray(i.segments) ? i.segments : [];
  if (segs.length) {
    return (
      <ol className="transcript-lines">
        {segs.map((s, k) => (
          <li key={k}>
            {onJump ? (
              <button type="button" className="transcript-line" onClick={() => onJump(s.t)} aria-label={`Play from ${lineTime(i, s.t)}`}>
                <span className="mono small transcript-time">{lineTime(i, s.t)}</span>
                <span>{s.text}</span>
              </button>
            ) : (
              <span className="transcript-line"><span className="mono small transcript-time">{lineTime(i, s.t)}</span><span>{s.text}</span></span>
            )}
          </li>
        ))}
      </ol>
    );
  }
  if (i.transcript) return <p className="transcript-plain">{i.transcript}</p>;
  return <p className="muted small">No transcript yet. It is made with the minutes.</p>;
}

function AskAI({ i, m, contact }) {
  const { api } = useApp();
  const [q, setQ] = useState('');
  const [history, setHistory] = useState([]); // [{ q, a }]
  const [asking, setAsking] = useState(false);
  const [err, setErr] = useState('');
  const ready = !!(i.transcript || i.notes);

  const ask = async (question) => {
    const text = question.trim();
    if (!text || asking) return;
    setAsking(true);
    setErr('');
    try {
      const a = await api.askMeeting({
        question: text,
        history,
        title: i.title || '',
        meeting_type: i.meeting_type,
        date: i.occurred_on,
        notes: i.notes || '',
        transcript: i.transcript || '',
        minutes: m,
        contact: contact ? { full_name: contact.full_name, company: contact.company, job_title: contact.job_title } : {},
      });
      setHistory((h) => [...h, { q: text, a }]);
      setQ('');
    } catch (e) {
      setErr(e.message);
    } finally {
      setAsking(false);
    }
  };

  if (!ready) return <p className="muted small">Ask AI works once the meeting has a transcript. Make the minutes first.</p>;
  return (
    <div className="ask-ai">
      {history.length === 0 && (
        <div className="chips ask-ideas" role="group" aria-label="Ideas">
          {ASK_IDEAS.map((x) => <button key={x} type="button" className="chip" onClick={() => ask(x)} disabled={asking}>{x}</button>)}
        </div>
      )}
      {history.map((h, k) => (
        <div key={k} className="ask-turn">
          <p className="ask-q">{h.q}</p>
          <div className="ask-a">
            <p>{h.a}</p>
            <button type="button" className="link small" onClick={() => navigator.clipboard?.writeText(h.a)}><Icon name="copy" size={13} /> Copy</button>
          </div>
        </div>
      ))}
      {err && <p className="form-error" role="alert">{err}</p>}
      <form className="ask-form" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
        <input type="text" placeholder="Ask anything about this meeting…" aria-label="Ask about this meeting" value={q} onChange={(e) => setQ(e.target.value)} disabled={asking} />
        <button type="submit" className="btn btn-primary" disabled={asking || !q.trim()}>
          {asking ? <Spinner /> : <Icon name="send" size={16} />}<span className="sr-only">Ask</span>
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editing the minutes
// ---------------------------------------------------------------------------

const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);

function MinutesEditor({ i, minutes, onCancel, onSaved }) {
  const { api, toast } = useApp();
  const m = minutes || normaliseMinutes();
  const [title, setTitle] = useState(i.title || '');
  const [f, setF] = useState(() => ({
    quick_summary: m.quick_summary.join('\n'),
    chairperson: m.chairperson,
    attendees: m.attendees.join(', '),
    location: m.location,
    agenda: m.agenda.join('\n'),
    discussion: m.discussion.map((d) => ({ topic: d.topic, points: d.points.join('\n') })),
    decisions: m.decisions.join('\n'),
    action_items: m.action_items,
    issues: m.issues.join('\n'),
    next_steps: m.next_steps.join('\n'),
    next_meeting: m.next_meeting,
  }));
  const [saving, setSaving] = useState(false);
  const [justSaved, markSaved] = useJustSaved();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setAction = (k, key, v) => setF((x) => ({ ...x, action_items: x.action_items.map((a, j) => (j === k ? { ...a, [key]: v } : a)) }));
  const setTopic = (k, key, v) => setF((x) => ({ ...x, discussion: x.discussion.map((d, j) => (j === k ? { ...d, [key]: v } : d)) }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const next = normaliseMinutes({
        ...f,
        quick_summary: lines(f.quick_summary),
        attendees: f.attendees.split(',').map((x) => x.trim()).filter(Boolean),
        agenda: lines(f.agenda),
        discussion: f.discussion.map((d) => ({ topic: d.topic, points: lines(d.points) })),
        decisions: lines(f.decisions),
        issues: lines(f.issues),
        next_steps: lines(f.next_steps),
      });
      await api.updateInteraction(i.id, { title: title.trim() || null, ...minutesColumns(next) });
      setSaving(false);
      markSaved();
      await new Promise((r) => setTimeout(r, 900)); // let the button show "Saved" before the form closes
      await onSaved();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const area = (id, label, k, rows = 3, hint = 'One per line') => (
    <div className="field">
      <label htmlFor={id}>{label} <span className="muted small">({hint})</span></label>
      <textarea id={id} rows={rows} value={f[k]} onChange={set(k)} />
    </div>
  );

  return (
    <form className="editor panel minutes-editor" onSubmit={save} aria-label="Edit minutes">
      <div className="field">
        <label htmlFor="me-title">Meeting title</label>
        <input id="me-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={i.meeting_type} />
      </div>
      {area('me-summary', 'Quick summary', 'quick_summary', 5)}
      <div className="grid-3">
        <div className="field"><label htmlFor="me-chair">Chairperson</label><input id="me-chair" value={f.chairperson} onChange={set('chairperson')} /></div>
        <div className="field"><label htmlFor="me-loc">Location</label><input id="me-loc" value={f.location} onChange={set('location')} /></div>
        <div className="field"><label htmlFor="me-next">Next meeting</label><input id="me-next" value={f.next_meeting} onChange={set('next_meeting')} placeholder="e.g. 2026-10-10" /></div>
      </div>
      <div className="field"><label htmlFor="me-att">Attendees <span className="muted small">(separate with commas)</span></label><input id="me-att" value={f.attendees} onChange={set('attendees')} /></div>
      {area('me-agenda', 'Agenda', 'agenda')}

      <fieldset className="field me-group">
        <legend className="label">Discussion</legend>
        {f.discussion.map((d, k) => (
          <div key={k} className="me-topic">
            <div className="me-row">
              <input aria-label={`Topic ${k + 1}`} value={d.topic} onChange={(e) => setTopic(k, 'topic', e.target.value)} placeholder="Topic" />
              <button type="button" className="icon-btn" aria-label={`Remove topic ${k + 1}`} onClick={() => setF((x) => ({ ...x, discussion: x.discussion.filter((_, j) => j !== k) }))}><Icon name="x" size={14} /></button>
            </div>
            <textarea aria-label={`Points for topic ${k + 1}, one per line`} rows={3} value={d.points} onChange={(e) => setTopic(k, 'points', e.target.value)} />
          </div>
        ))}
        <button type="button" className="link small" onClick={() => setF((x) => ({ ...x, discussion: [...x.discussion, { topic: '', points: '' }] }))}><Icon name="plus" size={13} /> Add topic</button>
      </fieldset>

      {area('me-decisions', 'Decisions', 'decisions')}

      <fieldset className="field me-group">
        <legend className="label">Action items</legend>
        {f.action_items.map((a, k) => (
          <div key={k} className="me-action">
            <div className="me-row">
              <input aria-label={`Action ${k + 1}`} value={a.action} onChange={(e) => setAction(k, 'action', e.target.value)} placeholder="Action" />
              <button type="button" className="icon-btn" aria-label={`Remove action ${k + 1}`} onClick={() => setF((x) => ({ ...x, action_items: x.action_items.filter((_, j) => j !== k) }))}><Icon name="x" size={14} /></button>
            </div>
            <div className="me-action-meta">
              <input aria-label={`Assigned to, action ${k + 1}`} value={a.assigned_to} onChange={(e) => setAction(k, 'assigned_to', e.target.value)} placeholder="Assigned to" />
              <input aria-label={`Due date, action ${k + 1}`} type="date" value={a.due} onChange={(e) => setAction(k, 'due', e.target.value)} />
              <select aria-label={`Priority, action ${k + 1}`} value={a.priority} onChange={(e) => setAction(k, 'priority', e.target.value)}>
                {ACTION_PRIORITIES.map((p) => <option key={p}>{p}</option>)}
              </select>
              <select aria-label={`Status, action ${k + 1}`} value={a.status} onChange={(e) => setAction(k, 'status', e.target.value)}>
                {ACTION_STATUSES.map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
          </div>
        ))}
        <button type="button" className="link small" onClick={() => setF((x) => ({ ...x, action_items: [...x.action_items, { action: '', assigned_to: '', due: '', priority: 'Medium', status: 'Open' }] }))}><Icon name="plus" size={13} /> Add action item</button>
      </fieldset>

      {area('me-issues', 'Issues / risks', 'issues')}
      {area('me-steps', 'Next steps', 'next_steps')}

      <div className="save-bar is-dirty">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving || justSaved}><SaveLabel saving={saving} saved={justSaved}>Save minutes</SaveLabel></button>
      </div>
    </form>
  );
}
