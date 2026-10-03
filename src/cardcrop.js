// Finding a business card in a photo and straightening it, with no libraries.
// Pure functions on plain arrays so they run (and are tested) outside the browser.

export const CARD_RATIO = 90 / 54; // ISO 7810 ID-1 / common business card

/** Otsu's threshold for an 8-bit grayscale array. */
export function otsu(gray) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; threshold = t; }
  }
  return threshold;
}

function boxBlur(gray, w, h) {
  const out = new Uint8ClampedArray(gray.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          s += gray[yy * w + xx]; n++;
        }
      }
      out[y * w + x] = s / n;
    }
  }
  return out;
}

function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }

/** Andrew's monotone chain convex hull. */
export function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

export function polygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** Order four points as top-left, top-right, bottom-right, bottom-left. */
export function orderCorners(pts) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const byAngle = [...pts].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  // byAngle is clockwise on screen (y down) starting near the left; rotate so the top-left comes first.
  let start = 0;
  for (let i = 1; i < 4; i++) if (byAngle[i][0] + byAngle[i][1] < byAngle[start][0] + byAngle[start][1]) start = i;
  return [0, 1, 2, 3].map((i) => byAngle[(start + i) % 4]);
}

/** The four hull points that enclose the largest area. */
export function bestQuad(hull) {
  if (hull.length < 4) return null;
  // Candidates: hull points furthest along 16 directions keeps this small and fast.
  const cand = [];
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    let best = hull[0], bestV = -Infinity;
    for (const p of hull) {
      const v = p[0] * dx + p[1] * dy;
      if (v > bestV) { bestV = v; best = p; }
    }
    if (!cand.includes(best)) cand.push(best);
  }
  if (cand.length < 4) return null;
  let quad = null, area = -1;
  for (let a = 0; a < cand.length; a++)
    for (let b = a + 1; b < cand.length; b++)
      for (let c = b + 1; c < cand.length; c++)
        for (let d = c + 1; d < cand.length; d++) {
          const q = orderCorners([cand[a], cand[b], cand[c], cand[d]]);
          const ar = polygonArea(q);
          if (ar > area) { area = ar; quad = q; }
        }
  return quad;
}

function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

/** Long side / short side of an ordered quad, and whether it is wider than tall. */
export function quadShape(q) {
  const horiz = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
  const vert = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  return { landscape: horiz >= vert, ratio: Math.max(horiz, vert) / Math.max(1, Math.min(horiz, vert)) };
}

/**
 * Find a card-shaped region in a small grayscale image.
 * Returns an ordered quad in the image's pixel coordinates, or null.
 */
export function detectCard(grayIn, w, h) {
  const gray = boxBlur(boxBlur(grayIn, w, h), w, h);
  const t = otsu(gray);
  // The card is whichever side of the threshold the border is mostly not.
  let borderBright = 0, borderN = 0;
  for (let x = 0; x < w; x++) { borderBright += gray[x] > t; borderBright += gray[(h - 1) * w + x] > t; borderN += 2; }
  for (let y = 0; y < h; y++) { borderBright += gray[y * w] > t; borderBright += gray[y * w + w - 1] > t; borderN += 2; }
  const fgBright = borderBright / borderN < 0.5;
  const fg = new Uint8Array(w * h);
  for (let i = 0; i < fg.length; i++) fg[i] = (gray[i] > t) === fgBright ? 1 : 0;

  // Largest 4-connected foreground region.
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let bestId = 0, bestSize = 0, id = 0;
  for (let i = 0; i < fg.length; i++) {
    if (!fg[i] || label[i]) continue;
    id++;
    let sp = 0, size = 0;
    stack[sp++] = i; label[i] = id;
    while (sp) {
      const j = stack[--sp]; size++;
      const x = j % w, y = (j - x) / w;
      if (x > 0 && fg[j - 1] && !label[j - 1]) { label[j - 1] = id; stack[sp++] = j - 1; }
      if (x < w - 1 && fg[j + 1] && !label[j + 1]) { label[j + 1] = id; stack[sp++] = j + 1; }
      if (y > 0 && fg[j - w] && !label[j - w]) { label[j - w] = id; stack[sp++] = j - w; }
      if (y < h - 1 && fg[j + w] && !label[j + w]) { label[j + w] = id; stack[sp++] = j + w; }
    }
    if (size > bestSize) { bestSize = size; bestId = id; }
  }
  const total = w * h;
  if (!bestId || bestSize < total * 0.06 || bestSize > total * 0.97) return null;

  // Edge pixels of that region feed the hull (interior points can't be on it).
  const edge = [];
  for (let y = 0; y < h; y++) {
    let first = -1, last = -1;
    for (let x = 0; x < w; x++) if (label[y * w + x] === bestId) { if (first < 0) first = x; last = x; }
    if (first >= 0) { edge.push([first, y]); if (last !== first) edge.push([last, y]); }
  }
  const quad = bestQuad(convexHull(edge));
  if (!quad) return null;
  const area = polygonArea(quad);
  // A card fills its quad almost completely, and has roughly card proportions.
  if (bestSize / area < 0.8) return null;
  const { ratio } = quadShape(quad);
  if (ratio < 1.2 || ratio > 2.3) return null;
  return quad;
}

