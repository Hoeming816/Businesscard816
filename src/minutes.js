// Meeting minutes made by AI from a saved recording: how they are stored as a
// Note, and the plain text that goes out through the phone's share sheet.

export const MINUTES_PREFIX = 'Minutes: ';

export const isMinutes = (i) => i?.kind === 'Note' && String(i.title || '').startsWith(MINUTES_PREFIX);

/** The Note row for minutes made from recording entry `source`. */
export function minutesRow(source, ai, transcript) {
  const label = source.title && source.title !== 'Recorded conversation' ? source.title : source.kind;
  const points = (ai.key_points || []).map((p) => `• ${p}`).join('\n');
  return {
    kind: 'Note',
    occurred_on: source.occurred_on,
    title: `${MINUTES_PREFIX}${label}`,
    notes: points ? `Key points\n${points}` : null,
    summary: ai.summary || null,
    action_items: ai.action_items || [],
    transcript: transcript || null,
  };
}

/** Plain text for sharing an entry (minutes or any summarised entry). */
export function shareText(i, contact, formatDate) {
  const who = [contact?.full_name, contact?.company].filter(Boolean).join(', ');
  const lines = [i.title || i.kind, [formatDate(i.occurred_on), who].filter(Boolean).join(' · '), ''];
  if (i.summary) lines.push('Summary', i.summary, '');
  if (i.notes) lines.push(i.notes, '');
  if (i.action_items?.length) lines.push('Action items', ...i.action_items.map((a) => `• ${a}`), '');
  return lines.join('\n').trim();
}

/** Opens the share sheet (WhatsApp, email…) or copies when there is none. Returns 'shared' | 'copied' | 'cancelled'. */
export async function shareOrCopy(title, text, nav = globalThis.navigator) {
  if (nav?.share) {
    try {
      await nav.share({ title, text });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';
      // fall through to copying, e.g. share not allowed here
    }
  }
  if (!nav?.clipboard?.writeText) throw new Error('Sharing is not available on this device.');
  await nav.clipboard.writeText(text);
  return 'copied';
}
