import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { missChart, toPng, tradeoffChart } from './charts.js';
import { loadEval } from './data.js';
import { BASE } from './jev.js';
import { computeMetrics, promptTokens, type RawRun, type VariantMetrics } from './metrics.js';
import { loadParts } from './parts.js';
import { CUTOFFS, NOUL_MIN } from './select.js';

const { values: args } = parseArgs({
  options: {
    raw: { type: 'string' },
    focus: { type: 'string', default: 'choice_ja@0' },
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
const T = promptTokens(parts);

export const LABEL: Record<string, string> = {
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

const focus = ms.find((m) => m.variant.key === args.focus) as VariantMetrics;
writeFileSync('results/chart-tradeoff.png', toPng(tradeoffChart(ms, 'プロンプトを1つ選ぶと、どれだけ軽く・どれだけ外すか')));
writeFileSync(
  'results/chart-part-miss.png',
  toPng(missChart(focus, `プロンプト別: 選び間違えた割合(${focus.variant.label})`, LABEL))
);

const p = (v: number | null) => (v === null ? '-' : `${(v * 100).toFixed(1)}%`);
const ms0 = (v: number | null) => (v === null ? '-' : `${Math.round(v)}ms`);
const models = [...new Set(run.cases.flatMap((c) => Object.values(c.results).map((r) => r?.model)).filter(Boolean))];

const table = (rows: VariantMetrics[]) =>
  [
    '| 構成 | 正解率 | 「これでも可」込み | 誤ったプロンプト | 全部載せに倒した | 削減率 | 選択 p50 / p95 | 選択の入力 tok/回 | 費用 /1000回 |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...rows.map(
      (m) =>
        `| ${m.variant.label} | ${m.variant.config === 'all' ? '-' : p(m.accuracy)} | ${m.variant.config === 'all' ? '-' : p(m.accuracyLenient)} | ${p(m.wrongRate)} | ${p(m.fallbackRate)} | ${p(m.reduction)} | ${ms0(m.latencyP50)} / ${ms0(m.latencyP95)} | ${m.selectorTokensPerCall?.toFixed(0) ?? '-'} | ${m.costUsdPer1k === null ? '-' : `$${m.costUsdPer1k.toFixed(3)}`} |`
    ),
  ].join('\n');

const mistakes = focus.outcomes
  .filter((o) => o.verdict === 'wrong')
  .map((o) => {
    const c = byId.get(o.id);
    const ctx = c?.context.length ? '(文脈あり) ' : '';
    const acc = o.acceptable.length ? `(可: ${o.acceptable.map(lab).join('、')})` : '';
    return `| ${o.id} | ${ctx}${c?.utterance} | ${lab(o.answer)}${acc} | **${lab(o.chosen)}** | ${o.confidence?.toFixed(2)} | ${c?.tags.join(', ')} |`;
  });
const confusion = focus.confusion
  .slice(0, 8)
  .map((x) => `- ${lab(x.answer)} → ${lab(x.chosen)}: ${x.count}件`)
  .join('\n');

const findings = existsSync('results/findings.md') ? readFileSync('results/findings.md', 'utf8').trim() : '_(未記入)_';
const main = ms.filter((m) => m.variant.cutoff === 0);

const md = `# 結果サマリー: Jev でシステムプロンプトを1つ選ぶ

- 実行: ${run.startedAt} / モデル: ${models.join(', ')} / 件数: ${focus.n} / 費用(実績): $${run.spentUsd.toFixed(4)}
- 候補: 専用プロンプト11個(常に載せる3部品 + 分野の部品1つ)+ 基本プロンプト(常に載せる3部品のみ)。全部載せは ${T.full} tok、基本プロンプトは ${T.always} tok
- 逃げ道: 確信度(choice の \`confidence\`)が下限未満、または API エラーなら全部載せ。B は noul の最大値が ${NOUL_MIN} 以上ならその分野、未満なら基本プロンプト
- 正解率は「選んだプロンプト = 正解」、「これでも可」込みは複数分野にまたがる発話の別解も正解とする。誤ったプロンプト = どちらでもない
- トークン数は gpt-tokenizer(o200k)による近似。費用は Jev の \`usage.input_tokens\` × $0.042/Mtok

${findings}

## 比較表(逃げ道なし)

${table(main)}

## 確信度の下限を変えたとき

確信度が下限を下回った件は全部載せにする(${CUTOFFS.filter(Boolean).join(' / ')})。

${table(ms.filter((m) => m.variant.cutoff > 0))}

## グラフ

![削減率と誤り](chart-tradeoff.png)

![プロンプト別の選び間違い](chart-part-miss.png)

## 選び間違えた件(${focus.variant.label})

| id | 発話 | 正解 | Jev が選んだ | 確信度 | タグ |
|---|---|---|---|---:|---|
${mistakes.join('\n') || '| - | なし | | | | |'}

**よくある取り違え**

${confusion || '- なし'}
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
console.log(table(main));