/** A centred card-shaped rectangle, used when nothing is detected. */
export function fallbackQuad(w, h) {
  const landscape = w >= h;
  const ratio = landscape ? CARD_RATIO : 1 / CARD_RATIO;
  let cw = w * 0.86, ch = cw / ratio;
  if (ch > h * 0.86) { ch = h * 0.86; cw = ch * ratio; }
  const x = (w - cw) / 2, y = (h - ch) / 2;
  return [[x, y], [x + cw, y], [x + cw, y + ch], [x, y + ch]];
}

/** Output size for a straightened card with the given long side. */
export function cardOutputSize(quad, longSide) {
  const { landscape } = quadShape(quad);
  const short = Math.round(longSide / CARD_RATIO);
  return landscape ? { width: longSide, height: short } : { width: short, height: longSide };
}

/**
 * Homography mapping the four `from` points onto the four `to` points.
 * Returns [a,b,c,d,e,f,g,h] for x' = (ax+by+c)/(gx+hy+1), y' = (dx+ey+f)/(gx+hy+1).
 */
export function homography(from, to) {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gaussian elimination with partial pivoting on the 8x9 augmented matrix.
  for (let col = 0; col < 8; col++) {
    let piv = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    const p = A[col][col];
    if (Math.abs(p) < 1e-12) return null;
    for (let c = col; c < 9; c++) A[col][c] /= p;
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = A[r][col];
      if (!f) continue;
      for (let c = col; c < 9; c++) A[r][c] -= f * A[col][c];
    }
  }
  return A.map((row) => row[8]);
}

export function applyHomography(H, x, y) {
  const z = H[6] * x + H[7] * y + 1;
  return [(H[0] * x + H[1] * y + H[2]) / z, (H[3] * x + H[4] * y + H[5]) / z];
}

/**
 * Straighten `quad` from RGBA source pixels into a new RGBA buffer of width x height,
 * sampling bilinearly.
 */
export function warpQuad(src, sw, sh, quad, width, height) {
  const out = new Uint8ClampedArray(width * height * 4);
  const H = homography([[0, 0], [width, 0], [width, height], [0, height]], quad);
  if (!H) return null;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [fx, fy] = applyHomography(H, x + 0.5, y + 0.5);
      const sx = Math.min(sw - 1.001, Math.max(0, fx - 0.5));
      const sy = Math.min(sh - 1.001, Math.max(0, fy - 0.5));
      const x0 = sx | 0, y0 = sy | 0;
      const ax = sx - x0, ay = sy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = src[i00 + c] * (1 - ax) + src[i10 + c] * ax;
        const bot = src[i01 + c] * (1 - ax) + src[i11 + c] * ax;
        out[o + c] = top * (1 - ay) + bot * ay;
      }
      out[o + 3] = 255;
    }
  }
  return out;
}
