import { Resvg } from '@resvg/resvg-js';
import type { VariantMetrics } from './metrics.js';

// Reference palette (light mode, slide use): categorical slots 1-3, text and grid tokens.
const C = {
  surface: '#fcfcfb',
  text: '#0b0b0b',
  text2: '#52514e',
  muted: '#8a8984',
  grid: '#e6e5e1',
  s1: '#2a78d6',
  };
const FONT = "'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif";
const W = 1200;
const H = 675;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">` +
  `<rect width="100%" height="100%" fill="${C.surface}"/>${body}</svg>`;

export function toPng(svgText: string): Buffer {
  return new Resvg(svgText, { font: { loadSystemFonts: true, defaultFontFamily: 'Hiragino Sans' } })
    .render()
    .asPng();
}

/** Chart: per correct prompt, the share of cases where a wrong prompt was chosen. */
export function missChart(m: VariantMetrics, title: string, labels: Record<string, string>): string {
  const rows = Object.entries(m.perAnswer)
    .filter(([, v]) => v.n > 0)
    .map(([id, v]) => ({ id, rate: v.wrong / v.n, ...v }))
    .sort((a, b) => b.rate - a.rate || b.n - a.n);
  const L = 330, R = 170, T = 120, B = 30;
  const pw = W - L - R;
  const bh = Math.min(36, (H - T - B) / rows.length - 8);
  const max = Math.max(0.2, ...rows.map((r) => r.rate));
  let g = `<text x="40" y="48" font-size="30" font-weight="700" fill="${C.text}">${esc(title)}</text>`;
  g += `<text x="40" y="82" font-size="18" fill="${C.text2}">正解がそのプロンプトの件のうち、別のプロンプトを選んだ割合(件数)。「これでも可」は正解扱い</text>`;
  rows.forEach((r, i) => {
    const yy = T + i * (bh + 8);
    const w = Math.max(r.rate > 0 ? 4 : 0, (r.rate / max) * pw);
    g += `<text x="${L - 14}" y="${yy + bh / 2 + 6}" text-anchor="end" font-size="18" fill="${C.text}">${esc(labels[r.id] ?? r.id)}</text>`;
    g += `<line x1="${L}" x2="${L}" y1="${yy}" y2="${yy + bh}" stroke="${C.grid}"/>`;
    if (w > 0) g += `<rect x="${L}" y="${yy}" width="${w}" height="${bh}" rx="4" fill="${C.s1}"/>`;
    g += `<text x="${L + w + 10}" y="${yy + bh / 2 + 6}" font-size="18" fill="${C.text2}">${Math.round(r.rate * 100)}% (${r.wrong}/${r.n}件)</text>`;
  });
  return svg(g);
}
