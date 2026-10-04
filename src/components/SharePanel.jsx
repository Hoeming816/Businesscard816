import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context.js';
import { Icon, Pill, Spinner, Avatar } from './ui.jsx';

const STATUS = {
  pending: { label: 'Waiting', tone: 'warn' },
  accepted: { label: 'Accepted', tone: 'ok' },
  declined: { label: 'Declined', tone: 'danger' },
  cancelled: { label: 'Withdrawn', tone: 'neutral' },
};

/** Offer this card to another member of the workspace; they get a prompt to accept it. */
export default function SharePanel({ contact, onClose }) {
  const { api, uid, members, toast } = useApp();
  const [shares, setShares] = useState(null);
  const [busy, setBusy] = useState('');

  const load = async () => {
    try { setShares(await api.listContactShares(contact.id)); } catch (e) { setShares([]); toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, [contact.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // The panel opens under the buttons, often below the fold: bring it into view.
  const box = useRef(null);
  useEffect(() => {
    box.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    box.current?.focus({ preventScroll: true });
  }, []);

  // Only people who can keep cards: active editors and admins, not yourself.
  const people = members.filter((m) => m.user_id !== uid && m.status === 'active' && m.profile_status === 'active'
    && (m.role === 'admin' || m.role === 'editor'));
  const latest = (id) => (shares || []).find((s) => s.recipient_id === id && s.sender_id === uid);

  const send = async (m) => {
    setBusy(m.user_id);
    try {
      await api.shareContact(contact, m.user_id);
      toast(`Sent to ${m.full_name || m.username}. They'll be asked to accept it.`);
      await load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };
  const withdraw = async (s) => {
    setBusy(s.recipient_id);
    try { await api.closeShare(s.id); await load(); } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };

  return (
    <section ref={box} tabIndex={-1} className="share-panel" aria-labelledby="share-title">
      <div className="share-head">
        <h3 id="share-title"><Icon name="send" size={16} /> Share this card</h3>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close sharing"><Icon name="x" size={18} /></button>
      </div>
      <p className="muted small">
        They'll be asked whether to accept it. If they do, they get their own private copy with the photos.
        Your notes and meetings stay with you.
      </p>
      {shares === null ? <Spinner /> : people.length === 0 ? (
        <p className="notice">
          There's no one to share with yet. You can share cards once you've joined a team.
        </p>
      ) : (
        <ul className="share-list">
          {people.map((m) => {
            const s = latest(m.user_id);
            const st = s && STATUS[s.status];
            const name = m.full_name || m.username;
            return (
              <li key={m.user_id}>
                <Avatar name={name} size={30} />
                <span className="share-who">
                  <span className="ellipsis">{name}</span>
                  <span className="muted small">@{m.username}</span>
                </span>
                {st && <Pill tone={st.tone}>{st.label}</Pill>}
                {s?.status === 'pending' ? (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => withdraw(s)}>Withdraw</button>
                ) : (
                  <button type="button" className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => send(m)}>
                    {busy === m.user_id ? 'Sending…' : s ? 'Send again' : 'Send'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
