import { useMemo, useState } from 'react';
import { useApp } from '../context.js';
import { addDays, addMonths, startOfMonth, startOfWeek, toISODate } from '../filters.js';
import { compareTasks, formatLongDay, formatTime, isDone, isOverdue, occurrences } from '../todo.js';
import TaskRow from './TaskRow.jsx';
import { Icon } from './ui.jsx';

const MODES = [{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }];
const HEAD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Tasks by date (repeating tasks on every date they repeat), as a day, week or month. */
export default function TaskCalendar({ onOpen, onAdd }) {
  const { tasks } = useApp();
  const today = toISODate(new Date());
  const [mode, setMode] = useState('month');
  const [day, setDay] = useState(today);

  const range = useMemo(() => {
    if (mode === 'day') return [day, day];
    if (mode === 'week') { const s = startOfWeek(day); return [s, addDays(s, 6)]; }
    const s = startOfWeek(startOfMonth(day));
    const end = addDays(addMonths(startOfMonth(day), 1), -1);
    return [s, addDays(startOfWeek(end), 6)];
  }, [mode, day]);

  // date -> tasks on that date
  const byDate = useMemo(() => {
    const m = new Map();
    for (const t of tasks) {
      for (const d of occurrences(t, range[0], range[1])) {
        if (!m.has(d)) m.set(d, []);
        m.get(d).push(t);
      }
    }
    for (const list of m.values()) list.sort(compareTasks);
    return m;
  }, [tasks, range]);

  const step = (dir) => setDay(mode === 'day' ? addDays(day, dir) : mode === 'week' ? addDays(day, 7 * dir) : addMonths(startOfMonth(day), dir));
  const title = mode === 'month'
    ? `${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`
    : mode === 'week' ? `${formatLongDay(range[0], today)} to ${formatLongDay(range[1], today)}` : formatLongDay(day, today);

  const days = [];
  for (let d = range[0]; d <= range[1]; d = addDays(d, 1)) days.push(d);

  return (
    <div className="task-cal">
      <div className="task-cal-bar">
        <div className="task-cal-nav">
          <button type="button" className="icon-btn" onClick={() => step(-1)} aria-label="Earlier"><Icon name="chevronLeft" size={18} /></button>
          <h2 className="task-cal-title" aria-live="polite">{title}</h2>
          <button type="button" className="icon-btn" onClick={() => step(1)} aria-label="Later"><Icon name="chevronRight" size={18} /></button>
          {day !== today && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDay(today)}>Today</button>}
        </div>
        <div className="segbar" role="group" aria-label="Calendar view">
          {MODES.map((m) => (
            <button key={m.value} type="button" className={`segbar-item ${mode === m.value ? 'is-on' : ''}`} aria-pressed={mode === m.value} onClick={() => setMode(m.value)}>{m.label}</button>
          ))}
        </div>
      </div>

      {mode === 'month' && (
        <div className="cal-month" role="grid" aria-label={title}>
          {HEAD.map((h) => <div key={h} className="cal-head" role="columnheader">{h}</div>)}
          {days.map((d) => {
            const list = byDate.get(d) || [];
            const outside = d.slice(5, 7) !== day.slice(5, 7);
            return (
              <button key={d} type="button" role="gridcell"
                className={`cal-cell ${outside ? 'is-outside' : ''} ${d === today ? 'is-today' : ''}`}
                onClick={() => { setDay(d); setMode('day'); }}
                aria-label={`${formatLongDay(d, today)}, ${list.length} ${list.length === 1 ? 'task' : 'tasks'}`}>
                <span className="cal-num">{Number(d.slice(8))}</span>
                <span className="cal-items">
                  {list.slice(0, 3).map((t) => (
                    <span key={t.id} className={`cal-item ${isDone(t) ? 'is-done' : ''} ${d === t.due_on && isOverdue(t) ? 'is-late' : ''} prio-${t.priority.toLowerCase()}`}>{t.title}</span>
                  ))}
                  {list.length > 3 && <span className="cal-more">+{list.length - 3} more</span>}
                </span>
                {list.length > 0 && <span className="cal-dot" aria-hidden="true">{list.length}</span>}
              </button>
            );
          })}
        </div>
      )}

      {mode === 'week' && (
        <div className="cal-week">
          {days.map((d) => {
            const list = byDate.get(d) || [];
            return (
              <section key={d} className={`cal-week-day ${d === today ? 'is-today' : ''}`}>
                <button type="button" className="cal-week-h" onClick={() => { setDay(d); setMode('day'); }}>{formatLongDay(d, today)}</button>
                {list.length ? (
                  <ul className="cal-week-list">
                    {list.map((t) => (
                      <li key={t.id}>
                        <button type="button" className={`cal-item ${isDone(t) ? 'is-done' : ''} prio-${t.priority.toLowerCase()}`} onClick={() => onOpen(t)}>
                          {t.due_time && <span className="mono">{formatTime(t.due_time)}</span>} {t.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : <span className="muted small">Nothing</span>}
              </section>
            );
          })}
        </div>
      )}

      {mode === 'day' && (
        <div className="todo-lists">
          {(byDate.get(day) || []).length ? (
            <ul className="task-list">
              {(byDate.get(day) || []).map((t) => <TaskRow key={t.id} task={t} today={today} onOpen={onOpen} />)}
            </ul>
          ) : <p className="muted center cal-empty">Nothing on this day.</p>}
          <button type="button" className="btn btn-outline" onClick={() => onAdd(day)}><Icon name="plus" size={16} /> Add a task on {formatLongDay(day, today)}</button>
        </div>
      )}
    </div>
  );
}
