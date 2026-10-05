import { toPng } from '../charts.js';

export { toPng };

const C = {
  surface: '#fcfcfb',
  text: '#0b0b0b',
  text2: '#52514e',
  grid: '#e6e5e1',
  axis: '#8a8984',
};
/** Categorical slots of the reference palette, fixed per classifier (color follows the entity). */
export const CLASSIFIER_COLOR: Record<string, string> = {
  jev: '#2a78d6',
  luna: '#eb6834',
  sol: '#1baf7a',
  nano: '#eda100',
  luna_low: '#8a8984',
};
const FONT = "'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif";
const W = 1200;
const H = 675;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}"><rect width="100%" height="100%" fill="${C.surface}"/>${body}</svg>`;
const halo = `stroke="${C.surface}" stroke-width="5" paint-order="stroke"`;
const head = (title: string, sub: string) =>
  `<text x="40" y="50" font-size="30" font-weight="700" fill="${C.text}">${esc(title)}</text><text x="40" y="84" font-size="18" fill="${C.text2}">${esc(sub)}</text>`;

export interface Point {
  classifier: string;
  label: string;
  granularity: 'fine' | 'coarse';
  acc: number;
  lo: number;
  hi: number;
  latencyMs: number;
}

/** Chart 1: accuracy (with 95% CI) vs latency p50 on a log axis. Filled = 12 candidates, hollow = 6 classes. */
/** opts (v3): values in the legend, and direct labels only where they do not collide. v2 output is unchanged without opts. */
export function accuracyLatencyChart(pts: Point[], opts: { legendValues?: boolean } = {}): string {
  const L = 110, R = 60, T = 180, B = 90;
  const pw = W - L - R, ph = H - T - B;
  const lat = pts.map((p) => p.latencyMs);
  const lx0 = Math.log10(Math.min(...lat) * 0.7), lx1 = Math.log10(Math.max(...lat) * 1.4);
  const yMin = Math.max(0, Math.floor((Math.min(...pts.map((p) => p.lo)) - 0.03) * 20) / 20);
  const x = (ms: number) => L + ((Math.log10(ms) - lx0) / (lx1 - lx0)) * pw;
  const y = (v: number) => T + (1 - (v - yMin) / (1 - yMin)) * ph;
  let g = head('正解率(95%信頼区間)と判定時間', '横軸は判定時間の中央値(対数目盛)。左上ほど速くて正確。● 12候補 / ○ 6分類');
  for (const t of [100, 200, 500, 1000, 2000, 5000, 10000]) {
    if (Math.log10(t) < lx0 || Math.log10(t) > lx1) continue;
    g += `<line x1="${x(t)}" x2="${x(t)}" y1="${T}" y2="${T + ph}" stroke="${C.grid}"/><text x="${x(t)}" y="${T + ph + 28}" text-anchor="middle" font-size="18" fill="${C.text2}">${t >= 1000 ? `${t / 1000}秒` : `${t}ms`}</text>`;
  }
  for (let v = yMin; v <= 1.0001; v += 0.05) {
    g += `<line x1="${L}" x2="${L + pw}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grid}"/><text x="${L - 12}" y="${y(v) + 6}" text-anchor="end" font-size="18" fill="${C.text2}">${Math.round(v * 100)}%</text>`;
  }
  g += `<text x="${L + pw / 2}" y="${H - 22}" text-anchor="middle" font-size="20" fill="${C.text2}">判定時間 p50 →</text>`;
  g += `<text transform="translate(30 ${T + ph / 2}) rotate(-90)" text-anchor="middle" font-size="20" fill="${C.text2}">正解率(答えと一致)</text>`;
  for (const p of pts) {
    const col = CLASSIFIER_COLOR[p.classifier] ?? C.axis;
    const cx = x(p.latencyMs);
    g += `<line x1="${cx}" x2="${cx}" y1="${y(p.hi)}" y2="${y(p.lo)}" stroke="${col}" stroke-width="2"/>`;
    g += `<line x1="${cx - 6}" x2="${cx + 6}" y1="${y(p.hi)}" y2="${y(p.hi)}" stroke="${col}" stroke-width="2"/><line x1="${cx - 6}" x2="${cx + 6}" y1="${y(p.lo)}" y2="${y(p.lo)}" stroke="${col}" stroke-width="2"/>`;
    g += p.granularity === 'fine'
      ? `<circle cx="${cx}" cy="${y(p.acc)}" r="8" fill="${col}" stroke="${C.surface}" stroke-width="2"/>`
      : `<circle cx="${cx}" cy="${y(p.acc)}" r="7" fill="${C.surface}" stroke="${col}" stroke-width="3"/>`;
  }
  // legend in one row under the subtitle (identity is never color-alone: names are written)
  let lx = L;
  let ly = T - 66;
  for (const [k, base] of new Map(pts.map((p) => [p.classifier, p.label]))) {
    const vals = pts.filter((p) => p.classifier === k).map((p) => `${p.granularity === 'fine' ? '●' : '○'}${Math.round(p.acc * 100)}%`);
    const label = opts.legendValues ? `${base} ${vals.join(' ')}` : base;
    const w = label.length * (opts.legendValues ? 13 : 15) + 60;
    if (lx + w > W - 40) {
      lx = L;
      ly += 30;
    }
    g += `<circle cx="${lx + 8}" cy="${ly - 6}" r="8" fill="${CLASSIFIER_COLOR[k] ?? C.axis}"/><text x="${lx + 24}" y="${ly}" font-size="17" fill="${C.text}">${esc(label)}</text>`;
    lx += w;
  }
  // direct value labels
  for (const p of pts) {
    const right = p.granularity === 'fine';
    if (opts.legendValues) {
      const px = x(p.latencyMs);
      const py = y(p.acc);
      const crowded = pts.some((q) => q !== p && Math.abs(y(q.acc) - py) < 24 && (right ? x(q.latencyMs) - px : px - x(q.latencyMs)) >= -4 && Math.abs(x(q.latencyMs) - px) < 56);
      if (crowded) continue;
    }
    g += `<text x="${x(p.latencyMs) + (right ? 12 : -12)}" y="${y(p.acc) + 6}" text-anchor="${right ? 'start' : 'end'}" font-size="16" fill="${C.text2}" ${halo}>${Math.round(p.acc * 100)}%</text>`;
  }
  return svg(g);
}

