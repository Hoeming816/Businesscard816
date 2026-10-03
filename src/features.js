// Per-user feature switches set by a super admin. A switch that was never set
// uses its default: Business Cards features are on, Meeting is off until a super
// admin turns it on. Super admins have everything. The server enforces the same
// keys and defaults (migration 0005 and the edge functions).
export const FEATURES = [
  { key: 'scan_ai', label: 'AI card reading', help: 'Scan fills in the card details with AI. When off, they type the details themselves.', default: true },
  { key: 'share', label: 'Share cards', help: 'Offer a card to another member.', default: true },
  { key: 'meeting', label: 'Meeting', help: 'The Meeting Minutes tab: record meetings, transcribe them and make AI minutes. Off for new accounts.', default: false },
];

export const featureDefault = (key) => FEATURES.find((f) => f.key === key)?.default ?? true;

export function featureOn(profile, key) {
  if (profile?.is_super_admin) return true;
  const v = profile?.features?.[key];
  return typeof v === 'boolean' ? v : featureDefault(key);
}
