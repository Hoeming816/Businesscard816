import { useEffect, useState } from 'react';
import { useApp } from '../context.js';
import { Icon, Logo } from './ui.jsx';

export const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

export default function AuthScreen({ onSuspended }) {
  const { api } = useApp();
  const [mode, setMode] = useState('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [avail, setAvail] = useState(null); // null | 'checking' | true | false

  const uname = username.trim().toLowerCase();
  const unameValid = USERNAME_RE.test(uname);

  useEffect(() => {
    if (mode !== 'signup' || !unameValid) { setAvail(null); return undefined; }
    setAvail('checking');
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const ok = await api.usernameAvailable(uname);
        if (alive) setAvail(ok);
      } catch {
        if (alive) setAvail(null);
      }
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [uname, unameValid, mode, api]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (mode === 'signup') {
      if (!fullName.trim()) return setError('Please enter your full name.');
      if (!unameValid) return setError('Usernames are 3–30 characters: lowercase letters, numbers, dot, underscore or hyphen.');
      if (password.length < 8) return setError('Passwords need at least 8 characters.');
      if (avail === false) return setError('That username is already taken.');
    } else if (!uname || !password) {
      return setError('Enter your username and password.');
    }
    setBusy(true);
    try {
      if (mode === 'signup') {
        if (!(await api.usernameAvailable(uname))) throw new Error('That username is already taken.');
        await api.signUp({ username: uname, password, full_name: fullName });
      } else {
        await api.signIn(uname, password);
      }
    } catch (err) {
      if (err.suspended) onSuspended(err.reason);
      else setError(err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (m) => { setMode(m); setError(''); };

  return (
    <div className="auth">
      <div className="auth-art" aria-hidden="true">
        <div className="auth-card c1" />
        <div className="auth-card c2" />
        <div className="auth-card c3">
          <span className="ac-line w60" /><span className="ac-line w40" /><span className="ac-line w75 mono" />
        </div>
      </div>
      <div className="auth-panel">
        <Logo byline tagline />
        <h1 className="auth-title">{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1>
        <p className="muted auth-sub">
          {mode === 'signin'
            ? 'Scan, file and follow up on every business card your team collects.'
            : 'You get your own workspace straight away. Invite colleagues later from Team.'}
        </p>
        {api.isDemo && (
          <p className="notice notice-info"><span>Demo mode with sample data: any password works. Sign in as <strong>alex.tan</strong>, or try <strong>jun.delacruz</strong> to see a suspended account.</span></p>
        )}
        {!api.isConfigured && (
          <p className="notice notice-warn">Supabase is not configured. Copy <code>.env.example</code> to <code>.env</code> and set your project URL and anon key.</p>
        )}
        <form onSubmit={submit} className="form" noValidate>
          {mode === 'signup' && (
            <div className="field">
              <label htmlFor="fullname">Full name</label>
              <input id="fullname" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
          )}
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))}
              aria-describedby="username-help"
              required
            />
            <p id="username-help" className={`help ${mode === 'signup' && avail === false ? 'help-error' : ''}`} aria-live="polite">
              {mode === 'signup'
                ? (!username ? '3–30 characters: a–z, 0–9, dot, underscore, hyphen.'
                  : !unameValid ? 'Use 3–30 characters: a–z, 0–9, dot, underscore, hyphen.'
                    : avail === 'checking' ? 'Checking availability…'
                      : avail === true ? <span className="help-ok"><Icon name="check" size={14} /> Available</span>
                        : avail === false ? 'Already taken. Try another.' : '')
                : ' '}
            </p>
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={mode === 'signup' ? 8 : undefined}
              required
            />
            {mode === 'signup' && <p className="help">At least 8 characters.</p>}
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <p className="auth-switch">
          {mode === 'signin' ? (
            <>New to Nomiqo? <button type="button" className="link" onClick={() => switchMode('signup')}>Create an account</button></>
          ) : (
            <>Already have an account? <button type="button" className="link" onClick={() => switchMode('signin')}>Sign in</button></>
          )}
        </p>
        <p className="help auth-foot">Forgot your password? Ask your Nomiqo administrator to reset it.</p>
      </div>
    </div>
  );
}

export function SuspendedScreen({ reason, onBack }) {
  return (
    <div className="auth auth-single">
      <div className="auth-panel center">
        <div className="suspended-icon"><Icon name="lock" size={28} /></div>
        <h1 className="auth-title">Access suspended</h1>
        <p className="muted">Your Nomiqo account has been suspended by an administrator, so you cannot sign in or see any workspace data.</p>
        {reason ? (
          <blockquote className="reason"><span className="reason-label">Reason given</span>{reason}</blockquote>
        ) : null}
        <p className="help">If you think this is a mistake, contact your Nomiqo administrator.</p>
        <button type="button" className="btn btn-ghost" onClick={onBack}><Icon name="chevronLeft" size={16} /> Back to sign in</button>
      </div>
    </div>
  );
}
