import { useState } from 'react';
import { useApp } from '../context.js';
import { Icon, Modal } from './ui.jsx';

/** Asks whether to accept a card another member is sharing. One offer at a time. */
export default function IncomingShare({ share, remaining, workspaceName, onDone, onLater }) {
  const { api, toast } = useApp();
  const [busy, setBusy] = useState('');
  const card = [share.contact_title, share.contact_company].filter(Boolean).join(' · ');

  const answer = async (accept) => {
    setBusy(accept ? 'accept' : 'decline');
    try {
      if (accept) {
        const copy = await api.acceptShare(share);
        toast(`${share.contact_name || 'The card'} is now in your contacts.`);
        onDone(share, copy);
      } else {
        await api.closeShare(share.id);
        toast('Declined.');
        onDone(share, null);
      }
    } catch (e) {
      toast(e.message, 'error');
      if (/already answered|no longer available/i.test(e.message)) onDone(share, null);
    } finally {
      setBusy('');
    }
  };

  return (
    <Modal title="A card was shared with you" onClose={busy ? () => {} : onLater} className="incoming-share">
      <p className="incoming-lead">
        <strong>{share.sender_name}</strong> is trying to share a contact's business card with you. Will you accept it?
      </p>
      <div className="incoming-card">
        <span className="incoming-icon" aria-hidden="true"><Icon name="cards" size={20} /></span>
        <span>
          <strong className="block">{share.contact_name || 'Unnamed contact'}</strong>
          {card && <span className="block muted small">{card}</span>}
          {workspaceName && <span className="block muted small">In {workspaceName}</span>}
        </span>
      </div>
      <p className="muted small">If you accept, a private copy with the card photos is added to your contacts.</p>
      <div className="incoming-actions">
        <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={onLater}>Later</button>
        <button type="button" className="btn btn-outline" disabled={!!busy} onClick={() => answer(false)}>
          {busy === 'decline' ? 'Declining…' : 'Decline'}
        </button>
        <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => answer(true)} data-autofocus>
          <Icon name="check" size={16} /> {busy === 'accept' ? 'Accepting…' : 'Accept'}
        </button>
      </div>
      {remaining > 0 && <p className="muted small incoming-more">{remaining} more waiting after this one.</p>}
    </Modal>
  );
}
