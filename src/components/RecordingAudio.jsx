import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useApp } from '../context.js';
import { PART_SEC } from '../minutes.js';
import { formatDuration } from './ui.jsx';

/**
 * Plays a saved recording. A long one is saved in parts; they play one after
 * another, with a picker to jump to a part. ref.seek(seconds) plays from that
 * point of the whole recording (used by the timed transcript).
 */
const RecordingAudio = forwardRef(function RecordingAudio({ paths, duration, preload = 'metadata', label = 'Recording' }, ref) {
  const { ensureSigned, signed } = useApp();
  const [part, setPart] = useState(0);
  const audioRef = useRef(null);
  const pending = useRef(null); // { at, play } to apply once the next part has loaded
  const key = paths.join('\n');
  useEffect(() => { if (paths.length) ensureSigned('recordings', paths); }, [key, ensureSigned]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPart(0); }, [key]);
  const n = paths.length;
  const url = n ? signed('recordings', paths[Math.min(part, n - 1)]) : null;

  const go = (k, at = 0, play = false) => {
    const a = audioRef.current;
    if (k === part && a) {
      a.currentTime = at;
      if (play) a.play().catch(() => {});
      return;
    }
    pending.current = { at, play };
    setPart(k);
  };
  useImperativeHandle(ref, () => ({
    seek(sec) {
      const k = Math.max(0, Math.min(n - 1, Math.floor(sec / PART_SEC)));
      go(k, Math.max(0, sec - k * PART_SEC), true);
    },
  }));

  if (!n) return null;
  if (!url) return <span className="muted small">Loading recording…</span>;
  const total = duration ? ` of ${formatDuration(duration)}` : '';
  return (
    <span className="recording-audio">
      <audio
        ref={audioRef}
        controls
        preload={preload}
        src={url}
        aria-label={n > 1 ? `${label}, part ${part + 1} of ${n}` : `${label}${duration ? `, ${formatDuration(duration)}` : ''}`}
        onLoadedMetadata={(e) => {
          const p = pending.current;
          pending.current = null;
          if (!p) return;
          const a = e.currentTarget;
          const play = () => { if (p.play) a.play().catch(() => {}); };
          // Recorded webm files have no index, so play only once the seek has landed.
          if (p.at) { a.addEventListener('seeked', play, { once: true }); a.currentTime = p.at; } else play();
        }}
        onEnded={() => { if (part < n - 1) go(part + 1, 0, true); }}
      />
      {n > 1 && (
        <select className="recording-part" value={part} onChange={(e) => go(Number(e.target.value))} aria-label={`Part of the recording${total}`}>
          {paths.map((p, k) => (
            <option key={p} value={k}>Part {k + 1} of {n} · from {formatDuration(k * PART_SEC)}</option>
          ))}
        </select>
      )}
    </span>
  );
});

export default RecordingAudio;
