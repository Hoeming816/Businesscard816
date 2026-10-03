import { useEffect, useRef, useState } from 'react';
import { SPEECH_LANGUAGES } from '../taxonomy.js';
import { load, save } from '../storage.js';
import { Icon, formatDuration } from './ui.jsx';

const LANG_KEY = 'cardfile.speechLang';
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac'];

export const SpeechRecognitionImpl = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
export const canRecord = typeof window !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

export function pickMime() {
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}
export const extFor = (mime) => (/mp4|aac/.test(mime || '') ? 'mp4' : 'webm');

/** BCP-47 speech code -> 2-letter code for server transcription. */
export function whisperLang(code) {
  const base = String(code || 'en').split('-')[0];
  return base === 'fil' ? 'tl' : base.slice(0, 2);
}

export function useSpeechLanguage() {
  const [lang, setLang] = useState(() => load(LANG_KEY, 'en-US'));
  return [lang, (v) => { setLang(v); save(LANG_KEY, v); }];
}

/**
 * Records a conversation. Shows the consent reminder before every recording,
 * a timer, an input level meter and (where supported) a live transcript.
 * onRecorded({ blob, ext, duration, url, liveTranscript })
 */
export default function Recorder({ onRecorded, lang, setLang, autoStart = false }) {
  const [phase, setPhase] = useState(autoStart ? 'consent' : 'idle'); // idle | consent | starting | recording
  const [elapsed, setElapsed] = useState(0);
  const [live, setLive] = useState('');
  const [error, setError] = useState('');
  const meterRef = useRef(null);
  const rec = useRef({});

  const cleanup = () => {
    const r = rec.current;
    if (r.raf) cancelAnimationFrame(r.raf);
    if (r.timer) clearInterval(r.timer);
    if (r.recognition) { r.stopRecognition = true; try { r.recognition.stop(); } catch { /* ignore */ } }
    if (r.stream) r.stream.getTracks().forEach((t) => t.stop());
    if (r.audioCtx) r.audioCtx.close().catch(() => {});
    rec.current = {};
  };
  useEffect(() => cleanup, []);

  const start = async () => {
    setError('');
    setLive('');
    setPhase('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mime = pickMime();
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      const r = { stream, mr, chunks, startedAt: Date.now(), finalText: '' };
      rec.current = r;
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = () => {
        const type = mr.mimeType || mime || 'audio/webm';
        const blob = new Blob(chunks, { type });
        const duration = Math.round((Date.now() - r.startedAt) / 1000);
        const liveTranscript = r.finalText.trim();
        cleanup();
        setPhase('idle');
        onRecorded({ blob, ext: extFor(type), duration, url: URL.createObjectURL(blob), liveTranscript });
      };
      mr.start(1000);

      // Level meter
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        const audioCtx = new AC();
        const src = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        r.audioCtx = audioCtx;
        const loop = () => {
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
          const level = Math.min(1, Math.sqrt(sum / data.length) * 3.2);
          if (meterRef.current) meterRef.current.style.transform = `scaleX(${level.toFixed(3)})`;
          r.raf = requestAnimationFrame(loop);
        };
        loop();
      }

      // Live transcript
      if (SpeechRecognitionImpl) {
        const recognition = new SpeechRecognitionImpl();
        recognition.lang = lang;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.onresult = (e) => {
          let interim = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i];
            if (res.isFinal) r.finalText += `${res[0].transcript.trim()} `;
            else interim += res[0].transcript;
          }
          setLive(`${r.finalText}${interim}`);
        };
        recognition.onerror = (e) => { if (e.error === 'not-allowed') r.stopRecognition = true; };
        recognition.onend = () => {
          if (!r.stopRecognition && rec.current === r) { try { recognition.start(); } catch { /* ignore */ } }
        };
        r.recognition = recognition;
        try { recognition.start(); } catch { /* ignore */ }
      }

      setElapsed(0);
      r.timer = setInterval(() => setElapsed(Math.round((Date.now() - r.startedAt) / 1000)), 500);
      setPhase('recording');
    } catch (e) {
      cleanup();
      setPhase('idle');
      setError(e && e.name === 'NotAllowedError'
        ? 'Microphone access was blocked. Allow it in your browser settings and try again.'
        : `Could not start recording: ${e.message || e.name}`);
    }
  };

  const stop = () => {
    const r = rec.current;
    if (r.recognition) { r.stopRecognition = true; try { r.recognition.stop(); } catch { /* ignore */ } }
    if (r.mr && r.mr.state !== 'inactive') r.mr.stop();
  };

  if (!canRecord) {
    return <p className="notice notice-info"><Icon name="mic" size={14} /> Recording is not supported in this browser.</p>;
  }

  return (
    <div className="recorder">
      {phase === 'idle' && (
        <button type="button" className="btn btn-outline" onClick={() => setPhase('consent')}>
          <Icon name="mic" size={16} /> Record conversation
        </button>
      )}

      {phase === 'consent' && (
        <div className="consent" role="alertdialog" aria-labelledby="consent-h" aria-describedby="consent-p">
          <h4 id="consent-h"><Icon name="alert" size={16} /> Ask before you record</h4>
          <p id="consent-p">Tell everyone in the conversation that you are recording and get their agreement first. Recording people without consent may be illegal where you are.</p>
          {SpeechRecognitionImpl && (
            <label className="select-inline">
              <span>Live transcript language</span>
              <select value={lang} onChange={(e) => setLang(e.target.value)}>
                {SPEECH_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </label>
          )}
          <div className="row-actions">
            <button type="button" className="btn btn-primary" onClick={start} autoFocus>
              <Icon name="mic" size={16} /> Everyone agreed, start recording
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setPhase('idle')}>Cancel</button>
          </div>
        </div>
      )}

      {(phase === 'starting' || phase === 'recording') && (
        <div className="rec-live">
          <div className="rec-head">
            <span className="rec-dot" aria-hidden="true" />
            <span className="rec-time mono" aria-live="off">{formatDuration(elapsed)}</span>
            <span className="meter" aria-hidden="true"><span ref={meterRef} className="meter-fill" /></span>
            <button type="button" className="btn btn-danger" onClick={stop} disabled={phase !== 'recording'}>
              <Icon name="stop" size={16} /> Stop
            </button>
          </div>
          <p className="sr-only" role="status">{phase === 'recording' ? 'Recording' : 'Starting microphone'}</p>
          {SpeechRecognitionImpl && (
            <div className="live-transcript" aria-live="polite">
              <span className="label">Live transcript</span>
              <p>{live || <span className="muted">Listening…</span>}</p>
            </div>
          )}
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
