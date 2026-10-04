import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context.js';
import { useBack } from '../back.js';
import { toISODate } from '../filters.js';
import { cleanTask, dueLabel, nowHHMM, smartReminders } from '../todo.js';
import {
  ARCHIVED, TRASH, actionText, checklistProgress, cleanNote, cleanTopicName, filterNotes, findTopic, isAudio, isEmptyNote,
  isImage, looksActionable, mergeActions, newItemId, newNoteId, noteDate, noteHeading, notePreview, pendingActions,
  quickNote, safeFileName, sortNotes,
} from '../notes.js';
import { prepareImage } from '../image.js';
import MicButton, { VoiceLangPicker, useVoiceLang } from './MicButton.jsx';
import NoteEditor from './NoteEditor.jsx';
import { ConfirmButton, EmptyState, Icon, Modal, SaveLabel, Spinner, useJustSaved } from './ui.jsx';

/** Shared by the list, the rows and the note sheet: data and what can be done to it. */
export const NotesCtx = createContext(null);
export const useNotes = () => useContext(NotesCtx);

const TOPIC_KEY = 'nomiqo.notesTopic';
const VIEWS = [
  { value: 'notes', label: 'Notes' },
  { value: ARCHIVED, label: 'Archived' },
  { value: TRASH, label: 'Trash' },
];
const clockNow = () => { const n = new Date(); return { today: toISODate(n), time: nowHHMM(n) }; };

