import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context.js';
import { toISODate } from '../filters.js';
import { cleanTask, dueLabel, filterTasks, groupTasks, isDone, myDay, nowHHMM, parseQuickAdd, repeatLabel } from '../todo.js';
import { MINUTES_LANGUAGES } from '../minutes.js';
import { canRecord, extFor, pickMime } from './Recorder.jsx';
import TaskEditor from './TaskEditor.jsx';
import TaskCalendar from './TaskCalendar.jsx';
import TaskRow, { SelectTasks } from './TaskRow.jsx';
import { canNotify } from './TaskReminders.jsx';
import { Icon, Spinner, EmptyState } from './ui.jsx';

const VIEWS = [
  { value: 'today', label: 'Today' },
  { value: 'all', label: 'All tasks' },
  { value: 'calendar', label: 'Calendar' },
];
const SHOW = [
  { value: 'open', label: 'Not done' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'given', label: 'Given to others' },
  { value: 'to_me', label: 'Given to me' },
  { value: 'done', label: 'Done' },
];
const VIEW_KEY = 'nomiqo.todoView';
const MAX_VOICE_SEC = 30;

const clockNow = () => { const n = new Date(); return { today: toISODate(n), time: nowHHMM(n) }; };
// Chinese text, or Tagalog words the quick parser doesn't know, go to the AI reader.
// The language spoken tasks are written in: English unless another is picked, kept on this device.
const VOICE_LANG_KEY = 'nomiqo.voiceLanguage';
const readVoiceLang = () => {
  try { const v = localStorage.getItem(VOICE_LANG_KEY); return MINUTES_LANGUAGES.some((l) => l.value === v) ? v : 'English'; } catch { return 'English'; }
};
const NEEDS_AI = /[㐀-鿿]|\b(bukas|mamaya|ngayon|mamayang|alas|lunes|martes|miyerkules|huwebes|biyernes|sabado|linggo|tuwing|araw-araw|paalala|tawagan|kailangan|sa susunod)\b/i;

