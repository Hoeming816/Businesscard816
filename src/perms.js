// UI permission checks mirroring the RLS rules in 0001_cardfile.sql (§2).
// The database is the source of truth; these only decide what to show.

export const canWrite = (role) => role === 'admin' || role === 'editor';
export const isAdmin = (role) => role === 'admin';

/** Every card belongs to the member who saved it; only they can see or change it (0004). */
export function canEditContact(c, role, uid) {
  return canWrite(role) && c.created_by === uid;
}

export function canDeleteContact(c, role, uid) {
  return canEditContact(c, role, uid);
}

export function canAddInteraction(c, role, uid) {
  return canEditContact(c, role, uid);
}

/** A meeting recorded without a card belongs to whoever recorded it (0006). */
export function canEditInteraction(i, c, role, uid) {
  if (!i.contact_id) return i.created_by === uid;
  return !!c && canEditContact(c, role, uid);
}