/** Quick Notes: one add box (type, speak or take a photo), Topics, search, and the notes. */
export default function Notes() {
  const app = useApp();
  const { api, uid, toast, can, upsertTask } = app;
  const [notes, setNotes] = useState([]);
  const [topics, setTopics] = useState([]);
  const [state, setState] = useState('loading'); // loading | ready | error
  const [error, setError] = useState('');
  const [topicId, setTopicIdRaw] = useState(() => { try { return sessionStorage.getItem(TOPIC_KEY) || ''; } catch { return ''; } });
  const [view, setView] = useState('notes');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null); // a note, or { new: true, ...fields }
  const [editTopic, setEditTopic] = useState(null); // a topic, or { new: true }
  const [flash, setFlash] = useState(null);
  const [selected, setSelected] = useState(null); // Set of ids while choosing notes
  const [urls, setUrls] = useState({}); // storage path -> signed url
  const todoOn = can('todo');

  const setTopicId = (v) => {
    setTopicIdRaw(v);
    setSelected(null);
    try { if (v) sessionStorage.setItem(TOPIC_KEY, v); else sessionStorage.removeItem(TOPIC_KEY); } catch { /* private mode */ }
  };
  const topic = topics.find((t) => t.id === topicId) || null;
  useBack(() => setTopicId(''), !!topic);

  const load = useCallback(async () => {
    try {
      const [n, t] = await Promise.all([api.listNotes(), api.listNoteTopics()]);
      setNotes(n);
      setTopics(t);
      setState('ready');
    } catch (e) {
      setError(e.message);
      setState('error');
    }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const putNote = useCallback((n) => setNotes((list) => (list.some((x) => x.id === n.id) ? list.map((x) => (x.id === n.id ? n : x)) : [n, ...list])), []);
  const dropNote = useCallback((id) => setNotes((list) => list.filter((x) => x.id !== id)), []);
  const putTopic = (t) => setTopics((list) => [...list.filter((x) => x.id !== t.id), t].sort((a, b) => a.name.localeCompare(b.name)));

  // Signed links for the photos and recordings on screen.
  const sign = useCallback(async (paths) => {
    const missing = paths.filter((p) => p && !urls[p]);
    if (!missing.length) return;
    try {
      const got = await api.signUrls('note-files', missing);
      setUrls((u) => ({ ...u, ...got }));
    } catch { /* thumbnails are optional */ }
  }, [api, urls]);

  // "✨ Action detected": looks for things to do when a note's text changed.
  const detect = useCallback(async (note, before = '') => {
    if (!todoOn) return;
    const text = actionText(note);
    if (text === before) return;
    try {
      const found = looksActionable(text) ? await api.noteActions(text, clockNow()) : [];
      const actions = mergeActions(note.actions, found);
      if (JSON.stringify(actions) === JSON.stringify(note.actions || [])) return;
      putNote(await api.updateNote(note.id, { actions }));
    } catch { /* the offer is a nice-to-have */ }
  }, [api, todoOn, putNote]);

  const ops = useMemo(() => ({
    notes, topics, urls, sign, putNote, dropNote, detect, todoOn,
    topicName: (id) => topics.find((t) => t.id === id)?.name || '',
    /** Saves a new note; `id` may be given when files were uploaded for it first. */
    async create(fields, opts = {}) {
      const row = { ...cleanNote(fields), ...(fields.id ? { id: fields.id } : {}) };
      const saved = await api.insertNote(row);
      putNote(saved);
      setFlash(saved.id);
      setTimeout(() => setFlash(null), 2500);
      if (!opts.noDetect) detect(saved);
      return saved;
    },
    async patch(note, patch) {
      const saved = await api.updateNote(note.id, patch);
      putNote(saved);
      return saved;
    },
    async upload(noteId, file) {
      let blob = file;
      let name = safeFileName(file.name, isImage(file) ? 'photo.jpg' : 'file');
      if (isImage(file) && !/gif|svg/.test(file.type)) {
        blob = (await prepareImage(file)).blob;
        name = name.replace(/\.[^.]+$/, '') + '.jpg';
      }
      return api.uploadNoteFile(uid, noteId, blob, name);
    },
    async toTrash(note) {
      const saved = await api.updateNote(note.id, { deleted_at: new Date().toISOString(), pinned: false });
      putNote(saved);
      toast('Moved to Trash.');
    },
    async restore(note) {
      const saved = await api.updateNote(note.id, { deleted_at: null, archived_at: null });
      putNote(saved);
      toast(saved.topic_id ? `Restored to ${topics.find((t) => t.id === saved.topic_id)?.name || 'its topic'}.` : 'Restored.');
    },
    async forever(note) {
      await api.deleteNoteForever(note);
      dropNote(note.id);
    },
    /** Adds an offered action to the To Do List and marks it added on the note. */
    async addToTodo(note, action) {
      const task = cleanTask({
        title: action.title, due_on: action.due_on, due_time: action.due_time,
        reminders: action.due_on ? smartReminders('Normal', !!action.due_time) : [],
        notes: `From Quick Notes: ${noteHeading(note)}`,
      });
      const saved = await api.insertTask(task);
      upsertTask?.(saved);
      const actions = (note.actions || []).map((a) => (a.id === action.id ? { ...a, task_id: saved.id } : a));
      const out = await api.updateNote(note.id, { actions });
      putNote(out);
      const when = dueLabel(saved, toISODate(new Date()));
      toast(`Added to your To Do List${when ? ` for ${when.replace(/^(Today|Tomorrow)/, (w) => w.toLowerCase())}` : ''}.`);
      return out;
    },
    async dismissAction(note, action) {
      const actions = (note.actions || []).map((a) => (a.id === action.id ? { ...a, dismissed: true } : a));
      putNote(await api.updateNote(note.id, { actions }));
    },
    /** Finds a topic by name, or makes it. */
    async topicFor(name) {
      const clean = cleanTopicName(name);
      if (!clean) return null;
      const found = findTopic(topics, clean);
      if (found) return found;
      const t = await api.insertNoteTopic({ name: clean });
      putTopic(t);
      return t;
    },
  }), [notes, topics, urls, sign, putNote, dropNote, detect, todoOn, api, uid, toast, upsertTask]);

  const inView = sortNotes(filterNotes(notes, { view, topic: topic ? topic.id : '', q }, topics));
  const pinned = view === 'notes' ? inView.filter((n) => n.pinned) : [];
  const others = view === 'notes' ? inView.filter((n) => !n.pinned) : inView;
  const liveCount = notes.filter((n) => !n.deleted_at && !n.archived_at && (!topic || n.topic_id === topic.id)).length;
  const trashCount = notes.filter((n) => n.deleted_at).length;

  useEffect(() => {
    sign(inView.flatMap((n) => (n.files || []).filter(isImage).slice(0, 1).map((f) => f.path)));
  }, [inView.map((n) => n.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const selecting = !!selected;
  const toggleSelect = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <NotesCtx.Provider value={ops}>
      <section className="notes-page" aria-labelledby="notes-title">
        <div className="notes-head">
          <h1 id="notes-title" className="h1 notes-title">{topic ? topic.name : 'Quick Notes'}</h1>
          <span className="result-count mono">{state === 'ready' ? `${liveCount} ${liveCount === 1 ? 'note' : 'notes'}` : ''}</span>
          {topic && (
            <button type="button" className="icon-btn notes-head-btn" onClick={() => setEditTopic(topic)} aria-label="Rename, recolour or delete this topic" title="Edit topic">
              <Icon name="edit" size={17} />
            </button>
          )}
        </div>
        {topic && (
          <button type="button" className="link notes-up" onClick={() => setTopicId('')}>
            <Icon name="chevronLeft" size={14} /> All notes and topics
          </button>
        )}

        {view === 'notes' && (
          <NoteAdd topic={topic} onTopic={(t) => setTopicId(t.id)} onOpen={setEditing} />
        )}

        {!topic && view === 'notes' && state === 'ready' && (
          <TopicStrip topics={topics} notes={notes} onOpen={(t) => setTopicId(t.id)} onNew={() => setEditTopic({ new: true })} />
        )}

        <div className="toolbar notes-toolbar">
          <div className="input-icon search">
            <Icon name="search" size={17} />
            <input type="search" placeholder="Search" aria-label="Search notes" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <label className="select-inline">
            <span className="sr-only">Show</span>
            <select value={view} onChange={(e) => { setView(e.target.value); setSelected(null); }} aria-label="Show">
              {VIEWS.map((v) => <option key={v.value} value={v.value}>{v.value === TRASH && trashCount ? `Trash (${trashCount})` : v.label}</option>)}
            </select>
          </label>
          {view !== TRASH && inView.length > 0 && !selecting && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}><Icon name="check" size={15} /> Select</button>
          )}
        </div>

        {selecting && <SelectBar selected={selected} onDone={() => setSelected(null)} />}
        {view === TRASH && <TrashBar notes={inView} />}

        {state === 'loading' && <div className="loading-block"><Spinner /> Loading your notes…</div>}
        {state === 'error' && <p className="notice notice-error" role="alert">{error}</p>}

        {state === 'ready' && (
          <div className="todo-lists">
            {pinned.length > 0 && (
              <NoteGroup label="Pinned" items={pinned} flash={flash} onOpen={setEditing} selected={selected} onToggle={toggleSelect} showTopic={!topic} />
            )}
            {others.length > 0 && (
              <NoteGroup label={pinned.length ? 'Others' : ''} items={others} flash={flash} onOpen={setEditing} selected={selected} onToggle={toggleSelect} showTopic={!topic} />
            )}
            {!inView.length && (
              <EmptyState icon={view === TRASH ? 'trash' : view === ARCHIVED ? 'archive' : q ? 'search' : 'edit'}
                title={q ? 'Nothing matches' : view === TRASH ? 'Trash is empty' : view === ARCHIVED ? 'No archived notes' : topic ? 'No notes in this topic yet' : 'No notes yet'}>
                {q ? 'Try other words.' : view === 'notes' ? 'Type a note above, tap the mic and say it, or take a photo.' : ''}
              </EmptyState>
            )}
          </div>
        )}

        {editing && <NoteEditor note={editing} onClose={() => setEditing(null)} />}
        {editTopic && (
          <TopicEditor topic={editTopic} onClose={() => setEditTopic(null)} onSaved={putTopic}
            onDeleted={(id) => { setTopics((l) => l.filter((t) => t.id !== id)); setNotes((l) => l.map((n) => (n.topic_id === id ? { ...n, topic_id: null } : n))); setTopicId(''); }} />
        )}
      </section>
    </NotesCtx.Provider>
  );
}

// ---------------------------------------------------------------------------
// Add box: type, speak or take a photo
// ---------------------------------------------------------------------------

function NoteAdd({ topic, onTopic, onOpen }) {
  const { toast, can } = useApp();
  const { api } = useApp();
  const ops = useNotes();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [lang, setLang] = useVoiceLang();
  const [review, setReview] = useState(null); // a spoken note waiting for Save
  const box = useRef(null);
  const photo = useRef(null);

  const grow = () => { const el = box.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 200)}px`; } };
  useEffect(grow, [text]);

  const add = async (e) => {
    e?.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setBusy('add');
    try {
      await ops.create({ ...quickNote(value), topic_id: topic?.id || null });
      setText('');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
      box.current?.focus();
    }
  };

  const addPhoto = async (file) => {
    if (!file) return;
    setBusy('photo');
    const id = newNoteId();
    try {
      const f = await ops.upload(id, file);
      await ops.create({ id, title: text.trim() || null, files: [f], topic_id: topic?.id || null }, { noDetect: true });
      setText('');
      toast('Photo note added.');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const heard = async (blob, ext) => {
    setBusy('voice');
    try {
      const { text: said, result } = await api.voiceNote(blob, ext, lang, ops.topics.map((t) => t.name), topic?.name || '', {
        today: toISODate(new Date()), time: nowHHMM(new Date()),
      });
      if (result.action === 'topic') {
        const existing = findTopic(ops.topics, result.topic);
        const t = await ops.topicFor(result.topic);
        onTopic(t);
        toast(existing ? `Opened ${t.name}.` : `Topic "${t.name}" created. You said: "${said}"`);
        return;
      }
      const t = result.topic ? await ops.topicFor(result.topic) : topic;
      if (t && t.id !== topic?.id) onTopic(t);
      const fields = { title: result.title, body: result.body, checklist: (result.checklist || []).map((x) => ({ id: newItemId(), text: x })), tags: result.tags, topic_id: t?.id || null };
      if (isEmptyNote(fields)) { onOpen({ new: true, topic_id: t?.id || null, listen: true }); return; }
      setReview({ ...fields, said, actions: (result.actions || []).map((a) => ({ ...a, id: newItemId(), task_id: null, dismissed: false })), topicName: t?.name || '' });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="quick-add notes-add">
      <form className="quick-add-row" onSubmit={add}>
        <textarea
          ref={box}
          rows={1}
          placeholder={topic ? 'Add a note…' : 'Write a note…'}
          aria-label="Write a note"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) add(e); }}
          maxLength={20000}
        />
        <button type="button" className="btn btn-outline voice-btn" onClick={() => photo.current?.click()} disabled={!!busy} aria-label="Take or add a photo" title="Photo">
          {busy === 'photo' ? <Spinner label="Uploading" /> : <Icon name="camera" size={18} />}
        </button>
        <input ref={photo} type="file" accept="image/*" hidden onChange={(e) => { addPhoto(e.target.files?.[0]); e.target.value = ''; }} />
        <MicButton onRecorded={heard} disabled={!!busy} label={topic ? `Say a note for ${topic.name}` : 'Say a note, or "create a topic called…"'} stopLabel="Stop" />
        <button type="submit" className="btn btn-primary" disabled={!text.trim() || !!busy} aria-label="Add note">
          {busy === 'add' ? <Spinner label="Adding" /> : <Icon name="plus" size={18} strokeWidth={2.2} />}
          <span className="quick-add-label">Add</span>
        </button>
      </form>
      <VoiceLangPicker lang={lang} setLang={setLang} disabled={!!busy} />
      {busy === 'voice' && <p className="quick-add-hint small" role="status"><Spinner /> Writing it up…</p>}
      {review && <VoiceReview review={review} todoOn={can('todo')} onDone={() => setReview(null)} onEdit={(fields) => { setReview(null); onOpen({ new: true, ...fields }); }} />}
    </div>
  );
}

/** A spoken note, cleaned up, waiting for Save note or Add to To-Do. */
function VoiceReview({ review, todoOn, onDone, onEdit }) {
  const { toast } = useApp();
  const ops = useNotes();
  const [busy, setBusy] = useState('');
  const fields = { title: review.title, body: review.body, checklist: review.checklist, tags: review.tags, topic_id: review.topic_id };
  const offers = review.actions || [];

  const save = async (withTodo) => {
    setBusy(withTodo ? 'todo' : 'save');
    try {
      let note = await ops.create({ ...fields, actions: offers }, { noDetect: true });
      if (withTodo) {
        const list = offers.length ? offers : [{ id: newItemId(), title: noteHeading(note), due_on: null, due_time: null }];
        if (!offers.length) note = await ops.patch(note, { actions: list.map((a) => ({ ...a, task_id: null, dismissed: false })) });
        for (const a of note.actions) {
          // eslint-disable-next-line no-await-in-loop
          note = await ops.addToTodo(note, a);
        }
      } else {
        toast(review.topicName ? `Saved in ${review.topicName}.` : 'Note saved.');
      }
      onDone();
    } catch (err) {
      toast(err.message, 'error');
      setBusy('');
    }
  };

  return (
    <div className="voice-review" role="region" aria-label="Your spoken note">
      <p className="voice-review-said small muted"><Icon name="mic" size={13} /> You said: "{review.said}"</p>
      {review.topicName && <p className="small note-topic-tag"><Icon name="folder" size={13} /> {review.topicName}</p>}
      {review.title && <h3 className="voice-review-title">{review.title}</h3>}
      {review.body && <p className="voice-review-body">{review.body}</p>}
      {review.checklist.length > 0 && (
        <ul className="voice-review-list">{review.checklist.map((i) => <li key={i.id}>☐ {i.text}</li>)}</ul>
      )}
      {offers.map((a) => (
        <p key={a.id} className="action-offer-line small"><Icon name="sparkles" size={14} /> <span><b>Action detected:</b> {a.title}{a.due_on ? ` · ${dueLabel(a, toISODate(new Date()))}` : ''}</span></p>
      ))}
      <div className="voice-review-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => save(false)}>
          <SaveLabel saving={busy === 'save'}>Save note</SaveLabel>
        </button>
        {todoOn && (
          <button type="button" className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => save(true)}>
            {busy === 'todo' ? 'Adding…' : <><Icon name="check" size={15} /> Add to To-Do</>}
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => onEdit({ ...fields, actions: offers })}>Edit</button>
        <span className="grow" />
        <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={onDone}>Discard</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

function TopicStrip({ topics, notes, onOpen, onNew }) {
  const count = (id) => notes.filter((n) => n.topic_id === id && !n.deleted_at && !n.archived_at).length;
  return (
    <div className="topic-strip" role="group" aria-label="Topics">
      {topics.map((t) => (
        <button key={t.id} type="button" className={`topic-tile ${t.color ? `note-c-${t.color}` : ''}`} onClick={() => onOpen(t)}>
          <Icon name="folder" size={18} />
          <span className="topic-name">{t.name}</span>
          <span className="topic-count mono small">{count(t.id)}</span>
        </button>
      ))}
      <button type="button" className="topic-tile topic-new" onClick={onNew}>
        <Icon name="plus" size={18} /> <span className="topic-name">New topic</span>
      </button>
    </div>
  );
}

const COLOR_CHOICES = [null, 'yellow', 'green', 'blue', 'pink', 'purple', 'grey'];

export function ColorPick({ value, onChange, label = 'Colour' }) {
  return (
    <div className="color-pick" role="radiogroup" aria-label={label}>
      {COLOR_CHOICES.map((c) => (
        <button key={c || 'none'} type="button" role="radio" aria-checked={(value || null) === c} aria-label={c || 'No colour'}
          className={`color-dot ${c ? `note-c-${c}` : 'is-none'} ${(value || null) === c ? 'is-on' : ''}`} onClick={() => onChange(c)}>
          {(value || null) === c && <Icon name="check" size={14} strokeWidth={2.6} />}
        </button>
      ))}
    </div>
  );
}

/** New topic, or rename / recolour / delete one. Deleting moves its notes to Trash. */
function TopicEditor({ topic, onClose, onSaved, onDeleted }) {
  const { api, toast } = useApp();
  const ops = useNotes();
  const isNew = !!topic.new;
  const [name, setName] = useState(topic.name || '');
  const [color, setColor] = useState(topic.color || null);
  const [saving, setSaving] = useState(false);
  const [saved, markSaved] = useJustSaved();
  const [error, setError] = useState('');
  const inside = isNew ? [] : ops.notes.filter((n) => n.topic_id === topic.id && !n.deleted_at);

  const save = async (e) => {
    e.preventDefault();
    const clean = cleanTopicName(name);
    if (!clean) { setError('Give the topic a name.'); return; }
    setSaving(true);
    setError('');
    try {
      const t = isNew ? await api.insertNoteTopic({ name: clean, color }) : await api.updateNoteTopic(topic.id, { name: clean, color });
      onSaved(t);
      markSaved();
      if (isNew) { toast(`Topic "${t.name}" created.`); onClose(); }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      const at = new Date().toISOString();
      for (const n of inside) {
        // eslint-disable-next-line no-await-in-loop
        ops.putNote(await api.updateNote(n.id, { deleted_at: at, pinned: false }));
      }
      await api.deleteNoteTopic(topic.id);
      onDeleted(topic.id);
      toast(inside.length ? `Topic deleted. Its ${inside.length} ${inside.length === 1 ? 'note is' : 'notes are'} in Trash.` : 'Topic deleted.');
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal title={isNew ? 'New topic' : 'Topic'} onClose={onClose} className="task-editor">
      <button type="button" className="icon-btn modal-x" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
      <form className="form" onSubmit={save}>
        <div className="field">
          <label htmlFor="topic-name">Name</label>
          <input id="topic-name" data-autofocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Inventory Management software" />
        </div>
        <div className="field">
          <span className="label">Colour</span>
          <ColorPick value={color} onChange={setColor} />
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="task-editor-actions">
          {!isNew && (
            <ConfirmButton icon="trash" confirmLabel="Delete topic"
              message={inside.length ? `Delete it? Its ${inside.length} ${inside.length === 1 ? 'note goes' : 'notes go'} to Trash.` : 'Delete this topic?'}
              onConfirm={remove}>Delete</ConfirmButton>
          )}
          <span className="grow" />
          <button type="submit" className="btn btn-primary" disabled={saving}>
            <SaveLabel saving={saving} saved={saved}>{isNew ? 'Create topic' : 'Save'}</SaveLabel>
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

function NoteGroup({ label, items, flash, onOpen, selected, onToggle, showTopic }) {
  return (
    <section className="task-group">
      {label && <h2 className="task-group-h">{label} <span className="chip-count">{items.length}</span></h2>}
      <ul className="task-list">
        {items.map((n) => (
          <NoteRow key={n.id} note={n} flash={flash === n.id} onOpen={onOpen} showTopic={showTopic}
            selecting={!!selected} selected={!!selected?.has(n.id)} onToggle={() => onToggle(n.id)} />
        ))}
      </ul>
    </section>
  );
}

function NoteRow({ note, flash, onOpen, showTopic, selecting, selected, onToggle }) {
  const { toast } = useApp();
  const ops = useNotes();
  const [busy, setBusy] = useState(false);
  const heading = noteHeading(note);
  const preview = notePreview(note);
  const steps = checklistProgress(note);
  const photoFile = (note.files || []).find(isImage);
  const others = (note.files || []).filter((f) => f !== photoFile);
  const topicName = showTopic ? ops.topicName(note.topic_id) : '';
  const inTrash = !!note.deleted_at;
  const color = note.color ? `note-c-${note.color}` : '';

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  if (selecting) {
    return (
      <li className={`task-row note-row is-selecting ${selected ? 'is-selected' : ''} ${color}`}>
        <label className="task-pick">
          <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select: ${heading}`} />
          <span className="task-check-box" aria-hidden="true"><Icon name="check" size={16} strokeWidth={2.6} /></span>
          <span className="task-main"><span className="task-title">{heading}</span></span>
        </label>
      </li>
    );
  }

  return (
    <li className={`task-row note-row ${flash ? 'is-new' : ''} ${color}`}>
      <div className="note-row-top">
        <button type="button" className="task-main note-main" onClick={() => !inTrash && onOpen(note)}>
          <span className="task-title">{note.pinned && <Icon name="pushpin" size={14} className="note-pin-mark" />} {heading}</span>
          {preview && <span className="note-preview">{preview}</span>}
          <span className="task-meta small">
            <span>{noteDate(note.deleted_at || note.updated_at)}</span>
            {topicName && <span className="note-topic-tag"><Icon name="folder" size={12} /> {topicName}</span>}
            {steps.total > 0 && <span><Icon name="list" size={12} /> {steps.done}/{steps.total}</span>}
            {others.some(isAudio) && <span><Icon name="mic" size={12} /> Voice</span>}
            {others.some((f) => !isAudio(f)) && <span><Icon name="clip" size={12} /> {others.filter((f) => !isAudio(f)).length}</span>}
            {(note.tags || []).slice(0, 3).map((t) => <span key={t} className="note-tag">#{t}</span>)}
          </span>
        </button>
        {photoFile && (
          <button type="button" className="note-thumb" onClick={() => !inTrash && onOpen(note)} aria-label="Open note">
            {ops.urls[photoFile.path] ? <img src={ops.urls[photoFile.path]} alt="" /> : <Icon name="image" size={20} />}
          </button>
        )}
        {inTrash ? (
          <div className="note-trash-btns">
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(() => ops.restore(note))}><Icon name="undo" size={15} /> Restore</button>
            <ConfirmButton className="btn btn-danger-ghost btn-sm" confirmLabel="Delete forever" message="" disabled={busy}
              onConfirm={() => run(async () => { await ops.forever(note); toast('Deleted for good.'); })}>Delete</ConfirmButton>
          </div>
        ) : (
          <>
            {!note.archived_at && (
              <button type="button" className={`task-delete note-pin ${note.pinned ? 'is-on' : ''}`} disabled={busy}
                onClick={() => run(() => ops.patch(note, { pinned: !note.pinned }))}
                aria-label={note.pinned ? `Unpin: ${heading}` : `Pin to top: ${heading}`} title={note.pinned ? 'Unpin' : 'Pin to top'}>
                <Icon name="pushpin" size={17} />
              </button>
            )}
            <button type="button" className="task-delete" disabled={busy} onClick={() => run(() => ops.toTrash(note))} aria-label={`Move to Trash: ${heading}`} title="Move to Trash">
              <Icon name="trash" size={17} />
            </button>
          </>
        )}
      </div>
      {!inTrash && ops.todoOn && <ActionOffers note={note} />}
    </li>
  );
}

