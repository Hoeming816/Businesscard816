// In-memory implementation of the src/api.js surface for the clickable demo.
// Used whenever VITE_DEMO=1 (see vite.config.js). Nothing leaves the browser.

import { PROFILES, WORKSPACES, MEMBERS, ME, buildContacts, buildHarbourContacts, buildInteractions } from './seed.js';
import { cardSvg, demoAudioUrl } from './cardArt.js';
import { todayISO, addDays } from '../filters.js';
import { canEditContact, canDeleteContact, canEditInteraction } from '../perms.js';
import { featureOn } from '../features.js';

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
  if (p.status === 'suspended') {
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
export async function signOut() {
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
export async function updatePassword(password) {
  await sleep(250);
  if (String(password).length < 8) throw new Error('Password should be at least 8 characters.');
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
  if (existing) Object.assign(existing, { role, status: 'active' });
  else db.members.push({ workspace_id: ws, user_id: p.id, role, status: 'active', created_at: now() });
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
    'front_path', 'back_path'];
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
  db.interactions = db.interactions.filter((x) => x.id !== i.id);
}
export async function uploadRecording(ws, contactId, interactionId, blob, ext) {
  needFeature('meeting', 'Meeting');
  await sleep(250);
  const path = `${ws}/${contactId}/${interactionId}-${Date.now()}.${ext}`; // the time in the name is when it was recorded
  db.blobs.set(path, URL.createObjectURL(blob));
  return path;
}
export async function downloadRecording(path) {
  await tick();
  const url = urlFor(path);
  if (!url) throw new Error('Could not load the recording');
  return (await fetch(url)).blob();
}
export async function transcribe() {
  needFeature('meeting', 'Meeting');
  await sleep(1500);
  return 'Thanks for making the time today. We are planning to refresh the network across our two Singapore sites next year. '
    + 'The main pain points are the ageing core switches and patchy Wi-Fi on the operations floor. '
    + 'We would like a proposal by the end of the month, and ideally a site survey before that.';
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
  if (userId === uid() && action !== 'reset_password') throw new Error('You cannot suspend yourself.');
  const p = profile(userId);
  if (!p) throw new Error('No such account.');
  if (action === 'suspend') Object.assign(p, { status: 'suspended', suspended_reason: extra.reason || null });
  else if (action === 'reinstate') Object.assign(p, { status: 'active', suspended_reason: null });
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