/** The To Do List: one add box (type or speak), Today, All tasks and Calendar. */
export default function Todo() {
  const { api, uid, toast, tasks, tasksState, tasksError, reloadTasks, removeTask } = useApp();
  const [view, setViewRaw] = useState(() => { try { return sessionStorage.getItem(VIEW_KEY) || 'today'; } catch { return 'today'; } });
  const setView = (v) => { setViewRaw(v); try { sessionStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ } };
  const [editing, setEditing] = useState(null); // a task, or { new: true, ...fields }
  const [flash, setFlash] = useState(null); // id of the task just added
  const [selected, setSelected] = useState(null); // a Set of task ids while choosing tasks to delete
  const selecting = !!selected;
  const [askDelete, setAskDelete] = useState(''); // '' | 'ask' | 'busy'
  const canSelect = view !== 'calendar' && tasks.some((t) => t.created_by === uid);
  const toggleSelect = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const stopSelecting = () => { setSelected(null); setAskDelete(''); };
  const deleteSelected = async () => {
    setAskDelete('busy');
    const ids = [...selected];
    const results = await Promise.allSettled(ids.map((id) => api.deleteTask(id)));
    let gone = 0;
    results.forEach((r, i) => { if (r.status === 'fulfilled') { removeTask(ids[i]); gone += 1; } });
    const failed = ids.length - gone;
    toast(failed ? `${gone} deleted; ${failed} could not be deleted.` : `${gone} ${gone === 1 ? 'task' : 'tasks'} deleted.`, failed ? 'error' : 'ok');
    stopSelecting();
  };

  useEffect(() => { if (tasksState === 'idle') reloadTasks(); }, [tasksState, reloadTasks]);
  const openCount = tasks.filter((t) => !isDone(t)).length;

  return (
    <section className="todo-page" aria-labelledby="todo-title">
      <div className="todo-head">
        <h1 id="todo-title" className="h1">To Do List</h1>
        <span className="result-count mono">{tasksState === 'ready' ? `${openCount} not done` : ''}</span>
        <NotifyButton />
      </div>

      <QuickAdd onAdded={(t) => { setFlash(t.id); setTimeout(() => setFlash(null), 2500); }} onMore={(fields) => setEditing({ new: true, ...fields })} />

      <div className="todo-views-row">
        <div className="chips view-switch todo-views" role="group" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.value} type="button" className={`chip ${view === v.value ? 'is-on' : ''}`} aria-pressed={view === v.value}
              onClick={() => { setView(v.value); stopSelecting(); }}>{v.label}</button>
          ))}
        </div>
        {canSelect && !selecting && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>
            <Icon name="check" size={15} /> Select
          </button>
        )}
      </div>

      {selecting && (
        <div className="select-bar" role="region" aria-label="Delete several tasks">
          {askDelete ? (
            <>
              <span className="select-bar-count">Delete {selected.size} {selected.size === 1 ? 'task' : 'tasks'}?</span>
              <button type="button" className="btn btn-danger btn-sm" autoFocus disabled={askDelete === 'busy'} onClick={deleteSelected}>
                {askDelete === 'busy' ? 'Deleting…' : 'Delete'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={askDelete === 'busy'} onClick={() => setAskDelete('')}>Back</button>
            </>
          ) : (
            <>
              <span className="select-bar-count">{selected.size ? `${selected.size} selected` : 'Tap your tasks to select them'}</span>
              {selected.size > 0 && (
                <button type="button" className="btn btn-danger btn-sm" onClick={() => setAskDelete('ask')}>
                  <Icon name="trash" size={15} /> Delete ({selected.size})
                </button>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={stopSelecting}>Cancel</button>
            </>
          )}
        </div>
      )}

      {tasksState === 'loading' && !tasks.length && <div className="loading-block"><Spinner /> Loading your tasks…</div>}
      {tasksState === 'error' && <p className="notice notice-error" role="alert">{tasksError}</p>}

      <SelectTasks.Provider value={selecting ? { selected, toggle: toggleSelect } : null}>
        {view === 'today' && <TodayView flash={flash} onOpen={setEditing} />}
        {view === 'all' && <AllView flash={flash} onOpen={setEditing} />}
      </SelectTasks.Provider>
      {view === 'calendar' && <TaskCalendar onOpen={setEditing} onAdd={(due_on) => setEditing({ new: true, due_on })} />}

      {editing && <TaskEditor task={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

/** Asks once for phone or computer notifications, so reminders show outside the app tab too. */
function NotifyButton() {
  const [perm, setPerm] = useState(() => (canNotify() ? Notification.permission : 'denied'));
  if (perm !== 'default') return null;
  return (
    <button type="button" className="btn btn-ghost btn-sm todo-notify" onClick={async () => {
      try { setPerm(await Notification.requestPermission()); } catch { setPerm('denied'); }
    }}>
      <Icon name="bell" size={15} /> <span>Turn on reminders</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Add box: type ("Call Peter tomorrow 10am") or tap the mic and say it.
// ---------------------------------------------------------------------------

function QuickAdd({ onAdded, onMore }) {
  const { api, toast, upsertTask } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [lang, setLangRaw] = useState(readVoiceLang);
  const setLang = (v) => { setLangRaw(v); try { localStorage.setItem(VOICE_LANG_KEY, v); } catch { /* private mode */ } };
  const input = useRef(null);
  const preview = useMemo(() => (text.trim() && !NEEDS_AI.test(text) ? parseQuickAdd(text) : null), [text]);
  const today = toISODate(new Date());

  const save = async (fields, heard) => {
    const row = cleanTask({ ...fields, subtasks: (fields.subtasks || []).map((s) => (typeof s === 'string' ? { text: s } : s)) });
    if (!row.title) return;
    const saved = await api.insertTask(row);
    upsertTask(saved);
    onAdded(saved);
    const when = dueLabel(saved, today);
    const at = when.replace(/^(Today|Tomorrow)/, (w) => w.toLowerCase());
    toast(heard ? `Added "${saved.title}"${at ? `, ${at}` : ''}. You said: "${heard}"` : `Added${at ? ` for ${at}` : ''}.`);
  };

  const add = async (e) => {
    e?.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setBusy('add');
    try {
      let fields;
      if (NEEDS_AI.test(value)) {
        try { fields = await api.aiTask(value, clockNow()); } catch { fields = parseQuickAdd(value); }
      } else {
        fields = parseQuickAdd(value);
      }
      await save(fields);
      setText('');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
      input.current?.focus();
    }
  };

  return (
    <form className="quick-add" onSubmit={add}>
      <div className="quick-add-row">
        <input
          ref={input}
          type="text"
          enterKeyHint="done"
          placeholder="Add a task, e.g. Call Peter tomorrow 10am"
          aria-label="Add a task"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!!busy && busy !== 'add'}
          maxLength={500}
        />
        <VoiceButton language={lang} disabled={!!busy} onBusy={setBusy} onHeard={async ({ text: heard, task }) => {
          try { await save(task, heard); } catch (err) { toast(err.message, 'error'); }
        }} />
        <button type="submit" className="btn btn-primary" disabled={!text.trim() || !!busy} aria-label="Add task">
          {busy === 'add' ? <Spinner label="Adding" /> : <Icon name="plus" size={18} strokeWidth={2.2} />}
          <span className="quick-add-label">Add</span>
        </button>
      </div>
      {preview && (preview.due_on || preview.repeat || preview.priority !== 'Normal') && (
        <p className="quick-add-hint small" aria-live="polite">
          <Icon name="calendar" size={13} />
          {[dueLabel(preview, today), repeatLabel(preview.repeat), preview.priority !== 'Normal' ? preview.priority : ''].filter(Boolean).join(' · ')}
          <button type="button" className="link" onClick={() => { onMore(preview); setText(''); }}>More options</button>
        </p>
      )}
      {canRecord && (
        <label className="quick-add-lang small muted">
          <Icon name="mic" size={13} /> Voice tasks in
          <select value={lang} onChange={(e) => setLang(e.target.value)} disabled={!!busy}>
            {MINUTES_LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </label>
      )}
      {busy === 'voice' && <p className="quick-add-hint small" role="status"><Spinner /> Working out your task…</p>}
    </form>
  );
}

/**
 * Tap to speak, tap again to stop. The recording is turned into a task by AI, written in
 * `language` (English by default); Mandarin or Tagalog speech is translated into it.
 */
function VoiceButton({ language, onHeard, onBusy, disabled }) {
  const { api, toast } = useApp();
  const [on, setOn] = useState(false);
  const [secs, setSecs] = useState(0);
  const rec = useRef(null);

  useEffect(() => () => stopAll(), []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!canRecord) return null;

  function stopAll() {
    const r = rec.current;
    if (!r) return;
    clearInterval(r.timer);
    r.stream?.getTracks().forEach((t) => t.stop());
  }

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mime = pickMime();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      const startedAt = Date.now();
      const r = { stream, mr, chunks };
      rec.current = r;
      mr.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      mr.onstop = async () => {
        stopAll();
        rec.current = null;
        setOn(false);
        const type = (mr.mimeType || mime || 'audio/webm').split(';')[0];
        const blob = new Blob(chunks, { type });
        if (!blob.size || Date.now() - startedAt < 600) { toast('Nothing was heard. Tap the mic and speak, then tap it again.', 'error'); return; }
        onBusy('voice');
        try {
          onHeard(await api.voiceTask(blob, extFor(type), clockNow(), language));
        } catch (e) {
          toast(e.message, 'error');
        } finally {
          onBusy('');
        }
      };
      mr.start();
      setSecs(0);
      r.timer = setInterval(() => {
        const s = Math.round((Date.now() - startedAt) / 1000);
        setSecs(s);
        if (s >= MAX_VOICE_SEC && mr.state !== 'inactive') mr.stop();
      }, 250);
      setOn(true);
    } catch (e) {
      toast(e?.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in your browser settings.' : 'Could not start the microphone.', 'error');
    }
  };
  const stop = () => { const r = rec.current; if (r && r.mr.state !== 'inactive') r.mr.stop(); };

  return (
    <button
      type="button"
      className={`btn ${on ? 'btn-danger' : 'btn-outline'} voice-btn`}
      onClick={on ? stop : start}
      disabled={disabled && !on}
      aria-label={on ? 'Stop and add the task' : 'Say a task'}
      title={on ? 'Tap to stop' : 'Say a task'}
    >
      <Icon name={on ? 'stop' : 'mic'} size={18} />
      {on && <span className="mono small">{secs}s</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

function TodayView({ flash, onOpen }) {
  const { tasks, tasksState } = useApp();
  const day = myDay(tasks);
  const today = toISODate(new Date());
  const empty = !day.overdue.length && !day.today.length;
  if (tasksState !== 'ready' && !tasks.length) return null;
  return (
    <div className="todo-lists">
      {day.overdue.length > 0 && (
        <TaskGroup label="From earlier days" tone="danger" items={day.overdue} flash={flash} onOpen={onOpen} today={today} />
      )}
      {day.today.length > 0 && <TaskGroup label="Today" items={day.today} flash={flash} onOpen={onOpen} today={today} />}
      {empty && (
        <EmptyState icon="check" title={day.done.length ? 'All done for today' : 'Nothing for today'}>
          Type a task above, or tap the mic and say it. Tasks for today and any you didn't finish before show here.
        </EmptyState>
      )}
      {day.done.length > 0 && <TaskGroup label="Done today" items={day.done} flash={flash} onOpen={onOpen} today={today} collapsible />}
    </div>
  );
}

function AllView({ flash, onOpen }) {
  const { tasks, uid } = useApp();
  const [q, setQ] = useState('');
  const [show, setShow] = useState('open');
  const today = toISODate(new Date());
  const list = filterTasks(tasks, {
    q,
    status: show === 'done' ? 'done' : 'open',
    due: show === 'overdue' ? 'overdue' : 'any',
    who: show === 'given' || show === 'to_me' ? show : 'all',
  }, uid);
  const groups = groupTasks(list);
  return (
    <div className="todo-lists">
      <div className="toolbar">
        <div className="input-icon search">
          <Icon name="search" size={17} />
          <input type="search" placeholder="Search tasks, notes, tags…" aria-label="Search tasks" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="select-inline">
          <span className="sr-only">Show</span>
          <select value={show} onChange={(e) => setShow(e.target.value)} aria-label="Show">
            {SHOW.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
      </div>
      {groups.map((g) => (
        <TaskGroup key={g.key} label={g.label} tone={g.key === 'overdue' ? 'danger' : ''} items={g.items} flash={flash} onOpen={onOpen} today={today} />
      ))}
      {!groups.length && (
        <EmptyState icon="search" title={tasks.length ? 'Nothing matches' : 'No tasks yet'}>
          {tasks.length ? 'Try another search, or show something else.' : 'Type a task above, or tap the mic and say it.'}
        </EmptyState>
      )}
    </div>
  );
}

function TaskGroup({ label, tone, items, flash, onOpen, today, collapsible = false }) {
  const [open, setOpen] = useState(!collapsible);
  return (
    <section className="task-group">
      <h2 className={`task-group-h ${tone ? `is-${tone}` : ''}`}>
        {collapsible ? (
          <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
            {label} <span className="chip-count">{items.length}</span>
            <Icon name="chevronDown" size={14} className={open ? 'is-flipped' : ''} />
          </button>
        ) : <>{label} <span className="chip-count">{items.length}</span></>}
      </h2>
      {open && (
        <ul className="task-list">
          {items.map((t) => <TaskRow key={t.id} task={t} today={today} flash={flash === t.id} onOpen={onOpen} />)}
        </ul>
      )}
    </section>
  );
}
