// All data access for the app. The demo build swaps this module for
// src/demo/api.js (see vite.config.js), which implements the same exports
// in memory. Every function either returns data or throws an Error with a
// user-presentable message.

import { supabase, USERNAME_DOMAIN, configured, setKeepSignedIn as keepSignedIn } from './supabase.js';
import { audioParts } from './recordingParts.js';

export const isDemo = false;
export const isConfigured = configured;

const PAGE = 1000;
const SIGN_TTL = 3600;

const MEMBER_SELECT =
  'workspace_id, user_id, role, status, created_at, profile:profiles!workspace_members_user_id_fkey(username, full_name, status)';

function fail(error, fallback = 'Something went wrong') {
  if (!error) return;
  const err = new Error(error.message || fallback);
  err.code = error.code;
  throw err;
}

function flattenMember(m) {
  return {
    workspace_id: m.workspace_id,
    user_id: m.user_id,
    role: m.role,
    status: m.status,
    created_at: m.created_at,
    username: m.profile?.username || '',
    full_name: m.profile?.full_name || '',
    profile_status: m.profile?.status || 'active',
  };
}

async function invoke(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let msg = error.message || `The ${name} service failed`;
    try {
      const ctx = error.context;
      if (ctx && typeof ctx.json === 'function') {
        const j = await ctx.json();
        if (j && j.error) msg = j.error;
      }
    } catch { /* body was not JSON */ }
    throw new Error(msg);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const usernameToEmail = (username) => `${username.trim().toLowerCase()}@${USERNAME_DOMAIN}`;

/** Current session user ({ id }) or null. */
export async function getSessionUser() {
  const { data } = await supabase.auth.getSession();
  return data.session ? { id: data.session.user.id } : null;
}

/** Subscribe to sign-in / sign-out. Returns an unsubscribe function. */
export function onAuthChange(cb) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session ? { id: session.user.id } : null);
  });
  return () => data.subscription.unsubscribe();
}

/**
 * Sign in with username + password. A banned (suspended) account throws an
 * Error with `suspended = true` and `reason` from suspension_notice().
 */
export async function signIn(username, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password,
  });
  if (error) {
    const text = `${error.message || ''} ${error.code || ''}`;
    if (/banned/i.test(text)) {
      const { data: reason } = await supabase.rpc('suspension_notice', { p_username: username.trim().toLowerCase() });
      const err = new Error('Access suspended');
      err.suspended = true;
      err.reason = reason || '';
      throw err;
    }
    if (/invalid login credentials/i.test(error.message)) throw new Error('Wrong username or password.');
    fail(error);
  }
  return { id: data.user.id };
}

export async function signUp({ username, password, full_name }) {
  const { data, error } = await supabase.auth.signUp({
    email: usernameToEmail(username),
    password,
    options: { data: { username: username.trim().toLowerCase(), full_name: full_name.trim() } },
  });
  fail(error);
  if (!data.session) {
    // Email confirmation must be off for username sign-in; try signing in directly.
    return signIn(username, password);
  }
  return { id: data.user.id };
}

export async function usernameAvailable(username) {
  const { data, error } = await supabase.rpc('username_available', { p_username: username });
  fail(error);
  return !!data;
}

/** "Keep me signed in": call before signing in. Signing out turns it off. */
export function setKeepSignedIn(on) {
  keepSignedIn(on);
}

export async function signOut() {
  await supabase.auth.signOut();
  keepSignedIn(false);
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export async function getProfile(uid) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
  fail(error);
  return data;
}

export async function updateFullName(uid, full_name) {
  const { data, error } = await supabase.from('profiles').update({ full_name }).eq('id', uid).select().single();
  fail(error);
  return data;
}

/** Checks the current password first, then sets the new one. */
export async function updatePassword(password, current, username) {
  const check = await supabase.auth.signInWithPassword({ email: usernameToEmail(username), password: current });
  if (check.error) throw new Error('Your current password is not right.');
  const { error } = await supabase.auth.updateUser({ password });
  fail(error);
}

