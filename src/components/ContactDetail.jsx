import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context.js';
import { toDraft, fromDraft, diff } from '../contactModel.js';
import { followUpState, todayISO } from '../filters.js';
import { canEditContact, canDeleteContact, canToggleVisibility, canTakePrivate, canAddInteraction } from '../perms.js';
import ContactForm from './ContactForm.jsx';
import Timeline from './Timeline.jsx';
import SharePanel from './SharePanel.jsx';
import { Modal, Icon, Pill, Tabs, ConfirmButton, CopyButton, formatDate, initials } from './ui.jsx';

export default function ContactDetail({ contact, onClose }) {
  const { api, uid, role, contacts, upsertContact, removeContact, memberName, toast, ensureSigned, signed } = useApp();
  const [tab, setTab] = useState('details');
  const [side, setSide] = useState('front');
  const [base, setBase] = useState(() => toDraft(contact)); // what editing started from
  const [draft, setDraft] = useState(base);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);

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
    ensureSigned('cards', [contact.front_path, contact.back_path]);
  }, [contact.front_path, contact.back_path, ensureSigned]);

  const today = todayISO();
  const fu = followUpState(contact, today);
  const photoPath = side === 'back' ? contact.back_path : contact.front_path;
  const photo = photoPath ? signed('cards', photoPath) : null;
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

  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      const updated = await api.updateContact(contact.id, changes);
      if (updated) {
        upsertContact(updated);
        reset(updated);
      }
      toast('Contact saved');
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

          <div className="facts">
            <h2 id={titleId} className="detail-name">{contact.full_name || <em className="muted">No name</em>}</h2>
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
              <div><dt>Added</dt><dd>{formatDate(contact.created_at)} by {contact.created_by === uid ? 'you' : memberName(contact.created_by)}</dd></div>
              <div>
                <dt>Visibility</dt>
                <dd>
                  {contact.is_private
                    ? <span className="vis"><Icon name="lock" size={14} /> Private: only you can see it</span>
                    : <span className="vis"><Icon name="users" size={14} /> Shared with the workspace</span>}
                </dd>
              </div>
            </dl>

            <div className="detail-actions">
              {editable && (
                <button type="button" className="btn btn-primary" disabled={busy || contact.last_contacted_on === today}
                  onClick={() => patch({ last_contacted_on: today }, 'Logged contact today')}>
                  <Icon name="check" size={16} /> {contact.last_contacted_on === today ? 'Contacted today' : 'Log contact today'}
                </button>
              )}
              {role && (
                <button type="button" className={`btn btn-outline ${sharing ? 'has-active' : ''}`} aria-expanded={sharing} onClick={() => setSharing((v) => !v)}>
                  <Icon name="send" size={16} /> Share
                </button>
              )}
              {canToggleVisibility(contact, role, uid) && (
                <button type="button" className="btn btn-outline" disabled={busy}
                  onClick={() => patch({ is_private: !contact.is_private }, contact.is_private ? 'Card shared with the workspace' : 'Card is now private')}>
                  <Icon name={contact.is_private ? 'unlock' : 'lock'} size={16} /> {contact.is_private ? 'Share with workspace' : 'Make private'}
                </button>
              )}
              {canTakePrivate(contact, role, uid) && (
                <ConfirmButton
                  className="btn btn-outline"
                  icon="lock"
                  confirmLabel="Take private"
                  message={`${memberName(contact.created_by)} will lose access to this card, its photos and notes. You become its owner.`}
                  onConfirm={() => patch({ is_private: true, created_by: uid }, 'Card taken private. You now own it.')}
                >
                  Take private
                </ConfirmButton>
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
                    <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save changes'}</button>
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
