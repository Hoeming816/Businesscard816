// Client-side image preparation: resize to max 1600 px (longest side) JPEG.

import { cardOutputSize, detectCard, fallbackQuad, warpQuad } from './cardcrop.js';

export const MAX_SIDE = 1600;
const QUALITY = 0.85;

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch { /* fall back to <img> (older Safari, HEIC handled by the OS) */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export function fitWithin(width, height, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Resize an image File/Blob. Returns { blob, url, base64, width, height }
 * where base64 has no data: prefix and url is an object URL for previews.
 */
export async function prepareImage(file) {
  if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('Please choose an image file.');
  const src = await decode(file);
  const w = src.width || src.naturalWidth;
  const h = src.height || src.naturalHeight;
  const size = fitWithin(w, h);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.drawImage(src, 0, 0, size.width, size.height);
  if (src.close) src.close();
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process the image.'))), 'image/jpeg', QUALITY));
  const base64 = await blobToBase64(blob);
  return { blob, url: URL.createObjectURL(blob), base64, ...size };
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// ---------------------------------------------------------------------------
// Card cropping: load a photo, find the card, straighten it.
// ---------------------------------------------------------------------------

const WORK_SIDE = 2400; // working resolution for cropping
const DETECT_SIDE = 360; // detection runs on a small copy

/** Decode a photo into a canvas (longest side at most WORK_SIDE). */
export async function loadPhoto(file) {
  if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('Please choose an image file.');
  const src = await decode(file);
  const w = src.width || src.naturalWidth;
  const h = src.height || src.naturalHeight;
  const size = fitWithin(w, h, WORK_SIDE);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.drawImage(src, 0, 0, size.width, size.height);
  if (src.close) src.close();
  return canvas;
}

/** Card corners in canvas pixels, or null when no card stands out. */
export function findCard(canvas) {
  const small = fitWithin(canvas.width, canvas.height, DETECT_SIDE);
  const c = document.createElement('canvas');
  c.width = small.width;
  c.height = small.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, small.width, small.height);
  const { data } = ctx.getImageData(0, 0, small.width, small.height);
  const gray = new Uint8ClampedArray(small.width * small.height);
  for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  const quad = detectCard(gray, small.width, small.height);
  if (!quad) return null;
  const sx = canvas.width / small.width, sy = canvas.height / small.height;
  return quad.map(([x, y]) => [x * sx, y * sy]);
}

export { fallbackQuad };

async function canvasResult(canvas) {
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process the image.'))), 'image/jpeg', QUALITY));
  const base64 = await blobToBase64(blob);
  return { blob, url: URL.createObjectURL(blob), base64, width: canvas.width, height: canvas.height };
}

/** Straighten the card inside `quad` to card proportions (long side up to MAX_SIDE). */
export async function cropToCard(canvas, quad) {
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0]].map(([a, b]) => Math.hypot(quad[a][0] - quad[b][0], quad[a][1] - quad[b][1]));
  const longEdge = Math.max(...edges);
  const size = cardOutputSize(quad, Math.max(400, Math.min(MAX_SIDE, Math.round(longEdge))));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const src = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const px = warpQuad(src, canvas.width, canvas.height, quad, size.width, size.height);
  if (!px) throw new Error('Could not straighten that crop. Try moving the corners.');
  const out = document.createElement('canvas');
  out.width = size.width;
  out.height = size.height;
  out.getContext('2d').putImageData(new ImageData(px, size.width, size.height), 0, 0);
  return canvasResult(out);
}

/** The whole photo, resized, for when the person skips cropping. */
export async function wholePhoto(canvas) {
  const size = fitWithin(canvas.width, canvas.height);
  const out = document.createElement('canvas');
  out.width = size.width;
  out.height = size.height;
  out.getContext('2d').drawImage(canvas, 0, 0, size.width, size.height);
  return canvasResult(out);
}

/** A square face photo: the part of `canvas` at { sx, sy, size }, scaled to `out` pixels. */
export async function cropSquare(canvas, { sx, sy, size }, out = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = Math.min(out, Math.round(size));
  c.getContext('2d').drawImage(canvas, sx, sy, size, size, 0, 0, c.width, c.height);
  return canvasResult(c);
}
