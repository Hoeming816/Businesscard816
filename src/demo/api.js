// In-memory implementation of the src/api.js surface for the clickable demo.
// Used whenever VITE_DEMO=1 (see vite.config.js). Nothing leaves the browser.

import { PROFILES, WORKSPACES, MEMBERS, ME, buildContacts, buildHarbourContacts, buildInteractions } from './seed.js';
import { cardSvg, demoAudioUrl } from './cardArt.js';
import { todayISO, addDays } from '../filters.js';
import { canEditContact, canDeleteContact, canEditInteraction } from '../perms.js';
import { featureOn } from '../features.js';
import { parseQuickAdd } from '../todo.js';
import { looksActionable } from '../notes.js';
import { audioParts } from '../recordingParts.js';

export const isDemo = true;
export const isConfigured = true;

const clone = (v) => JSON.parse(JSON.stringify(v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tick = () => sleep(90);
let idSeq = 1000;
const newId = (p) => `${p}-${(idSeq++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const now = () => new Date().toISOString();

const db = {
  session: { id: ME },
  profiles: clone(PROFILES),
  workspaces: clone(WORKSPACES),
  members: clone(MEMBERS),
  contacts: [...buildContacts(), ...buildHarbourContacts()],
  interactions: buildInteractions(),
  blobs: new Map(), // storage path -> object URL
  shares: [],
  tasks: [],
  notes: [],
  noteTopics: [],
};
// One card waiting for Alex, so the demo shows the accept prompt.
{
  const c = db.contacts.find((x) => x.workspace_id === 'w-north' && x.created_by === 'u-maria' && !x.is_private)
    || db.contacts.find((x) => x.workspace_id === 'w-north');
  if (c) {
    db.shares.push({
      id: 's-welcome', workspace_id: 'w-north', contact_id: c.id, sender_id: 'u-maria', recipient_id: ME, status: 'pending',
      contact_name: c.full_name || '', contact_title: c.job_title || null, contact_company: c.company || null,
      new_contact_id: null, created_at: now(), responded_at: null,
    });
  }
  // And one card Alex shared that Maria accepted, for the notifications list.
  const mine = db.contacts.find((x) => x.workspace_id === 'w-north' && x.created_by === ME && x.id !== c?.id);
  if (mine) {
    const at = new Date(Date.now() - 3 * 3600e3).toISOString();
    db.shares.push({
      id: 's-replied', workspace_id: 'w-north', contact_id: mine.id, sender_id: ME, recipient_id: 'u-maria', status: 'accepted',
      contact_name: mine.full_name || '', contact_title: mine.job_title || null, contact_company: mine.company || null,
      new_contact_id: null, created_at: at, responded_at: at,
    });
  }
}
const listeners = new Set();

function deny(msg = 'You do not have permission to do that.') {
  throw new Error(msg);
}
const uid = () => db.session?.id;
function roleIn(ws) {
  const m = db.members.find((x) => x.workspace_id === ws && x.user_id === uid() && x.status === 'active');
  const w = db.workspaces.find((x) => x.id === ws);
  return m && w && w.status === 'active' ? m.role : null;
}
const visible = (c) => roleIn(c.workspace_id) && c.created_by === uid(); // owner-only, as in 0004
const profile = (id) => db.profiles.find((p) => p.id === id);
// Mirrors the server: a feature that is off for this account is refused.
function needFeature(key, label) {
  if (!featureOn(profile(uid()), key)) throw new Error(`${label} is turned off for your account. Ask your super admin.`);
}

export const usernameToEmail = (u) => `${u}@demo.cardfile.app`;

export async function getSessionUser() {
  return db.session ? { ...db.session } : null;
}
export function onAuthChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
const emit = () => listeners.forEach((cb) => cb(db.session ? { ...db.session } : null));

export async function signIn(username) {
  await sleep(300);
  const p = db.profiles.find((x) => x.username === username.trim().toLowerCase()) || profile(ME);
  if (p.status !== 'active') {
    const err = new Error('Access suspended');
    err.suspended = true;
    err.reason = p.suspended_reason || '';
    throw err;
  }
  db.session = { id: p.id };
  emit();
  return { ...db.session };
}
export async function signUp({ username, full_name }) {
  await sleep(300);
  if (!(await usernameAvailable(username))) throw new Error('That username is taken.');
  const id = newId('u');
  db.profiles.push({ id, username: username.toLowerCase(), full_name, is_super_admin: false, status: 'active', suspended_reason: null, created_at: now() });
  const ws = { id: newId('w'), name: `${full_name}'s cards`, owner_id: id, status: 'active', created_at: now() };
  db.workspaces.push(ws);
  db.members.push({ workspace_id: ws.id, user_id: id, role: 'admin', status: 'active', created_at: now() });
  db.session = { id };
  emit();
  return { id };
}
export async function usernameAvailable(username) {
  await sleep(150);
  const u = String(username || '').toLowerCase();
  return /^[a-z0-9._-]{3,30}$/.test(u) && !db.profiles.some((p) => p.username === u);
}
export function setKeepSignedIn(on) {
  db.keepSignedIn = !!on;
}
export async function signOut() {
  db.keepSignedIn = false;
  db.session = null;
  emit();
}

export async function getProfile(id) {
  await tick();
  return clone(profile(id) || null);
}
export async function updateFullName(id, full_name) {
  await tick();
  const p = profile(id);
  p.full_name = full_name;
  return clone(p);
}
export async function updatePassword(password, current) {
  await sleep(250);
  if (!current) throw new Error('Your current password is not right.');
  if (String(password).length < 8) throw new Error('Password should be at least 8 characters.');
}
export async function setPrivateAccount(id, on) {
  await tick();
  if (id !== uid()) deny();
  const p = profile(id);
  p.private_account = !!on;
  return clone(p);
}

export async function listMyWorkspaces(id) {
  await tick();
  return db.members
    .filter((m) => m.user_id === id && m.status === 'active')
    .map((m) => ({ ...db.workspaces.find((w) => w.id === m.workspace_id), role: m.role }))
    .filter((w) => w.status === 'active')
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(clone);
}
export async function createWorkspace(id, name) {
  await tick();
  const ws = { id: newId('w'), name: name.trim(), owner_id: id, status: 'active', created_at: now() };
  db.workspaces.push(ws);
  db.members.push({ workspace_id: ws.id, user_id: id, role: 'admin', status: 'active', created_at: now() });
  return { ...clone(ws), role: 'admin' };
}
export async function renameWorkspace(id, name) {
  await tick();
  if (roleIn(id) !== 'admin') deny();
  const w = db.workspaces.find((x) => x.id === id);
  w.name = name.trim();
  return clone(w);
}

function membersOf(ws) {
  return db.members.filter((m) => m.workspace_id === ws).map((m) => {
    const p = profile(m.user_id) || {};
    return { ...clone(m), username: p.username, full_name: p.full_name, profile_status: p.status };
  });
}
export async function listMembers(ws) {
  await tick();
  if (!roleIn(ws)) deny();
  return membersOf(ws);
}
export async function addMember(ws, username, role) {
  await sleep(200);
  if (roleIn(ws) !== 'admin') deny('only workspace admins can add members');
  const p = db.profiles.find((x) => x.username === username.trim().toLowerCase());
  if (!p) throw new Error(`no account with username "${username}" — they need to sign up first`);
  const w = db.workspaces.find((x) => x.id === ws);
  if (w.owner_id === p.id) throw new Error('that person owns this workspace');
  const existing = db.members.find((m) => m.workspace_id === ws && m.user_id === p.id);
  if (p.private_account && existing?.status !== 'active') throw new Error(`no account with username "${username}" — they need to sign up first`);
  if (existing?.status === 'active') existing.role = role;
  else if (existing) Object.assign(existing, { role, status: 'invited', added_by: uid(), created_at: now() });
  else db.members.push({ workspace_id: ws, user_id: p.id, role, status: 'invited', added_by: uid(), created_at: now() });
}
export async function listMyInvites() {
  await tick();
  return db.members
    .filter((m) => m.user_id === uid() && m.status === 'invited')
    .map((m) => {
      const w = db.workspaces.find((x) => x.id === m.workspace_id);
      const by = profile(m.added_by) || profile(w?.owner_id) || {};
      return w?.status === 'active'
        ? { workspace_id: w.id, workspace_name: w.name, inviter_name: by.full_name || by.username, role: m.role, invited_at: m.created_at }
        : null;
    })
    .filter(Boolean);
}
export async function respondInvite(ws, accept) {
  await sleep(200);
  const m = db.members.find((x) => x.workspace_id === ws && x.user_id === uid() && x.status === 'invited');
  if (!m) throw new Error('This invitation is no longer open.');
  if (accept) m.status = 'active';
  else db.members = db.members.filter((x) => x !== m);
}
function guardMember(ws, userId) {
  const w = db.workspaces.find((x) => x.id === ws);
  const su = profile(uid())?.is_super_admin;
  if (!su && roleIn(ws) !== 'admin' && userId !== uid()) deny();
  if (!su && w.owner_id === userId) deny('the workspace owner cannot be removed or demoted');
}
export async function updateMember(ws, userId, patch) {
  await tick();
  guardMember(ws, userId);
  const row = db.members.find((m) => m.workspace_id === ws && m.user_id === userId);
  if (row?.status === 'invited' && patch.status === 'active') deny('They join when they accept the invitation.');
  if (patch.role && userId === uid()) deny('you cannot change your own role');
  Object.assign(db.members.find((m) => m.workspace_id === ws && m.user_id === userId), patch);
}
export async function removeMember(ws, userId) {
  await tick();
  guardMember(ws, userId);
  db.members = db.members.filter((m) => !(m.workspace_id === ws && m.user_id === userId));
}

export async function listContacts(ws) {
  await sleep(200);
  return db.contacts.filter((c) => c.workspace_id === ws && visible(c)).map(clone);
}
export async function getContact(id) {
  await tick();
  const c = db.contacts.find((x) => x.id === id);
  return c && visible(c) ? clone(c) : null;
}
export async function insertContact(row) {
  await sleep(200);
  const r = roleIn(row.workspace_id);
  if (r !== 'admin' && r !== 'editor') deny();
  const c = {
    emails: [], phones: [], opportunities: [], tags: [],
    ...clone(row), is_private: true, id: newId('c'), created_by: uid(), created_at: now(), updated_at: now(),
  };
  db.contacts.push(c);
  return clone(c);
}
export async function updateContact(id, patch) {
  await tick();
  const c = db.contacts.find((x) => x.id === id);
  if (!c || !canEditContact(c, roleIn(c.workspace_id), uid())) deny();
  if (patch.created_by && patch.created_by !== c.created_by) deny('a card cannot change owner');
  if (patch.is_private === false) deny('cards are only visible to their owner');
  Object.assign(c, clone(patch), { updated_at: now() });
  return visible(c) ? clone(c) : null;
}
export async function deleteContact(contact) {
  await sleep(200);
  const c = db.contacts.find((x) => x.id === contact.id);
  if (!c || !canDeleteContact(c, roleIn(c.workspace_id), uid())) deny();
  db.contacts = db.contacts.filter((x) => x.id !== c.id);
  db.interactions = db.interactions.filter((i) => i.contact_id !== c.id);
}
export async function uploadCardPhoto(ws, contactId, side, blob) {
  await sleep(250);
  const path = `${ws}/${contactId}/${side}-${Date.now()}.jpg`;
  db.blobs.set(path, URL.createObjectURL(blob));
  return path;
}
export async function removeStorageObjects(_bucket, paths) {
  for (const p of paths) db.blobs.delete(p);
}

// --------------------------------------------------------------------------- sharing
const canReceive = (ws, member) => {
  const m = db.members.find((x) => x.workspace_id === ws && x.user_id === member && x.status === 'active');
  return m && ['admin', 'editor'].includes(m.role) && profile(member)?.status === 'active';
};
const shareOut = (s) => {
  const p = profile(s.sender_id) || {};
  return { ...clone(s), sender_name: p.full_name || p.username || 'A member' };
};
export async function listShareReplies(me) {
  await tick();
  return db.shares
    .filter((s) => s.sender_id === me && ['accepted', 'declined'].includes(s.status))
    .sort((a, b) => (b.responded_at || '').localeCompare(a.responded_at || ''))
    .slice(0, 20)
    .map((s) => { const r = profile(s.recipient_id) || {}; return { ...shareOut(s), recipient_name: r.full_name || r.username || 'A member' }; });
}
export async function shareContact(contact, recipientId) {
  needFeature('share', 'Sharing');
  await sleep(200);
  const c = db.contacts.find((x) => x.id === contact.id);
  if (!c || !visible(c)) deny();
  if (recipientId === uid() || !canReceive(c.workspace_id, recipientId)) deny('You can only share with editors and admins of this workspace.');
  if (db.shares.some((s) => s.contact_id === c.id && s.recipient_id === recipientId && s.status === 'pending')) {
    throw new Error('This card is already waiting for their answer.');
  }
  const s = {
    id: newId('s'), workspace_id: c.workspace_id, contact_id: c.id, sender_id: uid(), recipient_id: recipientId,
    status: 'pending', contact_name: c.full_name || '', contact_title: c.job_title || null, contact_company: c.company || null,
    new_contact_id: null, created_at: now(), responded_at: null,
  };
  db.shares.push(s);
  return shareOut(s);
}
export async function listContactShares(contactId) {
  await tick();
  return db.shares.filter((s) => s.contact_id === contactId && [s.sender_id, s.recipient_id].includes(uid()))
    .sort((a, b) => b.created_at.localeCompare(a.created_at)).map(shareOut);
}
export async function listIncomingShares(me) {
  await tick();
  return db.shares.filter((s) => s.recipient_id === me && s.status === 'pending' && roleIn(s.workspace_id)).map(shareOut);
}
export async function acceptShare(share) {
  await sleep(300);
  const s = db.shares.find((x) => x.id === share.id);
  if (!s || s.recipient_id !== uid()) deny('Share not found.');
  if (s.status !== 'pending') throw new Error('This share was already answered.');
  if (!canReceive(s.workspace_id, uid())) deny('You need editor access to this workspace to accept cards.');
  const c = db.contacts.find((x) => x.id === s.contact_id);
  if (!c) throw new Error('The card is no longer available.');
  const keep = ['full_name', 'job_title', 'company', 'department', 'emails', 'phones', 'website', 'address', 'city', 'region',
    'country', 'card_text', 'contact_type', 'industry', 'business_category', 'job_function', 'seniority', 'opportunities', 'tags',
    'front_path', 'back_path', 'face_path'];
  const copy = { id: newId('c'), workspace_id: c.workspace_id, created_by: uid(), is_private: true, created_at: now(), updated_at: now() };
  for (const k of keep) copy[k] = clone(c[k] ?? null);
  db.contacts.push(copy);
  Object.assign(s, { status: 'accepted', new_contact_id: copy.id, responded_at: now() });
  return clone(copy);
}
export async function closeShare(shareId) {
  await tick();
  const s = db.shares.find((x) => x.id === shareId);
  if (!s || ![s.sender_id, s.recipient_id].includes(uid())) deny('Share not found.');
  if (s.status !== 'pending') throw new Error('This share was already answered.');
  s.status = s.recipient_id === uid() ? 'declined' : 'cancelled';
  s.responded_at = now();
  return s.status;
}

let audioUrl = null;
function urlFor(path) {
  if (!path) return null;
  if (db.blobs.has(path)) return db.blobs.get(path);
  const m = /^demo\/([^/]+)\/(front|back)\.svg$/.exec(path);
  if (m) {
    const c = db.contacts.find((x) => x.id === m[1]);
    return c ? cardSvg(c, m[2]) : null;
  }
  if (path.startsWith('demo-audio/')) {
    if (!audioUrl) audioUrl = demoAudioUrl(4);
    return audioUrl;
  }
  return null;
}
export async function signUrls(_bucket, paths) {
  await tick();
  const out = {};
  for (const p of paths) {
    const u = urlFor(p);
    if (u) out[p] = u;
  }
  return out;
}
export async function signUrl(_bucket, path) {
  await tick();
  return urlFor(path);
}

export async function scanCard(front) {
  needFeature('scan_ai', 'AI card reading');
  await sleep(1400);
  if (!front) throw new Error('A front photo is required.');
  return {
    full_name: 'Daniel Ong',
    job_title: 'Head of Infrastructure',
    company: 'Sentosa Data Centres Pte Ltd',
    department: 'Infrastructure & Facilities',
    emails: ['daniel.ong@sentosadc.example.com'],
    phones: [{ label: 'Mobile', number: '+65 9555 4821' }, { label: 'Office', number: '+65 6555 1200' }],
    website: 'www.sentosadc.example.com',
    address: '8 Harbourfront Walk, #05-02',
    city: 'Singapore',
    region: 'Central Region',
    country: 'Singapore',
    contact_type: 'Prospect',
    industry: 'IT',
    business_category: 'End User',
    job_function: 'IT',
    seniority: 'Director',
    opportunities: ['Structured Cabling', 'Network', 'Maintenance'],
    tags: ['data-centre', 'expo'],
    card_text: 'SENTOSA DATA CENTRES\nDaniel Ong\nHead of Infrastructure\nInfrastructure & Facilities\n8 Harbourfront Walk, #05-02, Singapore\nM +65 9555 4821  T +65 6555 1200\ndaniel.ong@sentosadc.example.com\nwww.sentosadc.example.com',
  };
}

export async function listInteractions(contactId) {
  await tick();
  const c = db.contacts.find((x) => x.id === contactId);
  if (!c || !visible(c)) return [];
  return db.interactions
    .filter((i) => i.contact_id === contactId)
    .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at))
    .map(clone);
}
export async function listWorkspaceInteractions(ws, limit = 500) {
  await tick();
  const seen = new Set(db.contacts.filter((c) => c.workspace_id === ws && visible(c)).map((c) => c.id));
  return db.interactions
    .filter((i) => seen.has(i.contact_id) || (!i.contact_id && i.workspace_id === ws && i.created_by === uid()))
    .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at))
    .slice(0, limit)
    .map(clone);
}
function bump(i) {
  if (i.kind === 'Note') return;
  const c = db.contacts.find((x) => x.id === i.contact_id);
  if (c && (!c.last_contacted_on || c.last_contacted_on < i.occurred_on)) c.last_contacted_on = i.occurred_on;
}
export async function insertInteraction(row) {
  await sleep(200);
  const c = row.contact_id ? db.contacts.find((x) => x.id === row.contact_id) : null;
  if (row.contact_id ? !c || !canEditContact(c, roleIn(c.workspace_id), uid()) : !roleIn(row.workspace_id)) deny();
  const i = {
    action_items: [], title: null, notes: null, transcript: null, summary: null, audio_path: null, duration_sec: null,
    meeting_type: null, minutes: null, segments: null,
    ...clone(row), id: newId('i'), contact_id: c ? c.id : null, workspace_id: c ? c.workspace_id : row.workspace_id,
    created_by: uid(), created_at: now(), updated_at: now(),
  };
  db.interactions.push(i);
  bump(i);
  return clone(i);
}
export async function updateInteraction(id, patch) {
  await tick();
  const i = db.interactions.find((x) => x.id === id);
  const c = db.contacts.find((x) => x.id === i?.contact_id);
  if (!i || !canEditInteraction(i, c, c && roleIn(c.workspace_id), uid())) deny();
  const { created_by: _a, contact_id: _b, workspace_id: _c, ...rest } = clone(patch);
  Object.assign(i, rest, { updated_at: now() });
  bump(i);
  return clone(i);
}
export async function deleteInteraction(interaction) {
  await tick();
  const i = db.interactions.find((x) => x.id === interaction.id);
  const c = db.contacts.find((x) => x.id === i?.contact_id);
  if (!i || !canEditInteraction(i, c, c && roleIn(c.workspace_id), uid())) deny();
  for (const p of audioParts(i)) db.blobs.delete(p);
  db.interactions = db.interactions.filter((x) => x.id !== i.id);
}
export async function uploadRecording(ws, contactId, interactionId, blob, ext, part = 0) {
  needFeature('meeting', 'Meeting');
  await sleep(250);
  // The time in the name is when it was recorded; a long recording's later parts add -p2, -p3…
  const path = `${ws}/${contactId}/${interactionId}${part ? `-p${part + 1}` : ''}-${Date.now()}.${ext}`;
  db.blobs.set(path, URL.createObjectURL(blob));
  return path;
}
export async function downloadRecording(path) {
  await tick();
  const url = urlFor(path);
  if (!url) throw new Error('Could not load the recording');
  return (await fetch(url)).blob();
}
// A Taglish meeting, as the live app shows it: in the chosen language, with what was said kept as "orig".
const DEMO_LINES = [
  [0, 'Thanks for making the time today. Let us go through the fibre rollout for the two Singapore sites.', 'Salamat sa oras ninyo ngayon. Pag-usapan natin ang fibre rollout para sa dalawang Singapore sites.', '谢谢大家今天抽空。我们来讨论两个新加坡站点的光纤部署。'],
  [7.5, 'Peter, can you submit the bill of materials by Wednesday?', 'Peter, kaya mo bang i-submit ang bill of materials bago mag-Wednesday?', 'Peter，你能在星期三之前提交物料清单吗？'],
  [12, 'Yes, I will submit the BOM by Wednesday.', 'Oo, ipapasa ko ang BOM sa Wednesday.', '可以，我会在星期三之前提交 BOM。'],
  [16.5, 'We agreed to proceed with Supplier A for the fibre.', 'Napagkasunduan natin na ituloy sa Supplier A para sa fibre.', '我们同意光纤采用 Supplier A。'],
  [22, 'Installation manpower goes from six to eight technicians so we finish before Friday.', 'Gagawin nating walo ang technicians mula anim para matapos bago mag-Friday.', '安装人员从六名技术员增加到八名，以便在星期五前完成。'],
  [29, 'Engineering will complete the T3 site survey by the tenth.', 'Tatapusin ng Engineering ang T3 site survey bago mag-tenth.', '工程部将在十号之前完成 T3 现场勘查。'],
  [34.5, 'The client still has to approve the revised layout, which is a risk to the schedule.', 'Kailangan pang i-approve ng client ang revised layout, risk ito sa schedule.', '客户仍需批准修改后的布局，这对进度是个风险。'],
  [41, 'Let us meet again next Monday to check progress.', 'Magkita ulit tayo sa Monday para i-check ang progress.', '下星期一再开会检查进度。'],
];
const demoLine = (output) => ([t, en, orig, zh]) => (output === 'Tagalog' ? { t, text: orig } : { t, text: output === 'Chinese' ? zh : en, orig });

