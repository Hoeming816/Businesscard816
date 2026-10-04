import { useState } from 'react';
import { useApp } from '../context.js';
import { Icon, Modal } from './ui.jsx';

/** Asks whether to join a team someone invited me to. One invitation at a time. */
export default function IncomingInvite({ invite, remaining, onDone, onLater }) {
  const { api, toast } = useApp();
  const [busy, setBusy] = useState('');
  const who = invite.inviter_name || 'Someone';

  const answer = async (accept) => {
    setBusy(accept ? 'accept' : 'decline');
    try {
      await api.respondInvite(invite.workspace_id, accept);
      toast(accept ? `You joined ${who}'s team.` : 'Invitation declined.');
      onDone(invite, accept);
    } catch (e) {
      toast(e.message, 'error');
      if (/no longer open/i.test(e.message)) onDone(invite, false);
    } finally {
      setBusy('');
    }
  };

  return (
    <Modal title="You're invited to a team" onClose={busy ? () => {} : onLater} className="incoming-share">
      <p className="incoming-lead">
        <strong>{who}</strong> wants to add you to their team. Will you join?
      </p>
      <div className="incoming-card">
        <span className="incoming-icon" aria-hidden="true"><Icon name="users" size={20} /></span>
        <span className="muted small">
          Your cards stay private either way. Joining lets you send and receive shared cards with this team.
        </span>
      </div>
      <div className="incoming-actions">
        <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={onLater}>Later</button>
        <button type="button" className="btn btn-outline" disabled={!!busy} onClick={() => answer(false)}>
          {busy === 'decline' ? 'Declining…' : 'Decline'}
        </button>
        <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => answer(true)} data-autofocus>
          <Icon name="check" size={16} /> {busy === 'accept' ? 'Joining…' : 'Accept'}
        </button>
      </div>
      {remaining > 0 && <p className="muted small incoming-more">{remaining} more waiting after this one.</p>}
    </Modal>
  );
}
