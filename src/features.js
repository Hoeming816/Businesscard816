// Per-user feature switches set by a super admin. A switch that was never set
// uses its default: Business Cards features are on, Meeting, To Do List and
// Quick Notes are off until a super admin turns them on. Super admins have
// everything. The server enforces the same keys and defaults (feature_on() in
// migrations 0005, 0011 and 0012, and the edge functions).
export const FEATURES = [
  { key: 'scan_ai', label: 'AI card reading', help: 'Scan fills in the card details with AI. When off, they type the details themselves.', default: true },
  { key: 'share', label: 'Share cards', help: 'Offer a card to another member.', default: true },
  { key: 'meeting', label: 'Meeting', help: 'The Meeting Minutes tab: record meetings, transcribe them and make AI minutes. Off for new accounts.', default: false },
  { key: 'todo', label: 'To Do List', help: 'The To Do List tab: tasks, reminders, calendar, voice and AI quick add, and giving tasks to teammates. Off for new accounts.', default: false },
  { key: 'notes', label: 'Quick Notes', help: 'The Quick Notes tab: notes and topics by typing, voice or photo, AI clean up, and Add to To-Do. Off for new accounts.', default: false },
];

export const featureDefault = (key) => FEATURES.find((f) => f.key === key)?.default ?? true;

export function featureOn(profile, key) {
  if (profile?.is_super_admin) return true;
  const v = profile?.features?.[key];
  return typeof v === 'boolean' ? v : featureDefault(key);
}
