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

/** Chart 1: outcome mix per confidence cut-off, as 100% stacked bars (one row per cut-off). */
export function cutoffChart(ms: VariantMetrics[], title: string): string {
  const rows = [...ms].sort((a, b) => a.variant.cutoff - b.variant.cutoff);
  const segs = [
    { name: '正解', color: C.s1, v: (m: VariantMetrics) => m.accuracy, onDark: true },
    { name: 'これでも可', color: '#86b6ef', v: (m: VariantMetrics) => m.accuracyLenient - m.accuracy, onDark: false },
    { name: '全部載せに倒した', color: '#c3c2b7', v: (m: VariantMetrics) => m.fallbackRate, onDark: false },
    { name: '誤ったプロンプト', color: '#e34948', v: (m: VariantMetrics) => m.wrongRate, onDark: true },
  ];
  const L = 220, R = 130, T = 170, bh = 72, gap = 28;
  const pw = W - L - R;
  let g = `<text x="40" y="48" font-size="30" font-weight="700" fill="${C.text}">${esc(title)}</text>`;
  g += `<text x="40" y="82" font-size="18" fill="${C.text2}">確信度が下限を下回ったら、選択を使わず全部載せにする。100件の内訳</text>`;
  let lx = L;
  for (const sg of segs) {
    g += `<rect x="${lx}" y="${T - 52}" width="16" height="16" rx="3" fill="${sg.color}"/><text x="${lx + 24}" y="${T - 38}" font-size="18" fill="${C.text}">${sg.name}</text>`;
    lx += sg.name.length * 18 + 64;
  }
  rows.forEach((m, i) => {
    const y = T + i * (bh + gap);
    const lab = m.variant.cutoff ? `下限 ${m.variant.cutoff}` : '下限なし';
    g += `<text x="${L - 16}" y="${y + bh / 2 + 7}" text-anchor="end" font-size="20" fill="${C.text}">${lab}</text>`;
    let x = L;
    for (const sg of segs) {
      const v = sg.v(m);
      const w = v * pw;
      if (w <= 0) continue;
      g += `<rect x="${x}" y="${y}" width="${Math.max(0, w - 2)}" height="${bh}" fill="${sg.color}"/>`;
      if (w > 40 && sg.name !== '誤ったプロンプト') {
        g += `<text x="${x + w / 2 - 1}" y="${y + bh / 2 + 7}" text-anchor="middle" font-size="20" font-weight="600" fill="${sg.onDark ? '#ffffff' : C.text}">${Math.round(v * 100)}%</text>`;
      }
      x += w;
    }
    g += `<text x="${L + pw + 12}" y="${y + bh / 2 + 7}" font-size="20" font-weight="600" fill="${C.text}">誤り ${Math.round(m.wrongRate * 100)}%</text>`;
  });
  return svg(g);
}

/** Chart 2: per correct prompt, the share of cases where a wrong prompt was chosen. */
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