export interface Bin {
  label: string;
  n: number;
  meanConf: number;
  acc: number;
}

/** Chart 2: reliability diagram for Jev confidence, with the ideal diagonal. */
export function calibrationChart(series: { name: string; color: string; bins: Bin[] }[]): string {
  const L = 110, R = 300, T = 130, B = 90;
  const pw = W - L - R, ph = H - T - B;
  const s = Math.min(pw, ph);
  const x = (v: number) => L + v * s;
  const y = (v: number) => T + (1 - v) * s;
  let g = head('Jev の確信度は、実際の正解率と合っているか', '確信度の区間ごとの平均確信度(横)と実際の正解率(縦)。斜めの点線に乗っていれば合っている');
  for (let v = 0; v <= 1.0001; v += 0.2) {
    g += `<line x1="${x(v)}" x2="${x(v)}" y1="${T}" y2="${T + s}" stroke="${C.grid}"/><text x="${x(v)}" y="${T + s + 28}" text-anchor="middle" font-size="18" fill="${C.text2}">${v.toFixed(1)}</text>`;
    g += `<line x1="${L}" x2="${L + s}" y1="${y(v)}" y2="${y(v)}" stroke="${C.grid}"/><text x="${L - 12}" y="${y(v) + 6}" text-anchor="end" font-size="18" fill="${C.text2}">${Math.round(v * 100)}%</text>`;
  }
  g += `<line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" stroke="${C.axis}" stroke-width="1.5" stroke-dasharray="6 6"/>`;
  g += `<text x="${x(0.62)}" y="${y(0.62) - 12}" font-size="16" fill="${C.text2}" transform="rotate(-${(Math.atan2(s, s) * 180) / Math.PI} ${x(0.62)} ${y(0.62) - 12})">理想(確信度 = 正解率)</text>`;
  g += `<text x="${L + s / 2}" y="${H - 22}" text-anchor="middle" font-size="20" fill="${C.text2}">確信度(区間内の平均)→</text>`;
  g += `<text transform="translate(30 ${T + s / 2}) rotate(-90)" text-anchor="middle" font-size="20" fill="${C.text2}">実際の正解率</text>`;
  g += `<text x="${L + s + 80}" y="${T + s / 2 + 90}" font-size="15" fill="${C.text2}">n = 区間に入った件数。5件未満は薄く表示</text>`;
  series.forEach((se, si) => {
    const pts = se.bins.filter((b) => b.n > 0);
    const solid = pts.filter((b) => b.n >= 5);
    if (solid.length > 1) g += `<polyline fill="none" stroke="${se.color}" stroke-width="2" points="${solid.map((b) => `${x(b.meanConf)},${y(b.acc)}`).join(' ')}"/>`;
    for (const b of pts) {
      const op = b.n >= 5 ? 1 : 0.35;
      g += `<circle cx="${x(b.meanConf)}" cy="${y(b.acc)}" r="8" fill="${si === 0 ? se.color : C.surface}" fill-opacity="${op}" stroke="${se.color}" stroke-opacity="${op}" stroke-width="3"/>`;
      g += `<text x="${x(b.meanConf) + (si === 0 ? -12 : 12)}" y="${y(b.acc) + (si === 0 ? -12 : 24)}" text-anchor="${si === 0 ? 'end' : 'start'}" font-size="15" fill="${C.text2}" ${halo}>n=${b.n}${b.n < 5 ? '(参考)' : ''}</text>`;
    }
    const ly = T + s / 2 + si * 34;
    g += `<circle cx="${L + s + 80}" cy="${ly - 6}" r="8" fill="${si === 0 ? se.color : C.surface}" stroke="${se.color}" stroke-width="3"/><text x="${L + s + 96}" y="${ly}" font-size="17" fill="${C.text}">${esc(se.name)}</text>`;
  });
  return svg(g);
}

