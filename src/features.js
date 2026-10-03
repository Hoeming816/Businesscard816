// Per-user feature switches a super admin can turn off. Unset means on; the
// server enforces the same keys (migration 0005 and the edge functions).
export const FEATURES = [
  { key: 'scan_ai', label: 'AI card reading', help: 'Scan fills in the card details with AI. When off, they type the details themselves.' },
  { key: 'share', label: 'Share cards', help: 'Offer a card to another member.' },
  { key: 'recording', label: 'Record conversations', help: 'Record meetings on a contact.' },
  { key: 'ai_minutes', label: 'AI transcription & minutes', help: 'Transcribe recordings, summarise notes and make meeting minutes.' },
  { key: 'minutes_tab', label: 'Meeting Minutes tab', help: 'The Meeting Minutes tab on the home screen.' },
];

export const featureOn = (profile, key) => profile?.features?.[key] !== false;
