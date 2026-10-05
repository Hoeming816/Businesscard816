import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context.js';
import { cropCardAt, loadPhoto, wholePhoto } from '../image.js';
import { blankDraft, draftFromScan, findSameName, fromDraft } from '../contactModel.js';
import { saveNewCard, updateCardFromScan } from '../saveCard.js';
import { findDuplicates } from '../filters.js';
import ContactForm from './ContactForm.jsx';
import { Icon, Spinner } from './ui.jsx';

const READ_SIDE = 2400; // several cards in one photo need more pixels than one card

const hasContent = (row) => !!(row.full_name || row.company || row.emails.length || row.phones.length);

/**
 * Several cards in one photo: Nomiqo reads every card, and each one becomes
 * its own contact after the person checks it.
 */
export default function MultiScan({ onSingle }) {
  const { api, uid, workspace, contacts, upsertContact, toast } = useApp();
  const [photo, setPhoto] = useState(null); // { canvas, url }
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState('');
  const [items, setItems] = useState(null); // [{ key, draft, img, include, choice, open, error }]
  const [saving, setSaving] = useState(false);
  const cam = useRef(null);
  const file = useRef(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const urls = useRef([]);
  const track = (u) => { if (u) urls.current.push(u); return u; };
  const dropUrls = () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); urls.current = []; };
  useEffect(() => dropUrls, []);

  const reset = () => {
    dropUrls();
    setPhoto(null);
    setItems(null);
    setReadError('');
  };

  const pick = async (f) => {
    if (!f) return;
    if (items?.length && !window.confirm('Start again with this photo? The cards below have not been saved and will be cleared.')) return;
    reset();
    setLoading(true);
    try {
      const canvas = await loadPhoto(f);
      const preview = await wholePhoto(canvas);
      if (!alive.current) return;
      setPhoto({ canvas, url: track(preview.url) });
      read(canvas);
    } catch (e) {
      toast(e.message || 'Could not use that image.', 'error');
    } finally {
      if (alive.current) setLoading(false);
    }
  };

  const read = async (canvas = photo?.canvas) => {
    if (!canvas) return;
    setReading(true);
    setReadError('');
    try {
      const full = await wholePhoto(canvas, READ_SIDE);
      URL.revokeObjectURL(full.url);
      const cards = await api.scanCards(full.base64);
      const next = [];
      for (const [i, card] of cards.entries()) {
        let img = null;
        try { img = await cropCardAt(canvas, card.box); } catch { /* saved without a photo */ }
        if (img) track(img.url);
        next.push({ key: `${Date.now()}-${i}`, draft: draftFromScan(card, blankDraft()), img, include: true, choice: 'update', open: false, error: '' });
      }
      if (!alive.current) return;
      setItems(next);
      if (!next.length) setReadError('No business cards were found in this photo.');
      else toast(`Found ${next.length} card${next.length === 1 ? '' : 's'}. Check each one before saving.`);
    } catch (e) {
      if (alive.current) setReadError(e.message || 'The cards could not be read.');
    } finally {
      if (alive.current) setReading(false);
    }
  };

  const change = (key, patch) => setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  const setDraftFor = (key) => (upd) => setItems((list) => list.map((it) => (
    it.key === key ? { ...it, draft: typeof upd === 'function' ? upd(it.draft) : upd } : it
  )));

  const chosen = (items || []).filter((it) => it.include);

  const saveAll = async () => {
    setSaving(true);
    let saved = 0;
    const left = [];
    for (const it of items) {
      if (!it.include) { left.push(it); continue; }
      const row = fromDraft(it.draft);
      if (!hasContent(row)) {
        left.push({ ...it, error: 'Add at least a name, company, email or phone, or untick this card.' });
        continue;
      }
      const match = findSameName(contacts, row.full_name, uid)[0];
      const photos = { front: it.img };
      try {
        const { contact, failures } = match && it.choice === 'update'
          ? await updateCardFromScan(api, { target: match, row, workspaceId: workspace.id, photos })
          : await saveNewCard(api, { row, workspaceId: workspace.id, uid, photos });
        if (contact) upsertContact(contact);
        if (failures.length) toast(`${row.full_name || 'A card'} was saved, but ${failures.join('; ')}`, 'error');
        saved++;
      } catch (e) {
        left.push({ ...it, error: e.message || 'Could not save this card.', open: true });
      }
    }
    if (!alive.current) return;
    setSaving(false);
    const failed = left.filter((it) => it.error).length;
    if (saved) toast(`Saved ${saved} card${saved === 1 ? '' : 's'}.${failed ? ` ${failed} still need${failed === 1 ? 's' : ''} attention.` : ''}`);
    if (!left.some((it) => it.include)) reset();
    else setItems(left);
  };

  const leave = () => {
    if (items?.length && !window.confirm('Leave without saving these cards?')) return;
    onSingle();
  };

  return (
    <div className="page scan multi-scan">
      <div className="page-head">
        <h1 className="h1">Scan several cards</h1>
        <p className="muted">
          Lay the cards out flat, front side up and not overlapping, and take one photo. Nomiqo reads each card as its own contact.
          {' '}<button type="button" className="link" onClick={leave}>Scan one card instead</button>
        </p>
      </div>

      <section className="multi-photo" aria-label="Photo of the cards">
        <div className={`dropzone multi-drop ${photo ? 'has-image' : ''}`}>
          {loading ? <span className="dz-hint"><Spinner /> Preparing photo…</span>
            : photo ? <img src={photo.url} alt="The cards you photographed" />
              : <span className="dz-hint"><Icon name="cards" size={28} /><span>One photo, several cards</span></span>}
        </div>
        <div className="slot-actions">
          <button type="button" className="btn btn-primary btn-sm" disabled={reading || saving} onClick={() => cam.current.click()}>
            <Icon name="camera" size={15} /> {photo ? 'Take another photo' : 'Take photo'}
          </button>
          <button type="button" className="btn btn-outline btn-sm" disabled={reading || saving} onClick={() => file.current.click()}>
            <Icon name="upload" size={15} /> Choose file
          </button>
          {photo && !reading && readError && (
            <button type="button" className="btn btn-outline btn-sm" onClick={() => read()}>
              <Icon name="sparkles" size={15} /> Read again
            </button>
          )}
          <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { pick(e.target.files[0]); e.target.value = ''; }} aria-label="Take a photo of the cards" />
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files[0]); e.target.value = ''; }} aria-label="Choose a photo of the cards" />
        </div>
        {reading && <p className="help"><Spinner /> Reading the cards… this can take a little while for several cards.</p>}
        {readError && (
          <div className="notice notice-error" role="alert">
            <strong>Couldn't read the cards.</strong> {readError}
          </div>
        )}
      </section>

      {items && items.length > 0 && (
        <section className="multi-review" aria-labelledby="multi-review-h">
          <h2 id="multi-review-h" className="h3">Check {items.length === 1 ? 'the card' : `the ${items.length} cards`}</h2>
          <p className="muted small">Untick any card you don't want. Tap Edit details to correct a card. Back sides can be added later from each card.</p>
          <ul className="multi-list">
            {items.map((it, i) => (
              <MultiItem
                key={it.key}
                n={i + 1}
                item={it}
                contacts={contacts}
                uid={uid}
                onChange={(patch) => change(it.key, patch)}
                setDraft={setDraftFor(it.key)}
              />
            ))}
          </ul>
          <div className="save-bar sticky is-dirty">
            <button type="button" className="btn btn-ghost" onClick={() => { if (window.confirm('Clear these cards without saving?')) reset(); }} disabled={saving}>Clear</button>
            <button type="button" className="btn btn-primary" onClick={saveAll} disabled={saving || !chosen.length}>
              {saving ? 'Saving…' : <><Icon name="check" size={16} /> Save {chosen.length} card{chosen.length === 1 ? '' : 's'}</>}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function MultiItem({ n, item, contacts, uid, onChange, setDraft }) {
  const row = useMemo(() => fromDraft(item.draft), [item.draft]);
  const match = useMemo(() => findSameName(contacts, row.full_name, uid)[0], [contacts, row.full_name, uid]);
  const dups = useMemo(() => (match ? [] : findDuplicates(contacts, row)), [contacts, row, match]);
  const id = `multi-${item.key}`;
  const sub = [row.job_title, row.company].filter(Boolean).join(' · ');
  const reach = [row.emails[0], row.phones[0]?.number].filter(Boolean).join(' · ');

  return (
    <li className={`multi-item ${item.include ? '' : 'is-off'}`}>
      <div className="multi-row">
        <input
          id={`${id}-inc`}
          type="checkbox"
          checked={item.include}
          onChange={(e) => onChange({ include: e.target.checked })}
          aria-label={`Save card ${n}${row.full_name ? `, ${row.full_name}` : ''}`}
        />
        <div className="multi-thumb">
          {item.img ? <img src={item.img.url} alt={`Card ${n}`} /> : <span className="muted small">No photo</span>}
        </div>
        <label htmlFor={`${id}-inc`} className="multi-main">
          <strong className="ellipsis">{row.full_name || <em className="muted">No name</em>}</strong>
          {sub && <span className="muted small ellipsis">{sub}</span>}
          {reach && <span className="muted small ellipsis mono">{reach}</span>}
        </label>
        <button type="button" className="btn btn-ghost btn-sm" aria-expanded={item.open} aria-controls={`${id}-form`} onClick={() => onChange({ open: !item.open })}>
          <Icon name={item.open ? 'chevronDown' : 'edit'} size={15} /> {item.open ? 'Done' : 'Edit details'}
        </button>
      </div>

      {match && item.include && (
        <div className="notice notice-info same-person" role="group" aria-label="Card you already have">
          <Icon name="history" size={16} />
          <div>
            <strong>You already have a card for {match.full_name}.</strong>
            <div className="multi-choice">
              <label><input type="radio" name={`${id}-choice`} checked={item.choice === 'update'} onChange={() => onChange({ choice: 'update' })} /> Update it (notes and meetings are kept)</label>
              <label><input type="radio" name={`${id}-choice`} checked={item.choice === 'new'} onChange={() => onChange({ choice: 'new' })} /> Keep both</label>
            </div>
          </div>
        </div>
      )}
      {dups.length > 0 && item.include && (
        <div className="notice notice-warn" role="status">
          <Icon name="alert" size={16} />
          <div>
            <strong>Possible duplicate:</strong>{' '}
            {dups.slice(0, 2).map((d) => `${d.full_name || 'No name'}${d.company ? ` (${d.company})` : ''}`).join(', ')}. It will still be saved as a new card.
          </div>
        </div>
      )}
      {item.error && <p className="form-error" role="alert">{item.error}</p>}
      {item.open && (
        <div id={`${id}-form`} className="multi-form">
          <ContactForm draft={item.draft} setDraft={setDraft} contacts={contacts} sections={['card']} />
        </div>
      )}
    </li>
  );
}
