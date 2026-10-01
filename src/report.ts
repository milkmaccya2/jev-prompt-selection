import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { missChart, toPng, tradeoffChart } from './charts.js';
import { loadEval } from './data.js';
import { computeMetrics, type RawRun, type VariantMetrics } from './metrics.js';
import { loadParts } from './parts.js';
import { FALLBACK } from './select.js';

const { values: args } = parseArgs({
  options: {
    raw: { type: 'string' },
    focus: { type: 'string', default: 'noul_ja@0.3' },
  },
});

const rawPath =
  args.raw ??
  `results/raw/${readdirSync('results/raw')
    .filter((f) => f.startsWith('run-'))
    .sort()
    .at(-1)}`;
const run = JSON.parse(readFileSync(rawPath, 'utf8')) as RawRun;
const parts = loadParts();
const cases = loadEval();
const byId = new Map(cases.map((c) => [c.id, c]));
const ms = computeMetrics(run, cases, parts);
const label = Object.fromEntries(parts.map((p) => [p.id, p.summary.split('(')[0].slice(0, 16)]));
const short: Record<string, string> = {
  search_conditions: '検索条件の聞き出し',
  query_normalization: '地名・職種の言い換え',
  company_info: '企業情報',
  reviews: 'クチコミ',
  salary_benefits: '給与・待遇',
  career_advice: 'キャリア相談',
  application_docs: '応募書類',
  interview_prep: '面接対策',
  account_terms: 'ログイン・規約',
  error_handling: 'エラー時',
  out_of_scope: '範囲外の話題',
};
Object.assign(label, short);

const fullTokens = parts.reduce((s, x) => s + x.tokens, 0);
const alwaysTokens = parts.filter((x) => x.kind === 'always').reduce((s, x) => s + x.tokens, 0);
const focus = ms.find((m) => m.variant.key === args.focus) as VariantMetrics;
writeFileSync('results/chart-tradeoff.png', toPng(tradeoffChart(ms, '入力をどれだけ減らせて、必要な部品をどれだけ残せたか', 1 - alwaysTokens / fullTokens)));
writeFileSync(
  'results/chart-part-miss.png',
  toPng(missChart(focus, `部品別の取りこぼし率(${focus.variant.label})`, label))
);

const p = (v: number | null) => (v === null ? '-' : `${(v * 100).toFixed(1)}%`);
const ms0 = (v: number | null) => (v === null ? '-' : `${Math.round(v)}ms`);
const models = [...new Set(run.cases.flatMap((c) => Object.values(c.results).map((r) => r?.model)).filter(Boolean))];

const table = (rows: VariantMetrics[]) =>
  [
    '| 構成 | 削減率 | 再現率 | 1つでも落とした件 | 適合率 | 全部載せに倒した件 | 選択 p50 / p95 | 選択の入力 tok/回 | 費用 /1000回 |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...rows.map(
      (m) =>
        `| ${m.variant.label} | ${p(m.reduction)} | ${p(m.recall)} | ${p(m.caseMissRate)} | ${p(m.precision)} | ${p(m.fallbackRate)} | ${ms0(m.latencyP50)} / ${ms0(m.latencyP95)} | ${m.selectorTokensPerCall?.toFixed(0) ?? '-'} | ${m.costUsdPer1k === null ? '-' : `$${m.costUsdPer1k.toFixed(3)}`} |`
    ),
  ].join('\n');

const misses = focus.outcomes
  .filter((o) => o.missed.length)
  .map((o) => {
    const c = byId.get(o.id);
    const ctx = c?.context.length ? `(文脈あり) ` : '';
    return `| ${o.id} | ${ctx}${c?.utterance} | ${o.gold.map((g) => label[g]).join('、')} | ${o.chosen.map((g) => label[g]).join('、') || '(なし)'} | **${o.missed.map((g) => label[g]).join('、')}** | ${c?.tags.join(', ')} |`;
  });

const findings = existsSync('results/findings.md') ? readFileSync('results/findings.md', 'utf8').trim() : '_(未記入)_';

const md = `# 結果サマリー: Jev によるプロンプト部品の選択

- 実行: ${run.startedAt} / モデル: ${models.join(', ')} / 件数: ${focus.n} / 費用(実績): $${run.spentUsd.toFixed(4)}
- プロンプト: 部品 ${parts.length} 個・${fullTokens} tok(常に載せる ${alwaysTokens} tok → **削減の上限は ${p(1 - alwaysTokens / fullTokens)}**)
- 逃げ道: noul が ${FALLBACK.uncertainBand.join('〜')} の部品が ${FALLBACK.uncertainMin} 個以上 / choice の confidence < ${FALLBACK.choiceMinConfidence} / API エラー → 全部載せ
- トークン数は gpt-tokenizer(o200k)による近似。費用は Jev の \`usage.input_tokens\` × $0.042/Mtok

${findings}

## 比較表(逃げ道あり)

${table(ms.filter((m) => m.variant.config === 'all' || m.variant.fallback))}

## 比較表(逃げ道なし)

${table(ms.filter((m) => m.variant.config !== 'all' && !m.variant.fallback))}

## グラフ

![削減率と再現率](chart-tradeoff.png)

![部品別の取りこぼし率](chart-part-miss.png)

## 取りこぼした件(${focus.variant.label})

| id | 発話 | 正解 | Jev が選んだ部品 | 落とした部品 | タグ |
|---|---|---|---|---|---|
${misses.join('\n') || '| - | なし | | | | |'}
`;
writeFileSync('results/summary.md', md);
writeFileSync(
  'results/metrics.json',
  `${JSON.stringify(
    ms.map(({ outcomes: _o, ...m }) => m),
    null,
    2
  )}\n`
);
console.log(`report from ${rawPath} → results/summary.md, metrics.json, chart-*.png`);
console.log(table(ms.filter((m) => m.variant.config === 'all' || m.variant.fallback)));