/** "✨ Action detected  Call James about CCTV quotation · Tomorrow  [Add to To-Do] [x]" */
export function ActionOffers({ note }) {
  const { toast } = useApp();
  const ops = useNotes();
  const [busy, setBusy] = useState('');
  const today = toISODate(new Date());
  const offers = pendingActions(note);
  if (!offers.length) return null;
  const run = async (id, fn) => {
    setBusy(id);
    try { await fn(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };
  return (
    <div className="action-offers">
      {offers.map((a) => (
        <div key={a.id} className="action-offer">
          <span className="action-offer-text">
            <span className="action-offer-h small"><Icon name="sparkles" size={13} /> Action detected</span>
            <b>{a.title}</b>
            {a.due_on && <span className="action-offer-when small"><Icon name="clock" size={12} /> {dueLabel(a, today)}</span>}
          </span>
          <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => run(a.id, () => ops.addToTodo(note, a))}>
            {busy === a.id ? 'Adding…' : 'Add to To-Do'}
          </button>
          <button type="button" className="icon-btn" disabled={!!busy} onClick={() => run(a.id, () => ops.dismissAction(note, a))} aria-label={`Not a to-do: ${a.title}`} title="Not a to-do">
            <Icon name="x" size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

function SelectBar({ selected, onDone }) {
  const { toast } = useApp();
  const ops = useNotes();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const list = ops.notes.filter((n) => selected.has(n.id));
    const at = new Date().toISOString();
    const results = await Promise.allSettled(list.map((n) => ops.patch(n, { deleted_at: at, pinned: false })));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    toast(ok < list.length ? `${ok} moved to Trash; ${list.length - ok} could not be moved.` : `${ok} ${ok === 1 ? 'note' : 'notes'} moved to Trash.`, ok < list.length ? 'error' : 'ok');
    onDone();
  };
  return (
    <div className="select-bar" role="region" aria-label="Choose notes">
      <span className="select-bar-count">{selected.size ? `${selected.size} selected` : 'Tap notes to select them'}</span>
      {selected.size > 0 && (
        <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={go}>
          <Icon name="trash" size={15} /> {busy ? 'Moving…' : `Delete (${selected.size})`}
        </button>
      )}
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onDone}>Cancel</button>
    </div>
  );
}

function TrashBar({ notes }) {
  const { toast } = useApp();
  const ops = useNotes();
  if (!notes.length) return null;
  const empty = async () => {
    const results = await Promise.allSettled(notes.map((n) => ops.forever(n)));
    const failed = results.filter((r) => r.status === 'rejected').length;
    toast(failed ? `${failed} could not be deleted.` : 'Trash emptied.', failed ? 'error' : 'ok');
  };
  return (
    <div className="notes-trash-bar small muted">
      <span>Notes in Trash can be restored until you delete them.</span>
      <ConfirmButton icon="trash" className="btn btn-danger-ghost btn-sm" confirmLabel="Empty trash" message={`Delete ${notes.length} for good?`} onConfirm={empty}>Empty trash</ConfirmButton>
    </div>
  );
}
