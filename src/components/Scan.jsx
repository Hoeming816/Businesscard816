import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context.js';
import { cropToCard, fallbackQuad, findCard, loadPhoto, wholePhoto } from '../image.js';
import CardCropper from './CardCropper.jsx';
import { blankDraft, draftFromScan, findSameName, fromDraft, overwritePatch } from '../contactModel.js';
import { findDuplicates } from '../filters.js';
import { canWrite } from '../perms.js';
import ContactForm from './ContactForm.jsx';
import { Icon, Spinner, EmptyState } from './ui.jsx';

export default function Scan() {
  const { api, uid, role, workspace, contacts, upsertContact, toast, setView, quickShot, clearQuickShot } = useApp();
  const [front, setFront] = useState(null); // { blob, url, base64 }
  const [back, setBack] = useState(null);
  const [draft, setDraft] = useState(blankDraft);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState('');
  const [readDone, setReadDone] = useState(false);
  const [pendingSave, setPendingSave] = useState(false); // awaiting duplicate confirmation
  const [keepBoth, setKeepBoth] = useState(''); // id of a same-name card the user chose not to update
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const row = useMemo(() => fromDraft(draft), [draft]);
  const dups = useMemo(() => findDuplicates(contacts, row), [contacts, row]);
  const hasContent = !!(row.full_name || row.company || row.emails.length || row.phones.length);
  // An existing card of yours for the same person: offer to update it instead of adding another.
  const sameName = useMemo(() => findSameName(contacts, row.full_name, uid), [contacts, row.full_name, uid]);
  const match = sameName[0] && sameName[0].id !== keepBoth ? sameName[0] : null;

  // Every new photo opens the cropper first: { side, canvas, quad, detected }.
  const [crop, setCrop] = useState(null);
  const [loadingSide, setLoadingSide] = useState('');
  const [cropBusy, setCropBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const setSide = (side, img) => {
    const [cur, set] = side === 'Front' ? [front, setFront] : [back, setBack];
    if (cur?.url) URL.revokeObjectURL(cur.url);
    set(img);
  };

  // autoRead: run Read card straight after cropping (new card from the Scan button,
  // or a front photo on an empty form).
  const startCrop = async (file, side, autoRead = false) => {
    setLoadingSide(side);
    try {
      const canvas = await loadPhoto(file);
      if (!alive.current) return;
      const found = findCard(canvas);
      setCrop({ side, canvas, quad: found || fallbackQuad(canvas.width, canvas.height), detected: !!found, autoRead });
      setReadError('');
    } catch (e) {
      toast(e.message || 'Could not use that image.', 'error');
    } finally {
      if (alive.current) setLoadingSide('');
    }
  };

  const finishCrop = async (quad) => {
    setCropBusy(true);
    try {
      const img = quad ? await cropToCard(crop.canvas, quad) : await wholePhoto(crop.canvas);
      if (!alive.current) return;
      setSide(crop.side, img);
      setCrop(null);
      if (crop.side === 'Front' && crop.autoRead) read(img);
    } catch (e) {
      toast(e.message || 'Could not crop that photo.', 'error');
    } finally {
      if (alive.current) setCropBusy(false);
    }
  };

  // A photo taken with the Scan tab button always starts a new card.
  useEffect(() => {
    if (!quickShot) return;
    const { file } = quickShot;
    clearQuickShot();
    const dirty = front || back || hasContent;
    if (dirty && !window.confirm('Start a new card with this photo? The card you were working on has not been saved and will be cleared.')) return;
    if (dirty) reset();
    startCrop(file, 'Front', true);
  }, [quickShot]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    if (front?.url) URL.revokeObjectURL(front.url);
    if (back?.url) URL.revokeObjectURL(back.url);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!canWrite(role)) {
    return (
      <div className="page narrow">
        <EmptyState icon="lock" title="Viewers can't add cards">
          You have view-only access to {workspace?.name}. Ask a workspace admin to make you an editor.
        </EmptyState>
      </div>
    );
  }

  const read = async (frontImg = front, backImg = back) => {
    if (!frontImg) return;
    setReading(true);
    setReadError('');
    try {
      const card = await api.scanCard(frontImg.base64, backImg?.base64 || null);
      setDraft((d) => draftFromScan(card, d));
      setReadDone(true);
      toast('Card read. Check the details before saving.');
    } catch (e) {
      setReadError(e.message || 'The card could not be read.');
    } finally {
      setReading(false);
    }
  };

  const reset = () => {
    if (front?.url) URL.revokeObjectURL(front.url);
    if (back?.url) URL.revokeObjectURL(back.url);
    setFront(null);
    setBack(null);
    setDraft(blankDraft());
    setReadDone(false);
    setReadError('');
    setPendingSave(false);
    setKeepBoth('');
    setSaveError('');
  };

  const save = async (force = false) => {
    setSaveError('');
    if (!hasContent) {
      setSaveError('Add at least a name, company, email or phone before saving.');
      return;
    }
    if (dups.length && !force) {
      setPendingSave(true);
      return;
    }
    setPendingSave(false);
    setSaving(true);
    let contact;
    try {
      contact = await api.insertContact({
        ...row,
        workspace_id: workspace.id,
        created_by: uid,
        is_private: true,
      });
    } catch (e) {
      setSaveError(e.message);
      setSaving(false);
      return;
    }
    // Photos after the row exists (storage RLS checks the contact).
    const patch = {};
    const failures = [];
    for (const [side, img] of [['front', front], ['back', back]]) {
      if (!img) continue;
      try {
        patch[`${side}_path`] = await api.uploadCardPhoto(workspace.id, contact.id, side, img.blob);
      } catch (e) {
        failures.push(`${side} photo: ${e.message}`);
      }
    }
    if (Object.keys(patch).length) {
      try {
        contact = (await api.updateContact(contact.id, patch)) || contact;
      } catch (e) {
        failures.push(e.message);
      }
    }
    upsertContact(contact);
    setSaving(false);
    if (failures.length) {
      toast(`Contact saved, but ${failures.join('; ')}`, 'error');
    } else {
      toast(`${contact.full_name || 'Contact'} saved to your cards`);
    }
    reset();
  };

  // Overwrite the existing card's details and photos; notes, meetings and pipeline stay.
  const updateExisting = async (target) => {
    setSaveError('');
    setSaving(true);
    const patch = overwritePatch(target, row);
    const failures = [];
    const replaced = [];
    for (const [side, img] of [['front', front], ['back', back]]) {
      if (!img) continue;
      try {
        patch[`${side}_path`] = await api.uploadCardPhoto(workspace.id, target.id, side, img.blob);
        if (target[`${side}_path`]) replaced.push(target[`${side}_path`]);
      } catch (e) {
        failures.push(`${side} photo: ${e.message}`);
      }
    }
    let updated;
    try {
      updated = Object.keys(patch).length ? await api.updateContact(target.id, patch) : target;
    } catch (e) {
      setSaveError(e.message);
      setSaving(false);
      return;
    }
    if (replaced.length) api.removeStorageObjects('cards', replaced).catch(() => {});
    if (updated) upsertContact(updated);
    setSaving(false);
    const name = target.full_name || 'the contact';
    if (failures.length) toast(`Updated ${name}, but ${failures.join('; ')}`, 'error');
    else toast(`Updated ${name}. Notes and meetings were kept.`);
    reset();
  };

  return (
    <div className="page scan">
      {crop && (
        <CardCropper
          key={crop.canvas.width + 'x' + crop.canvas.height + crop.side}
          side={crop.side}
          canvas={crop.canvas}
          initialQuad={crop.quad}
          detected={crop.detected}
          busy={cropBusy}
          onCrop={finishCrop}
          onSkip={() => finishCrop(null)}
          onCancel={() => setCrop(null)}
        />
      )}
      <div className="page-head">
        <h1 className="h1">Scan card</h1>
        <p className="muted">Add the front (and back, if it has details), then let Nomiqo read it, or type the details yourself.</p>
      </div>

      <div className="scan-grid">
        <section className="scan-photos" aria-label="Card photos">
          <PhotoSlot label="Front" required busy={loadingSide === 'Front'} value={front} onPick={(f) => startCrop(f, 'Front', !hasContent)} onChange={setFront} />
          <PhotoSlot label="Back" busy={loadingSide === 'Back'} value={back} onPick={(f) => startCrop(f, 'Back')} onChange={setBack} />
          <button type="button" className="btn btn-primary btn-lg btn-block" disabled={!front || reading} onClick={() => read()}>
            {reading ? <><Spinner /> Reading card…</> : <><Icon name="sparkles" size={18} /> {readDone ? 'Read card again' : 'Read card'}</>}
          </button>
          {!front && <p className="help center">A front photo is needed for AI reading.</p>}
          {readError && (
            <div className="notice notice-error" role="alert">
              <strong>Couldn't read the card.</strong> {readError} You can still fill in the details by hand.
            </div>
          )}
        </section>

        <section className="scan-form" aria-labelledby="review-h">
          <h2 id="review-h" className="h3">{readDone ? 'Review and correct' : 'Card details'}</h2>
          {match && (
            <div className="notice notice-info same-person" role="status">
              <Icon name="history" size={16} />
              <div>
                <strong>You already have a card for {match.full_name}</strong>
                {[match.job_title, match.company].filter(Boolean).length > 0 && <> ({[match.job_title, match.company].filter(Boolean).join(' · ')})</>}.
                {' '}Update it with this card? The new details and photo replace the old ones; notes and meetings are kept.
                {sameName.length > 1 && <span className="block muted small">You have {sameName.length} cards with this name; this updates the most recent one.</span>}
              </div>
            </div>
          )}
          {!match && dups.length > 0 && (
            <div className="notice notice-warn" role="status">
              <Icon name="alert" size={16} />
              <div>
                <strong>Possible duplicate{dups.length > 1 ? 's' : ''}:</strong>{' '}
                {dups.slice(0, 3).map((d) => `${d.full_name || 'No name'}${d.company ? ` (${d.company})` : ''}`).join(', ')}
                {dups.length > 3 && ` and ${dups.length - 3} more`}. Same email, or same name and company.
              </div>
            </div>
          )}
          <ContactForm draft={draft} setDraft={setDraft} contacts={contacts} />

          {saveError && <p className="form-error" role="alert">{saveError}</p>}
          {pendingSave && !match && (
            <div className="notice notice-warn confirm-dup" role="alertdialog" aria-label="Duplicate warning">
              <p>This looks like a card you already have. Save it anyway?</p>
              <div className="row-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => save(true)}>Save anyway</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPendingSave(null)}>Cancel</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setView('contacts')}>Go to contacts</button>
              </div>
            </div>
          )}
          <div className="save-bar sticky is-dirty">
            <button type="button" className="btn btn-ghost" onClick={reset} disabled={saving}>Clear</button>
            {match ? (
              <>
                <button type="button" className="btn btn-outline" onClick={() => { setKeepBoth(match.id); save(true); }} disabled={saving}>
                  Keep both
                </button>
                <button type="button" className="btn btn-primary" onClick={() => updateExisting(match)} disabled={saving}>
                  {saving ? 'Updating…' : <><Icon name="refresh" size={16} /> Update existing</>}
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => save()} disabled={saving}>
                {saving ? 'Saving…' : <><Icon name="check" size={16} /> Save card</>}
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function PhotoSlot({ label, required, busy, value, onPick, onChange }) {
  const [over, setOver] = useState(false);
  const cam = useRef(null);
  const file = useRef(null);
  const id = `slot-${label.toLowerCase()}`;
  const take = (f) => { if (f) onPick(f); };

  return (
    <div className="slot">
      <div className="slot-label" id={`${id}-l`}>
        {label} {required ? <span className="req">required</span> : <span className="muted small">optional</span>}
      </div>
      <div
        className={`dropzone ${over ? 'is-over' : ''} ${value ? 'has-image' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files && e.dataTransfer.files[0]);
        }}
        aria-labelledby={`${id}-l`}
        role="group"
      >
        {busy ? (
          <span className="dz-hint"><Spinner /> Preparing photo…</span>
        ) : value ? (
          <img src={value.url} alt={`${label} of the card`} />
        ) : (
          <span className="dz-hint">
            <Icon name="cards" size={28} />
            <span>Drop a photo here</span>
          </span>
        )}
      </div>
      <div className="slot-actions">
        <button type="button" className="btn btn-outline btn-sm" onClick={() => cam.current.click()}>
          <Icon name="camera" size={15} /> {value ? 'Retake' : 'Take photo'}
        </button>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => file.current.click()}>
          <Icon name="upload" size={15} /> Choose file
        </button>
        {value && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { URL.revokeObjectURL(value.url); onChange(null); }}>
            Remove
          </button>
        )}
        <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { take(e.target.files[0]); e.target.value = ''; }} aria-label={`Take ${label.toLowerCase()} photo`} />
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { take(e.target.files[0]); e.target.value = ''; }} aria-label={`Choose ${label.toLowerCase()} photo`} />
      </div>
    </div>
  );
}