/** "Stay private": when on, nobody can add or invite me as a member. */
export async function setPrivateAccount(uid, on) {
  const { data, error } = await supabase.from('profiles').update({ private_account: !!on }).eq('id', uid).select().single();
  fail(error);
  return data;
}

// ---------------------------------------------------------------------------
// Workspaces & members
// ---------------------------------------------------------------------------

/** Active memberships: [{ id, name, owner_id, status, role }]. */
export async function listMyWorkspaces(uid) {
  const { data, error } = await supabase
    .from('workspace_members')
    .select('role, status, workspace:workspaces(id, name, owner_id, status, created_at)')
    .eq('user_id', uid)
    .eq('status', 'active');
  fail(error);
  return (data || [])
    .filter((m) => m.workspace && m.workspace.status === 'active')
    .map((m) => ({ ...m.workspace, role: m.role }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function createWorkspace(uid, name) {
  const { data, error } = await supabase.from('workspaces').insert({ name: name.trim(), owner_id: uid }).select().single();
  fail(error);
  return { ...data, role: 'admin' };
}

export async function renameWorkspace(id, name) {
  const { data, error } = await supabase.from('workspaces').update({ name: name.trim() }).eq('id', id).select().single();
  fail(error);
  return data;
}

export async function listMembers(workspaceId) {
  const { data, error } = await supabase.from('workspace_members').select(MEMBER_SELECT).eq('workspace_id', workspaceId);
  fail(error);
  return (data || []).map(flattenMember);
}

export async function addMember(workspaceId, username, role) {
  const { error } = await supabase.rpc('add_member', { p_workspace: workspaceId, p_username: username.trim().toLowerCase(), p_role: role });
  fail(error);
}

/** patch: { role } and/or { status: 'active' | 'revoked' } */
export async function updateMember(workspaceId, userId, patch) {
  const { error } = await supabase.from('workspace_members').update(patch).eq('workspace_id', workspaceId).eq('user_id', userId);
  fail(error);
}

/** Invitations waiting for my answer: [{ workspace_id, workspace_name, inviter_name, role, invited_at }]. */
export async function listMyInvites() {
  const { data, error } = await supabase.rpc('my_invites');
  fail(error);
  return data || [];
}

/** Accept (join the workspace) or decline (the invitation is removed). */
export async function respondInvite(workspaceId, accept) {
  const { error } = await supabase.rpc('respond_invite', { p_workspace: workspaceId, p_accept: accept });
  fail(error, 'Could not answer the invitation');
}

export async function removeMember(workspaceId, userId) {
  const { error } = await supabase.from('workspace_members').delete().eq('workspace_id', workspaceId).eq('user_id', userId);
  fail(error);
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

/** Every readable contact in the workspace, loaded in pages of 1000. */
export async function listContacts(workspaceId) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, from + PAGE - 1);
    fail(error);
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

export async function getContact(id) {
  const { data, error } = await supabase.from('contacts').select('*').eq('id', id).maybeSingle();
  fail(error);
  return data;
}

export async function insertContact(row) {
  const { data, error } = await supabase.from('contacts').insert(row).select().single();
  fail(error);
  return data;
}

export async function updateContact(id, patch) {
  const { data, error } = await supabase.from('contacts').update(patch).eq('id', id).select().maybeSingle();
  fail(error);
  return data; // null when the caller can no longer read it (e.g. taken private by an admin)
}

async function listFolder(bucket, prefix) {
  const { data } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 });
  return (data || []).filter((o) => o.id).map((o) => `${prefix}/${o.name}`);
}

/** Removes photos and recordings first (storage RLS needs the row), then the row. */
export async function deleteContact(contact) {
  const prefix = `${contact.workspace_id}/${contact.id}`;
  const cardPaths = new Set([contact.front_path, contact.back_path].filter(Boolean));
  for (const p of await listFolder('cards', prefix)) cardPaths.add(p);

  const { data: ints } = await supabase.from('interactions').select('audio_path').eq('contact_id', contact.id);
  const recPaths = new Set((ints || []).flatMap((i) => audioParts(i)));
  for (const p of await listFolder('recordings', prefix)) recPaths.add(p);

  if (cardPaths.size) {
    const { error } = await supabase.storage.from('cards').remove([...cardPaths]);
    fail(error, 'Could not delete the card photos');
  }
  if (recPaths.size) {
    const { error } = await supabase.storage.from('recordings').remove([...recPaths]);
    fail(error, 'Could not delete the recordings');
  }
  const { error } = await supabase.from('contacts').delete().eq('id', contact.id);
  fail(error);
}

/** Upload a card photo; returns the storage path. side: 'front' | 'back'. */
export async function uploadCardPhoto(workspaceId, contactId, side, blob) {
  const path = `${workspaceId}/${contactId}/${side}-${Date.now()}.jpg`;
  const { error } = await supabase.storage.from('cards').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  fail(error, 'Photo upload failed');
  return path;
}

export async function removeStorageObjects(bucket, paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  const { error } = await supabase.storage.from(bucket).remove(list);
  fail(error);
}

/** Batch-sign storage paths. Returns { [path]: url }. */
export async function signUrls(bucket, paths) {
  const list = [...new Set(paths.filter(Boolean))];
  if (!list.length) return {};
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(list, SIGN_TTL);
  fail(error);
  const out = {};
  for (const r of data || []) if (r.signedUrl && !r.error) out[r.path] = r.signedUrl;
  return out;
}

export async function signUrl(bucket, path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, SIGN_TTL);
  fail(error);
  return data.signedUrl;
}

