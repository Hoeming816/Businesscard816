// Splits a long WebM recording (what Chrome, Edge and Android record) into
// parts of about `partSec` seconds, each a complete file that plays and
// transcribes on its own. It works on the file's clusters (blocks of a few
// seconds of audio): every part gets the original header (codec details) and
// its run of clusters, with the cluster times restarted from zero. The audio is
// copied byte for byte, never decoded, so an 8-hour file is no problem.

const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Tracks: 0x1654ae6b,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  Cues: 0x1c53bb6b,
};
const UNKNOWN = -1;
const UNKNOWN_SIZE = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

/** Reads a Blob in large windows so parsing can step through millions of small elements. */
class Reader {
  constructor(blob, windowSize = 8 * 1024 * 1024) {
    this.blob = blob;
    this.size = blob.size;
    this.win = windowSize;
    this.start = 0;
    this.bytes = new Uint8Array(0);
  }

  async ensure(pos, n) {
    if (pos >= this.start && pos + n <= this.start + this.bytes.length) return;
    const end = Math.min(this.size, pos + Math.max(n, this.win));
    this.bytes = new Uint8Array(await this.blob.slice(pos, end).arrayBuffer());
    this.start = pos;
  }

  async byte(pos) {
    await this.ensure(pos, 1);
    return this.bytes[pos - this.start];
  }

  /** An element ID (marker bits kept), as { value, length }. */
  async id(pos) {
    const first = await this.byte(pos);
    let length = 1;
    while (length <= 4 && !(first & (0x80 >> (length - 1)))) length++;
    if (length > 4) throw new Error('Not a WebM file');
    await this.ensure(pos, length);
    let value = 0;
    for (let k = 0; k < length; k++) value = value * 256 + this.bytes[pos - this.start + k];
    return { value, length };
  }

  /** An element size (marker bit removed), as { value, length }; all ones means unknown. */
  async size_(pos) {
    const first = await this.byte(pos);
    let length = 1;
    while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
    if (length > 8) throw new Error('Not a WebM file');
    await this.ensure(pos, length);
    let value = first & (0xff >> length);
    let allOnes = value === (0xff >> length);
    for (let k = 1; k < length; k++) {
      const b = this.bytes[pos - this.start + k];
      if (b !== 0xff) allOnes = false;
      value = value * 256 + b;
    }
    return { value: allOnes ? UNKNOWN : value, length };
  }

  /** Element header at pos: { id, size, dataStart }. */
  async head(pos) {
    const id = await this.id(pos);
    const size = await this.size_(pos + id.length);
    return { id: id.value, size: size.value, dataStart: pos + id.length + size.length };
  }

  async uint(pos, n) {
    await this.ensure(pos, n);
    let v = 0;
    for (let k = 0; k < n; k++) v = v * 256 + this.bytes[pos - this.start + k];
    return v;
  }
}

const isTopLevel = (id) => id === ID.Cluster || id === ID.Cues || id === ID.Tracks || id === ID.Info || id === 0x114d9b74 || id === 0x1254c367 || id === 0x1941a469 || id === 0x1043a770;

/** True when the bytes start like a WebM/Matroska file. */
export async function isWebm(blob) {
  const b = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  return b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
}

/**
 * Splits a WebM file. Returns { parts: [{ blob, duration }], duration } with
 * durations in seconds. A file shorter than partSec comes back as one part.
 */
