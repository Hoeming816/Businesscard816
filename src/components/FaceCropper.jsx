import { useEffect, useRef, useState } from 'react';
import { dragPan, squareCrop } from '../facecrop.js';
import { Icon, Modal, Spinner } from './ui.jsx';

/**
 * Frames a face photo: drag to move, slider to zoom. The round guide shows
 * how it will look as the contact's picture; Save keeps the square around it.
 */
export default function FaceCropper({ canvas, busy, onSave, onCancel }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const view = useRef(null);
  const drag = useRef(null);
  const w = canvas.width, h = canvas.height;

  useEffect(() => {
    const c = view.current;
    if (!c) return;
    const { sx, sy, size } = squareCrop(w, h, zoom, pan.x, pan.y);
    c.width = c.height = 600;
    c.getContext('2d').drawImage(canvas, sx, sy, size, size, 0, 0, 600, 600);
  }, [canvas, w, h, zoom, pan]);

  const down = (e) => {
    drag.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    if (!drag.current) return;
    e.preventDefault();
    const d = dragPan(w, h, zoom, view.current.getBoundingClientRect().width, e.clientX - drag.current.x, e.clientY - drag.current.y);
    drag.current = { x: e.clientX, y: e.clientY };
    setPan((p) => ({ x: Math.max(-1, Math.min(1, p.x + d.dx)), y: Math.max(-1, Math.min(1, p.y + d.dy)) }));
  };
  const up = () => { drag.current = null; };

  return (
    <Modal title="Face photo" onClose={busy ? () => {} : onCancel} className="face-cropper">
      <p className="small muted">Drag to move the face into the circle. Use the slider to zoom.</p>
      <div className="face-view" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <canvas ref={view} aria-label="Face photo preview" />
        <span className="face-ring" aria-hidden="true" />
      </div>
      <label className="face-zoom">
        <Icon name="search" size={16} />
        <span className="sr-only">Zoom</span>
        <input type="range" min="1" max="4" step="0.05" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
      </label>
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onSave(squareCrop(w, h, zoom, pan.x, pan.y))}>
          {busy ? <><Spinner /> Saving…</> : <><Icon name="check" size={16} /> Save face photo</>}
        </button>
      </div>
    </Modal>
  );
}
