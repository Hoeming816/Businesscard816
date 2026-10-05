// Meeting minutes made by AI from a saved recording: how they are stored as a
// Note, and the plain text that goes out through the phone's share sheet.

import { load, save } from './storage.js';
import { audioParts } from './recordingParts.js';
export { PART_SEC, audioParts, joinAudioParts } from './recordingParts.js';

export const MINUTES_PREFIX = 'Minutes: ';

// The language minutes and transcripts are written in, whatever was spoken.
// Kept per device; English unless another is picked.
export const MINUTES_LANGUAGES = [
  { value: 'English', label: 'English', short: 'English' },
  { value: 'Chinese', label: 'Chinese (中文)', short: '中文' },
  { value: 'Tagalog', label: 'Tagalog', short: 'Tagalog' },
];
const LANG_KEY = 'nomiqo.minutesLanguage';
export const minutesLanguage = () => {
  const v = load(LANG_KEY, 'English');
  return MINUTES_LANGUAGES.some((l) => l.value === v) ? v : 'English';
};
export const setMinutesLanguage = (v) => save(LANG_KEY, v);
export const languageShort = (v) => (MINUTES_LANGUAGES.find((l) => l.value === v) || MINUTES_LANGUAGES[0]).short;

export const isMinutes = (i) => i?.kind === 'Note' && String(i.title || '').startsWith(MINUTES_PREFIX);

/** Has AI minutes: an older minutes Note, or a typed meeting with its minutes on it. */
export const hasMinutes = (i) => isMinutes(i) || !!i?.minutes;

/** The Note row for minutes made from recording entry `source`. */
export function minutesRow(source, ai, transcript) {
  const label = source.title && source.title !== 'Recorded conversation' ? source.title : source.kind;
  const points = (ai.key_points || []).map((p) => `• ${p}`).join('\n');
  return {
    kind: 'Note',
    occurred_on: source.occurred_on,
    title: `${MINUTES_PREFIX}${label}`,
    notes: points ? `Key points\n${points}` : null,
    summary: ai.summary || null,
    action_items: ai.action_items || [],
    transcript: transcript || null,
  };
}

/** Plain text for sharing an entry (minutes or any summarised entry). */
export function shareText(i, contact, formatDate) {
  if (i.minutes) return minutesText(i, contact, formatDate);
  const who = [contact?.full_name, contact?.company].filter(Boolean).join(', ');
  const lines = [i.title || i.kind, [formatDate(i.occurred_on), who].filter(Boolean).join(' · '), ''];
  if (i.summary) lines.push('Summary', i.summary, '');
  if (i.notes) lines.push(i.notes, '');
  if (i.action_items?.length) lines.push('Action items', ...i.action_items.map((a) => `• ${a}`), '');
  return lines.join('\n').trim();
}

/** Opens the share sheet (WhatsApp, email…) or copies when there is none. Returns 'shared' | 'copied' | 'cancelled'. */
export async function shareOrCopy(title, text, nav = globalThis.navigator) {
  if (nav?.share) {
    try {
      await nav.share({ title, text });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';
      // fall through to copying, e.g. share not allowed here
    }
  }
  if (!nav?.clipboard?.writeText) throw new Error('Sharing is not available on this device.');
  await nav.clipboard.writeText(text);
  return 'copied';
}

