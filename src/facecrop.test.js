import { describe, expect, it } from 'vitest';
import { dragPan, squareCrop } from './facecrop.js';

describe('squareCrop', () => {
  it('takes the centred largest square at zoom 1', () => {
    expect(squareCrop(1200, 800)).toEqual({ sx: 200, sy: 0, size: 800 });
    expect(squareCrop(800, 1200)).toEqual({ sx: 0, sy: 200, size: 800 });
  });
  it('zooms in around the centre and pans to the edges', () => {
    expect(squareCrop(1000, 1000, 2)).toEqual({ sx: 250, sy: 250, size: 500 });
    expect(squareCrop(1000, 1000, 2, -1, 1)).toEqual({ sx: 0, sy: 500, size: 500 });
    expect(squareCrop(1000, 1000, 2, -5, 5)).toEqual({ sx: 0, sy: 500, size: 500 });
  });
});

describe('dragPan', () => {
  it('moves the crop opposite to the finger, in pan units', () => {
    const p = dragPan(1000, 1000, 2, 250, 50, 0); // 2 image px per screen px, 250 px of room
    expect(p.dx).toBeCloseTo(-0.4);
    expect(p.dy).toBeCloseTo(0);
    expect(dragPan(1000, 1000, 1, 250, 50, 50)).toEqual({ dx: 0, dy: 0 });
  });
});
