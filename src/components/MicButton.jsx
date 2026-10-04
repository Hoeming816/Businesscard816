import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context.js';
import { MINUTES_LANGUAGES } from '../minutes.js';
import { canRecord, extFor, pickMime } from './Recorder.jsx';
import { Icon } from './ui.jsx';

// The language spoken notes and tasks are written in: English unless another is picked,
// kept on this device (shared with the To Do List's "Voice tasks in").
const VOICE_LANG_KEY = 'nomiqo.voiceLanguage';
export function readVoiceLang() {
  try { const v = localStorage.getItem(VOICE_LANG_KEY); return MINUTES_LANGUAGES.some((l) => l.value === v) ? v : 'English'; } catch { return 'English'; }
}
export function useVoiceLang() {
  const [lang, setLangRaw] = useState(readVoiceLang);
  const setLang = (v) => { setLangRaw(v); try { localStorage.setItem(VOICE_LANG_KEY, v); } catch { /* private mode */ } };
  return [lang, setLang];
}

/** "Voice in [English ▾]" */
export function VoiceLangPicker({ lang, setLang, disabled, label = 'Voice in' }) {
  if (!canRecord) return null;
  return (
    <label className="quick-add-lang small muted">
      <Icon name="mic" size={13} /> {label}
      <select value={lang} onChange={(e) => setLang(e.target.value)} disabled={disabled}>
        {MINUTES_LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
      </select>
    </label>
  );
}

/**
 * Tap to speak, tap again to stop (it also stops by itself after `maxSec`).
 * onRecorded(blob, ext) gets the recording.
 */
export default function MicButton({ onRecorded, disabled, maxSec = 180, label = 'Speak', stopLabel = 'Stop', className = 'btn-outline' }) {
  const { toast } = useApp();
  const [on, setOn] = useState(false);
  const [secs, setSecs] = useState(0);
  const rec = useRef(null);

  useEffect(() => () => stopAll(), []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!canRecord) return null;

  function stopAll() {
    const r = rec.current;
    if (!r) return;
    clearInterval(r.timer);
    r.stream?.getTracks().forEach((t) => t.stop());
  }

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mime = pickMime();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      const startedAt = Date.now();
      const r = { stream, mr, chunks };
      rec.current = r;
      mr.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      mr.onstop = () => {
        stopAll();
        rec.current = null;
        setOn(false);
        const type = (mr.mimeType || mime || 'audio/webm').split(';')[0];
        const blob = new Blob(chunks, { type });
        if (!blob.size || Date.now() - startedAt < 600) { toast('Nothing was heard. Tap the mic and speak, then tap it again.', 'error'); return; }
        onRecorded(blob, extFor(type));
      };
      mr.start();
      setSecs(0);
      r.timer = setInterval(() => {
        const s = Math.round((Date.now() - startedAt) / 1000);
        setSecs(s);
        if (s >= maxSec && mr.state !== 'inactive') mr.stop();
      }, 250);
      setOn(true);
    } catch (e) {
      toast(e?.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in your browser settings.' : 'Could not start the microphone.', 'error');
    }
  };
  const stop = () => { const r = rec.current; if (r && r.mr.state !== 'inactive') r.mr.stop(); };

  return (
    <button
      type="button"
      className={`btn ${on ? 'btn-danger' : className} voice-btn`}
      onClick={on ? stop : start}
      disabled={disabled && !on}
      aria-label={on ? stopLabel : label}
      title={on ? 'Tap to stop' : label}
    >
      <Icon name={on ? 'stop' : 'mic'} size={18} />
      {on && <span className="mono small">{secs}s</span>}
    </button>
  );
}
