import { describe, expect, it } from 'vitest';
import { isWebm, splitWebm } from './webmSplit.js';

// A tiny WebM-shaped file: EBML header, a segment of unknown size (as Chrome
// records), Info, Tracks, then clusters of unknown size with one block each.
const el = (id, body) => [...id, 0x01, 0, 0, 0, 0, 0, 0, body.length, ...body]; // 8-byte size
const UNKNOWN = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
const cluster = (tc, block) => [0x1f, 0x43, 0xb6, 0x75, ...UNKNOWN, 0xe7, 0x82, tc >> 8, tc & 0xff, ...el([0xa3], block)];
const file = () => new Blob([new Uint8Array([
  ...el([0x1a, 0x45, 0xdf, 0xa3], [0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]),
  0x18, 0x53, 0x80, 0x67, ...UNKNOWN,
  ...el([0x15, 0x49, 0xa9, 0x66], [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40]), // 1 ms ticks
  ...el([0x16, 0x54, 0xae, 0x6b], [0xae, 0x80]),
  ...cluster(0, [1, 1, 1]),
  ...cluster(3000, [2, 2, 2]),
  ...cluster(6000, [3, 3, 3]),
  ...cluster(9000, [4, 4, 4]),
])], { type: 'audio/webm' });

const bytes = async (b) => [...new Uint8Array(await b.arrayBuffer())];
const indexOf = (hay, needle) => hay.findIndex((_, i) => needle.every((x, j) => hay[i + j] === x));

describe('splitWebm', () => {
  it('cuts at the part length, each part with the header and its own clusters from time 0', async () => {
    const f = file();
    expect(await isWebm(f)).toBe(true);
    const { parts, duration } = await splitWebm(f, 5);
    expect(duration).toBe(10);
    expect(parts.map((p) => p.duration)).toEqual([6, 4]);
    const second = await bytes(parts[1].blob);
    expect(second.slice(0, 4)).toEqual([0x1a, 0x45, 0xdf, 0xa3]); // a file of its own
    expect(indexOf(second, [0x16, 0x54, 0xae, 0x6b])).toBeGreaterThan(0); // codec details kept
    expect(indexOf(second, [1, 1, 1])).toBe(-1);
    expect(indexOf(second, [3, 3, 3])).toBeGreaterThan(0);
    // Its first cluster now starts at 0, the next 3000 ms later.
    const tc = (at) => second.slice(at + 14, at + 22).reduce((v, b) => v * 256 + b, 0);
    const first = indexOf(second, [0x1f, 0x43, 0xb6, 0x75]);
    expect(tc(first)).toBe(0);
    expect(tc(indexOf(second.slice(first + 1), [0x1f, 0x43, 0xb6, 0x75]) + first + 1)).toBe(3000);
  });

  it('keeps a short file in one part', async () => {
    const { parts } = await splitWebm(file(), 1200);
    expect(parts).toHaveLength(1);
  });

  it('refuses a file that is not WebM', async () => {
    const mp3 = new Blob([new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0])]);
    expect(await isWebm(mp3)).toBe(false);
    await expect(splitWebm(mp3, 60)).rejects.toThrow();
  });
});
