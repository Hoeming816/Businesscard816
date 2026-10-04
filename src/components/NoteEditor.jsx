import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context.js';
import {
  MAX_FILE_BYTES, TAG_SUGGESTIONS, actionText, cleanNote, cleanTags, extractTags, fileSize, isAudio, isEmptyNote, isImage,
  newItemId, newNoteId, noteHeading, shareText,
} from '../notes.js';
import MicButton, { useVoiceLang } from './MicButton.jsx';
import { ActionOffers, ColorPick, useNotes } from './Notes.jsx';
import { ConfirmButton, Icon, Modal, SaveLabel, Spinner, useJustSaved } from './ui.jsx';

const FILE_TYPES = 'image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.odt,.ods,.zip';

/**
 * Add or edit one note. The text, title and a row of tools (dictate, clean up, checklist,
 * photo, file) are always shown; topic, tags and colour sit under More options.
 */
export default function NoteEditor({ note, onClose }) {
  const { api, toast } = useApp();
  const ops = useNotes();
  const isNew = !!note.new;
  const [id] = useState(() => note.id || newNoteId());
  const [n, setN] = useState(() => ({
    topic_id: note.topic_id || null, title: note.title || '', body: note.body || '', checklist: note.checklist || [],
    tags: note.tags || [], color: note.color || null, files: note.files || [], pinned: !!note.pinned, actions: note.actions || [],
  }));
  const [tagText, setTagText] = useState(() => (note.tags || []).join(', '));
  const [saving, setSaving] = useState(false);
  const [saved, markSaved] = useJustSaved();
  const [busy, setBusy] = useState(''); // 'dictate' | 'cleanup' | 'upload'
  const [undo, setUndo] = useState(null); // title and text before ✨ Clean up
  const [error, setError] = useState('');
  const [more, setMore] = useState(() => !!(note.tags?.length || note.color));
  const [current, setCurrent] = useState(isNew ? null : note); // the saved note
  const [lang] = useVoiceLang();
  const uploaded = useRef([]); // paths uploaded while this sheet is open
  const photo = useRef(null);
  const file = useRef(null);
  const set = (patch) => setN((x) => ({ ...x, ...patch }));
  const live = current && ops.notes.find((x) => x.id === current.id);

  useEffect(() => { ops.sign(n.files.map((f) => f.path)); }, [n.files.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    // Files added but never saved are removed again.
    const keep = new Set((live?.files || []).map((f) => f.path));
    const orphans = uploaded.current.filter((p) => !keep.has(p));
    if (orphans.length) api.removeStorageObjects('note-files', orphans).catch(() => {});
    onClose();
  };

  const row = () => {
    const tags = cleanTags([...tagText.split(','), ...extractTags(`${n.title}\n${n.body}`)]);
    return cleanNote({ ...n, tags });
  };

  const save = async (e) => {
    e?.preventDefault();
    setError('');
    const r = row();
    if (isEmptyNote(r)) { setError('Write something first.'); return; }
    setSaving(true);
    try {
      const before = current ? actionText(current) : '';
      let out;
      if (current) {
        out = await ops.patch(current, r);
        const gone = (current.files || []).map((f) => f.path).filter((p) => !r.files.some((f) => f.path === p));
        if (gone.length) api.removeStorageObjects('note-files', gone).catch(() => {});
      } else {
        out = await ops.create({ ...r, id }, { noDetect: true });
      }
      setCurrent(out);
      setTagText(out.tags.join(', '));
      setUndo(null);
      markSaved();
      ops.detect(out, before);
      if (isNew) { toast('Note saved.'); onClose(); }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const dictate = async (blob, ext) => {
    setBusy('dictate');
    try {
      const text = await api.dictateNote(blob, ext, lang);
      set({ body: n.body.trim() ? `${n.body.replace(/\s+$/, '')}\n${text}` : text });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const cleanUp = async () => {
    if (!n.title.trim() && !n.body.trim()) { setError('Write something first.'); return; }
    setBusy('cleanup');
    setError('');
    try {
      const out = await api.cleanUpNote(n.title, n.body);
      setUndo({ title: n.title, body: n.body });
      set({ title: out.title || n.title, body: out.body });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const addFiles = async (list) => {
    const files = [...(list || [])];
    if (!files.length) return;
    const big = files.find((f) => f.size > MAX_FILE_BYTES);
    if (big) { toast(`${big.name} is over 20 MB.`, 'error'); return; }
    setBusy('upload');
    try {
      for (const f of files) {
        // eslint-disable-next-line no-await-in-loop
        const entry = await ops.upload(id, f);
        uploaded.current.push(entry.path);
        setN((x) => ({ ...x, files: [...x.files, entry] }));
      }
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const items = n.checklist;
  const setItem = (i, patch) => set({ checklist: items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const addItem = () => set({ checklist: [...items, { id: newItemId(), text: '', done: false }] });
  useEffect(() => {
    // Focus a checklist item just added.
    const last = document.querySelector('.note-check-item:last-child input[type=text]');
    if (last && !last.value) last.focus();
  }, [items.length]);

  const topicName = ops.topicName(n.topic_id);
  const text = shareText({ ...n, tags: cleanTags(tagText.split(',')) }, topicName);
  const share = async (how) => {
    const heading = noteHeading(n);
    if (how === 'native') {
      try { await navigator.share({ title: heading, text }); } catch { /* cancelled */ }
    } else if (how === 'whatsapp') {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    } else if (how === 'email') {
      window.location.href = `mailto:?subject=${encodeURIComponent(heading)}&body=${encodeURIComponent(text)}`;
    } else {
      try { await navigator.clipboard.writeText(text); toast('Copied.'); } catch { toast('Could not copy.', 'error'); }
    }
  };

  const archive = async () => {
    try {
      await ops.patch(current, { archived_at: current.archived_at ? null : new Date().toISOString(), pinned: false });
      toast(current.archived_at ? 'Back in your notes.' : 'Archived.');
      close();
    } catch (err) { setError(err.message); }
  };
  const trash = async () => {
    try { await ops.toTrash(current); close(); } catch (err) { setError(err.message); }
  };

  const photos = n.files.filter(isImage);
  const voices = n.files.filter(isAudio);
  const docs = n.files.filter((f) => !isImage(f) && !isAudio(f));
  const removeFile = (path) => set({ files: n.files.filter((f) => f.path !== path) });

  return (
    <Modal title={isNew ? 'New note' : 'Note'} onClose={close} className="task-editor note-editor">
      <button type="button" className="icon-btn modal-x" onClick={close} aria-label="Close"><Icon name="x" size={18} /></button>
      <form className={`form note-form ${n.color ? `note-c-${n.color}` : ''}`} onSubmit={save}>
        <input className="note-title-input" aria-label="Title" placeholder="Title" value={n.title} maxLength={200}
          onChange={(e) => set({ title: e.target.value })} />
        <textarea className="note-body-input" aria-label="Note" rows={7} data-autofocus={isNew ? true : undefined}
          placeholder={note.listen ? 'Write here, or tap the mic below and speak' : 'Write your note…'}
          value={n.body} onChange={(e) => set({ body: e.target.value })} maxLength={20000} />

        <div className="note-tools">
          <MicButton onRecorded={dictate} disabled={!!busy} label="Dictate into this note" className="btn-ghost btn-sm" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={cleanUp} disabled={!!busy}>
            {busy === 'cleanup' ? <Spinner label="Cleaning up" /> : <Icon name="sparkles" size={16} />} Clean up
          </button>
          {undo && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { set(undo); setUndo(null); }}>
              <Icon name="undo" size={16} /> Undo
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={addItem}><Icon name="list" size={16} /> Checklist</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => photo.current?.click()} disabled={!!busy}><Icon name="camera" size={16} /> Photo</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => file.current?.click()} disabled={!!busy}><Icon name="clip" size={16} /> File</button>
          <input ref={photo} type="file" accept="image/*" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          <input ref={file} type="file" accept={FILE_TYPES} multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        </div>
        {busy === 'dictate' && <p className="quick-add-hint small" role="status"><Spinner /> Writing down what you said…</p>}
        {busy === 'upload' && <p className="quick-add-hint small" role="status"><Spinner /> Uploading…</p>}

        {items.length > 0 && (
          <ul className="note-checklist">
            {items.map((it, i) => (
              <li key={it.id} className="note-check-item">
                <input type="checkbox" checked={!!it.done} onChange={(e) => setItem(i, { done: e.target.checked })} aria-label={`Done: ${it.text || 'item'}`} />
                <input type="text" value={it.text} placeholder="Item" aria-label="Checklist item" className={it.done ? 'is-done' : ''}
                  onChange={(e) => setItem(i, { text: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }} />
                <button type="button" className="icon-btn" onClick={() => set({ checklist: items.filter((_, j) => j !== i) })} aria-label="Remove item"><Icon name="x" size={15} /></button>
              </li>
            ))}
            <li><button type="button" className="link small" onClick={addItem}><Icon name="plus" size={13} /> Add item</button></li>
          </ul>
        )}

        {photos.length > 0 && (
          <div className="note-photos">
            {photos.map((f) => (
              <div key={f.path} className="note-photo">
                {ops.urls[f.path] ? <a href={ops.urls[f.path]} target="_blank" rel="noopener noreferrer"><img src={ops.urls[f.path]} alt={f.name} /></a> : <Spinner />}
                <button type="button" className="note-photo-x" onClick={() => removeFile(f.path)} aria-label={`Remove ${f.name}`}><Icon name="x" size={14} /></button>
              </div>
            ))}
          </div>
        )}
        {(voices.length > 0 || docs.length > 0) && (
          <ul className="note-files">
            {voices.map((f) => (
              <li key={f.path}>
                <Icon name="mic" size={15} />
                {ops.urls[f.path] ? <audio controls src={ops.urls[f.path]} preload="none" /> : <span className="small muted">Voice note</span>}
                <button type="button" className="icon-btn" onClick={() => removeFile(f.path)} aria-label="Remove recording"><Icon name="x" size={15} /></button>
              </li>
            ))}
            {docs.map((f) => (
              <li key={f.path}>
                <Icon name="clip" size={15} />
                {ops.urls[f.path] ? <a href={ops.urls[f.path]} target="_blank" rel="noopener noreferrer" className="note-file-name">{f.name}</a> : <span className="note-file-name">{f.name}</span>}
                <span className="small muted">{fileSize(f.size)}</span>
                <button type="button" className="icon-btn" onClick={() => removeFile(f.path)} aria-label={`Remove ${f.name}`}><Icon name="x" size={15} /></button>
              </li>
            ))}
          </ul>
        )}

        {live && ops.todoOn && <ActionOffers note={live} />}

        <button type="button" className="link more-toggle" aria-expanded={more} onClick={() => setMore(!more)}>
          Topic, tags and colour <Icon name="chevronDown" size={14} className={more ? 'is-flipped' : ''} />
        </button>
        {more && (
          <div className="grid-2">
            <div className="field">
              <label htmlFor="note-topic">Topic</label>
              <select id="note-topic" value={n.topic_id || ''} onChange={(e) => set({ topic_id: e.target.value || null })}>
                <option value="">No topic</option>
                {ops.topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="field">
              <span className="label">Colour</span>
              <ColorPick value={n.color} onChange={(color) => set({ color })} />
            </div>
            <div className="field span-2">
              <label htmlFor="note-tags">Tags</label>
              <input id="note-tags" value={tagText} placeholder="Work, Idea… or write #Work in the note" onChange={(e) => setTagText(e.target.value)} />
              <div className="chips note-tag-chips">
                {TAG_SUGGESTIONS.filter((t) => !cleanTags(tagText.split(',')).some((x) => x.toLowerCase() === t.toLowerCase())).map((t) => (
                  <button key={t} type="button" className="chip" onClick={() => setTagText(cleanTags([...tagText.split(','), t]).join(', '))}>#{t}</button>
                ))}
              </div>
            </div>
          </div>
        )}

        {!isNew && (
          <div className="note-share">
            <span className="small muted">Share</span>
            {typeof navigator !== 'undefined' && navigator.share && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => share('native')}><Icon name="share" size={15} /> Share…</button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => share('whatsapp')}>WhatsApp</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => share('email')}><Icon name="mail" size={15} /> Email</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => share('copy')}><Icon name="copy" size={15} /> Copy</button>
          </div>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="task-editor-actions">
          <button type="button" className={`btn btn-ghost btn-sm note-pin ${n.pinned ? 'is-on' : ''}`} aria-pressed={n.pinned} onClick={() => set({ pinned: !n.pinned })}>
            <Icon name="pushpin" size={16} /> {n.pinned ? 'Pinned' : 'Pin'}
          </button>
          {current && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={archive}><Icon name="archive" size={16} /> {current.archived_at ? 'Unarchive' : 'Archive'}</button>
              <ConfirmButton icon="trash" className="btn btn-danger-ghost btn-sm" confirmLabel="Move to Trash" message="" onConfirm={trash}>Delete</ConfirmButton>
            </>
          )}
          <span className="grow" />
          <button type="submit" className="btn btn-primary" disabled={saving || busy === 'upload'}>
            <SaveLabel saving={saving} saved={saved}>{isNew ? 'Save note' : 'Save'}</SaveLabel>
          </button>
        </div>
      </form>
    </Modal>
  );
}
