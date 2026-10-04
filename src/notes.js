// Quick Notes helpers: cleaning, titles, tags, search, sorting and sharing.
// Pure functions, shared by the Quick Notes screen and the demo build.

export const NOTE_COLORS = ['yellow', 'green', 'blue', 'pink', 'purple', 'grey'];
export const TAG_SUGGESTIONS = ['Work', 'Personal', 'Idea', 'Customer'];
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const TRASH = 'trash';
export const ARCHIVED = 'archived';

export const newItemId = () => Math.random().toString(36).slice(2, 10);
export const newNoteId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)));

// "#Work", "#follow-up" or "#客户" in a note's text; the # needs a space (or the start) before it.
const TAG_RE = /(^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]{0,29})/gu;

/** Tags written as #words in some text, without the #, first spelling kept. */
export function extractTags(text) {
  const out = [];
  for (const m of String(text || '').matchAll(TAG_RE)) {
    if (!out.some((t) => t.toLowerCase() === m[2].toLowerCase())) out.push(m[2]);
  }
  return out;
}

/** Tags from a comma list or #words, trimmed, # dropped, no repeats (ignoring case), at most 20. */
export function cleanTags(tags) {
  const out = [];
  for (const raw of tags || []) {
    const t = String(raw || '').trim().replace(/^#+/, '').slice(0, 30);
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.slice(0, 20);
}

/** The fields saved for a note, tidied. Checklist items with no text are dropped. */
export function cleanNote(n) {
  return {
    topic_id: n.topic_id || null,
    title: String(n.title || '').trim().slice(0, 200) || null,
    body: String(n.body || '').replace(/\s+$/, '').slice(0, 20000),
    checklist: (n.checklist || [])
      .map((i) => ({ id: i.id || newItemId(), text: String(i.text || '').trim(), done: !!i.done }))
      .filter((i) => i.text),
    tags: cleanTags(n.tags),
    color: NOTE_COLORS.includes(n.color) ? n.color : null,
    files: n.files || [],
    actions: n.actions || [],
    pinned: !!n.pinned,
  };
}

/** True when a note has nothing in it worth keeping. */
export const isEmptyNote = (n) => !String(n.title || '').trim() && !String(n.body || '').trim()
  && !(n.checklist || []).some((i) => String(i.text || '').trim()) && !(n.files || []).length;

/**
 * A typed note from the add box: the first line becomes the title when there are more lines,
 * and #words become tags.
 */
export function quickNote(text) {
  const value = String(text || '').trim();
  const lines = value.split('\n');
  const multi = lines.length > 1 && lines[0].trim().length <= 80;
  return {
    title: multi ? lines[0].trim() : null,
    body: multi ? lines.slice(1).join('\n').trim() : value,
    tags: extractTags(value),
  };
}

/** What a note is called in lists: its title, else its first line, else its first checklist item or file. */
export function noteHeading(n) {
  if (n.title && n.title.trim()) return n.title.trim();
  const line = String(n.body || '').split('\n').find((l) => l.trim());
  if (line) return line.trim().slice(0, 120);
  const item = (n.checklist || []).find((i) => i.text);
  if (item) return item.text;
  const file = (n.files || [])[0];
  if (file) return isImage(file) ? 'Photo' : isAudio(file) ? 'Voice note' : file.name;
  return 'Empty note';
}

/** The text under the heading in lists (the body without the line used as the heading). */
export function notePreview(n) {
  const body = String(n.body || '').trim();
  if (n.title && n.title.trim()) return body;
  const lines = body.split('\n');
  const first = lines.findIndex((l) => l.trim());
  return first === -1 ? '' : lines.slice(first + 1).join('\n').trim();
}

export const checklistProgress = (n) => {
  const items = n.checklist || [];
  return { done: items.filter((i) => i.done).length, total: items.length };
};

export const isImage = (f) => /^image\//.test(f?.type || '');
export const isAudio = (f) => /^audio\//.test(f?.type || '');

/** Which list a note belongs in: 'notes', 'archived' or 'trash'. */
export const noteView = (n) => (n.deleted_at ? TRASH : n.archived_at ? ARCHIVED : 'notes');

/**
 * Notes to show. view: 'notes' | 'archived' | 'trash'; topic: a topic id, 'none' for
 * notes in no topic, or '' for all; tag: '' or a tag; q: words to find anywhere in the
 * note, its tags, its files' names or its topic's name.
 */
export function filterNotes(notes, { view = 'notes', topic = '', tag = '', q = '' } = {}, topics = []) {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  const topicName = Object.fromEntries(topics.map((t) => [t.id, t.name]));
  return notes.filter((n) => {
    if (noteView(n) !== view) return false;
    if (topic === 'none' ? n.topic_id : topic && n.topic_id !== topic) return false;
    if (tag && !(n.tags || []).some((t) => t.toLowerCase() === tag.toLowerCase())) return false;
    if (!words.length) return true;
    const hay = [n.title, n.body, ...(n.tags || []), ...(n.checklist || []).map((i) => i.text),
      ...(n.files || []).map((f) => f.name), topicName[n.topic_id]].join('\n').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Pinned first, then the most recently changed. In Trash: most recently deleted first. */
export function sortNotes(notes) {
  return [...notes].sort((a, b) => {
    if (a.deleted_at || b.deleted_at) return String(b.deleted_at || '').localeCompare(String(a.deleted_at || ''));
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
  });
}

/** Tags in use on the given notes, most used first. */
export function tagsInUse(notes) {
  const count = new Map();
  for (const n of notes) {
    for (const t of n.tags || []) {
      const key = [...count.keys()].find((k) => k.toLowerCase() === t.toLowerCase()) || t;
      count.set(key, (count.get(key) || 0) + 1);
    }
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

/** Finds a topic by name, ignoring case, spaces and quotes. */
export function findTopic(topics, name) {
  const key = (s) => String(s || '').toLowerCase().replace(/["'“”‘’「」]/g, '').replace(/\s+/g, ' ').trim();
  const k = key(name);
  return k ? topics.find((t) => key(t.name) === k) || null : null;
}

/** A topic name as it will be saved: quotes and spaces at the ends removed, at most 80 characters. */
export const cleanTopicName = (name) => String(name || '').replace(/^["'“”‘’「」\s]+|["'“”‘’「」\s.。]+$/g, '').replace(/\s+/g, ' ').slice(0, 80);

/** Plain text for sending a note out of the app (WhatsApp, email…). */
export function shareText(n, topicName = '') {
  const parts = [];
  const head = [topicName, n.title && n.title.trim()].filter(Boolean).join(' · ');
  if (head) parts.push(head);
  if (String(n.body || '').trim()) parts.push(n.body.trim());
  if ((n.checklist || []).length) parts.push(n.checklist.map((i) => `${i.done ? '☑' : '☐'} ${i.text}`).join('\n'));
  if ((n.tags || []).length) parts.push(n.tags.map((t) => `#${t}`).join(' '));
  return parts.join('\n\n');
}

/** A file name safe for a storage path, keeping its extension. */
export function safeFileName(name, fallback = 'file') {
  const clean = String(name || '').normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  const named = clean.replace(/^\.+/, '') && !/^-*\.[^.]*$/.test(clean) ? clean : `${fallback}${/\.\w+$/.exec(clean)?.[0] || ''}`;
  return named.slice(-80);
}

/** "12 KB", "3.4 MB" */
export function fileSize(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/** "Today 14:05", "Yesterday", "3 Oct", "3 Oct 2025" */
export function noteDate(iso, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 864e5);
  if (diff === 0) return `Today ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
}

// Words that suggest a note holds something to do; only then is it read for "Add to To-Do".
const ACTION_HINT = new RegExp([
  String.raw`\b(need|needs|have|has|must|should|got)\s+to\b`, String.raw`\b(remember|remind|don'?t forget|todo|to-do|follow[\s-]?up|deadline|asap)\b`,
  String.raw`\b(call|email|e-mail|send|buy|pay|book|meet|check|ask|reply|order|submit|prepare|finish|visit|collect|renew|confirm|schedule|whatsapp|text)\b`,
  String.raw`\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|by \w+)\b`,
  '要|需要|记得|别忘|提醒|明天|后天|今天|下周|打电话|发给|买|付|预订|安排|跟进',
  String.raw`\b(kailangan|dapat|bukas|mamaya|tawagan|paalala|bilhin|bayaran|ipadala)\b`,
].join('|'), 'i');

export const looksActionable = (text) => ACTION_HINT.test(String(text || ''));

/** The text "Add to To-Do" reads: title, body and unticked checklist items. */
export const actionText = (n) => [n.title, n.body, ...(n.checklist || []).filter((i) => !i.done).map((i) => i.text)]
  .filter((x) => String(x || '').trim()).join('\n');

/**
 * New offers merged with the old: ones already added or dismissed stay as they were;
 * waiting ones are replaced by what was found now. Each offer gets an id.
 */
export function mergeActions(old = [], found = []) {
  const kept = old.filter((a) => a.task_id || a.dismissed);
  const key = (a) => String(a.title || '').trim().toLowerCase();
  const fresh = found
    .filter((a) => a.title && !kept.some((k) => key(k) === key(a)))
    .map((a) => ({ id: newItemId(), title: a.title, due_on: a.due_on || null, due_time: a.due_time || null, task_id: null, dismissed: false }));
  return [...kept, ...fresh];
}

export const pendingActions = (n) => (n.actions || []).filter((a) => !a.task_id && !a.dismissed);