export async function transcribe(_blob, _language, _ext, output = 'English') {
  needFeature('meeting', 'Meeting');
  await sleep(1500);
  const segments = DEMO_LINES.map(demoLine(output));
  return { text: segments.map((x) => x.text).join(' '), segments, language: 'Tagalog' };
}
export async function translateTranscript(segments, output) {
  needFeature('meeting', 'Meeting');
  await sleep(800);
  const out = segments.map((x) => {
    const d = DEMO_LINES.find(([t]) => t === x.t);
    return d ? demoLine(output)(d) : x;
  });
  return { text: out.map((x) => x.text).join(' '), segments: out };
}
export async function summarise({ contact, today, notes, transcript }) {
  needFeature('meeting', 'Meeting');
  await sleep(1400);
  const t = today || todayISO();
  const next = { New: 'Contacted', Contacted: 'Qualified', Qualified: 'Proposal Sent', 'Proposal Sent': 'Negotiating' };
  const source = String(notes || transcript || '').trim().replace(/\s+/g, ' ');
  const gist = (source.length > 160 ? `${source.slice(0, 157)}…` : source).replace(/[.!?]+$/, '');
  return {
    summary: `${contact?.full_name ? `${contact.full_name} (${contact.company || 'their company'})` : 'The meeting'} covered the points in your notes: "${gist}". `
      + 'They are open to a site survey followed by a written proposal, and the next step is to confirm scope, timeline and the budget owner. '
      + '(Demo summary: the live app writes this with Claude.)',
    key_points: ['Network refresh planned across two Singapore sites next year', 'Ageing core switches and patchy Wi-Fi on the operations floor', 'Proposal wanted by the end of the month, site survey first'],
    action_items: ['Book a site survey for next week', 'Send a scoped proposal with pricing', 'Confirm decision timeline and budget owner'],
    follow_up_on: addDays(t, 7),
    lead_status: next[contact?.lead_status] || 'Qualified',
  };
}

