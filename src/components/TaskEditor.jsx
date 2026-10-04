import { useState } from 'react';
import { useApp } from '../context.js';
import { toISODate } from '../filters.js';
import {
  CATEGORIES, PRIORITIES, REMINDER_CHOICES, REPEAT_PRESETS, STATUSES, cleanTask, firstDate, formatLongDay,
  formatTime, newSubtaskId, normaliseRepeat, reminderLabel, repeatLabel, repeatPreset, smartReminders,
} from '../todo.js';
import { Modal, Icon, ConfirmButton, SaveLabel, useJustSaved } from './ui.jsx';

const WEEKDAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
const BLANK = { title: '', notes: '', priority: 'Normal', status: 'todo', due_on: null, due_time: null, reminders: [], repeat: null, subtasks: [], category: null, tags: [], my_day_on: null, assignee_id: null };

/** Add or edit one task. Someone who was given a task can only change its status and checklist. */
export default function TaskEditor({ task, onClose }) {
  const { api, uid, members, toast, upsertTask, removeTask } = useApp();
  const isNew = !!task.new;
  const mine = isNew || task.created_by === uid;
  const [t, setT] = useState(() => ({ ...BLANK, ...task, notes: task.notes || '', tags: task.tags || [], subtasks: task.subtasks || [] }));
  const [saving, setSaving] = useState(false);
  const [saved, markSaved] = useJustSaved();
  const [error, setError] = useState('');
  const [more, setMore] = useState(() => !!(task.category || task.tags?.length || task.assignee_id || (task.status && task.status !== 'todo' && task.status !== 'done')));
  const [newStep, setNewStep] = useState('');
  const today = toISODate(new Date());
  const set = (patch) => setT((x) => ({ ...x, ...patch }));

  // People who can be given tasks: active members of this team, not me.
  const people = members.filter((m) => m.user_id !== uid && m.status === 'active' && m.profile_status === 'active');

  const setDate = (due_on) => {
    const patch = { due_on: due_on || null };
    if (!due_on) Object.assign(patch, { due_time: null, repeat: null, reminders: [] });
    else if (!t.due_on && !t.reminders.length) patch.reminders = smartReminders(t.priority, !!t.due_time);
    set(patch);
  };
  const setTime = (due_time) => {
    const patch = { due_time: due_time || null };
    if (due_time && !t.due_on) patch.due_on = today;
    if (!t.reminders.length || t.reminders.join() === smartReminders(t.priority, !!t.due_time).join()) {
      patch.reminders = smartReminders(t.priority, !!due_time);
    }
    set(patch);
  };
  const setPriority = (priority) => {
    const patch = { priority };
    if (t.due_on && t.reminders.join() === smartReminders(t.priority, !!t.due_time).join()) patch.reminders = smartReminders(priority, !!t.due_time);
    set(patch);
  };
  const preset = repeatPreset(t.repeat) || (t.repeat ? 'custom' : '');
  const setPreset = (v) => {
    if (!v) return set({ repeat: null });
    const base = t.due_on || today;
    const p = REPEAT_PRESETS.find((x) => x.value === v);
    let repeat = v === 'custom' ? (normaliseRepeat(t.repeat) || { freq: 'weekly', interval: 1, days: [new Date(`${base}T00:00:00`).getDay()] }) : { ...p.repeat };
    if (repeat.freq === 'monthly') repeat = { ...repeat, day: Number(base.slice(8)) };
    set({ repeat, due_on: firstDate(base, repeat), ...(t.due_on ? {} : { reminders: smartReminders(t.priority, !!t.due_time) }) });
  };
  const toggleReminder = (m) => set({ reminders: t.reminders.includes(m) ? t.reminders.filter((x) => x !== m) : [...t.reminders, m].sort((a, b) => b - a) });

  const addStep = () => {
    const text = newStep.trim();
    if (!text) return;
    set({ subtasks: [...t.subtasks, { id: newSubtaskId(), text, done: false }] });
    setNewStep('');
  };
  const steps = t.subtasks;

  const save = async (e) => {
    e?.preventDefault();
    setError('');
    const withStep = newStep.trim() ? [...steps, { id: newSubtaskId(), text: newStep.trim(), done: false }] : steps;
    const row = cleanTask({ ...t, subtasks: withStep });
    if (!row.title) { setError('Give the task a name.'); return; }
    setSaving(true);
    try {
      let out;
      if (isNew) out = await api.insertTask(row);
      else if (mine) out = await api.updateTask(task.id, row);
      else out = await api.updateTask(task.id, { status: row.status, subtasks: row.subtasks });
      upsertTask(out);
      setNewStep('');
      markSaved();
      if (isNew) { toast('Task added.'); onClose(); }
      else setT((x) => ({ ...x, ...out, notes: out.notes || '', tags: out.tags || [], subtasks: out.subtasks || [] }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await api.deleteTask(task.id);
      removeTask(task.id);
      toast('Task deleted.');
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal title={isNew ? 'New task' : mine ? 'Edit task' : 'Task given to you'} onClose={onClose} className="task-editor">
      <button type="button" className="icon-btn modal-x" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
      <form className="form" onSubmit={save}>
        {!mine && (
          <p className="notice notice-info"><Icon name="user" size={14} /> From {task.assigned_by_name}. You can update its status and tick its checklist.</p>
        )}
        <div className="field">
          <label htmlFor="task-title">Task</label>
          <input id="task-title" value={t.title} onChange={(e) => set({ title: e.target.value })} readOnly={!mine} maxLength={300} data-autofocus={isNew ? true : undefined} placeholder="What needs doing?" />
        </div>

        {mine ? (
          <div className="grid-2">
            <div className="field">
              <label htmlFor="task-date">Date</label>
              <input id="task-date" type="date" value={t.due_on || ''} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="task-time">Time</label>
              <input id="task-time" type="time" value={t.due_time ? t.due_time.slice(0, 5) : ''} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
        ) : (t.due_on && (
          <p className="small"><Icon name="clock" size={13} /> Due {formatLongDay(t.due_on, today)}{t.due_time ? `, ${formatTime(t.due_time)}` : ''}{t.repeat ? ` · ${repeatLabel(t.repeat)}` : ''}</p>
        ))}

        {mine && (
          <div className="field">
            <span className="label" id="prio-l">Priority</span>
            <div className="segbar" role="radiogroup" aria-labelledby="prio-l">
              {PRIORITIES.map((p) => (
                <button key={p.value} type="button" role="radio" aria-checked={t.priority === p.value}
                  className={`segbar-item ${t.priority === p.value ? 'is-on' : ''} prio-${p.value.toLowerCase()}`} onClick={() => setPriority(p.value)}>
                  {p.value}
                </button>
              ))}
            </div>
          </div>
        )}

        {mine && t.due_on && (
          <div className="grid-2">
            <div className="field">
              <label htmlFor="task-repeat">Repeat</label>
              <select id="task-repeat" value={preset} onChange={(e) => setPreset(e.target.value)}>
                {REPEAT_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            {preset === 'custom' && t.repeat && (
              <div className="field">
                <span className="label">Every</span>
                <div className="repeat-custom">
                  <input type="number" min="1" max="99" value={t.repeat.interval} aria-label="How many"
                    onChange={(e) => set({ repeat: { ...t.repeat, interval: Math.max(1, Number(e.target.value) || 1) } })} />
                  <select value={t.repeat.freq} aria-label="Unit" onChange={(e) => {
                    const freq = e.target.value;
                    set({ repeat: normaliseRepeat({ freq, interval: t.repeat.interval, days: freq === 'weekly' ? t.repeat.days : undefined, day: freq === 'monthly' ? Number((t.due_on || today).slice(8)) : undefined }) });
                  }}>
                    <option value="daily">days</option><option value="weekly">weeks</option><option value="monthly">months</option><option value="yearly">years</option>
                  </select>
                </div>
              </div>
            )}
            {preset === 'custom' && t.repeat?.freq === 'weekly' && (
              <div className="field span-2">
                <span className="label">On</span>
                <div className="chips">
                  {WEEKDAYS.map(([d, l]) => {
                    const on = (t.repeat.days || []).includes(d);
                    return (
                      <button key={d} type="button" className={`chip ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => {
                        const days = on ? (t.repeat.days || []).filter((x) => x !== d) : [...(t.repeat.days || []), d];
                        const repeat = normaliseRepeat({ ...t.repeat, days });
                        set({ repeat, due_on: firstDate(t.due_on || today, repeat) });
                      }}>{l}</button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {mine && t.due_on && (
          <div className="field">
            <span className="label">Remind me</span>
            <div className="chips">
              {REMINDER_CHOICES.filter((c) => t.due_time || c.value % 1440 === 0).map((c) => {
                const on = t.reminders.includes(c.value);
                return (
                  <button key={c.value} type="button" className={`chip ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => toggleReminder(c.value)}>
                    {on && <Icon name="check" size={13} />} {!t.due_time && c.value === 0 ? 'On the day (9am)' : c.label}
                  </button>
                );
              })}
              {t.reminders.filter((m) => !REMINDER_CHOICES.some((c) => c.value === m)).map((m) => (
                <button key={m} type="button" className="chip is-on" aria-pressed="true" onClick={() => toggleReminder(m)}><Icon name="check" size={13} /> {reminderLabel(m)}</button>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <span className="label">Checklist</span>
          {steps.length > 0 && (
            <ul className="steps">
              {steps.map((s, i) => (
                <li key={s.id}>
                  <label className="check">
                    <input type="checkbox" checked={s.done} onChange={() => set({ subtasks: steps.map((x, k) => (k === i ? { ...x, done: !x.done } : x)) })} />
                    <span className={s.done ? 'is-done' : ''}>{s.text}</span>
                  </label>
                  {mine && (
                    <button type="button" className="icon-btn" aria-label={`Remove ${s.text}`} onClick={() => set({ subtasks: steps.filter((_, k) => k !== i) })}>
                      <Icon name="x" size={15} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {mine && (
            <div className="chip-add">
              <input value={newStep} onChange={(e) => setNewStep(e.target.value)} placeholder="Add a step" aria-label="Add a step"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addStep(); } }} />
              <button type="button" className="btn btn-outline btn-sm" onClick={addStep} disabled={!newStep.trim()}>Add</button>
            </div>
          )}
        </div>

        <div className="field">
          <label htmlFor="task-notes">Notes</label>
          <textarea id="task-notes" rows={3} value={t.notes} onChange={(e) => set({ notes: e.target.value })} readOnly={!mine} placeholder={mine ? 'Details, numbers, who to call…' : ''} />
        </div>

        {!mine && (
          <div className="field">
            <label htmlFor="task-status">Status</label>
            <select id="task-status" value={t.status} onChange={(e) => set({ status: e.target.value })}>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        )}

        {mine && (
          <>
            <button type="button" className="link more-toggle" aria-expanded={more} onClick={() => setMore(!more)}>
              More options <Icon name="chevronDown" size={14} className={more ? 'is-flipped' : ''} />
            </button>
            {more && (
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="task-status">Status</label>
                  <select id="task-status" value={t.status} onChange={(e) => set({ status: e.target.value })}>
                    {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="task-cat">Category</label>
                  <select id="task-cat" value={t.category || ''} onChange={(e) => set({ category: e.target.value || null })}>
                    <option value="">None</option>
                    {[...new Set([...CATEGORIES, ...(t.category ? [t.category] : [])])].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="field span-2">
                  <label htmlFor="task-tags">Tags</label>
                  <input id="task-tags" value={t.tags.join(', ')} placeholder="Customer, project, place… separated by commas"
                    onChange={(e) => set({ tags: e.target.value.split(',').map((x) => x.trimStart()) })} />
                </div>
                {people.length > 0 && (
                  <div className="field span-2">
                    <label htmlFor="task-who">Give this task to</label>
                    <select id="task-who" value={t.assignee_id || ''} onChange={(e) => set({ assignee_id: e.target.value || null })}>
                      <option value="">Nobody, it's mine</option>
                      {people.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name || m.username}</option>)}
                    </select>
                    <span className="help">They see only this task, and can update its status and checklist.</span>
                  </div>
                )}
                <label className="check span-2">
                  <input type="checkbox" checked={t.my_day_on === today} onChange={(e) => set({ my_day_on: e.target.checked ? today : null })} />
                  Show in Today
                </label>
              </div>
            )}
          </>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="task-editor-actions">
          {!isNew && mine && <ConfirmButton icon="trash" confirmLabel="Delete task" message="Delete this task?" onConfirm={remove}>Delete</ConfirmButton>}
          <span className="grow" />
          <button type="submit" className="btn btn-primary" disabled={saving}>
            <SaveLabel saving={saving} saved={saved}>{isNew ? 'Add task' : 'Save'}</SaveLabel>
          </button>
        </div>
      </form>
    </Modal>
  );
}
