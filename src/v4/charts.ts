/**
 * v4 confidence chart: for each classifier, the cases are split by the returned confidence,
 * and each bar shows how many cases fell in the bin and how many of them matched the answer.
 */
const C = { surface: '#fcfcfb', text: '#0b0b0b', text2: '#52514e', grid: '#e6e5e1', miss: '#d4483b' };
const FONT = "'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif";
const W = 1200;
const H = 675;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export interface ConfBin {
  label: string;
  n: number;
  correct: number;
}

export function confidenceCountChart(panels: { name: string; color: string; bins: ConfBin[] }[], title: string, sub: string): string {
  const total = panels[0].bins.reduce((s, b) => s + b.n, 0);
  const max = Math.max(...panels.flatMap((p) => p.bins.map((b) => b.n)));
  const panelW = (W - 80) / panels.length;
  const labelW = 110;
  const barMax = panelW - labelW - 250;
  const top = 200;
  const rowH = 92;
  const barH = 40;
  let g = `<text x="40" y="50" font-size="30" font-weight="700" fill="${C.text}">${esc(title)}</text>`;
  g += `<text x="40" y="84" font-size="18" fill="${C.text2}">${esc(sub)}</text>`;
  // legend (identity never by color alone: both states are named)
  g += `<rect x="40" y="108" width="18" height="18" rx="3" fill="${C.text2}"/><text x="66" y="123" font-size="17" fill="${C.text}">答えと一致した件数(各構成の色)</text>`;
  g += `<rect x="370" y="108" width="18" height="18" rx="3" fill="${C.miss}"/><text x="396" y="123" font-size="17" fill="${C.text}">一致しなかった件数</text>`;
  panels.forEach((p, pi) => {
    const x0 = 40 + pi * panelW;
    const bx = x0 + labelW;
    g += `<text x="${x0}" y="${top - 26}" font-size="21" font-weight="700" fill="${p.color}">${esc(p.name)}</text>`;
    g += `<text x="${x0}" y="${top - 2}" font-size="14" fill="${C.text2}">confidence の区間</text>`;
    // bins from high to low confidence, top to bottom
    [...p.bins].reverse().forEach((b, i) => {
      const y = top + 14 + i * rowH;
      const wOk = (b.correct / max) * barMax;
      const wMiss = ((b.n - b.correct) / max) * barMax;
      g += `<text x="${bx - 14}" y="${y + barH / 2 + 6}" text-anchor="end" font-size="18" fill="${C.text}">${esc(b.label)}</text>`;
      g += `<line x1="${bx}" x2="${bx}" y1="${y - 8}" y2="${y + barH + 8}" stroke="${C.grid}" stroke-width="2"/>`;
      if (wOk > 0) g += `<rect x="${bx}" y="${y}" width="${Math.max(wOk, 3)}" height="${barH}" rx="4" fill="${p.color}"/>`;
      if (wMiss > 0) g += `<rect x="${bx + wOk + (wOk > 0 ? 2 : 0)}" y="${y}" width="${Math.max(wMiss, 3)}" height="${barH}" rx="4" fill="${C.miss}"/>`;
      const end = bx + wOk + wMiss + (wOk > 0 && wMiss > 0 ? 2 : 0);
      const text = b.n === 0 ? '0件' : `${b.n}件中 ${b.correct}件一致(${Math.round((b.correct / b.n) * 100)}%)`;
      const miss = b.n - b.correct;
      g += `<text x="${Math.max(end, bx) + 10}" y="${y + barH / 2 + 6}" font-size="17" fill="${C.text}">${esc(text)}${miss ? `<tspan fill="${C.miss}" font-weight="700">・不一致${miss}件</tspan>` : ''}</text>`;
    });
  });
  g += `<text x="40" y="${H - 24}" font-size="15" fill="${C.text2}">${esc(`各構成とも、test ${total}件を、その構成が返した confidence の値で4つに分けた。選んだ候補の probability とは別の値。`)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}"><rect width="100%" height="100%" fill="${C.surface}"/>${g}</svg>`;
}
