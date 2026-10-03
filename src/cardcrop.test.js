import { describe, expect, it } from 'vitest';
import {
  CARD_RATIO, applyHomography, cardOutputSize, detectCard, fallbackQuad, homography, orderCorners, quadShape, warpQuad,
} from './cardcrop.js';

function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Grayscale image with a filled polygon on a contrasting, slightly noisy background. */
function scene(w, h, poly, { card = 235, bg = 60 } = {}) {
  const g = new Uint8ClampedArray(w * h);
  let seed = 7;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const noise = (seed % 21) - 10;
      g[y * w + x] = (inside(poly, x + 0.5, y + 0.5) ? card : bg) + noise;
    }
  return g;
}

function rotated(cx, cy, w, h, deg) {
  const a = (deg * Math.PI) / 180;
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [
    cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a),
  ]);
}

const near = (q, truth, tol) => q.every((p, i) => Math.hypot(p[0] - truth[i][0], p[1] - truth[i][1]) <= tol);

describe('detectCard', () => {
  it('finds a light card on a dark table, tilted', () => {
    const truth = orderCorners(rotated(160, 120, 180, 108, 12));
    const q = detectCard(scene(320, 240, truth), 320, 240);
    expect(q).not.toBeNull();
    expect(near(q, truth, 6)).toBe(true);
  });

  it('finds a dark card on a light desk', () => {
    const truth = orderCorners(rotated(150, 130, 200, 120, -8));
    const q = detectCard(scene(320, 260, truth, { card: 40, bg: 220 }), 320, 260);
    expect(q).not.toBeNull();
    expect(near(q, truth, 6)).toBe(true);
  });

  it('finds a portrait card in perspective', () => {
    const truth = [[110, 40], [215, 52], [225, 225], [95, 215]];
    const q = detectCard(scene(320, 260, truth), 320, 260);
    expect(q).not.toBeNull();
    expect(near(q, truth, 6)).toBe(true);
    expect(quadShape(q).landscape).toBe(false);
  });

  it('returns null when there is no card-shaped region', () => {
    const blank = scene(200, 150, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    expect(detectCard(blank, 200, 150)).toBeNull();
    const circleish = scene(200, 150, Array.from({ length: 24 }, (_, i) => [100 + 50 * Math.cos(i / 3.82), 75 + 50 * Math.sin(i / 3.82)]));
    expect(detectCard(circleish, 200, 150)).toBeNull();
  });
});

describe('geometry', () => {
  it('orders corners clockwise from top-left', () => {
    expect(orderCorners([[10, 90], [90, 10], [10, 10], [90, 90]])).toEqual([[10, 10], [90, 10], [90, 90], [10, 90]]);
  });

  it('maps the four corners exactly', () => {
    const from = [[0, 0], [100, 0], [100, 60], [0, 60]];
    const to = [[12, 8], [130, 20], [120, 95], [5, 80]];
    const H = homography(from, to);
    from.forEach((p, i) => {
      const [x, y] = applyHomography(H, p[0], p[1]);
      expect(x).toBeCloseTo(to[i][0], 6);
      expect(y).toBeCloseTo(to[i][1], 6);
    });
  });

  it('keeps card proportions in both orientations', () => {
    expect(cardOutputSize([[0, 0], [90, 0], [90, 54], [0, 54]], 1600)).toEqual({ width: 1600, height: Math.round(1600 / CARD_RATIO) });
    expect(cardOutputSize([[0, 0], [54, 0], [54, 90], [0, 90]], 1600)).toEqual({ width: Math.round(1600 / CARD_RATIO), height: 1600 });
  });

  it('falls back to a centred card-shaped box inside the photo', () => {
    const q = fallbackQuad(400, 300);
    expect(quadShape(q).ratio).toBeCloseTo(CARD_RATIO, 5);
    q.forEach(([x, y]) => { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(400); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(300); });
  });

  it('straightens the card region into the output', () => {
    const w = 120, h = 90;
    const quad = [[20, 15], [100, 25], [95, 75], [15, 65]];
    const src = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = inside(quad, x + 0.5, y + 0.5) ? 250 : 10;
      src.set([v, v, v, 255], (y * w + x) * 4);
    }
    const out = warpQuad(src, w, h, quad, 60, 36);
    let bright = 0;
    for (let i = 0; i < out.length; i += 4) bright += out[i] > 128;
    expect(bright / (60 * 36)).toBeGreaterThan(0.93);
  });
});
