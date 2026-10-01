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

/** Chart 1: input-token reduction (x) vs wrong-prompt rate (y), one connected series per selector over cut-offs. */
export function tradeoffChart(ms: VariantMetrics[], title: string): string {
  const L = 110, R = 60, T = 140, B = 90;
  const pw = W - L - R, ph = H - T - B;
  const pts0 = ms.filter((m) => m.variant.config !== 'all');
  const xMin = Math.floor((Math.min(...pts0.map((m) => m.reduction)) - 0.03) * 20) / 20;
  const xMax = Math.ceil((Math.max(...pts0.map((m) => m.reduction)) + 0.02) * 20) / 20;
  const yMax = Math.ceil((Math.max(...pts0.map((m) => m.wrongRate)) + 0.02) * 20) / 20;
  const x = (v: number) => L + ((v - xMin) / (xMax - xMin)) * pw;
  const y = (v: number) => T + (v / yMax) * ph; // 0% at the top: higher on the chart = fewer wrong prompts
  let g = '';
  for (let v = xMin; v <= xMax + 1e-9; v += 0.05) {
    g += `<line x1="${x(v)}" x2="${x(v)}" y1="${T}" y2="${T + ph}" stroke="${C.grid}"/>`;
    g += `<text x="${x(v)}" y="${T + ph + 28}" text-anchor="middle" font-size="18" fill="${C.text2}">${Math.round(v * 100)}%</text>`;
  }
  for (let v = 0; v <= yMax + 1e-9; v += 0.05) {
    g += `<line x1="${L}" x2="${L + pw}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grid}"/>`;
    g += `<text x="${L - 12}" y="${y(v) + 6}" text-anchor="end" font-size="18" fill="${C.text2}">${Math.round(v * 100)}%</text>`;
  }
  g += `<text x="${L + pw / 2}" y="${H - 22}" text-anchor="middle" font-size="20" fill="${C.text2}">入力トークン削減率(A 全部載せ比)→ 大きいほど軽い</text>`;
  g += `<text transform="translate(30 ${T + ph / 2}) rotate(-90)" text-anchor="middle" font-size="20" fill="${C.text2}">誤ったプロンプトを渡した割合(上ほど少ない)</text>`;
  g += `<text x="${L}" y="48" font-size="30" font-weight="700" fill="${C.text}">${esc(title)}</text>`;
  g += `<text x="${L}" y="82" font-size="18" fill="${C.text2}">点は確信度の下限(下回ったら全部載せ)。右上ほど良い。A 全部載せは削減0%・誤り0%</text>`;

  const series: { key: string; name: string; color: string; label?: boolean }[] = [
    { key: 'choice_ja', name: 'C choice(日本語)', color: C.s1, label: true },
    { key: 'choice_en', name: "C' choice(英語)", color: C.s2 },
    { key: 'choice_ja_v2', name: 'C2 choice(説明改善)', color: C.s3 },
    { key: 'noul_ja', name: 'B noul 最大値', color: C.muted },
  ];
  const legendY = T - 22;
  let lx = L + pw;
  const legend: string[] = [];
  for (const s of [...series].reverse()) {
    const pts = ms.filter((m) => m.variant.config === s.key);
    if (!pts.length) continue;
    const w = s.name.length * 17 + 40;
    lx -= w;
    legend.push(
      `<circle cx="${lx + 8}" cy="${legendY - 6}" r="7" fill="${s.color}"/><text x="${lx + 22}" y="${legendY}" font-size="18" fill="${C.text}">${esc(s.name)}</text>`
    );
    pts.sort((a, b) => a.variant.cutoff - b.variant.cutoff);
    g += `<polyline fill="none" stroke="${s.color}" stroke-width="2" points="${pts.map((m) => `${x(m.reduction)},${y(m.wrongRate)}`).join(' ')}"/>`;
    for (const m of pts) {
      g += `<circle cx="${x(m.reduction)}" cy="${y(m.wrongRate)}" r="7" fill="${s.color}" stroke="${C.surface}" stroke-width="2"/>`;
      if (s.label) {
        const lab = m.variant.cutoff ? `下限${m.variant.cutoff}` : '下限なし';
        g += `<text x="${x(m.reduction) + 12}" y="${y(m.wrongRate) - 10}" font-size="16" fill="${C.text2}" stroke="${C.surface}" stroke-width="5" paint-order="stroke">${lab}</text>`;
      }
    }
  }
  return svg(g + legend.join(''));
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
