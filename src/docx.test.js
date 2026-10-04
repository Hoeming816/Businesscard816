import { describe, expect, it } from 'vitest';
import { crc32, docxBytes, documentXml } from './docx.js';
import { minutesDoc, minutesFileName, minutesMailto, normaliseMinutes } from './minutes.js';

// Reads a stored (uncompressed) zip back into { name: text }.
function unzip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  const end = bytes.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const files = {};
  for (let k = 0; k < count; k++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const crc = v.getUint32(p + 16, true);
    const offset = v.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const start = offset + 30 + v.getUint16(offset + 26, true);
    const data = bytes.subarray(start, start + size);
    expect(crc32(data)).toBe(crc);
    files[name] = dec.decode(data);
    p += 46 + nameLen;
  }
  return files;
}

describe('docx', () => {
  it('crc32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xCBF43926);
  });

  it('builds a zip with the Word parts and escaped text', () => {
    const files = unzip(docxBytes([{ t: 'title', text: 'Minutes' }, { t: 'p', text: 'R&D <budget> "ok"' }]));
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml']);
    expect(files['word/document.xml']).toContain('R&amp;D &lt;budget&gt; &quot;ok&quot;');
    expect(files['[Content_Types].xml']).toContain('/word/document.xml');
  });

  it('writes tables with a header row', () => {
    const xml = documentXml([{ t: 'table', head: ['Action', 'Due'], rows: [['Submit BOM', 'Wed']] }]);
    expect(xml.match(/<w:tr>/g)).toHaveLength(2);
    expect(xml).toContain('Submit BOM');
  });
});

describe('minutes as a Word file', () => {
  const i = {
    title: 'Weekly sync', meeting_type: 'Project Meeting', occurred_on: '2026-10-04',
    minutes: normaliseMinutes({
      quick_summary: ['Budget approved'], decisions: ['Go with vendor A'],
      action_items: [{ action: 'Submit BOM', assigned_to: 'Peter', due: '2026-10-08', priority: 'High' }],
    }),
  };

  it('has the sections with content, and an action table', () => {
    const blocks = minutesDoc(i, { full_name: 'Ana', company: 'Acme' });
    const heads = blocks.filter((b) => b.t === 'h').map((b) => b.text);
    expect(heads).toEqual(['Quick Summary', 'Decisions Made', 'Action Items']);
    expect(blocks.find((b) => b.t === 'table').rows[0]).toEqual(['Submit BOM', 'Peter', '2026-10-08', 'High', 'Open']);
    expect(blocks).toContainEqual({ t: 'field', label: 'Decision 01', value: 'Go with vendor A' });
  });

  it('names the file safely and fills the email', () => {
    expect(minutesFileName({ ...i, title: 'Q3: plan/review?' })).toBe('Minutes - Q3 plan review - 2026-10-04.docx');
    const url = minutesMailto(i, null, (d) => d, 'x.docx');
    expect(url.startsWith('mailto:?subject=')).toBe(true);
    expect(decodeURIComponent(url)).toContain('Minutes: Weekly sync (2026-10-04)');
    expect(decodeURIComponent(url)).toContain('• Budget approved');
  });
});
