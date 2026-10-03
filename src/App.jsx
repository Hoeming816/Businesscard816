import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api.js';
import { AppContext, useApp } from './context.js';
import { load, save } from './storage.js';
import { Icon, Logo, Avatar, Spinner } from './components/ui.jsx';
import AuthScreen, { SuspendedScreen } from './components/Auth.jsx';
import Contacts from './components/Contacts.jsx';
import Scan from './components/Scan.jsx';
import Team from './components/Team.jsx';
import SuperAdmin from './components/SuperAdmin.jsx';
import Me from './components/Me.jsx';

const WS_KEY = 'cardfile.workspace';
const SIGN_REFRESH_MS = 50 * 60 * 1000; // signed URLs live 1 h; refresh after 50 min

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = checking, null = signed out
  const [profile, setProfile] = useState(null);
  const [suspended, setSuspended] = useState(null);
  const [workspaces, setWorkspaces] = useState(null);
  const [wsId, setWsId] = useState(null);
  const [members, setMembers] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [contactsState, setContactsState] = useState('idle'); // idle | loading | ready | error
  const [contactsError, setContactsError] = useState('');
  const [view, setView] = useState('contacts');
  const [toasts, setToasts] = useState([]);
  const [signedVersion, setSignedVersion] = useState(0);
  const signedRef = useRef(new Map()); // `${bucket}:${path}` -> { url, at }
  const pendingRef = useRef(new Set());

  // ----- toasts -----
  const toast = useCallback((message, tone = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 3500);
  }, []);

  // ----- auth -----
  useEffect(() => {
    let alive = true;
    api.getSessionUser().then((u) => alive && setUser(u)).catch(() => alive && setUser(null));
    const off = api.onAuthChange((u) => {
      setUser((prev) => (prev?.id === u?.id ? prev : u));
    });
    return () => { alive = false; off(); };
  }, []);

  const resetSession = useCallback(() => {
    setProfile(null);
    setWorkspaces(null);
    setWsId(null);
    setMembers([]);
    setContacts([]);
    setContactsState('idle');
    setView('contacts');
    signedRef.current.clear();
  }, []);

  useEffect(() => {
    if (!user) { resetSession(); return; }
    let alive = true;
    (async () => {
      try {
        const p = await api.getProfile(user.id);
        if (!alive) return;
        if (!p) throw new Error('Your profile could not be loaded.');
        if (p.status === 'suspended') {
          setSuspended({ reason: p.suspended_reason || '' });
          await api.signOut();
          return;
        }
        setProfile(p);
        const list = await api.listMyWorkspaces(user.id);
        if (!alive) return;
        setWorkspaces(list);
        const saved = load(WS_KEY);
        setWsId((list.find((w) => w.id === saved) || list[0] || {}).id || null);
      } catch (e) {
        if (alive) toast(e.message, 'error');
      }
    })();
    return () => { alive = false; };
  }, [user, resetSession, toast]);

  const workspace = useMemo(() => (workspaces || []).find((w) => w.id === wsId) || null, [workspaces, wsId]);
  const role = workspace?.role || null;

  const switchWorkspace = useCallback((id) => {
    setWsId(id);
    save(WS_KEY, id);
  }, []);

  // ----- workspace data -----
  const reloadMembers = useCallback(async () => {
    if (!wsId) return;
    try { setMembers(await api.listMembers(wsId)); } catch (e) { toast(e.message, 'error'); }
  }, [wsId, toast]);

  const reloadContacts = useCallback(async () => {
    if (!wsId) return;
    setContactsState('loading');
    setContactsError('');
    try {
      const list = await api.listContacts(wsId);
      setContacts(list);
      setContactsState('ready');
    } catch (e) {
      setContactsError(e.message);
      setContactsState('error');
    }
  }, [wsId]);

  useEffect(() => {
    setContacts([]);
    setMembers([]);
    if (!wsId) return;
    reloadContacts();
    reloadMembers();
  }, [wsId, reloadContacts, reloadMembers]);

  const reloadWorkspaces = useCallback(async (selectId) => {
    if (!user) return;
    const list = await api.listMyWorkspaces(user.id);
    setWorkspaces(list);
    const target = selectId || wsId;
    if (!list.some((w) => w.id === target)) switchWorkspace(list[0]?.id || null);
    else if (selectId) switchWorkspace(selectId);
  }, [user, wsId, switchWorkspace]);

  const upsertContact = useCallback((c, removedId) => {
    setContacts((list) => {
      if (!c) return list.filter((x) => x.id !== removedId);
      const i = list.findIndex((x) => x.id === c.id);
      if (i === -1) return [c, ...list];
      const next = list.slice();
      next[i] = c;
      return next;
    });
  }, []);
  const removeContact = useCallback((id) => setContacts((list) => list.filter((x) => x.id !== id)), []);

  const memberName = useCallback((id) => {
    if (!id) return '';
    if (id === profile?.id) return profile.full_name || profile.username;
    const m = members.find((x) => x.user_id === id);
    return m ? (m.full_name || m.username) : 'Former member';
  }, [members, profile]);

  // ----- signed URL cache -----
  const signed = useCallback((bucket, path) => {
    const hit = signedRef.current.get(`${bucket}:${path}`);
    return hit ? hit.url : null;
  }, []);

  const ensureSigned = useCallback(async (bucket, paths) => {
    const nowMs = Date.now();
    const need = [...new Set(paths.filter(Boolean))].filter((p) => {
      const k = `${bucket}:${p}`;
      const hit = signedRef.current.get(k);
      return !pendingRef.current.has(k) && (!hit || nowMs - hit.at > SIGN_REFRESH_MS);
    });
    if (!need.length) return;
    need.forEach((p) => pendingRef.current.add(`${bucket}:${p}`));
    try {
      for (let i = 0; i < need.length; i += 100) {
        const batch = need.slice(i, i + 100);
        const urls = await api.signUrls(bucket, batch);
        for (const [p, url] of Object.entries(urls)) signedRef.current.set(`${bucket}:${p}`, { url, at: Date.now() });
      }
      setSignedVersion((v) => v + 1);
    } catch {
      // thumbnails are best-effort
    } finally {
      need.forEach((p) => pendingRef.current.delete(`${bucket}:${p}`));
    }
  }, []);

  const ctx = useMemo(() => ({
    api, uid: user?.id, profile, setProfile, workspace, workspaces, role, members, reloadMembers,
    contacts, contactsState, contactsError, reloadContacts, upsertContact, removeContact,
    memberName, toast, view, setView, switchWorkspace, reloadWorkspaces, signed, ensureSigned, signedVersion,
  }), [user, profile, workspace, workspaces, role, members, reloadMembers, contacts, contactsState, contactsError,
    reloadContacts, upsertContact, removeContact, memberName, toast, view, switchWorkspace, reloadWorkspaces, signed, ensureSigned, signedVersion]);

  // ----- render -----
  if (suspended) {
    return <SuspendedScreen reason={suspended.reason} onBack={() => setSuspended(null)} />;
  }
  if (user === undefined || (user && !profile)) {
    return <div className="boot"><Logo /><Spinner /></div>;
  }
  if (!user) {
    return (
      <AppContext.Provider value={ctx}>
        <AuthScreen onSuspended={(reason) => setSuspended({ reason })} />
        <Toasts toasts={toasts} />
      </AppContext.Provider>
    );
  }

  const isSuper = !!profile?.is_super_admin;
  const nav = [
    { value: 'contacts', label: 'Contacts', icon: 'cards' },
    { value: 'scan', label: 'Scan card', icon: 'scan' },
    { value: 'team', label: 'Team', icon: 'users' },
    ...(isSuper ? [{ value: 'admin', label: 'Super admin', icon: 'shield' }] : []),
  ];
  const go = (v) => {
    setView(v);
    window.scrollTo({ top: 0 });
  };

  let main;
  if (!workspace && view !== 'me' && !(view === 'admin' && isSuper)) {
    main = <NoWorkspace onMe={() => go('me')} />;
  } else if (view === 'scan') main = <Scan key={workspace.id} />;
  else if (view === 'team') main = <Team key={workspace.id} />;
  else if (view === 'admin' && isSuper) main = <SuperAdmin />;
  else if (view === 'me') main = <Me />;
  else main = <Contacts key={workspace.id} />;

  return (
    <AppContext.Provider value={ctx}>
      <div className={`shell view-${view}`}>
        <a className="skip-link" href="#main">Skip to content</a>
        <header className="topbar">
          <button type="button" className="logo-btn" onClick={() => go('contacts')} aria-label="Nomiqo, go to contacts">
            <Logo />
          </button>
          <WorkspaceSwitcher />
          <nav className="topnav" aria-label="Main">
            {nav.map((n) => (
              <button
                key={n.value}
                type="button"
                className={`topnav-item ${view === n.value ? 'is-active' : ''}`}
                aria-current={view === n.value ? 'page' : undefined}
                onClick={() => go(n.value)}
              >
                <Icon name={n.icon} size={17} /> {n.label}
              </button>
            ))}
          </nav>
          {api.isDemo && <span className="demo-badge" title="Sample data, nothing is saved">Demo</span>}
          <button
            type="button"
            className={`avatar-btn ${view === 'me' ? 'is-active' : ''}`}
            onClick={() => go('me')}
            aria-label={`Your account: ${profile.full_name || profile.username}`}
            aria-current={view === 'me' ? 'page' : undefined}
          >
            <Avatar name={profile.full_name || profile.username} size={34} />
          </button>
        </header>

        <main id="main" className="main" tabIndex={-1}>{main}</main>

        <nav className="tabbar" aria-label="Main">
          <TabbarItem icon="cards" label="Contacts" active={view === 'contacts'} onClick={() => go('contacts')} />
          <TabbarItem icon="users" label="Team" active={view === 'team'} onClick={() => go('team')} />
          <button
            type="button"
            className={`tabbar-scan ${view === 'scan' ? 'is-active' : ''}`}
            onClick={() => go('scan')}
            aria-current={view === 'scan' ? 'page' : undefined}
          >
            <span className="tabbar-scan-btn"><Icon name="scan" size={24} strokeWidth={2} /></span>
            <span className="tabbar-label">Scan</span>
          </button>
          {isSuper && <TabbarItem icon="shield" label="Admin" active={view === 'admin'} onClick={() => go('admin')} />}
          <TabbarItem icon="user" label="Me" active={view === 'me'} onClick={() => go('me')} />
        </nav>
      </div>
      <Toasts toasts={toasts} />
    </AppContext.Provider>
  );
}