/** Chart 3: selection cost per 1000 calls, horizontal bars on a log axis (values span ~50x). */
export function costChart(rows: { classifier: string; label: string; usd: number; faded?: boolean }[]): string {
  const L = 470, R = 120, T = 130, B = 60;
  const pw = W - L - R;
  const sorted = [...rows].sort((a, b) => a.usd - b.usd);
  const bh = Math.min(48, (H - T - B) / sorted.length - 14);
  const lo = Math.log10(Math.min(...sorted.map((r) => r.usd)) / 2), hi = Math.log10(Math.max(...sorted.map((r) => r.usd)) * 1.2);
  const xw = (v: number) => ((Math.log10(v) - lo) / (hi - lo)) * pw;
  let g = head('1000回あたりの判定の費用(12候補)', '実際のトークン数 × 公式の単価(2026-10-02 確認)。薄い棒は OpenAI のプロンプトキャッシュなしで換算した値。横軸は対数目盛');
  for (const t of [0.01, 0.03, 0.1, 0.3, 1, 3, 10]) {
    if (Math.log10(t) < lo || Math.log10(t) > hi) continue;
    g += `<line x1="${L + xw(t)}" x2="${L + xw(t)}" y1="${T - 10}" y2="${H - B}" stroke="${C.grid}"/><text x="${L + xw(t)}" y="${H - B + 28}" text-anchor="middle" font-size="16" fill="${C.text2}">$${t}</text>`;
  }
  sorted.forEach((r, i) => {
    const yy = T + i * (bh + 14);
    g += `<text x="${L - 14}" y="${yy + bh / 2 + 6}" text-anchor="end" font-size="18" fill="${C.text}">${esc(r.label)}</text>`;
    g += `<rect x="${L}" y="${yy}" width="${Math.max(4, xw(r.usd))}" height="${bh}" rx="4" fill="${CLASSIFIER_COLOR[r.classifier] ?? C.axis}" fill-opacity="${r.faded ? 0.4 : 1}"/>`;
    g += `<text x="${L + Math.max(4, xw(r.usd)) + 10}" y="${yy + bh / 2 + 6}" font-size="18" font-weight="600" fill="${C.text}">$${r.usd < 0.1 ? r.usd.toFixed(3) : r.usd.toFixed(2)}</text>`;
  });
  return svg(g);
}