/** AI card reading. front/back: base64 JPEG without the data: prefix. */
export async function scanCard(front, back) {
  const data = await invoke('scan-card', { front, back: back || null, media_type: 'image/jpeg' });
  if (!data || !data.card) throw new Error('The card reader returned no result.');
  return data.card;
}

// ---------------------------------------------------------------------------
// Sharing a card with another member
// ---------------------------------------------------------------------------

const SHARE_SELECT =
  'id, workspace_id, contact_id, sender_id, recipient_id, status, contact_name, contact_title, contact_company, new_contact_id, created_at, responded_at, sender:profiles!card_shares_sender_id_fkey(username, full_name)';

function flattenShare(s) {
  const { sender, ...rest } = s;
  return { ...rest, sender_name: sender?.full_name || sender?.username || 'A member' };
}

/** Answers to cards I shared, newest first: shares with recipient_name. */
export async function listShareReplies(uid) {
  const { data, error } = await supabase
    .from('card_shares')
    .select(`${SHARE_SELECT}, recipient:profiles!card_shares_recipient_id_fkey(username, full_name)`)
    .eq('sender_id', uid)
    .in('status', ['accepted', 'declined'])
    .order('responded_at', { ascending: false })
    .limit(20);
  fail(error);
  return (data || []).map(({ recipient, ...s }) => ({ ...flattenShare(s), recipient_name: recipient?.full_name || recipient?.username || 'A member' }));
}

/** Offer a card to a member of the same workspace. */
export async function shareContact(contact, recipientId) {
  const { data, error } = await supabase
    .from('card_shares')
    .insert({ workspace_id: contact.workspace_id, contact_id: contact.id, recipient_id: recipientId })
    .select(SHARE_SELECT)
    .single();
  if (error?.code === '23505') throw new Error('This card is already waiting for their answer.');
  fail(error, 'Could not share the card');
  return flattenShare(data);
}

/** Offers I have made for this card, newest first. */
export async function listContactShares(contactId) {
  const { data, error } = await supabase
    .from('card_shares')
    .select(SHARE_SELECT)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false });
  fail(error);
  return (data || []).map(flattenShare);
}

/** Cards members are waiting for me to accept or decline. */
export async function listIncomingShares(uid) {
  const { data, error } = await supabase
    .from('card_shares')
    .select(SHARE_SELECT)
    .eq('recipient_id', uid)
    .eq('status', 'pending')
    .order('created_at');
  fail(error);
  return (data || []).map(flattenShare);
}