/** When a recording was made: from its (last part's) file name (…-<ms>.ext), else when the entry was created. */
export function recordedAt(i) {
  const parts = audioParts(i);
  const m = /-(\d{13})\.\w+$/.exec(parts[parts.length - 1] || '');
  const d = m ? new Date(Number(m[1])) : new Date(i.created_at);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Typed meetings: AI minutes stored on the meeting itself (interactions.minutes)
// ---------------------------------------------------------------------------

const strings = (a) => (Array.isArray(a) ? a.map((x) => String(x ?? '').trim()).filter(Boolean) : []);
const text = (v) => String(v ?? '').trim();

/** The minutes as stored: everything the AI returned, each action item starting Open. */
export function normaliseMinutes(ai = {}) {
  return {
    language: MINUTES_LANGUAGES.some((l) => l.value === ai.language) ? ai.language : 'English',
    quick_summary: strings(ai.quick_summary),
    chairperson: text(ai.chairperson),
    attendees: strings(ai.attendees),
    location: text(ai.location),
    agenda: strings(ai.agenda),
    discussion: (Array.isArray(ai.discussion) ? ai.discussion : [])
      .map((d) => ({ topic: text(d?.topic), points: strings(d?.points) }))
      .filter((d) => d.topic || d.points.length),
    decisions: strings(ai.decisions),
    action_items: (Array.isArray(ai.action_items) ? ai.action_items : [])
      .map((a) => ({
        action: text(a?.action),
        assigned_to: text(a?.assigned_to),
        due: /^\d{4}-\d{2}-\d{2}$/.test(text(a?.due)) ? text(a.due) : '',
        priority: ['High', 'Medium', 'Low'].includes(a?.priority) ? a.priority : 'Medium',
        status: a?.status === 'Done' ? 'Done' : 'Open',
      }))
      .filter((a) => a.action),
    issues: strings(ai.issues),
    next_steps: strings(ai.next_steps),
    next_meeting: text(ai.next_meeting),
    follow_up: (Array.isArray(ai.follow_up) ? ai.follow_up : [])
      .map((f) => ({
        ref: text(f?.ref),
        action: text(f?.action),
        assigned_to: text(f?.assigned_to),
        due: text(f?.due),
        meeting: text(f?.meeting),
        date: text(f?.date),
        state: ['Completed', 'Overdue', 'Pending'].includes(f?.state) ? f.state : 'Pending',
        note: text(f?.note),
      }))
      .filter((f) => f.action),
  };
}

/** "Decision 01", "Decision 02"… */
export const decisionLabel = (k) => `Decision ${String(k + 1).padStart(2, '0')}`;

/** One action item as a line of text. */
export function actionLine(a, formatDate = (d) => d) {
  return [
    a.action,
    a.assigned_to && `Assigned to: ${a.assigned_to}`,
    a.due && `Due: ${formatDate(a.due)}`,
    a.priority && `Priority: ${a.priority}`,
    `Status: ${a.status || 'Open'}`,
  ].filter(Boolean).join(' · ');
}

/**
 * The columns kept in step with the minutes, so search, the contact's history
 * and older screens show them: summary (the quick summary) and action_items.
 */
export function minutesColumns(minutes) {
  return {
    minutes,
    summary: minutes.quick_summary.map((b) => `• ${b}`).join('\n') || null,
    action_items: minutes.action_items.map((a) => actionLine(a)),
  };
}

const pad = (n) => String(n).padStart(2, '0');
export const clock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Start and end of the recording as Date objects, or null when unknown. */
export function meetingTimes(i) {
  const end = i.audio_path ? recordedAt(i) : null;
  if (!end || i.duration_sec == null) return null;
  return { start: new Date(end.getTime() - i.duration_sec * 1000), end };
}

/** "10:04" for a transcript line `sec` seconds into the meeting (or "4:05" into the recording). */
export function lineTime(i, sec) {
  const t = meetingTimes(i);
  if (t) return clock(new Date(t.start.getTime() + sec * 1000));
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

/** The formal minutes as plain text, for sharing by email, WhatsApp or copy. */
export function minutesText(i, contact, formatDate = (d) => d) {
  const m = i.minutes || normaliseMinutes();
  const t = meetingTimes(i);
  const out = ['MEETING MINUTES', ''];
  const row = (label, v) => { if (v) out.push(`${label}: ${v}`); };
  row('Meeting', i.title || i.meeting_type || 'Meeting');
  row('Type', i.meeting_type);
  row('Date', formatDate(i.occurred_on));
  row('Time', t && `${clock(t.start)}–${clock(t.end)}`);
  row('Location', m.location);
  row('Chairperson', m.chairperson);
  row('Attendees', m.attendees.join(', '));
  row('Contact', [contact?.full_name, contact?.company].filter(Boolean).join(', '));
  const section = (title, lines) => { if (lines.length) out.push('', title, ...lines); };
  section('QUICK SUMMARY', m.quick_summary.map((b) => `• ${b}`));
  section('AGENDA', m.agenda.map((a, k) => `${k + 1}. ${a}`));
  section('DISCUSSION', m.discussion.flatMap((d, k) => [`${k + 1}. ${d.topic}`, ...d.points.map((p) => `   • ${p}`)]));
  section('DECISIONS MADE', m.decisions.map((d, k) => `${decisionLabel(k)}: ${d}`));
  section('ACTION ITEMS', m.action_items.map((a, k) => `${k + 1}. ${actionLine(a, formatDate)}`));
  section('OUTSTANDING FROM PREVIOUS MEETINGS', m.follow_up.map((f) => `${f.state === 'Completed' ? '✓' : '⚠'} ${[f.action, f.assigned_to, f.state].filter(Boolean).join(' — ')}${f.note ? ` (${f.note})` : ''}`));
  section('ISSUES / RISKS', m.issues.map((x) => `• ${x}`));
  section('NEXT STEPS', m.next_steps.map((x) => `• ${x}`));
  if (m.next_meeting) out.push('', 'NEXT MEETING', /^\d{4}-\d{2}-\d{2}$/.test(m.next_meeting) ? formatDate(m.next_meeting) : m.next_meeting);
  return out.join('\n').trim();
}

/** 'done' | 'overdue' | 'soon' (due within 3 days) | '' for an action item, as of `today` (YYYY-MM-DD). */
export function dueState(a, today) {
  if (a.status === 'Done') return 'done';
  if (!a.due) return '';
  if (a.due < today) return 'overdue';
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 3);
  return a.due <= soon.toISOString().slice(0, 10) ? 'soon' : '';
}

// ---------------------------------------------------------------------------
// Follow-up tracking across meetings
// ---------------------------------------------------------------------------

/** Every action item from meetings with minutes, newest meeting first, with its due state. */
export function allActions(items, today) {
  return (items || [])
    .filter((i) => i.minutes?.action_items?.length)
    .flatMap((i) => normaliseMinutes(i.minutes).action_items.map((a, index) => ({ ...a, index, meeting: i, state: dueState(a, today) })));
}

/** Open action items from meetings held before `i`, newest first: what the AI checks off at `i`. */
export function earlierActions(items, i, max = 40) {
  const before = (x) => x.id !== i.id && (x.occurred_on < i.occurred_on || (x.occurred_on === i.occurred_on && String(x.created_at) < String(i.created_at)));
  return allActions((items || []).filter(before), i.occurred_on)
    .filter((a) => a.status !== 'Done')
    .sort((a, b) => b.meeting.occurred_on.localeCompare(a.meeting.occurred_on))
    .slice(0, max)
    .map((a) => ({
      ref: `${a.meeting.id}:${a.index}`,
      action: a.action,
      assigned_to: a.assigned_to,
      due: a.due,
      meeting: a.meeting.title || a.meeting.meeting_type || 'Meeting',
      date: a.meeting.occurred_on,
      meeting_type: a.meeting.meeting_type,
    }));
}

/**
 * "Outstanding from previous meetings" for meeting `i`: earlier open items the
 * meeting talked about, plus those from earlier meetings of the same type,
 * each Completed, Overdue (past due on the meeting date) or Pending.
 */
export function outstanding(i, earlier, followUp = []) {
  const said = new Map(followUp.map((f) => [f.ref, f]));
  return earlier
    .filter((a) => said.has(a.ref) || a.meeting_type === i.meeting_type)
    .map((a) => {
      const f = said.get(a.ref);
      const state = f?.status === 'completed' ? 'Completed' : a.due && a.due < i.occurred_on ? 'Overdue' : 'Pending';
      const { meeting_type: _t, ...rest } = a;
      return { ...rest, state, note: f?.note || '' };
    });
}

/** The formal minutes as Word document blocks (see docx.js), in the same order as minutesText. */
export function minutesDoc(i, contact, formatDate = (d) => d) {
  const m = i.minutes || normaliseMinutes();
  const t = meetingTimes(i);
  const out = [{ t: 'title', text: 'Meeting Minutes' }];
  const field = (label, value) => { if (value) out.push({ t: 'field', label, value }); };
  field('Meeting', i.title || i.meeting_type || 'Meeting');
  field('Type', i.meeting_type);
  field('Date', formatDate(i.occurred_on));
  field('Time', t && `${clock(t.start)}–${clock(t.end)}`);
  field('Location', m.location);
  field('Chairperson', m.chairperson);
  field('Attendees', m.attendees.join(', '));
  field('Contact', [contact?.full_name, contact?.company].filter(Boolean).join(', '));
  const section = (title, blocks) => { if (blocks.length) out.push({ t: 'h', text: title }, ...blocks); };
  const bullets = (xs) => xs.map((text) => ({ t: 'bullet', text }));
  section('Quick Summary', bullets(m.quick_summary));
  section('Agenda', m.agenda.map((a, k) => ({ t: 'p', text: `${k + 1}. ${a}` })));
  section('Discussion', m.discussion.flatMap((d, k) => [{ t: 'p', text: `${k + 1}. ${d.topic}`, bold: true }, ...bullets(d.points)]));
  section('Decisions Made', m.decisions.map((d, k) => ({ t: 'field', label: decisionLabel(k), value: d })));
  if (m.action_items.length) {
    section('Action Items', [{
      t: 'table',
      head: ['Action', 'Assigned to', 'Due', 'Priority', 'Status'],
      rows: m.action_items.map((a) => [a.action, a.assigned_to || '', a.due ? formatDate(a.due) : '', a.priority || '', a.status || 'Open']),
    }]);
  }
  section('Outstanding from Previous Meetings', m.follow_up.map((f) => ({
    t: 'bullet',
    text: `${[f.action, f.assigned_to, f.state].filter(Boolean).join(' — ')}${f.note ? ` (${f.note})` : ''}`,
  })));
  section('Issues / Risks', bullets(m.issues));
  section('Next Steps', bullets(m.next_steps));
  if (m.next_meeting) section('Next Meeting', [{ t: 'p', text: /^\d{4}-\d{2}-\d{2}$/.test(m.next_meeting) ? formatDate(m.next_meeting) : m.next_meeting }]);
  return out;
}

/** "Minutes - Weekly sync - 4 Oct 2026.docx", safe as a file name. */
export function minutesFileName(i, formatDate = (d) => d) {
  const name = ['Minutes', i.title || i.meeting_type || 'Meeting', formatDate(i.occurred_on)].filter(Boolean).join(' - ');
  return `${name.replace(/[\\/:*?"<>|\u0000-\u001F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)}.docx`;
}

/**
 * Meeting list filter by date: `mode` is 'any', 'month' (value "2026-10")
 * or 'day' (value "2026-10-04"). An empty value matches everything.
 */
export function onDate(occurredOn, mode, value) {
  if (mode === 'any' || !value) return true;
  const d = String(occurredOn || '');
  return mode === 'month' ? d.slice(0, 7) === value : d.slice(0, 10) === value;
}
