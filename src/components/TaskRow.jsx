import { useState } from 'react';
import { useApp } from '../context.js';
import { carriedFrom, completion, dueLabel, formatLongDay, isDone, isOverdue, priorityTone, repeatLabel, subtaskProgress } from '../todo.js';
import { Icon } from './ui.jsx';

/** One task: what, when, a delete button (your own tasks) and the done checkbox at the end. */
export default function TaskRow({ task, today, flash, onOpen }) {
  const { api, uid, toast, upsertTask, removeTask } = useApp();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false); // "Delete this task?" showing
  const done = isDone(task);
  const from = carriedFrom(task, today);
  const late = isOverdue(task);
  const steps = subtaskProgress(task);
  // A task carried over from an earlier day says so; its old date isn't repeated.
  const due = from && task.due_on && task.due_on < today ? '' : dueLabel(task, today);
  const mine = task.created_by === uid;

  const toggle = async () => {
    setBusy(true);
    try {
      const patch = done ? { status: 'todo' } : completion(task, today);
      const saved = await api.updateTask(task.id, patch);
      upsertTask(saved);
      if (!done && task.repeat) toast(`Done. Next one: ${dueLabel(saved, today)}.`);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteTask(task.id);
      removeTask(task.id);
      toast('Task deleted.');
    } catch (e) {
      toast(e.message, 'error');
      setBusy(false);
    }
  };

  if (asking) {
    return (
      <li className="task-row task-row-confirm" role="group" aria-label="Delete task">
        <span className="task-confirm-msg">Delete <b>{task.title}</b>?</span>
        <button type="button" className="btn btn-danger btn-sm" autoFocus disabled={busy} onClick={remove}>{busy ? 'Deleting…' : 'Delete'}</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setAsking(false)}>Cancel</button>
      </li>
    );
  }

  return (
    <li className={`task-row ${done ? 'is-done' : ''} ${flash ? 'is-new' : ''} prio-${task.priority.toLowerCase()}`}>
      <button type="button" className="task-main" onClick={() => onOpen(task)}>
        <span className="task-title">{task.title}</span>
        <span className="task-meta small">
          {from && <span className="task-from"><Icon name="history" size={12} /> From {formatLongDay(from, today)}</span>}
          {due && <span className={late ? 'is-late' : ''}><Icon name="clock" size={12} /> {due}</span>}
          {task.repeat && <span title={repeatLabel(task.repeat)}><Icon name="refresh" size={12} /> {repeatLabel(task.repeat)}</span>}
          {steps.total > 0 && <span><Icon name="check" size={12} /> {steps.done}/{steps.total}</span>}
          {task.status === 'in_progress' && <span className="task-status">In progress</span>}
          {task.status === 'waiting' && <span className="task-status">Waiting</span>}
          {(task.priority === 'Urgent' || task.priority === 'High') && <span className={`task-prio pill-${priorityTone(task.priority)}`}>{task.priority}</span>}
          {mine && task.assignee_id && <span><Icon name="user" size={12} /> {task.assignee_name}</span>}
          {!mine && <span><Icon name="user" size={12} /> From {task.assigned_by_name}</span>}
        </span>
      </button>
      {mine && (
        <button type="button" className="task-delete" onClick={() => setAsking(true)} disabled={busy} aria-label={`Delete: ${task.title}`} title="Delete task">
          <Icon name="trash" size={17} />
        </button>
      )}
      <label className="task-check" title={done ? 'Mark as not done' : 'Mark as done'}>
        <input type="checkbox" checked={done} disabled={busy} onChange={toggle} aria-label={`${done ? 'Not done' : 'Done'}: ${task.title}`} />
        <span className="task-check-box" aria-hidden="true"><Icon name="check" size={16} strokeWidth={2.6} /></span>
      </label>
    </li>
  );
}
