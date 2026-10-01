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
  s2: '#eb6834',
  s3: '#1baf7a',
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

/** Chart 1: input-token reduction (x) vs recall (y), one connected series per selector. */
export function tradeoffChart(ms: VariantMetrics[], title: string, maxReduction: number): string {
  const L = 110, R = 60, T = 140, B = 90;
  const pw = W - L - R, ph = H - T - B;
  const yMin = Math.floor((Math.min(...ms.map((m) => m.recall)) - 0.03) * 20) / 20;
  const xs = ms.filter((m) => m.variant.config !== 'all').map((m) => m.reduction);
  const xMin = Math.floor((Math.min(...xs) - 0.05) * 10) / 10;
  const xMax = Math.ceil((Math.max(maxReduction, ...xs) + 0.02) * 10) / 10;
  const x = (v: number) => L + ((v - xMin) / (xMax - xMin)) * pw;
  const y = (v: number) => T + (1 - (v - yMin) / (1 - yMin)) * ph;
  let g = '';
  for (let v = xMin; v <= xMax + 1e-9; v += 0.05) {
    g += `<line x1="${x(v)}" x2="${x(v)}" y1="${T}" y2="${T + ph}" stroke="${C.grid}"/>`;
    g += `<text x="${x(v)}" y="${T + ph + 28}" text-anchor="middle" font-size="18" fill="${C.text2}">${Math.round(v * 100)}%</text>`;
  }
  const yStep = 0.05;
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= 1.0001; v += yStep) {
    g += `<line x1="${L}" x2="${L + pw}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grid}"/>`;
    g += `<text x="${L - 12}" y="${y(v) + 6}" text-anchor="end" font-size="18" fill="${C.text2}">${Math.round(v * 100)}%</text>`;
  }
  g += `<text x="${L + pw / 2}" y="${H - 22}" text-anchor="middle" font-size="20" fill="${C.text2}">入力トークン削減率(A 全部載せ比)→ 大きいほど軽い</text>`;
  g += `<text transform="translate(30 ${T + ph / 2}) rotate(-90)" text-anchor="middle" font-size="20" fill="${C.text2}">再現率(必要な部品を載せた割合)↑</text>`;
  g += `<text x="${L}" y="48" font-size="30" font-weight="700" fill="${C.text}">${esc(title)}</text>`;
  g += `<text x="${L}" y="82" font-size="18" fill="${C.text2}">点はしきい値 t。右上ほど良い。基準の A 全部載せは 削減0%・再現率100%(図の範囲外)</text>`;
  g += `<line x1="${x(maxReduction)}" x2="${x(maxReduction)}" y1="${T}" y2="${T + ph}" stroke="${C.muted}" stroke-dasharray="6 6"/>`;
  g += `<text x="${x(maxReduction) - 8}" y="${T + ph - 12}" text-anchor="end" font-size="16" fill="${C.text2}">削減の上限 ${Math.round(maxReduction * 1000) / 10}%(常に載せる部品のみ)</text>`;

  const series: { key: string; name: string; color: string }[] = [
    { key: 'noul_ja', name: 'B noul(日本語の質問文)', color: C.s1 },
    { key: 'noul_en', name: "B' noul(英語の質問文)", color: C.s2 },
    { key: 'choice_ja', name: 'C choice(主な1部品)', color: C.s3 },
  ];
  const legendY = T - 22;
  let lx = L + pw;
  const legend: string[] = [];
  for (const s of [...series].reverse()) {
    const pts = ms.filter((m) => m.variant.config === s.key && m.variant.fallback);
    if (!pts.length) continue;
    const w = s.name.length * 18 + 40;
    lx -= w;
    legend.push(
      `<circle cx="${lx + 8}" cy="${legendY - 6}" r="7" fill="${s.color}"/><text x="${lx + 22}" y="${legendY}" font-size="18" fill="${C.text}">${esc(s.name)}</text>`
    );
    pts.sort((a, b) => a.reduction - b.reduction);
    if (pts.length > 1) {
      g += `<polyline fill="none" stroke="${s.color}" stroke-width="2" points="${pts.map((m) => `${x(m.reduction)},${y(m.recall)}`).join(' ')}"/>`;
    }
    for (const m of pts) {
      g += `<circle cx="${x(m.reduction)}" cy="${y(m.recall)}" r="7" fill="${s.color}" stroke="${C.surface}" stroke-width="2"/>`;
      const lab = m.variant.threshold !== undefined ? `t=${m.variant.threshold}` : 'choice';
      // selective labels: thresholds on the main series only (B' sits almost on top of it)
      if (s.key === 'noul_en') continue;
      g += `<text x="${x(m.reduction) - 12}" y="${y(m.recall) - 10}" text-anchor="end" font-size="16" fill="${C.text2}" stroke="${C.surface}" stroke-width="5" paint-order="stroke">${lab}</text>`;
    }
  }
  return svg(g + legend.join(''));
}

/** Chart 2: per-part miss rate for one variant, horizontal bars sorted by rate. */
export function missChart(m: VariantMetrics, title: string, labels: Record<string, string>): string {
  const rows = Object.entries(m.perPartMiss)
    .filter(([, v]) => v.gold > 0)
    .map(([id, v]) => ({ id, rate: v.missed / v.gold, ...v }))
    .sort((a, b) => b.rate - a.rate || b.gold - a.gold);
  const L = 330, R = 170, T = 120, B = 40;
  const pw = W - L - R;
  const bh = Math.min(38, (H - T - B) / rows.length - 8);
  const max = Math.max(0.2, ...rows.map((r) => r.rate));
  let g = `<text x="40" y="48" font-size="30" font-weight="700" fill="${C.text}">${esc(title)}</text>`;
  g += `<text x="40" y="82" font-size="18" fill="${C.text2}">取りこぼし率 = その部品が必要な件のうち、載せなかった件の割合(件数)</text>`;
  rows.forEach((r, i) => {
    const yy = T + i * (bh + 8);
    const w = Math.max(r.rate > 0 ? 4 : 0, (r.rate / max) * pw);
    g += `<text x="${L - 14}" y="${yy + bh / 2 + 6}" text-anchor="end" font-size="18" fill="${C.text}">${esc(labels[r.id] ?? r.id)}</text>`;
    g += `<line x1="${L}" x2="${L}" y1="${yy}" y2="${yy + bh}" stroke="${C.grid}"/>`;
    if (w > 0) g += `<rect x="${L}" y="${yy}" width="${w}" height="${bh}" rx="4" fill="${C.s1}"/>`;
    g += `<text x="${L + w + 10}" y="${yy + bh / 2 + 6}" font-size="18" fill="${C.text2}">${Math.round(r.rate * 100)}% (${r.missed}/${r.gold}件)</text>`;
  });
  return svg(g);
}
