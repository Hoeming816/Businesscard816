// Square crop for a face photo: which part of the photo a zoomed, panned
// square viewport shows. Pure maths so it can be tested without a canvas.

/**
 * zoom 1 = the largest square that fits; pan x/y run from -1 to 1 (0 = centred).
 * Returns { sx, sy, size } in image pixels.
 */
export function squareCrop(w, h, zoom = 1, panX = 0, panY = 0) {
  const size = Math.min(w, h) / Math.max(1, zoom);
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  const sx = ((w - size) / 2) * (1 + clamp(panX));
  const sy = ((h - size) / 2) * (1 + clamp(panY));
  return { sx: Math.round(sx), sy: Math.round(sy), size: Math.round(size) };
}

/** Pan change for a drag of dx, dy screen pixels across a viewport `view` pixels wide. */
export function dragPan(w, h, zoom, view, dx, dy) {
  const { size } = squareCrop(w, h, zoom);
  const px = size / view; // image pixels per screen pixel
  const rx = (w - size) / 2;
  const ry = (h - size) / 2;
  return { dx: rx ? (-dx * px) / rx : 0, dy: ry ? (-dy * px) / ry : 0 };
}
