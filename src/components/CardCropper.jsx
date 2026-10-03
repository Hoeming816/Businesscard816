import { useEffect, useRef, useState } from 'react';
import { Icon, Modal, Spinner } from './ui.jsx';

const CORNER_NAMES = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

/**
 * Shows the photo with the detected card outlined. The four corners can be
 * dragged; Crop straightens the outlined area to card proportions.
 */
export default function CardCropper({ side, canvas, initialQuad, detected, busy, onCrop, onSkip, onCancel }) {
  const [quad, setQuad] = useState(initialQuad);
  const [drag, setDrag] = useState(-1);
  const view = useRef(null);
  const svg = useRef(null);
  const w = canvas.width, h = canvas.height;

  useEffect(() => {
    const c = view.current;
    if (!c) return;
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(canvas, 0, 0);
  }, [canvas, w, h]);

  const toImage = (e) => {
    const r = svg.current.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * w;
    const y = ((e.clientY - r.top) / r.height) * h;
    return [Math.min(w, Math.max(0, x)), Math.min(h, Math.max(0, y))];
  };

  const onMove = (e) => {
    if (drag < 0) return;
    e.preventDefault();
    const p = toImage(e);
    setQuad((q) => q.map((c, i) => (i === drag ? p : c)));
  };

  // Handle size in image pixels so it stays finger-sized whatever the photo resolution.
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = svg.current;
    if (!el) return undefined;
    const update = () => setScale(el.getBoundingClientRect().width / w || 1);
    update();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [w]);
  const r = 11 / scale;
  const hit = 26 / scale;

  const points = quad.map((p) => p.join(',')).join(' ');

  return (
    <Modal title={`Crop the ${side.toLowerCase()} of the card`} onClose={busy ? () => {} : onCancel} className="cropper">
      <p className="muted small cropper-hint">
        {detected
          ? 'Nomiqo found the card. Drag a corner if the outline is off.'
          : "Nomiqo couldn't find the card's edges. Drag the four corners onto the card's corners."}
      </p>
      <div className="cropper-stage">
        <div className="cropper-frame" style={{ aspectRatio: `${w} / ${h}`, '--ar': w / h }}>
          <canvas ref={view} className="cropper-photo" aria-hidden="true" />
          <svg
            ref={svg}
            className="cropper-overlay"
            viewBox={`0 0 ${w} ${h}`}
            preserveAspectRatio="none"
            onPointerMove={onMove}
            onPointerUp={() => setDrag(-1)}
            onPointerCancel={() => setDrag(-1)}
            role="group"
            aria-label="Card outline"
          >
            <path
              d={`M0 0H${w}V${h}H0Z M${quad.map((p) => p.join(' ')).join(' L')} Z`}
              fillRule="evenodd"
              className="cropper-shade"
            />
            <polygon points={points} className="cropper-outline" vectorEffect="non-scaling-stroke" />
            {quad.map(([x, y], i) => (
              <g
                key={CORNER_NAMES[i]}
                className={`cropper-handle ${drag === i ? 'is-dragging' : ''}`}
                onPointerDown={(e) => {
                  e.preventDefault();
                  svg.current.setPointerCapture?.(e.pointerId);
                  setDrag(i);
                }}
              >
                <circle cx={x} cy={y} r={hit} className="cropper-hit" />
                <circle cx={x} cy={y} r={r} className="cropper-dot" vectorEffect="non-scaling-stroke" />
                <title>{`Drag the ${CORNER_NAMES[i]} corner`}</title>
              </g>
            ))}
          </svg>
        </div>
      </div>
      <div className="cropper-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onSkip} disabled={busy}>Use whole photo</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQuad(initialQuad)} disabled={busy}>Reset</button>
        <button type="button" className="btn btn-primary" onClick={() => onCrop(quad)} disabled={busy} data-autofocus>
          {busy ? <><Spinner /> Cropping…</> : <><Icon name="check" size={16} /> Crop</>}
        </button>
      </div>
    </Modal>
  );
}
