// UI permission checks mirroring the RLS rules in 0001_cardfile.sql (§2).
// The database is the source of truth; these only decide what to show.

export const canWrite = (role) => role === 'admin' || role === 'editor';
export const isAdmin = (role) => role === 'admin';

/** Edit fields of a card: shared cards, or your own private cards. */
export function canEditContact(c, role, uid) {
  return canWrite(role) && (!c.is_private || c.created_by === uid);
}

/** Delete: editors delete their own cards; admins any shared card (and their own). */
export function canDeleteContact(c, role, uid) {
  return canEditContact(c, role, uid) && (c.created_by === uid || isAdmin(role));
}

/** Owner of a card may switch it between private and shared. */
export function canToggleVisibility(c, role, uid) {
  return canWrite(role) && c.created_by === uid;
}

/** Admin taking someone else's shared card private (ownership moves to the admin). */
export function canTakePrivate(c, role, uid) {
  return isAdmin(role) && !c.is_private && c.created_by !== uid;
}

export function canAddInteraction(c, role, uid) {
  return canEditContact(c, role, uid);
}

export function canEditInteraction(i, c, role, uid) {
  return canEditContact(c, role, uid) && (i.created_by === uid || isAdmin(role));
}
