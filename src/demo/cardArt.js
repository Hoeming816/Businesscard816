// Generated SVG "photos" of business cards for the demo (90:54 proportions).

const PALETTES = [
  { bg: '#ffffff', ink: '#14213d', accent: '#2f5bea' },
  { bg: '#f7f3ea', ink: '#2b2b2b', accent: '#c0392b' },
  { bg: '#10243e', ink: '#f4f6fb', accent: '#5ec2b7' },
  { bg: '#ffffff', ink: '#1d3a2f', accent: '#2e8b57' },
  { bg: '#1f1f24', ink: '#f2f2f2', accent: '#f0b429' },
  { bg: '#eef4fb', ink: '#0d2a4a', accent: '#0b6bcb' },
];

const esc = (s) => String(s || '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function cardSvg(contact, side = 'front') {
  const pal = PALETTES[hash(contact.company || contact.full_name || 'x') % PALETTES.length];
  const initials = (contact.company || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const phones = (contact.phones || []).map((p) => `${p.label ? p.label[0] + ': ' : ''}${p.number}`);
  const tilt = ((hash(contact.id || '') % 5) - 2) * 0.4;
  let body;
  if (side === 'back') {
    body = `
      <rect x="0" y="0" width="900" height="540" fill="${pal.accent}"/>
      <text x="450" y="250" text-anchor="middle" font-family="Georgia, serif" font-size="64" font-weight="700" fill="#fff">${esc(contact.company)}</text>
      <text x="450" y="320" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="#fff" opacity=".85">${esc(contact.website || '')}</text>`;
  } else {
    body = `
      <rect x="0" y="0" width="900" height="540" fill="${pal.bg}"/>
      <rect x="0" y="0" width="22" height="540" fill="${pal.accent}"/>
      <circle cx="790" cy="110" r="58" fill="${pal.accent}"/>
      <text x="790" y="128" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="46" font-weight="700" fill="#fff">${esc(initials)}</text>
      <text x="80" y="110" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="700" fill="${pal.accent}" letter-spacing="2">${esc((contact.company || '').toUpperCase())}</text>
      <text x="80" y="250" font-family="Georgia, serif" font-size="58" font-weight="700" fill="${pal.ink}">${esc(contact.full_name)}</text>
      <text x="80" y="298" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="${pal.ink}" opacity=".8">${esc(contact.job_title)}</text>
      <line x1="80" y1="338" x2="820" y2="338" stroke="${pal.ink}" stroke-opacity=".2" stroke-width="2"/>
      ${phones.slice(0, 2).map((p, i) => `<text x="80" y="${388 + i * 36}" font-family="Menlo, monospace" font-size="24" fill="${pal.ink}">${esc(p)}</text>`).join('')}
      <text x="80" y="${388 + Math.min(phones.length, 2) * 36}" font-family="Menlo, monospace" font-size="24" fill="${pal.ink}">${esc((contact.emails || [])[0] || '')}</text>
      <text x="820" y="500" text-anchor="end" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="${pal.ink}" opacity=".6">${esc([contact.city, contact.country].filter(Boolean).join(', '))}</text>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-40 -40 980 620" width="980" height="620">
    <rect x="-40" y="-40" width="980" height="620" fill="#8a8f98"/>
    <g transform="rotate(${tilt} 450 270)">
      <rect x="6" y="10" width="900" height="540" rx="14" fill="#000" opacity=".25"/>
      <clipPath id="r"><rect x="0" y="0" width="900" height="540" rx="14"/></clipPath>
      <g clip-path="url(#r)">${body}</g>
    </g>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** A short, quiet WAV tone so the demo's recording player has something to play. */
export function demoAudioUrl(seconds = 3) {
  const rate = 8000;
  const n = rate * seconds;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 800, (n - i) / 800);
    v.setInt16(44 + i * 2, Math.sin((2 * Math.PI * 330 * i) / rate) * 2500 * env * (0.6 + 0.4 * Math.sin(i / 900)), true);
  }
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
