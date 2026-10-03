import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../context.js';
import { memberStatus } from './Team.jsx';
import { Icon, Pill, Spinner, Tabs, formatDate } from './ui.jsx';
import { FEATURES, featureOn } from '../features.js';

export default function SuperAdmin() {
  const { api, toast } = useApp();
  const [tab, setTab] = useState('accounts');
  const [profiles, setProfiles] = useState(null);
  const [workspaces, setWorkspaces] = useState(null);
  const [error, setError] = useState('');

  const loadAll = useCallback(async () => {
    try {
      const [p, w] = await Promise.all([api.adminListProfiles(), api.adminListWorkspaces()]);
      setProfiles(p);
      setWorkspaces(w);
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [api]);
  useEffect(() => { loadAll(); }, [loadAll]);

  const counts = profiles && workspaces ? {
    accounts: profiles.length,
    active: profiles.filter((p) => p.status === 'active').length,
    workspaces: workspaces.length,
  } : null;

  return (
    <div className="page admin">
      <div className="page-head">
        <h1 className="h1">Super admin</h1>
        <p className="muted">Manage accounts and workspaces across Nomiqo. Card contents are never visible here.</p>
      </div>
      {error && <p className="notice notice-error" role="alert">{error}</p>}

      <div className="stats">
        <Stat label="Accounts" value={counts?.accounts} />
        <Stat label="Active accounts" value={counts?.active} />
        <Stat label="Workspaces" value={counts?.workspaces} />
      </div>

      <Tabs
        label="Super admin sections"
        value={tab}
        onChange={setTab}
        tabs={[{ value: 'accounts', label: 'Accounts', icon: 'user' }, { value: 'workspaces', label: 'Workspaces', icon: 'building' }]}
      />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="tabpanel">
        {!profiles ? <div className="loading-block"><Spinner /> Loading…</div>
          : tab === 'accounts'
            ? <Accounts profiles={profiles} reload={loadAll} toast={toast} />
            : <Workspaces workspaces={workspaces} reload={loadAll} toast={toast} />}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span className="stat-value mono">{value ?? '–'}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function Accounts({ profiles, reload, toast }) {
  const { api, uid, setProfile } = useApp();
  const [q, setQ] = useState('');
  const [action, setAction] = useState(null); // { id, kind: 'suspend' | 'reset' }
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return profiles.filter((p) => words.every((w) => `${p.username} ${p.full_name}`.toLowerCase().includes(w)));
  }, [profiles, q]);

  const run = async (kind, p, extra) => {
    setBusy(true);
    try {
      await api.adminUserAction(kind, p.id, extra);
      toast(kind === 'suspend' ? `Access cancelled for @${p.username}` : kind === 'reinstate' ? `@${p.username} reinstated` : `Password reset for @${p.username}`);
      setAction(null);
      setInput('');
      await reload();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="input-icon search admin-search">
        <Icon name="search" size={16} />
        <input type="search" placeholder="Search username or name" aria-label="Search accounts" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th scope="col">Account</th><th scope="col">Status</th><th scope="col">Joined</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {list.map((p) => {
              const self = p.id === uid;
              const open = action && action.id === p.id;
              return (
                <Fragment key={p.id}>
                  <tr className={p.status === 'suspended' ? 'is-inactive' : ''}>
                    <td>
                      <span className="cell-main">{p.full_name || '—'} {p.is_super_admin && <Pill tone="accent" icon="shield">Super admin</Pill>}{self && <span className="muted"> (you)</span>}</span>
                      <span className="mono small muted">@{p.username}</span>
                    </td>
                    <td>
                      {p.status === 'active' ? <Pill tone="ok">Active</Pill> : <Pill tone="danger">Suspended</Pill>}
                      {p.status === 'suspended' && p.suspended_reason && <span className="small muted block reason-cell">{p.suspended_reason}</span>}
                    </td>
                    <td className="mono small" data-label="Joined">{formatDate(p.created_at)}</td>
                    <td className="actions-cell">
                      {p.status === 'active' ? (
                        <button type="button" className="btn btn-danger-ghost btn-sm" disabled={self || busy}
                          title={self ? 'You cannot suspend yourself' : undefined}
                          onClick={() => { setAction({ id: p.id, kind: 'suspend' }); setInput(''); }}>
                          Cancel access
                        </button>
                      ) : (
                        <button type="button" className="btn btn-outline btn-sm" disabled={self || busy} onClick={() => run('reinstate', p)}>Reinstate</button>
                      )}
                      <button type="button" className="btn btn-outline btn-sm" disabled={busy}
                        aria-expanded={!!open && action.kind === 'features'}
                        onClick={() => setAction(open && action.kind === 'features' ? null : { id: p.id, kind: 'features' })}>
                        <Icon name="sliders" size={14} /> Features{offCount(p) ? ` (${offCount(p)} off)` : ''}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={self || busy}
                        title={self ? 'Change your own password from Me' : undefined}
                        onClick={() => { setAction({ id: p.id, kind: 'reset' }); setInput(''); }}>
                        Reset password
                      </button>
                    </td>
                  </tr>
                  {open && action.kind === 'features' && (
                    <tr className="action-row">
                      <td colSpan={4}>
                        <FeatureSwitches
                          p={p}
                          onSaved={(saved) => {
                            if (saved.id === uid) setProfile((me) => ({ ...me, features: saved.features }));
                            return reload();
                          }}
                        />
                      </td>
                    </tr>
                  )}
                  {open && action.kind !== 'features' && (
                    <tr className="action-row">
                      <td colSpan={4}>
                        <form
                          className="inline-form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (action.kind === 'suspend') run('suspend', p, { reason: input.trim() || undefined });
                            else if (input.length >= 8) run('reset_password', p, { password: input });
                          }}
                        >
                          <div className="field grow">
                            <label htmlFor={`act-${p.id}`}>
                              {action.kind === 'suspend' ? `Reason shown to @${p.username}` : `New password for @${p.username} (8+ characters)`}
                            </label>
                            <input id={`act-${p.id}`} autoFocus type={action.kind === 'reset' ? 'text' : 'text'} autoComplete="off"
                              className={action.kind === 'reset' ? 'mono' : undefined}
                              value={input} onChange={(e) => setInput(e.target.value)} />
                          </div>
                          <button type="submit" className={`btn ${action.kind === 'suspend' ? 'btn-danger' : 'btn-primary'}`} disabled={busy || (action.kind === 'reset' && input.length < 8)}>
                            {action.kind === 'suspend' ? 'Cancel access' : 'Set password'}
                          </button>
                          <button type="button" className="btn btn-ghost" onClick={() => setAction(null)}>Back</button>
                        </form>
                        {action.kind === 'suspend' && <p className="help">They are signed out everywhere and lose access to every workspace until reinstated.</p>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!list.length && <tr><td colSpan={4} className="muted center">No accounts match.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

const offCount = (p) => FEATURES.filter((f) => !featureOn(p, f.key)).length;

/** On/off switches for what one account can use. Each switch saves straight away. */
function FeatureSwitches({ p, onSaved }) {
  const { api, toast } = useApp();
  const [features, setFeatures] = useState(() => ({ ...(p.features || {}) }));
  const [saving, setSaving] = useState(null);

  const toggle = async (key, on) => {
    const before = features;
    const next = { ...features };
    if (on) delete next[key]; else next[key] = false;
    setFeatures(next); // show the change straight away
    setSaving(key);
    try {
      const saved = await api.adminSetFeatures(p.id, next);
      setFeatures(saved.features || {});
      await onSaved(saved);
    } catch (e) {
      setFeatures(before);
      toast(e.message, 'error');
    } finally {
      setSaving(null);
    }
  };

  return (
    <fieldset className="feature-switches">
      <legend>Features for @{p.username}</legend>
      {FEATURES.map((f) => {
        const on = features[f.key] !== false;
        return (
          <label key={f.key} className="feature-switch">
            <input type="checkbox" role="switch" checked={on} disabled={saving !== null} onChange={(e) => toggle(f.key, e.target.checked)} />
            <span>
              <strong>{f.label}</strong> {saving === f.key ? <span className="muted small">Saving…</span> : <span className={`small ${on ? 'feature-on' : 'feature-off'}`}>{on ? 'On' : 'Off'}</span>}
              <span className="help block">{f.help}</span>
            </span>
          </label>
        );
      })}
      <p className="help">Changes take effect the next time they open the app. AI, sharing and recording are also blocked on the server when switched off.</p>
    </fieldset>
  );
}

function Workspaces({ workspaces, reload, toast }) {
  const { api } = useApp();
  const [open, setOpen] = useState(null);
  const [members, setMembers] = useState({});
  const [q, setQ] = useState('');

  const loadMembers = async (id) => {
    try {
      const m = await api.adminWorkspaceMembers(id);
      setMembers((x) => ({ ...x, [id]: m }));
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const toggle = (id) => {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    loadMembers(id);
  };
  const setStatus = async (w, status) => {
    try {
      await api.adminSetWorkspaceStatus(w.id, status);
      toast(`${w.name} ${status === 'suspended' ? 'suspended' : 'reactivated'}`);
      await reload();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const setMember = async (wsId, m, status) => {
    try {
      await api.updateMember(wsId, m.user_id, { status });
      await loadMembers(wsId);
      await reload();
      toast(status === 'revoked' ? 'Membership revoked' : 'Membership restored');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = workspaces.filter((w) => words.every((x) => `${w.name} ${w.owner_username} ${w.owner_name}`.toLowerCase().includes(x)));

  return (
    <>
      <div className="input-icon search admin-search">
        <Icon name="search" size={16} />
        <input type="search" placeholder="Search workspace or owner" aria-label="Search workspaces" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Workspace</th><th scope="col">Owner</th><th scope="col" className="num">Members</th>
              <th scope="col" className="num">Cards</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {list.map((w) => (
              <Fragment key={w.id}>
                <tr className={w.status === 'suspended' ? 'is-inactive' : ''}>
                  <td>
                    <button type="button" className="expand" aria-expanded={open === w.id} onClick={() => toggle(w.id)}>
                      <Icon name={open === w.id ? 'chevronDown' : 'chevronRight'} size={16} />
                      <span className="cell-main">{w.name}</span>
                    </button>
                    <span className="small muted block indent">Created {formatDate(w.created_at)}</span>
                  </td>
                  <td className="owner-cell"><span className="cell-main">{w.owner_name}</span> <span className="mono small muted">@{w.owner_username}</span></td>
                  <td className="num mono" data-label="Members">{w.active_members}</td>
                  <td className="num mono" data-label="Cards">{w.card_count}</td>
                  <td>{w.status === 'active' ? <Pill tone="ok">Active</Pill> : <Pill tone="danger">Suspended</Pill>}</td>
                  <td className="actions-cell">
                    {w.status === 'active'
                      ? <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => setStatus(w, 'suspended')}>Suspend</button>
                      : <button type="button" className="btn btn-outline btn-sm" onClick={() => setStatus(w, 'active')}>Reactivate</button>}
                  </td>
                </tr>
                {open === w.id && (
                  <tr className="action-row">
                    <td colSpan={6}>
                      {!members[w.id] ? <Spinner /> : (
                        <ul className="sub-members">
                          {members[w.id].map((m) => {
                            const st = memberStatus(m);
                            const owner = m.user_id === w.owner_id;
                            return (
                              <li key={m.user_id}>
                                <span className="grow"><strong>{m.full_name || m.username}</strong> <span className="mono small muted">@{m.username}</span></span>
                                <span className="small">{m.role}{owner ? ' · owner' : ''}</span>
                                <Pill tone={st.tone}>{st.label}</Pill>
                                {m.status === 'active'
                                  ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMember(w.id, m, 'revoked')}>Revoke</button>
                                  : <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMember(w.id, m, 'active')}>Restore</button>}
                              </li>
                            );
                          })}
                          {!members[w.id].length && <li className="muted">No members.</li>}
                        </ul>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
