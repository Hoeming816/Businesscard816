import { Icon, Modal, formatDate } from './ui.jsx';
import { ReminderList } from './TaskReminders.jsx';

/** Everything waiting for me (to-do reminders, invitations, shared cards) plus answers to cards I shared. */
export default function Notifications({ invites, shares, replies, reminders, seenAt, onOpen, onClose }) {
  const waiting = invites.length + shares.length;
  return (
    <Modal labelledBy="notif-title" onClose={onClose} className="notifications">
      <div className="notif-bar">
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Back">
          <Icon name="chevronLeft" size={22} />
        </button>
        <h2 id="notif-title" className="modal-title">Notifications</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="x" size={20} />
        </button>
      </div>
      {reminders?.active.length > 0 && (
        <>
          <h3 className="notif-head">Reminders</h3>
          <ReminderList board={reminders} showLater={false} />
        </>
      )}
      <h3 className="notif-head">Waiting for you</h3>
      {waiting ? (
        <ul className="notif-list">
          {invites.map((i) => (
            <li key={`i-${i.workspace_id}`}>
              <span className="incoming-icon" aria-hidden="true"><Icon name="users" size={18} /></span>
              <span className="grow">
                <strong>{i.inviter_name || 'Someone'}</strong> invited you to their team.
                <span className="block muted small">{formatDate(i.invited_at)}</span>
              </span>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => onOpen({ kind: 'invite', id: i.workspace_id })}>Answer</button>
            </li>
          ))}
          {shares.map((s) => (
            <li key={`s-${s.id}`}>
              <span className="incoming-icon" aria-hidden="true"><Icon name="cards" size={18} /></span>
              <span className="grow">
                <strong>{s.sender_name}</strong> shared {s.contact_name || 'a card'} with you.
                <span className="block muted small">{formatDate(s.created_at)}</span>
              </span>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => onOpen({ kind: 'share', id: s.id })}>Answer</button>
            </li>
          ))}
        </ul>
      ) : <p className="muted small">Nothing is waiting for you.</p>}

      {replies.length > 0 && (
        <>
          <h3 className="notif-head">Cards you shared</h3>
          <ul className="notif-list">
            {replies.map((r) => (
              <li key={`r-${r.id}`} className={r.responded_at > seenAt ? 'is-new' : ''}>
                <span className="incoming-icon" aria-hidden="true"><Icon name={r.status === 'accepted' ? 'check' : 'x'} size={18} /></span>
                <span className="grow">
                  <strong>{r.recipient_name}</strong> {r.status === 'accepted' ? 'accepted' : 'declined'} {r.contact_name || 'your card'}.
                  <span className="block muted small">{formatDate(r.responded_at)}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* On a phone this page covers the menu bar, so Back sits at the bottom too. */}
      <div className="notif-foot">
        <button type="button" className="btn btn-outline btn-lg" onClick={onClose}>
          <Icon name="chevronLeft" size={18} /> Back
        </button>
      </div>
    </Modal>
  );
}
