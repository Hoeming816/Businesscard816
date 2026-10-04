// What a workspace is called on screen. Every member's cards are private, so a
// workspace made at sign-up ("<owner>'s cards") shows as "My cards" rather than
// someone else's name. Workspaces given their own name keep it.

const DEFAULT_NAME = /'s cards$/i;

export function workspaceLabel(w, uid) {
  if (!w) return '';
  if (!DEFAULT_NAME.test(w.name || '')) return w.name;
  return w.owner_id === uid ? 'My cards' : 'Team cards';
}

/** The header shows "My cards" when there is only one workspace to be in. */
export const switcherLabel = (w, uid, count) => (count <= 1 ? 'My cards' : workspaceLabel(w, uid));
