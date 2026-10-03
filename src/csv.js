// CSV export of the current filtered list (FR-23).

const COLUMNS = [
  ['Full name', (c) => c.full_name],
  ['Job title', (c) => c.job_title],
  ['Company', (c) => c.company],
  ['Department', (c) => c.department],
  ['Emails', (c) => (c.emails || []).join('; ')],
  ['Phones', (c) => (c.phones || []).filter((p) => p && p.number).map((p) => `${p.label || 'Phone'}: ${p.number}`).join('; ')],
  ['Website', (c) => c.website],
  ['Address', (c) => c.address],
  ['City', (c) => c.city],
  ['Region / State', (c) => c.region],
  ['Country', (c) => c.country],
  ['Contact type', (c) => c.contact_type],
  ['Industry', (c) => c.industry],
  ['Business category', (c) => c.business_category],
  ['Job function', (c) => c.job_function],
  ['Seniority', (c) => c.seniority],
  ['Business opportunities', (c) => (c.opportunities || []).join('; ')],
  ['Tags', (c) => (c.tags || []).join('; ')],
  ['Relationship', (c) => c.relationship],
  ['Lead status', (c) => c.lead_status],
  ['Lead source', (c) => c.lead_source],
  ['Priority', (c) => c.priority],
  ['Last contacted', (c) => c.last_contacted_on],
  ['Next follow-up', (c) => c.next_follow_up_on],
  ['Notes', (c) => c.notes],
  ['Visibility', (c) => (c.is_private ? 'Private' : 'Shared')],
  ['Added by', (c, ownerName) => ownerName(c.created_by)],
  ['Added on', (c) => (c.created_at || '').slice(0, 10)],
];

export function csvCell(v) {
  let s = v == null ? '' : String(v);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Only shared cards and the caller's own private cards are ever exported. */
export function toCsv(contacts, { uid, ownerName = () => '' } = {}) {
  const rows = contacts.filter((c) => !c.is_private || c.created_by === uid);
  const lines = [COLUMNS.map(([h]) => csvCell(h)).join(',')];
  for (const c of rows) lines.push(COLUMNS.map(([, get]) => csvCell(get(c, ownerName))).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function downloadText(filename, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