/** Accept: the card becomes one of my private cards, photos included. Returns the new card. */
export async function acceptShare(share) {
  const { data, error } = await supabase.rpc('accept_card_share', { p_share: share.id });
  fail(error, 'Could not accept the card');
  const row = Array.isArray(data) ? data[0] : data;
  const id = row.new_contact_id;
  const patch = {};
  // The face photo is not in the accept reply; it sits in the card's folder as face-<ms>.jpg.
  let facePath = null;
  try {
    facePath = (await listFolder('cards', `${share.workspace_id}/${share.contact_id}`))
      .filter((p) => /\/face-\d+\.jpg$/.test(p)).sort().pop() || null;
  } catch { /* no face photo */ }
  for (const [side, path] of [['front', row.front_path], ['back', row.back_path], ['face', facePath]]) {
    if (!path) continue;
    try {
      const { data: blob, error: dlErr } = await supabase.storage.from('cards').download(path);
      if (dlErr || !blob) continue;
      patch[`${side}_path`] = await uploadCardPhoto(share.workspace_id, id, side, blob);
    } catch { /* the card details still arrive without that photo */ }
  }
  if (Object.keys(patch).length) return updateContact(id, patch);
  return getContact(id);
}

/** Decline (recipient) or withdraw (sender) an open offer. */
export async function closeShare(shareId) {
  const { data, error } = await supabase.rpc('close_card_share', { p_share: shareId });
  fail(error);
  return data;
}

// ---------------------------------------------------------------------------
// Interactions (notes & meetings)
// ---------------------------------------------------------------------------

export async function listInteractions(contactId) {
  const { data, error } = await supabase
    .from('interactions')
    .select('*')
    .eq('contact_id', contactId)
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false });
  fail(error);
  return data || [];
}

/** Every note, meeting and recording the caller can see in a workspace, newest first. */
export async function listWorkspaceInteractions(workspaceId, limit = 500) {
  const { data, error } = await supabase
    .from('interactions')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  fail(error);
  return data || [];
}

export async function insertInteraction(row) {
  const { data, error } = await supabase.from('interactions').insert(row).select().single();
  fail(error);
  return data;
}

export async function updateInteraction(id, patch) {
  const { data, error } = await supabase.from('interactions').update(patch).eq('id', id).select().single();
  fail(error);
  return data;
}

export async function deleteInteraction(interaction) {
  if (interaction.audio_path) {
    const { error } = await supabase.storage.from('recordings').remove(audioParts(interaction));
    fail(error, 'Could not delete the recording');
  }
  const { error } = await supabase.from('interactions').delete().eq('id', interaction.id);
  fail(error);
}

