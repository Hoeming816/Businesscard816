// A small Word (.docx) writer: enough for meeting minutes (title, headings,
// labelled fields, paragraphs, bullets and a table), with no library. A .docx
// is a zip of a few XML files; we store them uncompressed.

export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const esc = (s) => String(s ?? '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const run = (text, { bold, size, color } = {}) => {
  const pr = [bold && '<w:b/>', color && `<w:color w:val="${color}"/>`, size && `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`].filter(Boolean).join('');
  return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
};

const para = (runs, { before = 0, after = 80, indent = 0, hanging = 0, keepNext } = {}) =>
  `<w:p><w:pPr>${keepNext ? '<w:keepNext/>' : ''}<w:spacing w:before="${before}" w:after="${after}"/>`
  + `${indent ? `<w:ind w:left="${indent}"${hanging ? ` w:hanging="${hanging}"` : ''}/>` : ''}</w:pPr>${runs}</w:p>`;

const cell = (text, { head, width }) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="EEF2F7"/>' : ''}</w:tcPr>`
  + `${para(run(text, { bold: head, size: 20 }), { after: 0 })}</w:tc>`;

const BORDER = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="C8D0DC"/>`).join('');

function table(head, rows) {
  const total = 9360; // page width inside 1" margins, in twentieths of a point
  const first = Math.round(total * 0.4);
  const rest = head.length > 1 ? Math.floor((total - first) / (head.length - 1)) : total;
  const widths = head.map((_, k) => (k === 0 ? first : rest));
  const tr = (cells, h) => `<w:tr>${cells.map((c, k) => cell(c, { head: h, width: widths[k] })).join('')}</w:tr>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblBorders>${BORDER}</w:tblBorders>`
    + '<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>'
    + `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`
    + tr(head, true) + rows.map((r) => tr(r, false)).join('') + '</w:tbl>' + para('', { after: 0 });
}

/**
 * Blocks: { t: 'title' | 'h' | 'p' | 'bullet', text, level? },
 * { t: 'field', label, value } or { t: 'table', head: [...], rows: [[...]] }.
 */
export function documentXml(blocks) {
  const body = blocks.map((b) => {
    switch (b.t) {
      case 'title': return para(run(b.text, { bold: true, size: 36, color: '1F2A44' }), { after: 200 });
      case 'h': return para(run(b.text, { bold: true, size: 26, color: '1F2A44' }), { before: 240, after: 100, keepNext: true });
      case 'field': return para(run(`${b.label}: `, { bold: true, size: 22 }) + run(b.value, { size: 22 }), { after: 40 });
      case 'bullet': {
        const lvl = b.level || 0;
        return para(run(lvl ? '–' : '•', { size: 22 }) + '<w:r><w:tab/></w:r>' + run(b.text, { size: 22 }), { after: 40, indent: 360 + lvl * 360, hanging: 360 });
      }
      case 'table': return table(b.head, b.rows);
      default: return para(run(b.text, { bold: b.bold, size: 22 }));
    }
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + body
    + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1270" w:right="1270" w:bottom="1270" w:left="1270" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>'
    + '</w:body></w:document>';
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '</Types>';

const RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '</Relationships>';

const DOC_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';

let CRC_TABLE;
export function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** A zip (stored, no compression) of { name: string } files, as bytes. */
export function zip(files) {
  const enc = new TextEncoder();
  const entries = Object.entries(files).map(([name, text]) => ({ name: enc.encode(name), data: enc.encode(text) }));
  const DOS_DATE = 0x21; // 1980-01-01
  let size = 22;
  for (const e of entries) size += 30 + e.name.length + e.data.length + 46 + e.name.length;
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  let p = 0;
  const header = (sig, e, central) => {
    v.setUint32(p, sig, true); p += 4;
    if (central) { v.setUint16(p, 20, true); p += 2; }
    v.setUint16(p, 20, true); v.setUint16(p + 2, 0x0800, true); v.setUint16(p + 4, 0, true); // version, UTF-8 names, stored
    v.setUint16(p + 6, 0, true); v.setUint16(p + 8, DOS_DATE, true);
    v.setUint32(p + 10, e.crc, true); v.setUint32(p + 14, e.data.length, true); v.setUint32(p + 18, e.data.length, true);
    v.setUint16(p + 22, e.name.length, true); v.setUint16(p + 24, 0, true); p += 26;
  };
  for (const e of entries) {
    e.crc = crc32(e.data);
    e.offset = p;
    header(0x04034b50, e, false);
    out.set(e.name, p); p += e.name.length;
    out.set(e.data, p); p += e.data.length;
  }
  const cd = p;
  for (const e of entries) {
    header(0x02014b50, e, true);
    v.setUint16(p, 0, true); v.setUint16(p + 2, 0, true); v.setUint16(p + 4, 0, true); // comment, disk, internal attrs
    v.setUint32(p + 6, 0, true); v.setUint32(p + 10, e.offset, true); p += 14;
    out.set(e.name, p); p += e.name.length;
  }
  v.setUint32(p, 0x06054b50, true);
  v.setUint16(p + 4, 0, true); v.setUint16(p + 6, 0, true);
  v.setUint16(p + 8, entries.length, true); v.setUint16(p + 10, entries.length, true);
  v.setUint32(p + 12, p - cd, true); v.setUint32(p + 16, cd, true); v.setUint16(p + 20, 0, true);
  return out;
}

/** The .docx bytes for these blocks. */
export function docxBytes(blocks) {
  return zip({
    '[Content_Types].xml': CONTENT_TYPES,
    '_rels/.rels': RELS,
    'word/document.xml': documentXml(blocks),
    'word/_rels/document.xml.rels': DOC_RELS,
  });
}