export async function meetingMinutes({ meeting_type, date, earlier_actions = [] }) {
  needFeature('meeting', 'Meeting');
  await sleep(1800);
  const d = date || todayISO();
  return {
    quick_summary: [
      `This ${String(meeting_type || 'meeting').toLowerCase()} reviewed the fibre rollout for the two Singapore sites.`,
      'Supplier A was chosen for the fibre.',
      'Installation crew goes from six to eight technicians to finish before Friday.',
      'Peter submits the bill of materials by Wednesday.',
      'Engineering completes the T3 site survey by the tenth.',
      'Client approval of the revised layout is still pending and is a schedule risk.',
      '(Demo minutes: the live app writes these with Claude.)',
    ],
    chairperson: 'Alex',
    attendees: ['Alex', 'Peter', 'Engineering', 'Sales'],
    location: '',
    agenda: ['Fibre supplier', 'Installation manpower and schedule', 'Site survey', 'Client approval'],
    discussion: [
      { topic: 'Fibre supplier', points: ['Supplier A offers the best lead time.'] },
      { topic: 'Installation manpower and schedule', points: ['Six technicians cannot finish before Friday.', 'Two more technicians will be assigned.'] },
      { topic: 'Site survey', points: ['T3 survey still to be done by Engineering.'] },
      { topic: 'Client approval', points: ['The revised layout is waiting on the client.'] },
    ],
    decisions: ['Proceed with Supplier A.', 'Increase installation manpower from six to eight technicians.'],
    action_items: [
      { action: 'Submit the bill of materials', assigned_to: 'Peter', due: addDays(d, 2), priority: 'High' },
      { action: 'Complete the T3 site survey', assigned_to: 'Engineering', due: addDays(d, 7), priority: 'Medium' },
      { action: 'Get client approval of the revised layout', assigned_to: 'Sales', due: '', priority: 'High' },
    ],
    issues: ['Client approval of the revised layout could delay installation.'],
    next_steps: ['Confirm fibre delivery dates with Supplier A.'],
    next_meeting: addDays(d, 7),
    follow_up: earlier_actions.slice(0, 2).map((a, k) => (k === 0
      ? { ref: a.ref, status: 'completed', note: 'Reported done at this meeting.' }
      : { ref: a.ref, status: 'discussed', note: 'Still in progress.' })),
  };
}

