import { useEffect, useId, useRef, useState } from 'react';
import markUrl from '../assets/nomiqo-mark.png';

// ---------------------------------------------------------------------------
// Icons (inline SVG, 24px grid, stroke = currentColor)
// ---------------------------------------------------------------------------

const PATHS = {
  cards: 'M3 7.5A2.5 2.5 0 0 1 5.5 5h13A2.5 2.5 0 0 1 21 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5zM7 10h6M7 14h9',
  scan: 'M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M7 12h10',
  users: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 19v-1a4 4 0 0 0-3-3.87M15.5 4.13a3 3 0 0 1 0 5.74',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  shield: 'M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z M9 12l2 2 4-4',
  user: 'M20 20v-1a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v1M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M20 20l-4-4',
  filter: 'M4 5h16M7 12h10M10 19h4',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  phone: 'M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3',
  pin: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  unlock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3M6 11a6 6 0 0 0 12 0M12 17v4',
  stop: 'M7 7h10v10H7z',
  sparkles: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  download: 'M12 4v11M7 10.5l5 5 5-5M5 20h14',
  chevronDown: 'M6 9l6 6 6-6',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  building: 'M5 21V4h10v17M15 9h4v12M8 8h4M8 12h4M8 16h4M3 21h18',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  upload: 'M12 16V5M7 9.5l5-5 5 5M5 20h14',
  flip: 'M4 9h13l-3-3M20 15H7l3 3',
  refresh: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4',
  send: 'M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5 21 3z',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  play: 'M8 5l11 7-11 7z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3',
  alert: 'M12 4l9 16H3zM12 10v4M12 17.5v.01',
};

export function Icon({ name, size = 18, className = '', strokeWidth = 1.8, title }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name] || ''} />
    </svg>
  );
}

export function Logo({ compact = false, byline = false, tagline = false }) {
  return (
    <span className="logo">
      <img className="logo-mark" src={markUrl} width="30" height="30" alt="" />
      {!compact && (
        <span className="logo-text">
          <span className="logo-word">Nomi<span className="logo-flow">qo</span></span>
          {byline && <span className="logo-by">by Aspencom</span>}
          {tagline && <span className="logo-tagline">Scan. Organize. Connect.</span>}
        </span>
      )}
    </span>
  );
}

/** After a save: true for a moment so the button can say "Saved". */
export function useJustSaved(ms = 1500) {
  const [on, setOn] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const mark = () => {
    clearTimeout(timer.current);
    setOn(true);
    timer.current = setTimeout(() => setOn(false), ms);
  };
  return [on, mark];
}

/** Button text for a save: "Saving…" while working, then a ticked "Saved", then the normal label. */
export function SaveLabel({ saving, saved, children }) {
  if (saving) return 'Saving…';
  if (saved) return <><Icon name="check" size={16} /> Saved</>;
  return children;
}

export function Spinner({ label = 'Loading' }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}

export function Avatar({ name, size = 32 }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Modal dialog: role=dialog, aria-modal, Escape to close, focus handling
// ---------------------------------------------------------------------------

// Open modals, innermost last: only the top one answers Escape and traps Tab.
const modalStack = [];

export function Modal({ title, labelledBy, onClose, children, className = '', wide = false }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const fallbackId = useId();
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current;
    const first = el && el.querySelector('[data-autofocus]');
    (first || el)?.focus({ preventScroll: true });
    const token = {};
    modalStack.push(token);
    const onKey = (e) => {
      if (modalStack[modalStack.length - 1] !== token) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),audio[controls],[tabindex]:not([tabindex="-1"])')]
          .filter((n) => n.offsetParent !== null);
        if (!items.length) return;
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
        else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      modalStack.splice(modalStack.indexOf(token), 1);
      if (!modalStack.length) document.body.classList.remove('modal-open');
      if (prev && prev.focus) prev.focus({ preventScroll: true });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) closeRef.current(); }}>
      <div
        ref={ref}
        className={`modal ${wide ? 'modal-wide' : ''} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy || fallbackId}
        tabIndex={-1}
      >
        {title && <h2 id={fallbackId} className="modal-title">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline confirmation: first click arms, second click confirms.
// ---------------------------------------------------------------------------

export function ConfirmButton({ children, confirmLabel = 'Confirm', message, onConfirm, className = 'btn btn-danger-ghost', disabled, icon }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!armed) {
    return (
      <button type="button" className={className} disabled={disabled} onClick={() => setArmed(true)}>
        {icon && <Icon name={icon} size={16} />} {children}
      </button>
    );
  }
  return (
    <span className="confirm-inline" role="group" aria-label="Confirm action">
      {message && <span className="confirm-msg">{message}</span>}
      <button
        type="button"
        className="btn btn-danger btn-sm"
        disabled={busy}
        autoFocus
        onClick={async () => {
          setBusy(true);
          try { await onConfirm(); } finally { setBusy(false); setArmed(false); }
        }}
      >
        {busy ? 'Working…' : confirmLabel}
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setArmed(false)} disabled={busy}>Cancel</button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tabs (role=tablist / tab / tabpanel with arrow-key navigation)
// ---------------------------------------------------------------------------

export function Tabs({ tabs, value, onChange, label, className = '' }) {
  const refs = useRef({});
  const onKey = (e, i) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = tabs[(i + dir + tabs.length) % tabs.length];
    onChange(next.value);
    refs.current[next.value]?.focus();
  };
  return (
    <div className={`tabs ${className}`} role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.value}
          ref={(el) => { refs.current[t.value] = el; }}
          type="button"
          role="tab"
          id={`tab-${t.value}`}
          aria-selected={value === t.value}
          aria-controls={`panel-${t.value}`}
          tabIndex={value === t.value ? 0 : -1}
          className={`tab ${value === t.value ? 'is-active' : ''}`}
          onClick={() => onChange(t.value)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {t.img ? <img className="tab-img" src={t.img} alt="" /> : t.icon && <Icon name={t.icon} size={16} />}
          {t.label}
          {t.badge != null && <span className="tab-badge">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pill({ children, tone = 'neutral', icon, title }) {
  return (
    <span className={`pill pill-${tone}`} title={title}>
      {icon && <Icon name={icon} size={12} strokeWidth={2.2} />}
      {children}
    </span>
  );
}

export function EmptyState({ icon = 'cards', title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={28} /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function CopyButton({ value, label, onCopied }) {
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          onCopied && onCopied(`${label} copied`);
        } catch {
          onCopied && onCopied('Copy failed. Select and copy manually.', 'error');
        }
      }}
    >
      <Icon name="copy" size={16} />
    </button>
  );
}

export const formatDate = (iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) => {
  if (!iso) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, opts);
};

export const formatDuration = (sec) => {
  if (sec == null) return '';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
};