export async function splitWebm(blob, partSec) {
  const r = new Reader(blob);
  const type = blob.type || 'audio/webm';

  // EBML header, copied as is.
  const ebml = await r.head(0);
  if (ebml.id !== ID.EBML || ebml.size === UNKNOWN) throw new Error('Not a WebM file');
  let pos = ebml.dataStart + ebml.size;
  const headerPieces = [blob.slice(0, pos)];

  const seg = await r.head(pos);
  if (seg.id !== ID.Segment) throw new Error('Not a WebM file');
  const segEnd = seg.size === UNKNOWN ? r.size : Math.min(r.size, seg.dataStart + seg.size);
  headerPieces.push(new Uint8Array([0x18, 0x53, 0x80, 0x67, ...UNKNOWN_SIZE]));
  pos = seg.dataStart;

  // Segment children up to the first cluster: keep Info and Tracks (the codec details).
  let scale = 1000000; // nanoseconds per timecode tick
  while (pos < segEnd) {
    const h = await r.head(pos);
    if (h.id === ID.Cluster) break;
    if (h.size === UNKNOWN) throw new Error('This recording file could not be read');
    const end = h.dataStart + h.size;
    if (h.id === ID.Info || h.id === ID.Tracks) headerPieces.push(blob.slice(pos, end));
    if (h.id === ID.Info) {
      let p = h.dataStart;
      while (p < end) {
        const c = await r.head(p);
        if (c.id === ID.TimecodeScale) scale = await r.uint(c.dataStart, c.size);
        p = c.dataStart + c.size;
      }
    }
    pos = end;
  }
  const tickSec = scale / 1e9;

  // Clusters: where each one's audio sits and when it starts.
  const clusters = [];
  while (pos < segEnd) {
    const h = await r.head(pos);
    if (h.id !== ID.Cluster) {
      if (h.size === UNKNOWN) break;
      pos = h.dataStart + h.size;
      continue;
    }
    const end = h.size === UNKNOWN ? segEnd : Math.min(segEnd, h.dataStart + h.size);
    const cl = { tc: 0, ranges: [] };
    let p = h.dataStart;
    let from = p;
    while (p < end) {
      const c = await r.head(p);
      if (h.size === UNKNOWN && isTopLevel(c.id)) break; // the next cluster starts here
      if (c.size === UNKNOWN) throw new Error('This recording file could not be read');
      const cEnd = c.dataStart + c.size;
      if (cEnd > r.size) break; // cut short (the end of a recording that stopped abruptly)
      if (c.id === ID.Timecode) {
        cl.tc = await r.uint(c.dataStart, c.size);
        if (p > from) cl.ranges.push([from, p]);
        from = cEnd;
      }
      p = cEnd;
    }
    if (p > from) cl.ranges.push([from, p]);
    clusters.push(cl);
    pos = p;
  }
  if (!clusters.length) throw new Error('No audio was found in this file');

  const t0 = clusters[0].tc;
  const lastTc = clusters[clusters.length - 1].tc;
  // The last cluster's own length is unknown without reading its blocks; a few seconds at most.
  const duration = Math.max(1, Math.round((lastTc - t0) * tickSec) + 1);
  const header = new Blob(headerPieces);

  const partTicks = Math.round(partSec / tickSec);
  const groups = [];
  for (const cl of clusters) {
    const k = Math.floor((cl.tc - t0) / partTicks);
    const g = groups[groups.length - 1];
    if (g && g.k === k) g.clusters.push(cl);
    else groups.push({ k, clusters: [cl] });
  }

  const parts = groups.map((g, n) => {
    const start = g.clusters[0].tc;
    const pieces = [header];
    for (const cl of g.clusters) {
      const rel = cl.tc - start;
      const tcBytes = [];
      for (let k = 7; k >= 0; k--) tcBytes.push(Math.floor(rel / 2 ** (8 * k)) & 0xff);
      pieces.push(new Uint8Array([0x1f, 0x43, 0xb6, 0x75, ...UNKNOWN_SIZE, 0xe7, 0x88, ...tcBytes]));
      for (const [a, b] of cl.ranges) pieces.push(blob.slice(a, b));
    }
    const next = groups[n + 1];
    const endTc = next ? next.clusters[0].tc : lastTc + Math.round(1 / tickSec);
    return { blob: new Blob(pieces, { type }), duration: Math.max(1, Math.round((endTc - start) * tickSec)) };
  });
  return { parts, duration };
}
