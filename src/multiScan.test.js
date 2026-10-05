import { describe, it, expect } from 'vitest';
import { boxToRect, quadFitsBox, usableBox } from './multiScan.js';

describe('boxToRect', () => {
  it('converts fractions to pixels', () => {
    expect(boxToRect({ left: 0.1, top: 0.2, width: 0.5, height: 0.25 }, 1000, 800)).toEqual({ x: 100, y: 160, width: 500, height: 200 });
  });
  it('pads and stays inside the photo', () => {
    expect(boxToRect({ left: 0, top: 0, width: 0.5, height: 0.5 }, 1000, 1000, 0.2)).toEqual({ x: 0, y: 0, width: 600, height: 600 });
  });
});

describe('quadFitsBox', () => {
  const rect = { x: 100, y: 100, width: 400, height: 240 };
  const q = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  it('accepts an outline matching the box', () => expect(quadFitsBox(q(110, 105, 390, 235), rect)).toBe(true));
  it('rejects a neighbouring card', () => expect(quadFitsBox(q(520, 100, 400, 240), rect)).toBe(false));
  it('rejects an outline far bigger than the box', () => expect(quadFitsBox(q(0, 0, 900, 700), rect)).toBe(false));
  it('rejects nothing found', () => expect(quadFitsBox(null, rect)).toBe(false));
});

it('usableBox', () => {
  expect(usableBox({ width: 0.3, height: 0.2 })).toBe(true);
  expect(usableBox({ width: 0, height: 0 })).toBe(false);
  expect(usableBox(undefined)).toBe(false);
});
