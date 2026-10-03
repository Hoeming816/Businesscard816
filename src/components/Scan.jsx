import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context.js';
import { prepareImage } from '../image.js';
import { blankDraft, draftFromScan, fromDraft } from '../contactModel.js';
import { findDuplicates } from '../filters.js';
import { canWrite } from '../perms.js';
import ContactForm from './ContactForm.jsx';
import { Icon, Spinner, EmptyState } from './ui.jsx';

export default function Scan() {
  const { api, uid, role, workspace, contacts, upsertContact, toast, setView } = useApp();
  const [front, setFront] = useState(null); // { blob, url, base64 }
  const [back, setBack] = useState(null);
  const [draft, setDraft] = useState(blankDraft);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState('');
  const [readDone, setReadDone] = useState(false);
  const [pendingSave, setPendingSave] = useState(null); // 'shared' | 'private' awaiting duplicate confirmation
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const row = useMemo(() => fromDraft(draft), [draft]);
  const dups = useMemo(() => findDuplicates(contacts, row), [contacts, row]);
  const hasContent = !!(row.full_name || row.company || row.emails.length || row.phones.length);

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

  const read = async () => {
    if (!front) return;
    setReading(true);
    setReadError('');
    try {
      const card = await api.scanCard(front.base64, back?.base64 || null);
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
    setFront(null);
    setBack(null);
    setDraft(blankDraft());
    setReadDone(false);
    setReadError('');
    setPendingSave(null);
    setSaveError('');
  };

  const save = async (visibility, force = false) => {
    setSaveError('');
    if (!hasContent) {
      setSaveError('Add at least a name, company, email or phone before saving.');
      return;
    }
    if (dups.length && !force) {
      setPendingSave(visibility);
      return;
    }
    setPendingSave(null);
    setSaving(true);
    let contact;
    try {
      contact = await api.insertContact({
        ...row,
        workspace_id: workspace.id,
        created_by: uid,
        is_private: visibility === 'private',
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
      toast(`${contact.full_name || 'Contact'} saved ${visibility === 'private' ? 'as private' : 'to ' + workspace.name}`);
    }
    reset();
  };

  return (
    <div className="page scan">
      <div className="page-head">
        <h1 className="h1">Scan card</h1>
        <p className="muted">Add the front (and back, if it has details), then let Cardfile read it, or type the details yourself.</p>
      </div>

      <div className="scan-grid">
        <section className="scan-photos" aria-label="Card photos">
          <PhotoSlot label="Front" required value={front} onChange={setFront} onError={(m) => toast(m, 'error')} />
          <PhotoSlot label="Back" value={back} onChange={setBack} onError={(m) => toast(m, 'error')} />
          <button type="button" className="btn btn-primary btn-lg btn-block" disabled={!front || reading} onClick={read}>
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
          {dups.length > 0 && (
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
          {pendingSave && (
            <div className="notice notice-warn confirm-dup" role="alertdialog" aria-label="Duplicate warning">
              <p>This looks like a card you already have. Save it anyway?</p>
              <div className="row-actions">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => save(pendingSave, true)}>Save anyway</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPendingSave(null)}>Cancel</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setView('contacts')}>Go to contacts</button>
              </div>
            </div>
          )}
          <div className="save-bar sticky is-dirty">
            <button type="button" className="btn btn-ghost" onClick={reset} disabled={saving}>Clear</button>
            <button type="button" className="btn btn-outline" onClick={() => save('private')} disabled={saving}>
              <Icon name="lock" size={16} /> Save as private
            </button>
            <button type="button" className="btn btn-primary" onClick={() => save('shared')} disabled={saving}>
              {saving ? 'Saving…' : <><Icon name="users" size={16} /> Save to workspace</>}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function PhotoSlot({ label, required, value, onChange, onError }) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const cam = useRef(null);
  const file = useRef(null);
  const id = `slot-${label.toLowerCase()}`;

  const take = async (f) => {
    if (!f) return;
    setBusy(true);
    try {
      const img = await prepareImage(f);
      if (value?.url) URL.revokeObjectURL(value.url);
      onChange(img);
    } catch (e) {
      onError(e.message || 'Could not use that image.');
    } finally {
      setBusy(false);
    }
  };

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
