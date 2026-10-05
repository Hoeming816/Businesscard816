// Several cards in one photo: turning the reader's rough box for each card
// into a crop of that card.

import { polygonArea } from './cardcrop.js';

/** Box (fractions of the photo) -> pixel rect, grown by `pad` of its size on each side and kept inside the photo. */
export function boxToRect(box, w, h, pad = 0) {
  const bx = box.left * w, by = box.top * h, bw = box.width * w, bh = box.height * h;
  const x0 = Math.max(0, Math.floor(bx - bw * pad));
  const y0 = Math.max(0, Math.floor(by - bh * pad));
  const x1 = Math.min(w, Math.ceil(bx + bw * (1 + pad)));
  const y1 = Math.min(h, Math.ceil(by + bh * (1 + pad)));
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}

/**
 * Whether a card outline found inside the padded area really is this card:
 * its centre lies inside the reader's box and its size is close to the box's.
 * `quad` and `rect` are in the same (photo) pixels.
 */
export function quadFitsBox(quad, rect) {
  if (!quad) return false;
  const cx = quad.reduce((s, p) => s + p[0], 0) / 4;
  const cy = quad.reduce((s, p) => s + p[1], 0) / 4;
  if (cx < rect.x || cx > rect.x + rect.width || cy < rect.y || cy > rect.y + rect.height) return false;
  const ratio = polygonArea(quad) / (rect.width * rect.height);
  return ratio > 0.5 && ratio < 1.8;
}

/** Reader boxes too small to be a card (or missing) are left uncropped. */
export const usableBox = (box) => !!box && box.width > 0.03 && box.height > 0.03;
