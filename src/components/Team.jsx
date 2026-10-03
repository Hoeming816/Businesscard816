import { useState } from 'react';
import { useApp } from '../context.js';
import { Icon, Avatar, Pill, ConfirmButton, formatDate } from './ui.jsx';

export const ROLES = ['admin', 'editor', 'viewer'];
const ROLE_HELP = {
  admin: 'Manages members, edits or deletes any shared card',
  editor: 'Scans and edits shared cards, deletes own cards',
  viewer: 'Views, searches and exports shared cards',
};

export function memberStatus(m) {
  if (m.profile_status === 'suspended') return { label: 'Account suspended', tone: 'danger' };
  if (m.status === 'revoked') return { label: 'Access revoked', tone: 'warn' };
  return { label: 'Active', tone: 'ok' };
}

export default function Team() {
  const { api, uid, workspace, role, members, reloadMembers, reloadWorkspaces, toast } = useApp();
  const isAdmin = role === 'admin';
  const isOwner = workspace.owner_id === uid;
  const [username, setUsername] = useState('');
  const [newRole, setNewRole] = useState('editor');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(workspace.name);

  const run = async (fn, ok) => {
    try {
      await fn();
      await reloadMembers();
      if (ok) toast(ok);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const add = async (e) => {
    e.preventDefault();
    setAddError('');
    const u = username.trim().toLowerCase();
    if (!u) return;
    setAdding(true);
    try {
      await api.addMember(workspace.id, u, newRole);
      await reloadMembers();
      toast(`@${u} added as ${newRole}`);
      setUsername('');
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const rename = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await api.renameWorkspace(workspace.id, name);
      await reloadWorkspaces();
      setRenaming(false);
      toast('Workspace renamed');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const leave = async () => {
    try {
      await api.removeMember(workspace.id, uid);
      toast(`You left ${workspace.name}`);
      await reloadWorkspaces();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const sorted = [...members].sort((a, b) => {
    if (a.user_id === workspace.owner_id) return -1;
    if (b.user_id === workspace.owner_id) return 1;
    return ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || (a.full_name || a.username).localeCompare(b.full_name || b.username);
  });
  const activeCount = members.filter((m) => m.status === 'active' && m.profile_status !== 'suspended').length;

  return (
    <div className="page narrow team">
      <div className="page-head">
        {renaming ? (
          <form className="rename" onSubmit={rename}>
            <label htmlFor="ws-name" className="sr-only">Workspace name</label>
            <input id="ws-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoFocus />
            <button type="submit" className="btn btn-primary btn-sm">Save</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRenaming(false); setName(workspace.name); }}>Cancel</button>
          </form>
        ) : (
          <div className="title-row">
            <h1 className="h1">{workspace.name}</h1>
            {isAdmin && (
              <button type="button" className="icon-btn" onClick={() => { setName(workspace.name); setRenaming(true); }} aria-label="Rename workspace">
                <Icon name="edit" size={17} />
              </button>
            )}
          </div>
        )}
        <p className="muted">
          {activeCount} active member{activeCount === 1 ? '' : 's'} · You are {role === 'admin' ? 'an admin' : `a ${role}`}{isOwner ? ' and the owner' : ''}
        </p>
      </div>

      {isAdmin && (
        <form className="panel add-member" onSubmit={add}>
          <h2 className="h3">Add a member</h2>
          <p className="help">They need to have signed up for CardFlow first. Ask them for their username.</p>
          <div className="add-row">
            <div className="field grow">
              <label htmlFor="add-username">Username</label>
              <div className="input-prefix">
                <span aria-hidden="true">@</span>
                <input id="add-username" autoCapitalize="none" spellCheck={false} value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))} placeholder="username" />
              </div>
            </div>
            <div className="field">
              <label htmlFor="add-role">Role</label>
              <select id="add-role" value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                {ROLES.map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
              </select>
            </div>
            <button type="submit" className="btn btn-primary" disabled={adding || !username.trim()}>
              <Icon name="plus" size={16} /> {adding ? 'Adding…' : 'Add'}
            </button>
          </div>
          <p className="help">{ROLE_HELP[newRole]}.</p>
          {addError && <p className="form-error" role="alert">{addError}</p>}
        </form>
      )}

      <section className="panel" aria-labelledby="members-h">
        <h2 id="members-h" className="h3">Members</h2>
        {!isAdmin && <p className="help">Only workspace admins can change members.</p>}
        <ul className="members">
          {sorted.map((m) => {
            const owner = m.user_id === workspace.owner_id;
            const self = m.user_id === uid;
            const st = memberStatus(m);
            const locked = owner || !isAdmin;
            return (
              <li key={m.user_id} className={`member ${m.status !== 'active' || m.profile_status === 'suspended' ? 'is-inactive' : ''}`}>
                <Avatar name={m.full_name || m.username} size={38} />
                <div className="member-main">
                  <span className="member-name">{m.full_name || m.username}{self && <span className="muted"> (you)</span>}</span>
                  <span className="mono small muted">@{m.username}</span>
                </div>
                <div className="member-meta">
                  {owner && <Pill tone="accent" icon="lock">Owner</Pill>}
                  <Pill tone={st.tone}>{st.label}</Pill>
                </div>
                <div className="member-role">
                  {locked || self ? (
                    <span className="role-text">{m.role}</span>
                  ) : (
                    <select aria-label={`Role for ${m.full_name || m.username}`} value={m.role}
                      onChange={(e) => run(() => api.updateMember(workspace.id, m.user_id, { role: e.target.value }), `Role changed to ${e.target.value}`)}>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  )}
                </div>
                <div className="member-actions">
                  {!locked && !self && (
                    <>
                      {m.status === 'active' ? (
                        <button type="button" className="btn btn-ghost btn-sm"
                          onClick={() => run(() => api.updateMember(workspace.id, m.user_id, { status: 'revoked' }), 'Access revoked')}>
                          Revoke
                        </button>
                      ) : (
                        <button type="button" className="btn btn-ghost btn-sm"
                          onClick={() => run(() => api.updateMember(workspace.id, m.user_id, { status: 'active' }), 'Access restored')}>
                          Restore
                        </button>
                      )}
                      <ConfirmButton className="btn btn-danger-ghost btn-sm" confirmLabel="Remove" message="Remove from workspace?"
                        onConfirm={() => run(() => api.removeMember(workspace.id, m.user_id), 'Member removed')}>
                        Remove
                      </ConfirmButton>
                    </>
                  )}
                  {owner && <span className="small muted">Locked</span>}
                </div>
                <span className="member-since small muted">Added {formatDate(m.created_at)}</span>
              </li>
            );
          })}
        </ul>
      </section>

      {!isOwner && (
        <section className="panel danger-zone">
          <h2 className="h3">Leave workspace</h2>
          <p className="help">You will lose access to all shared cards in {workspace.name}. Your private cards here stay in the workspace but nobody can see them.</p>
          <ConfirmButton icon="logout" confirmLabel="Leave workspace" message={`Leave ${workspace.name}?`} onConfirm={leave}>
            Leave workspace
          </ConfirmButton>
        </section>
      )}
    </div>
  );
}