export async function askMeeting({ question, minutes }) {
  needFeature('meeting', 'Meeting');
  await sleep(1200);
  const acts = (minutes?.action_items || []).map((a) => `• ${a.action}: ${a.assigned_to || 'not assigned'}${a.due ? `, due ${a.due}` : ''}`).join('\n');
  return `(Demo answer: the live app asks Claude.) You asked: "${question}". From this meeting's action items:\n${acts || 'none were recorded.'}`;
}

// ---------------------------------------------------------------------------
// To Do List (rules as in migration 0011)
// ---------------------------------------------------------------------------

const teammate = (other) => db.members.some((a) => a.user_id === uid() && a.status === 'active'
  && db.members.some((b) => b.workspace_id === a.workspace_id && b.user_id === other && b.status === 'active' && other !== uid())
  && db.workspaces.find((w) => w.id === a.workspace_id)?.status === 'active');
const nameOf = (id) => { const p = profile(id); return p ? (p.full_name || p.username) : ''; };
const canSeeTask = (t) => t.created_by === uid() || (t.assignee_id === uid() && teammate(t.created_by));
{
  const today = todayISO();
  const seed = [
    { title: 'Send quotation to Harbour Logistics', priority: 'High', due_on: addDays(today, -2), tags: ['quotation'], category: 'Work', reminders: [0] },
    { title: 'Call Peter about the CCTV order', priority: 'Urgent', due_on: today, due_time: '10:00', reminders: [15, 0], category: 'Work' },
    { title: 'Pay office rent', due_on: today, repeat: { freq: 'monthly', interval: 1, day: Number(today.slice(8)) }, category: 'Finance', reminders: [0] },
    { title: 'Prepare site survey checklist', status: 'in_progress', my_day_on: addDays(today, -1), category: 'Work',
      subtasks: [{ id: 'k1', text: 'Floor plan', done: true }, { id: 'k2', text: 'Camera points', done: false }, { id: 'k3', text: 'Cable routes', done: false }] },
    { title: 'Weekly sales report', due_on: addDays(today, 3), due_time: '17:00', repeat: { freq: 'weekly', interval: 1 }, reminders: [60, 0], category: 'Work' },
    { title: 'Book flights for Cebu trip', due_on: addDays(today, 9), category: 'Personal', tags: ['travel'], priority: 'Low' },
    { title: 'Follow up the switch delivery', status: 'waiting', due_on: addDays(today, 1), assignee_id: 'u-maria', category: 'Work', notes: 'Supplier promised Thursday.' },
    { title: 'Renew car insurance', notes: 'Compare at least two quotes.', category: 'Personal' },
    { title: 'Check stock count', status: 'done', due_on: today, completed_at: new Date(Date.now() - 3600e3).toISOString() },
  ];
  seed.forEach((t, i) => db.tasks.push({
    id: `t-${i + 1}`, created_by: ME, notes: null, priority: 'Normal', status: 'todo', due_on: null, due_time: null, reminders: [], repeat: null,
    subtasks: [], category: null, tags: [], my_day_on: null, assignee_id: null, assignee_name: null, assigned_by_name: null, assigned_at: null,
    completed_at: null, done_count: 0, created_at: new Date(Date.now() - (20 - i) * 3600e3).toISOString(), updated_at: now(), ...t,
    ...(t.assignee_id ? { assignee_name: nameOf(t.assignee_id), assigned_by_name: nameOf(ME), assigned_at: now() } : {}),
  }));
  db.tasks.push({
    id: 't-from-maria', created_by: 'u-maria', title: 'Check the Acme proposal numbers', notes: 'Prices on page 3 look off.', priority: 'High', status: 'todo',
    due_on: addDays(today, 2), due_time: null, reminders: [0], repeat: null, subtasks: [], category: 'Work', tags: ['acme'], my_day_on: null,
    assignee_id: ME, assignee_name: nameOf(ME), assigned_by_name: nameOf('u-maria'), assigned_at: now(), completed_at: null, done_count: 0,
    created_at: now(), updated_at: now(),
  });
}