export async function uploadRecording(workspaceId, contactId, interactionId, blob, ext, part = 0) {
  // The time in the name is when it was recorded; a long recording's later parts add -p2, -p3…
  const path = `${workspaceId}/${contactId}/${interactionId}${part ? `-p${part + 1}` : ''}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('recordings').upload(path, blob, {
    contentType: blob.type || (ext === 'mp4' ? 'audio/mp4' : 'audio/webm'),
    upsert: true,
  });
  fail(error, 'Recording upload failed');
  return path;
}

/** Downloads a saved recording so it can be sent for transcription. */
export async function downloadRecording(path) {
  const { data, error } = await supabase.storage.from('recordings').download(path);
  fail(error, 'Could not load the recording');
  return data;
}

/**
 * Server-side transcription, in `output` (English, Chinese or Tagalog): { text, segments: [{ t: seconds, text, orig? }], language }.
 * A line spoken in another language keeps what was said in orig. Throws with code 'not_configured' if it is off. */
export async function transcribe(blob, language, ext, output = 'English') {
  const form = new FormData();
  form.append('action', 'transcribe');
  form.append('output', output);
  if (language) form.append('language', language.slice(0, 2)); // left out, Whisper detects it (mixed English/Chinese)
  form.append('audio', blob, `rec.${ext}`);
  try {
    const data = await invoke('meeting-notes', form);
    return { text: data.transcript || '', segments: Array.isArray(data.segments) ? data.segments : [], language: data.language || '' };
  } catch (e) {
    if (/not configured|not set up|openai_api_key|not enabled/i.test(e.message)) e.code = 'not_configured';
    throw e;
  }
}

/** Translates a saved timed transcript into `output` (English, Chinese or Tagalog), keeping what was said in orig. */
export async function translateTranscript(segments, output) {
  const data = await invoke('meeting-notes', { action: 'translate', segments, output });
  return { text: data.transcript || '', segments: Array.isArray(data.segments) ? data.segments : [] };
}

/** Returns { summary, key_points, action_items, follow_up_on, lead_status }. */
export async function summarise(payload) {
  const data = await invoke('meeting-notes', { action: 'summarise', ...payload });
  return {
    summary: data.summary || '',
    key_points: Array.isArray(data.key_points) ? data.key_points : [],
    action_items: Array.isArray(data.action_items) ? data.action_items : [],
    follow_up_on: data.follow_up_on || null,
    lead_status: data.lead_status || null,
  };
}

/** AI minutes for a typed meeting: quick summary, formal minutes, action items and decisions. */
export async function meetingMinutes(payload) {
  return invoke('meeting-notes', { action: 'minutes', ...payload });
}

/** Answers a question about one meeting (or drafts an email or report from it). Returns the answer text. */
export async function askMeeting(payload) {
  const data = await invoke('meeting-notes', { action: 'ask', ...payload });
  return data.answer || '';
}

// ---------------------------------------------------------------------------
// To Do List
// ---------------------------------------------------------------------------

/** My tasks and the tasks teammates gave me (the database lets me see no others). */
export async function listTasks() {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .order('due_on', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  fail(error);
  return data || [];
}

export async function insertTask(row) {
  const { data, error } = await supabase.from('tasks').insert(row).select().single();
  fail(error);
  return data;
}

export async function updateTask(id, patch) {
  const { data, error } = await supabase.from('tasks').update(patch).eq('id', id).select().single();
  fail(error);
  return data;
}

export async function deleteTask(id) {
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  fail(error);
}

/**
 * Reads a typed sentence with AI ("Remind me to call Peter tomorrow 10am") and
 * returns the task fields: title, notes, due_on, due_time, priority, reminders,
 * repeat, category, tags, subtasks. `clock` is { today, time } on this device.
 */
export async function aiTask(text, clock) {
  const data = await invoke('todo-ai', { action: 'parse', text, ...clock });
  return data.task;
}

/**
 * Speech to task: transcribes a short recording, then reads it like aiTask. The task is
 * written in `language` (English, Chinese or Tagalog), whatever was said. Returns { text, task }.
 */
export async function voiceTask(blob, ext, clock, language = 'English') {
  const form = new FormData();
  form.append('action', 'voice');
  form.append('language', language);
  form.append('today', clock.today);
  form.append('time', clock.time);
  form.append('audio', blob, `task.${ext}`);
  const data = await invoke('todo-ai', form);
  return { text: data.text || '', task: data.task };
}

// ---------------------------------------------------------------------------
// Quick Notes (only ever my own: the database shows nobody else's)
// ---------------------------------------------------------------------------

export async function listNotes() {
  const { data, error } = await supabase.from('notes').select('*').order('updated_at', { ascending: false });
  fail(error);
  return data || [];
}

/** row may carry its own id (made on this device so its files can be uploaded first). */
export async function insertNote(row) {
  const { data, error } = await supabase.from('notes').insert(row).select().single();
  fail(error);
  return data;
}

export async function updateNote(id, patch) {
  const { data, error } = await supabase.from('notes').update(patch).eq('id', id).select().single();
  fail(error);
  return data;
}

/** Deletes a note for good, its photos and files first. */
export async function deleteNoteForever(note) {
  const paths = (note.files || []).map((f) => f.path).filter(Boolean);
  for (const p of await listFolder('note-files', `${note.created_by}/${note.id}`)) if (!paths.includes(p)) paths.push(p);
  if (paths.length) {
    const { error } = await supabase.storage.from('note-files').remove(paths);
    fail(error, 'Could not delete the note\'s files');
  }
  const { error } = await supabase.from('notes').delete().eq('id', note.id);
  fail(error);
}

/** Uploads a photo, recording or file for a note. Returns the file entry saved on the note. */
export async function uploadNoteFile(ownerId, noteId, blob, name) {
  const path = `${ownerId}/${noteId}/${Date.now().toString(36)}-${name}`;
  const { error } = await supabase.storage.from('note-files').upload(path, blob, { contentType: blob.type || 'application/octet-stream', upsert: false });
  fail(error, 'Upload failed');
  return { path, name, type: blob.type || 'application/octet-stream', size: blob.size };
}

export async function listNoteTopics() {
  const { data, error } = await supabase.from('note_topics').select('*').order('name');
  fail(error);
  return data || [];
}

export async function insertNoteTopic(row) {
  const { data, error } = await supabase.from('note_topics').insert(row).select().single();
  if (error?.code === '23505') throw new Error('You already have a topic with that name.');
  fail(error);
  return data;
}

export async function updateNoteTopic(id, patch) {
  const { data, error } = await supabase.from('note_topics').update(patch).eq('id', id).select().single();
  if (error?.code === '23505') throw new Error('You already have a topic with that name.');
  fail(error);
  return data;
}

export async function deleteNoteTopic(id) {
  const { error } = await supabase.from('note_topics').delete().eq('id', id);
  fail(error);
}

/**
 * Speech to note: transcribes a recording and works out what was asked, written in
 * `language`. `topics` are my topic names; `inTopic` is the open topic's name, or ''.
 * `clock` is { today, time } on this device, for dates of things to do found in it.
 * Returns { text, result: { action: 'note' | 'topic', topic, title, body, checklist, tags, actions } }.
 */
export async function voiceNote(blob, ext, language = 'English', topics = [], inTopic = '', clock = {}) {
  const form = new FormData();
  form.append('today', clock.today || '');
  form.append('time', clock.time || '');
  form.append('action', 'voice');
  form.append('language', language);
  form.append('topics', JSON.stringify(topics));
  form.append('in_topic', inTopic);
  form.append('audio', blob, `note.${ext}`);
  const data = await invoke('notes-ai', form);
  return { text: data.text || '', result: data.result };
}

/** ✨ Clean up: a rushed note rewritten with a title and tidy points. Returns { title, body }. */
export async function cleanUpNote(title, body) {
  return invoke('notes-ai', { action: 'cleanup', title, body });
}

/**
 * Things to do found in a note's text, for "Add to To-Do": [{ title, due_on, due_time }].
 * `clock` is { today, time } on this device.
 */
export async function noteActions(text, clock) {
  const data = await invoke('notes-ai', { action: 'actions', text, ...clock });
  return data.actions || [];
}

/** Speech to text for adding to a note being edited, tidied and written in `language`. */
export async function dictateNote(blob, ext, language = 'English') {
  const form = new FormData();
  form.append('action', 'dictate');
  form.append('language', language);
  form.append('audio', blob, `note.${ext}`);
  const data = await invoke('notes-ai', form);
  return data.text || '';
}

// ---------------------------------------------------------------------------
// Super admin
// ---------------------------------------------------------------------------

export async function adminListProfiles() {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1);
    fail(error);
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

/** action: 'suspend' | 'reinstate' | 'reset_password' | 'delete' (to Deleted users) | 'purge'; extra: { reason?, password?, confirm_username? } */
export async function adminUserAction(action, userId, extra = {}) {
  await invoke('admin-users', { action, user_id: userId, ...extra });
}

/** Saves a user's feature switches; only the ones that are off need listing. */
export async function adminSetFeatures(userId, features) {
  const { data, error } = await supabase.from('profiles').update({ features }).eq('id', userId).select('id, features').single();
  fail(error);
  return data;
}

export async function adminListWorkspaces() {
  const { data, error } = await supabase.rpc('super_admin_workspaces');
  fail(error);
  return data || [];
}

export async function adminSetWorkspaceStatus(id, status) {
  const { error } = await supabase.from('workspaces').update({ status }).eq('id', id);
  fail(error);
}

export async function adminWorkspaceMembers(workspaceId) {
  return listMembers(workspaceId);
}
