import { useState } from 'react';
import { useApp } from '../context.js';
import { Icon, Avatar, Pill, SaveLabel, useJustSaved } from './ui.jsx';

export default function Me() {
  const { api, profile, setProfile, workspaces, workspace, switchWorkspace, reloadWorkspaces, toast, setView } = useApp();
  const [name, setName] = useState(profile.full_name || '');
  const [savingName, setSavingName] = useState(false);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [pwError, setPwError] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [nameSaved, markNameSaved] = useJustSaved();
  const [pwSaved, markPwSaved] = useJustSaved();
  const [wsName, setWsName] = useState('');
  const [creating, setCreating] = useState(false);

  const saveName = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSavingName(true);
    try {
      setProfile(await api.updateFullName(profile.id, name.trim()));
      markNameSaved();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSavingName(false);
    }
  };

  const savePw = async (e) => {
    e.preventDefault();
    setPwError('');
    if (pw.length < 8) return setPwError('Use at least 8 characters.');
    if (pw !== pw2) return setPwError('The two passwords do not match.');
    setSavingPw(true);
    try {
      await api.updatePassword(pw);
      setPw('');
      setPw2('');
      markPwSaved();
      toast('Your password is changed.');
    } catch (err) {
      setPwError(err.message);
    } finally {
      setSavingPw(false);
    }
  };

  const createWs = async (e) => {
    e.preventDefault();
    if (!wsName.trim()) return;
    setCreating(true);
    try {
      const ws = await api.createWorkspace(profile.id, wsName.trim());
      await reloadWorkspaces(ws.id);
      setWsName('');
      toast(`Created ${ws.name}`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="page narrow me">
      <div className="me-head panel">
        <Avatar name={profile.full_name || profile.username} size={56} />
        <div>
          <h1 className="h2">{profile.full_name || profile.username}</h1>
          <p className="mono muted">@{profile.username}</p>
          {profile.is_super_admin && <Pill tone="accent" icon="shield">Super admin</Pill>}
        </div>
        <button type="button" className="btn btn-outline me-signout" onClick={() => api.signOut()}>
          <Icon name="logout" size={16} /> Sign out
        </button>
      </div>

      <form className="panel" onSubmit={saveName}>
        <h2 className="h3">Your name</h2>
        <div className="inline-form">
          <div className="field grow">
            <label htmlFor="me-name">Full name</label>
            <input id="me-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={savingName || !name.trim() || name.trim() === profile.full_name}>
            <SaveLabel saving={savingName} saved={nameSaved}>Save</SaveLabel>
          </button>
        </div>
        <p className="help">Your username can't be changed.</p>
      </form>

      <form className="panel" onSubmit={savePw}>
        <h2 className="h3">Change password</h2>
        <input type="text" autoComplete="username" value={profile.username} readOnly hidden />
        <div className="grid-2">
          <div className="field">
            <label htmlFor="me-pw">New password</label>
            <input id="me-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="me-pw2">Repeat new password</label>
            <input id="me-pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </div>
        </div>
        {pwError && <p className="form-error" role="alert">{pwError}</p>}
        <button type="submit" className="btn btn-primary" disabled={savingPw || !pw}><SaveLabel saving={savingPw} saved={pwSaved}>Change password</SaveLabel></button>
      </form>

      <section className="panel" aria-labelledby="me-ws">
        <h2 id="me-ws" className="h3">Your workspaces</h2>
        <ul className="ws-list">
          {(workspaces || []).map((w) => (
            <li key={w.id}>
              <Icon name="building" size={16} />
              <span className="grow">{w.name}</span>
              <span className="muted small">{w.owner_id === profile.id ? 'owner · ' : ''}{w.role}</span>
              {w.id === workspace?.id ? (
                <Pill tone="ok">Current</Pill>
              ) : (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { switchWorkspace(w.id); setView('contacts'); }}>Switch</button>
              )}
            </li>
          ))}
          {!(workspaces || []).length && <li className="muted">You are not an active member of any workspace.</li>}
        </ul>
        <form className="inline-form" onSubmit={createWs}>
          <div className="field grow">
            <label htmlFor="me-newws">New workspace name</label>
            <input id="me-newws" maxLength={80} value={wsName} onChange={(e) => setWsName(e.target.value)} placeholder="e.g. Singapore sales team" />
          </div>
          <button type="submit" className="btn btn-outline" disabled={creating || !wsName.trim()}>
            <Icon name="plus" size={16} /> {creating ? 'Creating…' : 'Create workspace'}
          </button>
        </form>
        <p className="help">You become the admin of new workspaces and can invite people from Team.</p>
      </section>
    </div>
  );
}