function taskRules(t, prev) {
  if (!String(t.title || '').trim()) deny('A task needs a title.');
  if (t.due_time && !t.due_on) deny('A time needs a date.');
  if (t.repeat && !t.due_on) deny('A repeating task needs a date.');
  if (!prev || t.assignee_id !== prev.assignee_id) {
    if (t.assignee_id) {
      if (!teammate(t.assignee_id)) deny('You can only give tasks to people in your team.');
      if (!featureOn(profile(t.assignee_id), 'todo')) deny('They do not have the To Do List yet. Ask your super admin to turn it on for them.');
      Object.assign(t, { assignee_name: nameOf(t.assignee_id), assigned_by_name: nameOf(t.created_by), assigned_at: now() });
    } else Object.assign(t, { assignee_name: null, assigned_by_name: null, assigned_at: null });
  }
  if (!prev) t.completed_at = t.status === 'done' ? now() : null;
  else if ((t.done_count || 0) > (prev.done_count || 0) || (t.status === 'done' && prev.status !== 'done')) t.completed_at = now();
  else if (t.status !== 'done' && prev.status === 'done') t.completed_at = null;
}

export async function listTasks() {
  await tick();
  return clone(db.tasks.filter(canSeeTask));
}
export async function insertTask(row) {
  await tick();
  needFeature('todo', 'To Do List');
  const t = {
    id: newId('t'), notes: null, priority: 'Normal', status: 'todo', due_on: null, due_time: null, reminders: [], repeat: null, subtasks: [],
    category: null, tags: [], my_day_on: null, assignee_id: null, done_count: 0, created_at: now(), ...clone(row), created_by: uid(), updated_at: now(),
  };
  taskRules(t, null);
  db.tasks.push(t);
  return clone(t);
}
export async function updateTask(id, patch) {
  await tick();
  const t = db.tasks.find((x) => x.id === id && canSeeTask(x));
  if (!t) deny('That task is no longer there.');
  const next = { ...t, ...clone(patch), id: t.id, created_by: t.created_by, updated_at: now() };
  if (t.created_by !== uid()) {
    const locked = ['title', 'notes', 'priority', 'reminders', 'repeat', 'category', 'tags', 'my_day_on', 'assignee_id'];
    if (!t.repeat) locked.push('due_on', 'due_time');
    if (locked.some((k) => k in patch && JSON.stringify(patch[k]) !== JSON.stringify(t[k]))) {
      deny('Only the person who gave you this task can change it. You can update its status and checklist.');
    }
  }
  taskRules(next, t);
  Object.assign(t, next);
  return clone(t);
}
export async function deleteTask(id) {
  await tick();
  const i = db.tasks.findIndex((x) => x.id === id && x.created_by === uid());
  if (i === -1) deny('Only the person who made a task can delete it.');
  db.tasks.splice(i, 1);
}
const demoClock = (clock) => {
  const [y, m, d] = String(clock?.today || todayISO()).split('-').map(Number);
  const [hh, mm] = String(clock?.time || '09:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm);
};
export async function aiTask(text, clock) {
  needFeature('todo', 'To Do List');
  await sleep(700);
  const { found: _found, ...task } = parseQuickAdd(text, demoClock(clock));
  return { ...task, notes: '', subtasks: [] };
}
export async function voiceTask(_blob, _ext, clock, _language) {
  needFeature('todo', 'To Do List');
  await sleep(1200);
  const text = 'Remind me to send the quotation to Acme on Friday at 3pm, high priority';
  return { text, task: await aiTask(text, clock) };
}

// ---------------------------------------------------------------------------
// Quick Notes (rules as in migration 0012: only ever the owner's own)
// ---------------------------------------------------------------------------

{
  const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  const topic = (id, name, color, h) => ({ id, created_by: ME, name, color, created_at: ago(h), updated_at: ago(h) });
  db.noteTopics.push(topic('nt-1', 'Cebu trip', 'blue', 50), topic('nt-2', 'Acme project', 'green', 80));
  const note = (n, h) => ({
    id: newId('n'), created_by: ME, topic_id: null, title: null, body: '', checklist: [], tags: [], color: null, files: [], pinned: false,
    archived_at: null, deleted_at: null, created_at: ago(h), updated_at: ago(h), ...n,
  });
  db.notes.push(
    note({ title: 'Wi-Fi at the warehouse', body: 'Network: AspenWH-5G\nPassword: on the router label', pinned: true, color: 'yellow', tags: ['Work'] }, 30),
    note({ body: 'Idea: send customers a monthly CCTV health check report #Idea', tags: ['Idea'] }, 2),
    note({ topic_id: 'nt-1', title: 'Packing', checklist: [{ id: 'c1', text: 'Passport', done: true }, { id: 'c2', text: 'Chargers', done: false }, { id: 'c3', text: 'Sunscreen', done: false }] }, 20),
    note({ topic_id: 'nt-1', body: 'Hotel: Mango Suites, check-in 2pm. Booking ref MS-44821.' }, 26),
    note({ topic_id: 'nt-2', title: 'Kick-off call', body: 'Peter wants 24 cameras across 3 floors. Quote by Friday.', tags: ['Customer'], color: 'green' }, 6),
    note({ body: 'Old parking spot number: B2-117' }, 400),
  );
  db.notes[db.notes.length - 1].archived_at = ago(300);
}

const myNote = (id) => db.notes.find((n) => n.id === id && n.created_by === uid());
const myTopic = (id) => db.noteTopics.find((t) => t.id === id && t.created_by === uid());
function noteRules(n) {
  if (n.topic_id && !myTopic(n.topic_id)) deny('That topic is not there any more.');
  if (n.color && !['yellow', 'green', 'blue', 'pink', 'purple', 'grey'].includes(n.color)) deny('Unknown colour.');
}
function topicRules(t) {
  const name = String(t.name || '').trim();
  if (!name) deny('Give the topic a name.');
  const key = name.toLowerCase();
  if (db.noteTopics.some((x) => x.id !== t.id && x.created_by === uid() && x.name.trim().toLowerCase() === key)) deny('You already have a topic with that name.');
}

export async function listNotes() {
  await tick();
  return clone(db.notes.filter((n) => n.created_by === uid()));
}
export async function insertNote(row) {
  await tick();
  needFeature('notes', 'Quick Notes');
  const n = {
    id: newId('n'), topic_id: null, title: null, body: '', checklist: [], tags: [], color: null, files: [], pinned: false,
    archived_at: null, deleted_at: null, created_at: now(), ...clone(row), created_by: uid(), updated_at: now(),
  };
  noteRules(n);
  db.notes.push(n);
  return clone(n);
}
export async function updateNote(id, patch) {
  await tick();
  const n = myNote(id);
  if (!n) deny('That note is no longer there.');
  const next = { ...n, ...clone(patch), id: n.id, created_by: n.created_by, updated_at: now() };
  noteRules(next);
  Object.assign(n, next);
  return clone(n);
}
export async function deleteNoteForever(note) {
  await tick();
  const i = db.notes.findIndex((n) => n.id === note.id && n.created_by === uid());
  if (i === -1) deny('That note is no longer there.');
  for (const f of db.notes[i].files || []) db.blobs.delete(f.path);
  db.notes.splice(i, 1);
}
export async function uploadNoteFile(ownerId, noteId, blob, name) {
  await tick();
  needFeature('notes', 'Quick Notes');
  if (ownerId !== uid()) deny();
  const path = `${ownerId}/${noteId}/${Date.now().toString(36)}-${name}`;
  db.blobs.set(path, URL.createObjectURL(blob));
  return { path, name, type: blob.type || 'application/octet-stream', size: blob.size };
}
export async function listNoteTopics() {
  await tick();
  return clone(db.noteTopics.filter((t) => t.created_by === uid()).sort((a, b) => a.name.localeCompare(b.name)));
}
export async function insertNoteTopic(row) {
  await tick();
  needFeature('notes', 'Quick Notes');
  const t = { id: newId('nt'), color: null, created_at: now(), ...clone(row), created_by: uid(), updated_at: now() };
  topicRules(t);
  db.noteTopics.push(t);
  return clone(t);
}
export async function updateNoteTopic(id, patch) {
  await tick();
  const t = myTopic(id);
  if (!t) deny('That topic is no longer there.');
  const next = { ...t, ...clone(patch), id: t.id, created_by: t.created_by, updated_at: now() };
  topicRules(next);
  Object.assign(t, next);
  return clone(t);
}
export async function deleteNoteTopic(id) {
  await tick();
  if (!myTopic(id)) deny('That topic is no longer there.');
  db.noteTopics = db.noteTopics.filter((t) => t.id !== id);
  for (const n of db.notes) if (n.topic_id === id) n.topic_id = null;
}
// The demo can't listen, so it pretends: the first recording asks for a new topic,
// the next ones add notes.
let demoVoiceTurn = 0;
export async function voiceNote(_blob, _ext, _language, _topics, inTopic = '', _clock = {}) {
  needFeature('notes', 'Quick Notes');
  await sleep(1200);
  const turn = demoVoiceTurn++;
  if (!inTopic && turn % 2 === 0) {
    const text = 'Create a new topic, call it "Inventory Management software".';
    return { text, result: { action: 'topic', topic: 'Inventory Management software', title: '', body: '', checklist: [], tags: [], actions: [] } };
  }
  const text = 'Idea for the inventory system. We should have an alert when stock falls below minimum quantity and automatically notify purchasing. Need to call James tomorrow about the scanner quotation.';
  const todo = featureOn(profile(uid()), 'todo');
  return {
    text,
    result: {
      action: 'note', topic: inTopic || 'Inventory Management software', title: 'Inventory System Idea',
      body: 'Add a minimum-stock alert. When inventory falls below the preset quantity, automatically notify Purchasing. Call James tomorrow about the scanner quotation.',
      checklist: [], tags: ['Idea'],
      actions: todo ? [{ title: 'Call James about the scanner quotation', due_on: addDays(todayISO(), 1), due_time: null }] : [],
    },
  };
}
export async function cleanUpNote(title, body) {
  needFeature('notes', 'Quick Notes');
  await sleep(900);
  // The demo splits on "and" and commas; the live app asks Claude.
  const parts = String(body || '').split(/\s*(?:,|;|\n|\band\b|\balso\b)\s*/i).map((x) => x.trim()).filter(Boolean);
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  return { title: String(title || '').trim() || cap(parts[0] || 'Note').slice(0, 40), body: parts.map((x) => `• ${cap(x)}`).join('\n') };
}
export async function noteActions(text, clock) {
  needFeature('notes', 'Quick Notes');
  needFeature('todo', 'To Do List');
  await sleep(600);
  // The demo reads each sentence that looks like a to-do with the To Do List's quick parser.
  return String(text || '').split(/(?<=[.!?\n])\s*/).filter((x) => looksActionable(x)).slice(0, 5).map((sentence) => {
    const t = parseQuickAdd(sentence.replace(/^(i\s+)?(need|have|must|got)\s+to\s+|^remember\s+to\s+|^remind me to\s+/i, ''), demoClock(clock));
    const title = t.title.replace(/[.!?]+$/, '');
    return { title: title.charAt(0).toUpperCase() + title.slice(1), due_on: t.due_on, due_time: t.due_time };
  });
}
export async function dictateNote(_blob, _ext, _language) {
  needFeature('notes', 'Quick Notes');
  await sleep(1000);
  return 'Also check whether they support stock counts on a phone.';
}

function requireSuper() {
  if (!profile(uid())?.is_super_admin) deny('super admin only');
}
export async function adminListProfiles() {
  await tick();
  requireSuper();
  return clone([...db.profiles].sort((a, b) => b.created_at.localeCompare(a.created_at)));
}
export async function adminSetFeatures(userId, features) {
  await tick();
  requireSuper();
  const p = profile(userId);
  if (!p) throw new Error('No such account.');
  p.features = clone(features);
  return { id: p.id, features: clone(p.features) };
}
export async function adminUserAction(action, userId, extra = {}) {
  await sleep(300);
  requireSuper();
  if (userId === uid() && (action === 'delete' || action === 'purge')) throw new Error('You cannot delete your own account.');
  if (userId === uid() && action !== 'reset_password') throw new Error('You cannot suspend yourself.');
  const p = profile(userId);
  if (!p) throw new Error('No such account.');
  if (action === 'delete') {
    if (p.is_super_admin && db.profiles.filter((x) => x.is_super_admin && x.status === 'active').length <= 1) throw new Error('You cannot delete the last super admin.');
    Object.assign(p, { status: 'deleted', deleted_at: now() });
    return;
  }
  if (action === 'purge') {
    if (p.status !== 'deleted') throw new Error('Delete the account first.');
    if (String(extra.confirm_username || '').trim().toLowerCase() !== p.username) throw new Error(`Type ${p.username} to confirm.`);
    // Mirrors admin-users: shared workspaces pass to you, everything else of theirs goes.
    const gone = new Set();
    for (const w of db.workspaces.filter((x) => x.owner_id === userId)) {
      if (db.members.some((m) => m.workspace_id === w.id && m.user_id !== userId)) {
        w.owner_id = uid();
        const mine = db.members.find((m) => m.workspace_id === w.id && m.user_id === uid());
        if (mine) Object.assign(mine, { role: 'admin', status: 'active' });
        else db.members.push({ workspace_id: w.id, user_id: uid(), role: 'admin', status: 'active', created_at: now() });
      } else gone.add(w.id);
    }
    const lost = new Set(db.contacts.filter((c) => c.created_by === userId || gone.has(c.workspace_id)).map((c) => c.id));
    db.interactions = db.interactions.filter((i) => i.created_by !== userId && !lost.has(i.contact_id) && !gone.has(i.workspace_id));
    db.contacts = db.contacts.filter((c) => !lost.has(c.id));
    db.shares = db.shares.filter((x) => x.sender_id !== userId && x.recipient_id !== userId);
    db.members = db.members.filter((m) => m.user_id !== userId && !gone.has(m.workspace_id));
    db.workspaces = db.workspaces.filter((w) => !gone.has(w.id));
    db.profiles = db.profiles.filter((x) => x.id !== userId);
    return;
  }
  if (action === 'suspend') Object.assign(p, { status: 'suspended', suspended_reason: extra.reason || null });
  else if (action === 'reinstate') Object.assign(p, { status: 'active', suspended_reason: null, deleted_at: null });
  else if (action === 'reset_password') {
    if (!extra.password || extra.password.length < 8) throw new Error('Password should be at least 8 characters.');
  } else throw new Error('Unknown action');
}
export async function adminListWorkspaces() {
  await tick();
  requireSuper();
  return db.workspaces
    .map((w) => {
      const o = profile(w.owner_id) || {};
      return {
        ...clone(w),
        owner_username: o.username, owner_name: o.full_name,
        active_members: db.members.filter((m) => m.workspace_id === w.id && m.status === 'active' && profile(m.user_id)?.status === 'active').length,
        card_count: db.contacts.filter((c) => c.workspace_id === w.id).length,
      };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
export async function adminSetWorkspaceStatus(id, status) {
  await tick();
  requireSuper();
  db.workspaces.find((w) => w.id === id).status = status;
}
export async function adminWorkspaceMembers(ws) {
  await tick();
  requireSuper();
  return membersOf(ws);
}
