import sharp from 'sharp';

export interface SceneOptions {
  title: string; // e.g. store + camera name
  ts: string; // timestamp text (store-local)
  view: 'ENTRANCE' | 'ZONE' | 'BILLING' | 'SHELF' | 'SIGNAGE' | 'UNIFORM';
  people?: number;
  seed?: number;
  emptyShelfPct?: number; // SHELF view: 0..100
  dark?: boolean; // closed store
  width?: number;
  height?: number;
  badge?: string; // overlay label (e.g. "MOBILE USAGE")
}

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

function prng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Renders a simple synthetic CCTV-style store scene (floor, shelves, people silhouettes, timestamp) as JPEG. */
export async function renderScene(o: SceneOptions): Promise<Buffer> {
  const W = o.width ?? 640;
  const H = o.height ?? 360;
  const r = prng(o.seed ?? 7);
  const parts: string[] = [];
  const floor = o.dark ? '#1b1d22' : '#c9c2b6';
  const wall = o.dark ? '#121418' : '#e9e4da';
  parts.push(`<rect width="${W}" height="${H}" fill="${wall}"/>`);
  parts.push(`<polygon points="0,${H * 0.42} ${W},${H * 0.42} ${W},${H} 0,${H}" fill="${floor}"/>`);
  for (let i = 1; i < 8; i++) parts.push(`<line x1="${(W / 8) * i}" y1="${H * 0.42}" x2="${(W / 8) * i * 1.4 - W * 0.2}" y2="${H}" stroke="${o.dark ? '#24272d' : '#b8b0a3'}" stroke-width="1"/>`);
  if (o.view === 'SHELF') {
    const empty = Math.max(0, Math.min(100, o.emptyShelfPct ?? 10)) / 100;
    for (let row = 0; row < 4; row++) {
      const y = 40 + row * 70;
      parts.push(`<rect x="40" y="${y + 52}" width="${W - 80}" height="8" fill="#6b4f35"/>`);
      const n = 18;
      for (let k = 0; k < n; k++) {
        if (r() < empty) continue;
        const hue = Math.floor(r() * 360);
        parts.push(`<rect x="${48 + k * ((W - 96) / n)}" y="${y + 14 + r() * 8}" width="${(W - 96) / n - 4}" height="${38 - r() * 8}" fill="hsl(${hue},55%,52%)"/>`);
      }
    }
  } else if (o.view === 'SIGNAGE') {
    parts.push(`<rect x="${W * 0.2}" y="${H * 0.12}" width="${W * 0.6}" height="${H * 0.35}" rx="8" fill="#b3122e"/>`);
    parts.push(`<text x="${W / 2}" y="${H * 0.3}" font-family="DejaVu Sans, Arial" font-size="34" font-weight="bold" fill="#ffd45a" text-anchor="middle">DIWALI FESTIVE SALE</text>`);
    parts.push(`<text x="${W / 2}" y="${H * 0.4}" font-family="DejaVu Sans, Arial" font-size="20" fill="#fff" text-anchor="middle">Up to 40% off · Congruence</text>`);
  } else if (o.view === 'UNIFORM') {
    parts.push(`<circle cx="${W / 2}" cy="${H * 0.28}" r="${H * 0.1}" fill="#8d5a3b"/>`);
    parts.push(`<rect x="${W / 2 - H * 0.16}" y="${H * 0.4}" width="${H * 0.32}" height="${H * 0.5}" rx="20" fill="#1f4e8c"/>`);
    parts.push(`<rect x="${W / 2 + H * 0.04}" y="${H * 0.5}" width="${H * 0.08}" height="${H * 0.04}" fill="#fff"/>`);
  } else {
    // racks / counters
    const racks = o.view === 'BILLING' ? 2 : o.view === 'ENTRANCE' ? 0 : 4;
    for (let i = 0; i < racks; i++) {
      const x = 40 + i * ((W - 80) / racks);
      if (o.view === 'BILLING') parts.push(`<rect x="${x + 30}" y="${H * 0.45}" width="${(W - 80) / racks - 60}" height="${H * 0.18}" fill="${o.dark ? '#2a2d33' : '#5c4a3a'}"/>`);
      else {
        parts.push(`<rect x="${x + 8}" y="${H * 0.2}" width="${(W - 80) / racks - 16}" height="${H * 0.3}" fill="${o.dark ? '#24262b' : '#8a7560'}"/>`);
        for (let k = 0; k < 6; k++) parts.push(`<rect x="${x + 14 + k * (((W - 80) / racks - 28) / 6)}" y="${H * 0.23}" width="${((W - 80) / racks - 28) / 6 - 3}" height="${H * 0.22}" fill="hsl(${Math.floor(r() * 360)},${o.dark ? 10 : 45}%,${o.dark ? 20 : 55}%)"/>`);
      }
    }
    if (o.view === 'ENTRANCE') {
      parts.push(`<rect x="${W * 0.3}" y="${H * 0.08}" width="${W * 0.4}" height="${H * 0.4}" fill="${o.dark ? '#0b0c0e' : '#a8c8de'}" stroke="#555" stroke-width="6"/>`);
      parts.push(`<line x1="${W * 0.15}" y1="${H * 0.72}" x2="${W * 0.85}" y2="${H * 0.72}" stroke="#e8b400" stroke-width="3" stroke-dasharray="10,6"/>`);
    }
  }
  // people silhouettes
  const n = o.dark ? 0 : (o.people ?? 0);
  for (let i = 0; i < n; i++) {
    const x = 30 + r() * (W - 60);
    const y = H * 0.55 + r() * H * 0.38;
    const s = 0.6 + ((y - H * 0.55) / (H * 0.45)) * 0.7;
    const shirt = `hsl(${Math.floor(r() * 360)},45%,${35 + Math.floor(r() * 25)}%)`;
    parts.push(`<ellipse cx="${x}" cy="${y + 2}" rx="${14 * s}" ry="${4 * s}" fill="rgba(0,0,0,0.25)"/>`);
    parts.push(`<rect x="${x - 9 * s}" y="${y - 52 * s}" width="${18 * s}" height="${34 * s}" rx="${6 * s}" fill="${shirt}"/>`);
    parts.push(`<rect x="${x - 7 * s}" y="${y - 20 * s}" width="${14 * s}" height="${22 * s}" fill="#2d3340"/>`);
    parts.push(`<circle cx="${x}" cy="${y - 60 * s}" r="${8 * s}" fill="#7a5235"/>`);
  }
  if (o.badge) parts.push(`<rect x="${W - 230}" y="10" width="220" height="30" rx="4" fill="rgba(200,30,30,0.85)"/><text x="${W - 120}" y="31" font-family="DejaVu Sans, Arial" font-size="15" fill="#fff" text-anchor="middle">${esc(o.badge)}</text>`);
  parts.push(`<rect x="0" y="${H - 26}" width="${W}" height="26" fill="rgba(0,0,0,0.55)"/>`);
  parts.push(`<text x="10" y="${H - 8}" font-family="DejaVu Sans Mono, monospace" font-size="14" fill="#fff">${esc(o.title)}</text>`);
  parts.push(`<text x="${W - 10}" y="${H - 8}" font-family="DejaVu Sans Mono, monospace" font-size="14" fill="#fff" text-anchor="end">${esc(o.ts)}</text>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 72 }).toBuffer();
}
