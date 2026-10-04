import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context.js';
import { toDraft, fromDraft, diff } from '../contactModel.js';
import { followUpState, todayISO } from '../filters.js';
import { canEditContact, canDeleteContact, canAddInteraction } from '../perms.js';
import ContactForm from './ContactForm.jsx';
import Timeline from './Timeline.jsx';
import SharePanel from './SharePanel.jsx';
import CardCropper from './CardCropper.jsx';
import FaceCropper from './FaceCropper.jsx';
import { cropSquare, cropToCard, fallbackQuad, findCard, loadPhoto, wholePhoto } from '../image.js';
import { Modal, Icon, Pill, Tabs, ConfirmButton, CopyButton, Spinner, SaveLabel, useJustSaved, formatDate, initials } from './ui.jsx';

export default function ContactDetail({ contact, onClose, initialTab = 'details' }) {
  const { api, uid, role, contacts, upsertContact, removeContact, toast, ensureSigned, signed, can } = useApp();
  const [tab, setTab] = useState(initialTab);
  const [side, setSide] = useState('front');
  const [base, setBase] = useState(() => toDraft(contact)); // what editing started from
  const [draft, setDraft] = useState(base);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  // Retaking a card photo: camera -> crop -> replace. { side, canvas, quad, detected }
  const retakeInput = useRef(null);
  const retakeSide = useRef('front');
  const [retake, setRetake] = useState(null);
  const [retakeBusy, setRetakeBusy] = useState(''); // '' | 'loading' | 'saving'
  const faceInput = useRef(null);
  const [face, setFace] = useState(null); // { canvas } while framing a new face photo
  const [faceBusy, setFaceBusy] = useState(false);
  const [photoNote, setPhotoNote] = useState(''); // confirmation shown under the photo after a retake

  const editable = canEditContact(contact, role, uid);
  // Only the fields the user changed, so updates made elsewhere (e.g. "Log
  // contact today" or an AI suggestion) are neither overwritten nor counted.
  const changes = useMemo(() => diff(fromDraft(base), fromDraft(draft)), [base, draft]);
  const dirty = Object.keys(changes).length > 0;
  const reset = (c) => { const d = toDraft(c); setBase(d); setDraft(d); };

  useEffect(() => {
    if (!dirty) reset(contact);
  }, [contact]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    ensureSigned('cards', [contact.front_path, contact.back_path, contact.face_path]);
  }, [contact.front_path, contact.back_path, contact.face_path, ensureSigned]);

  const today = todayISO();
  const fu = followUpState(contact, today);
  const photoPath = side === 'back' ? contact.back_path : contact.front_path;
  const photo = photoPath ? signed('cards', photoPath) : null;
  const faceUrl = contact.face_path ? signed('cards', contact.face_path) : null;
  const titleId = `detail-title-${contact.id}`;

  const refresh = async () => {
    try {
      const fresh = await api.getContact(contact.id);
      if (fresh) upsertContact(fresh);
    } catch { /* keep current */ }
  };

  const patch = async (p, okMsg) => {
    setBusy(true);
    try {
      const updated = await api.updateContact(contact.id, p);
      if (updated) upsertContact(updated);
      else { removeContact(contact.id); onClose(); }
      if (okMsg) toast(okMsg);
      return updated;
    } catch (e) {
      toast(e.message, 'error');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const [justSaved, markSaved] = useJustSaved();
  const save = async () => {
    if (!dirty) {
      toast(photoNote ? 'Already saved. The new photo was saved when you tapped Crop.' : 'Everything is already saved.');
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateContact(contact.id, changes);
      if (updated) {
        upsertContact(updated);
        reset(updated);
      }
      markSaved();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const del = async () => {
    try {
      await api.deleteContact(contact);
      removeContact(contact.id);
      toast('Card deleted');
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const pickRetake = (which) => {
    retakeSide.current = which;
    retakeInput.current?.click();
  };

  const startRetake = async (file) => {
    setRetakeBusy('loading');
    try {
      const canvas = await loadPhoto(file);
      const found = findCard(canvas);
      setRetake({ side: retakeSide.current, canvas, quad: found || fallbackQuad(canvas.width, canvas.height), detected: !!found });
    } catch (e) {
      toast(e.message || 'Could not use that image.', 'error');
    } finally {
      setRetakeBusy('');
    }
  };

  // Replace the photo only; the card details are left as they are.
  const finishRetake = async (quad) => {
    const which = retake.side;
    setRetakeBusy('saving');
    try {
      const img = quad ? await cropToCard(retake.canvas, quad) : await wholePhoto(retake.canvas);
      const old = contact[`${which}_path`];
      const path = await api.uploadCardPhoto(contact.workspace_id, contact.id, which, img.blob);
      const updated = await api.updateContact(contact.id, { [`${which}_path`]: path });
      if (img.url) URL.revokeObjectURL(img.url);
      if (old) api.removeStorageObjects('cards', [old]).catch(() => {});
      if (updated) upsertContact(updated);
      setSide(which);
      setRetake(null);
      const msg = old ? `Saved. New ${which} photo` : `Saved. ${which === 'back' ? 'Back' : 'Front'} photo added`;
      setPhotoNote(msg);
      toast(msg);
    } catch (e) {
      toast(e.message || 'Could not replace the photo.', 'error');
    } finally {
      setRetakeBusy('');
    }
  };

  const startFace = async (file) => {
    setFaceBusy(true);
    try {
      setFace({ canvas: await loadPhoto(file) });
    } catch (e) {
      toast(e.message || 'Could not use that image.', 'error');
    } finally {
      setFaceBusy(false);
    }
  };

  // The face photo is saved on its own, like a card photo retake.
  const saveFace = async (crop) => {
    setFaceBusy(true);
    try {
      const img = await cropSquare(face.canvas, crop);
      const old = contact.face_path;
      const path = await api.uploadCardPhoto(contact.workspace_id, contact.id, 'face', img.blob);
      const updated = await api.updateContact(contact.id, { face_path: path });
      if (img.url) URL.revokeObjectURL(img.url);
      if (old) api.removeStorageObjects('cards', [old]).catch(() => {});
      if (updated) upsertContact(updated);
      setFace(null);
      toast(old ? 'Saved. New face photo' : 'Saved. Face photo added');
    } catch (e) {
      toast(e.message || 'Could not save the face photo.', 'error');
    } finally {
      setFaceBusy(false);
    }
  };

  const removeFace = async () => {
    const old = contact.face_path;
    const updated = await patch({ face_path: null }, 'Face photo removed');
    if (updated && old) api.removeStorageObjects('cards', [old]).catch(() => {});
  };

  const close = () => {
    if (dirty && !window.confirm('Discard unsaved changes to this contact?')) return;
    onClose();
  };

  const phones = (contact.phones || []).filter((p) => p && p.number);
  const emails = (contact.emails || []).filter(Boolean);
  const location = [contact.city, contact.region, contact.country].filter(Boolean).join(', ');
  const website = contact.website ? (/^https?:\/\//i.test(contact.website) ? contact.website : `https://${contact.website}`) : null;

  return (
    <Modal onClose={close} labelledBy={titleId} className="detail" wide>
      <div className="detail-bar">
        <button type="button" className="icon-btn detail-back" onClick={close} aria-label="Back to contacts">
          <Icon name="chevronLeft" size={22} />
        </button>
        <span className="detail-bar-title">{contact.full_name || 'Contact'}</span>
        <button type="button" className="icon-btn detail-close" onClick={close} aria-label="Close">
          <Icon name="x" size={20} />
        </button>
      </div>

      <div className="detail-grid">
        <div className="detail-left">
          <div className="photo-frame">
            {photo ? (
              <img src={photo} alt={`${side === 'back' ? 'Back' : 'Front'} of ${contact.full_name || 'the'} business card`} />
            ) : (
              <div className="photo-ph" aria-label="No photo">
                <span>{initials(contact.full_name || contact.company)}</span>
                <small>{photoPath ? 'Loading photo…' : `No ${side} photo`}</small>
              </div>
            )}
            {contact.back_path && (
              <div className="photo-toggle" role="group" aria-label="Card side">
                <button type="button" aria-pressed={side === 'front'} className={side === 'front' ? 'is-on' : ''} onClick={() => setSide('front')}>Front</button>
                <button type="button" aria-pressed={side === 'back'} className={side === 'back' ? 'is-on' : ''} onClick={() => setSide('back')}>Back</button>
              </div>
            )}
          </div>
          {editable && (
            <div className="photo-actions">
              <button type="button" className="btn btn-outline btn-sm" disabled={!!retakeBusy} onClick={() => pickRetake(side === 'back' && contact.back_path ? 'back' : 'front')}>
                {retakeBusy === 'loading' ? <Spinner /> : <Icon name="camera" size={15} />}{' '}
                {(side === 'back' && contact.back_path) ? 'Retake back photo' : contact.front_path ? 'Retake front photo' : 'Add card photo'}
              </button>
              {contact.front_path && !contact.back_path && (
                <button type="button" className="btn btn-ghost btn-sm" disabled={!!retakeBusy} onClick={() => pickRetake('back')}>
                  <Icon name="plus" size={15} /> Add back photo
                </button>
              )}
              {photoNote && <p className="photo-note" role="status"><Icon name="check" size={14} /> {photoNote}. Nothing else to save.</p>}
              <input
                ref={retakeInput}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => {
                  const f = e.target.files && e.target.files[0];
                  e.target.value = '';
                  if (f) startRetake(f);
                }}
              />
            </div>
          )}
          {face && <FaceCropper canvas={face.canvas} busy={faceBusy} onSave={saveFace} onCancel={() => setFace(null)} />}
          {retake && (
            <CardCropper
              side={retake.side === 'back' ? 'Back' : 'Front'}
              canvas={retake.canvas}
              initialQuad={retake.quad}
              detected={retake.detected}
              busy={retakeBusy === 'saving'}
              onCrop={finishRetake}
              onSkip={() => finishRetake(null)}
              onCancel={() => setRetake(null)}
            />
          )}

          <div className="facts">
            <div className="face-row">
              <span className="face-avatar" aria-hidden={!faceUrl}>
                {faceUrl ? <img src={faceUrl} alt={`Face photo of ${contact.full_name || 'this contact'}`} />
                  : <span>{contact.face_path ? '' : initials(contact.full_name || contact.company)}</span>}
              </span>
              <div className="face-side">
                <h2 id={titleId} className="detail-name">{contact.full_name || <em className="muted">No name</em>}</h2>
                {editable && (
                  <div className="face-actions">
                    <button type="button" className="link small" disabled={faceBusy} onClick={() => faceInput.current?.click()}>
                      {faceBusy && !face ? <Spinner /> : <Icon name="user" size={13} />} {contact.face_path ? 'Change face photo' : 'Add face photo'}
                    </button>
                    {contact.face_path && (
                      <ConfirmButton className="link small face-remove" confirmLabel="Remove" message="Remove the face photo?" onConfirm={removeFace} disabled={busy}>
                        Remove
                      </ConfirmButton>
                    )}
                    <input
                      ref={faceInput}
                      type="file"
                      accept="image/*"
                      hidden
                      tabIndex={-1}
                      aria-hidden="true"
                      onChange={(e) => {
                        const f = e.target.files && e.target.files[0];
                        e.target.value = '';
                        if (f) startFace(f);
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
            {(contact.job_title || contact.company) && (
              <p className="detail-sub">
                {contact.job_title}{contact.job_title && contact.company ? ' · ' : ''}<strong>{contact.company}</strong>
                {contact.department && <span className="muted"> · {contact.department}</span>}
              </p>
            )}
            <div className="row-pills">
              {contact.contact_type && <Pill>{contact.contact_type}</Pill>}
              {contact.industry && <Pill>{contact.industry}</Pill>}
              {contact.lead_status && <Pill tone="accent">{contact.lead_status}</Pill>}
              {contact.priority && <Pill tone={contact.priority === 'High' ? 'hot' : 'neutral'}>{contact.priority} priority</Pill>}
              {fu === 'overdue' && <Pill tone="danger" icon="clock">Follow-up overdue</Pill>}
              {fu === 'today' && <Pill tone="warn" icon="clock">Follow-up today</Pill>}
            </div>

            <ul className="quick">
              {phones.map((p, i) => (
                <li key={`p${i}`}>
                  <Icon name="phone" size={16} />
                  <span className="quick-label">{p.label}</span>
                  <a className="mono" href={`tel:${p.number.replace(/[^\d+]/g, '')}`}>{p.number}</a>
                  <CopyButton value={p.number} label={`${p.label} number`} onCopied={toast} />
                </li>
              ))}
              {emails.map((e) => (
                <li key={e}>
                  <Icon name="mail" size={16} />
                  <a className="mono ellipsis" href={`mailto:${e}`}>{e}</a>
                  <CopyButton value={e} label="Email" onCopied={toast} />
                </li>
              ))}
              {website && (
                <li><Icon name="globe" size={16} /><a className="mono ellipsis" href={website} target="_blank" rel="noreferrer noopener">{contact.website}</a></li>
              )}
              {(contact.address || location) && (
                <li>
                  <Icon name="pin" size={16} />
                  <span>
                    {contact.address && <span className="block">{contact.address}</span>}
                    {location && <span className="block muted">{location}</span>}
                  </span>
                </li>
              )}
            </ul>

            <dl className="meta">
              <div><dt>Last contacted</dt><dd>{contact.last_contacted_on ? formatDate(contact.last_contacted_on) : 'Never'}</dd></div>
              <div><dt>Next follow-up</dt><dd>{contact.next_follow_up_on ? formatDate(contact.next_follow_up_on) : 'None'}</dd></div>
              <div><dt>Added</dt><dd>{formatDate(contact.created_at)}</dd></div>
              <div>
                <dt>Visibility</dt>
                <dd><span className="vis"><Icon name="lock" size={14} /> Only you can see it</span></dd>
              </div>
            </dl>

            <div className="detail-actions">
              {editable && (
                <button type="button" className="btn btn-primary" disabled={busy || contact.last_contacted_on === today}
                  onClick={() => patch({ last_contacted_on: today }, 'Logged contact today')}>
                  <Icon name="check" size={16} /> {contact.last_contacted_on === today ? 'Contacted today' : 'Log contact today'}
                </button>
              )}
              {editable && can('share') && (
                <button type="button" className={`btn btn-outline ${sharing ? 'has-active' : ''}`} aria-expanded={sharing} onClick={() => setSharing((v) => !v)}>
                  <Icon name="send" size={16} /> Share
                </button>
              )}
              {canDeleteContact(contact, role, uid) && (
                <ConfirmButton icon="trash" confirmLabel="Delete card" message="Delete this card, its photos, notes and recordings?" onConfirm={del}>
                  Delete
                </ConfirmButton>
              )}
            </div>
            {sharing && <SharePanel contact={contact} onClose={() => setSharing(false)} />}
          </div>
        </div>

        <div className="detail-right">
          <Tabs
            label="Contact sections"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'details', label: 'Contact details' },
              { value: 'notes', label: 'Notes & meetings' },
            ]}
          />
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="tabpanel">
            {tab === 'details' ? (
              <>
                {!editable && (
                  <p className="notice notice-info">
                    <Icon name="lock" size={14} /> {role === 'viewer' ? 'Viewers can read cards but not change them.' : 'You can view this card but not edit it.'}
                  </p>
                )}
                <ContactForm draft={draft} setDraft={setDraft} contacts={contacts} readOnly={!editable} />
                {editable && (
                  <div className={`save-bar ${dirty ? 'is-dirty' : ''}`}>
                    <span className="muted small">{dirty ? `${Object.keys(changes).length} unsaved change${Object.keys(changes).length === 1 ? '' : 's'}` : 'All changes saved'}</span>
                    <button type="button" className="btn btn-ghost" disabled={!dirty || saving} onClick={() => reset(contact)}>Discard</button>
                    <button type="button" className="btn btn-primary" disabled={saving} onClick={save}><SaveLabel saving={saving} saved={justSaved}>Save changes</SaveLabel></button>
                  </div>
                )}
              </>
            ) : (
              <Timeline contact={contact} canAdd={canAddInteraction(contact, role, uid)} onContactChanged={refresh} />
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
