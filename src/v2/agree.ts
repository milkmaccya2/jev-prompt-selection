/** Agreement between the original (v1) labels and the independent Claude labels. */
import { readFileSync, writeFileSync } from 'node:fs';
import { loadEval } from '../data.js';

interface L {
  id: string;
  answer: string | null;
  acceptable: string[];
  reason?: string | null;
}

const v1 = loadEval();
const claude = JSON.parse(readFileSync('results/v2/raw/labels-claude.json', 'utf8')) as { model: string; labels: L[] };
const byId = new Map(claude.labels.map((l) => [l.id, l]));
const pairs = v1
  .map((c) => ({ c, l: byId.get(c.id) }))
  .filter((x): x is { c: (typeof v1)[number]; l: L } => Boolean(x.l?.answer));

/** Cohen's kappa for two raters over nominal labels. */
export function cohenKappa(a: string[], b: string[]): number {
  const n = a.length;
  const po = a.filter((x, i) => x === b[i]).length / n;
  const labels = new Set([...a, ...b]);
  let pe = 0;
  for (const k of labels) pe += (a.filter((x) => x === k).length / n) * (b.filter((x) => x === k).length / n);
  return (po - pe) / (1 - pe);
}

const a = pairs.map((x) => x.c.answer);
const b = pairs.map((x) => x.l.answer as string);
const exact = pairs.filter((x) => x.c.answer === x.l.answer).length;
// compatible = either rater's answer is inside the other's answer+acceptable set
const compatible = pairs.filter(
  (x) =>
    x.c.answer === x.l.answer ||
    x.l.acceptable.includes(x.c.answer) ||
    x.c.acceptable.includes(x.l.answer as string)
).length;
const kappa = cohenKappa(a, b);
const missing = v1.length - pairs.length;

const diff = pairs.filter((x) => x.c.answer !== x.l.answer);
const fmt = (ans: string, acc: string[]) => `\`${ans}\`${acc.length ? `(可: ${acc.map((x) => `\`${x}\``).join(', ')})` : ''}`;
const rows = diff.map(({ c, l }) => {
  const ctx = c.context.length ? `<br><sub>文脈: ${c.context.map((t) => `${t.role === 'user' ? 'U' : 'A'}: ${t.text.split('\n')[0]}`).join(' / ')}</sub>` : '';
  const compat = l.acceptable.includes(c.answer) || c.acceptable.includes(l.answer as string) ? '別解で一致' : '不一致';
  return `| ${c.id} | ${c.utterance}${ctx} | ${fmt(c.answer, c.acceptable)} | ${fmt(l.answer as string, l.acceptable)} | ${compat} | ${l.reason ?? ''} |`;
});

const md = `# ラベルの突き合わせ(v1 の元ラベル vs ${claude.model})

- 件数: ${pairs.length}${missing ? `(Claude が付けられなかった件: ${missing})` : ''}
- 答えの一致率: **${((exact / pairs.length) * 100).toFixed(1)}%**(${exact}/${pairs.length})
- Cohen's kappa(答え、12候補): **${kappa.toFixed(3)}**
- 別解まで含めた一致率(どちらかの答えが相手の「答え+これでも可」に入る): ${((compatible / pairs.length) * 100).toFixed(1)}%(${compatible}/${pairs.length})

## 答えが食い違った件(${diff.length}件)

| id | 発話 | 元のラベル(v1) | Claude | 別解での関係 | Claude の理由 |
|---|---|---|---|---|---|
${rows.join('\n')}
`;
writeFileSync('results/v2/label-review.md', md);
console.log(md.split('\n').slice(0, 7).join('\n'));