function TabbarItem({ icon, label, active, onClick }) {
  return (
    <button type="button" className={`tabbar-item ${active ? 'is-active' : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined}>
      <Icon name={icon} size={22} />
      <span className="tabbar-label">{label}</span>
    </button>
  );
}

function WorkspaceSwitcher() {
  const { workspaces, workspace, switchWorkspace } = useApp();
  if (!workspaces || !workspaces.length) return <span className="ws-switch ws-empty">No workspace</span>;
  return (
    <label className="ws-switch">
      <span className="sr-only">Workspace</span>
      <Icon name="building" size={16} className="ws-icon" />
      <select value={workspace?.id || ''} onChange={(e) => switchWorkspace(e.target.value)}>
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>{w.name} · {w.role}</option>
        ))}
      </select>
      <Icon name="chevronDown" size={14} className="ws-caret" />
    </label>
  );
}

function NoWorkspace({ onMe }) {
  return (
    <div className="page narrow">
      <div className="panel center">
        <h1 className="h2">No active workspace</h1>
        <p className="muted">Your access to every workspace has been revoked or the workspace was suspended. You can create a new workspace from your account page.</p>
        <button type="button" className="btn btn-primary" onClick={onMe}>Go to your account</button>
      </div>
    </div>
  );
}

function Toasts({ toasts }) {
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
          <Icon name={t.tone === 'error' ? 'alert' : 'check'} size={16} />
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}
