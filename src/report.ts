import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { missChart, toPng } from './charts.js';
import { loadEval } from './data.js';
import { BASE, MAIN } from './jev.js';
import { CONFIG_LABEL, computeMetrics, type RawRun, type VariantMetrics } from './metrics.js';
import { loadParts } from './parts.js';

const { values: args } = parseArgs({ options: { raw: { type: 'string' } } });

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

const LABEL: Record<string, string> = {
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
  [BASE]: '基本プロンプト',
};
const lab = (id: string | null) => (id ? (LABEL[id] ?? id) : '-');
const p = (v: number | null) => (v === null ? '-' : `${(v * 100).toFixed(0)}%`);

const head = ms.find((m) => m.variant.config === MAIN) as VariantMetrics;
writeFileSync('results/chart-part-miss.png', toPng(missChart(head, 'プロンプト別: 選び間違えた割合', LABEL)));

/** Side check: if a low-confidence pick were replaced by the base prompt, how many would be wrong? */
const baseFallbackWrong = (cut: number) =>
  run.cases.filter((row) => {
    const c = byId.get(row.id);
    const r = row.results[MAIN];
    if (!c || !r?.ok) return false;
    const chosen = (r.confidence ?? 0) < cut ? BASE : (r.choice as string);
    return chosen !== c.answer && !c.acceptable.includes(chosen);
  }).length / head.n;

const models = [...new Set(run.cases.flatMap((c) => Object.values(c.results).map((r) => r?.model)).filter(Boolean))];

const table = [
  '| 正解率 | 「これでも可」込み | 誤ったプロンプト |',
  '|---:|---:|---:|',
  `| ${p(head.accuracy)} | ${p(head.accuracyLenient)} | ${p(head.wrongRate)} |`,
].join('\n');

const extras = ms
  .filter((m) => m.variant.config !== MAIN)
  .map(
    (m) =>
      `- ${CONFIG_LABEL[m.variant.config]}: 正解率 ${p(m.accuracy)}(可込み ${p(m.accuracyLenient)})、誤り ${p(m.wrongRate)}、判定の入力 ${m.selectorTokensPerCall?.toFixed(0)} tok/回`
  )
  .join('\n');

const mistakes = head.outcomes
  .filter((o) => o.verdict === 'wrong')
  .map((o) => {
    const c = byId.get(o.id);
    const ctx = c?.context.length ? '(文脈あり) ' : '';
    const acc = o.acceptable.length ? `(可: ${o.acceptable.map(lab).join('、')})` : '';
    return `| ${o.id} | ${ctx}${c?.utterance} | ${lab(o.answer)}${acc} | **${lab(o.chosen)}** | ${o.confidence?.toFixed(2)} |`;
  });
const confusion = head.confusion
  .slice(0, 6)
  .map((x) => `- ${lab(x.answer)} → ${lab(x.chosen)}: ${x.count}件`)
  .join('\n');

const findings = existsSync('results/findings.md') ? readFileSync('results/findings.md', 'utf8').trim() : '_(未記入)_';

const md = `# 結果サマリー: Jev でシステムプロンプトを1つ選ぶ

- 実行: ${run.startedAt} / モデル: ${models.join(', ')} / 件数: ${head.n}
- 候補12個(専用プロンプト11個 + 基本プロンプト)から、Jev の choice で1つ選ぶ
- 正解率 = 正解と一致 /「これでも可」込み = ラベル付けのときに決めた別解も当たりとする / 誤ったプロンプト = どちらでもないものを選んだ
- Jev が使えなかったとき(API エラー)は基本プロンプトを使う(今回は ${Math.round(head.failedRate * head.n)} 件)
- 判定時間 p50 ${Math.round(head.latencyP50 ?? 0)}ms / p95 ${Math.round(head.latencyP95 ?? 0)}ms、判定の費用 1000回あたり $${head.costUsdPer1k?.toFixed(3)}

${findings}

## 結果(choice・日本語)

${table}

![プロンプト別の選び間違い](chart-part-miss.png)

## 選び間違えた件

| id | 発話 | 正解 | Jev が選んだ | 確信度 |
|---|---|---|---|---:|
${mistakes.join('\n') || '| - | なし | | | |'}

**よくある取り違え**

${confusion || '- なし'}

## 補足

- 確信度が低いときに基本プロンプトへ戻すと: 誤り ${p(head.wrongRate)} → 下限0.5で ${p(baseFallbackWrong(0.5))}、0.7で ${p(baseFallbackWrong(0.7))}、0.9で ${p(baseFallbackWrong(0.9))}
${extras || '- なし'}
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
console.log(table);
console.log(extras);
console.log('base fallback wrong @0.5/0.7/0.9:', [0.5, 0.7, 0.9].map((c) => p(baseFallbackWrong(c))).join(' / '));
