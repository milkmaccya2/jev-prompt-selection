/** v2 report: per-config accuracy with Wilson CIs, McNemar, latency, cost, loaded prompt size, Jev calibration. */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { type EvalCase, loadEval } from '../data.js';
import { BASE } from '../jev.js';
import { loadParts } from '../parts.js';
import { COARSE, type Granularity, toCoarse } from './candidates.js';
import { accuracyLatencyChart, type Bin, CLASSIFIER_COLOR, calibrationChart, costChart, toPng } from './charts.js';
import { CLASSIFIERS, type ClassifyResult } from './classifiers.js';
import { mcnemarExact, percentile, wilson } from './stats.js';

const { values: args } = parseArgs({ options: { raw: { type: 'string' } } });
const rawPath =
  args.raw ??
  `results/v2/raw/${readdirSync('results/v2/raw')
    .filter((f) => f.startsWith('run-'))
    .sort()
    .at(-1)}`;
interface Run {
  startedAt: string;
  data: string;
  env: Record<string, string>;
  warmup: number;
  spentUsd: number;
  configs: { key: string; classifier: string; label: string; model: string; reasoningEffort: string | null; granularity: Granularity }[];
  cases: { id: string; results: Record<string, ClassifyResult> }[];
}
const run = JSON.parse(readFileSync(rawPath, 'utf8')) as Run;
const cases = loadEval(new URL(`../../${run.data}`, import.meta.url));
const byId = new Map(cases.map((c) => [c.id, c]));
const rows = run.cases.filter((r) => byId.has(r.id));
const N = rows.length;

// ---- prompt size after selection (o200k approximation, same as v1) ----
const parts = loadParts();
const tok = new Map(parts.map((p) => [p.id, p.tokens]));
const always = parts.filter((p) => p.kind === 'always').reduce((s, p) => s + p.tokens, 0);
const full = parts.reduce((s, p) => s + p.tokens, 0);
const promptTokens = (g: Granularity, id: string) => {
  const members = g === 'fine' ? [id] : (COARSE.find((c) => c.id === id)?.members ?? []);
  return always + members.filter((m) => m !== BASE).reduce((s, m) => s + (tok.get(m) ?? 0), 0);
};

const LABEL: Record<string, string> = {
  search_conditions: '検索条件', query_normalization: '地名・職種の言い換え', company_info: '企業情報', reviews: 'クチコミ',
  salary_benefits: '給与・待遇', career_advice: 'キャリア相談', application_docs: '応募書類', interview_prep: '面接対策',
  account_terms: 'ログイン・規約', error_handling: 'エラー時', out_of_scope: '範囲外', [BASE]: '基本',
  consult: '相談', docs: '書類作成', info: '情報提供', howto: 'ハウツー',
};
const lab = (id: string | null) => (id ? (LABEL[id] ?? id) : '(なし)');

/** Gold for a granularity: the answer, and the set that also counts as right. */
const gold = (c: EvalCase, g: Granularity) => {
  if (g === 'fine') return { answer: c.answer, ok: new Set([c.answer, ...c.acceptable]) };
  const a = toCoarse(c.answer);
  return { answer: a, ok: new Set([a, ...c.acceptable.map(toCoarse)]) };
};
// An API error falls back to the base prompt (same rule as the deployed viewer).
const chosenOf = (r: ClassifyResult | undefined) => (r?.ok && r.chosen ? r.chosen : BASE);

interface M {
  key: string;
  classifier: string;
  label: string;
  g: Granularity;
  strict: boolean[];
  lenient: boolean[];
  errors: number;
  lat: number[];
  cost: number[];
  costNoCache: number[];
  cachedShare: number[];
  promptTok: number[];
  reasoningTok: number[];
  conf: { c: number; ok: boolean; okL: boolean }[];
  confusion: Map<string, number>;
}
const ms: M[] = run.configs.map((cfg) => {
  const m: M = { key: cfg.key, classifier: cfg.classifier, label: cfg.label, g: cfg.granularity, strict: [], lenient: [], errors: 0, lat: [], cost: [], costNoCache: [], cachedShare: [], promptTok: [], reasoningTok: [], conf: [], confusion: new Map() };
  for (const row of rows) {
    const c = byId.get(row.id) as EvalCase;
    const r = row.results[cfg.key];
    const chosen = chosenOf(r);
    const gd = gold(c, cfg.granularity);
    const ok = chosen === gd.answer;
    const okL = gd.ok.has(chosen);
    m.strict.push(ok);
    m.lenient.push(okL);
    if (!r?.ok) m.errors++;
    if (r) {
      m.lat.push(r.latencyMs);
      m.cost.push(r.costUsd);
      const price = CLASSIFIERS.find((x) => x.key === cfg.classifier)?.price;
      // "every call misses the cache": the cacheable prefix is written (1.25x on GPT-5.6+), the rest billed as input
      if (price) {
        const prefix = r.usage.cachedInput || (r.usage as { cacheWrite?: number }).cacheWrite || 0;
        m.costNoCache.push((r.usage.input - prefix) * price.input + prefix * (price.cacheWrite ?? price.input) + r.usage.output * price.output);
      }
      if (r.usage.input) m.cachedShare.push(r.usage.cachedInput / r.usage.input);
      m.reasoningTok.push(r.usage.reasoning);
      if (r.confidence !== null && r.ok) m.conf.push({ c: r.confidence, ok, okL });
    }
    m.promptTok.push(promptTokens(cfg.granularity, chosen));
    if (!okL) m.confusion.set(`${gd.answer}\t${chosen}`, (m.confusion.get(`${gd.answer}\t${chosen}`) ?? 0) + 1);
  }
  return m;
});

const sum = (xs: boolean[]) => xs.filter(Boolean).length;
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const ci = (k: number) => {
  const [lo, hi] = wilson(k, N);
  return `${pct(k / N)} [${pct(lo)}–${pct(hi)}]`;
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const ms0 = (v: number | null) => (v === null ? '-' : v >= 1000 ? `${(v / 1000).toFixed(2)}秒` : `${Math.round(v)}ms`);
const G = { fine: '12候補', coarse: '6分類' } as const;

// ---- main table ----
const table = [
  '| 構成 | 粒度 | 正解率 [95%CI] | 「これでも可」込み [95%CI] | 判定時間 p50 / p95 | 費用 / 1000回(実績) | 同(毎回キャッシュ切れ) | 選択後のプロンプト(平均) | エラー |',
  '|---|---|---:|---:|---:|---:|---:|---:|---:|',
  ...ms.map(
    (m) =>
      `| ${m.label} | ${G[m.g]} | ${ci(sum(m.strict))} | ${ci(sum(m.lenient))} | ${ms0(percentile(m.lat, 0.5))} / ${ms0(percentile(m.lat, 0.95))} | $${(mean(m.cost) * 1000).toFixed(3)} | $${(mean(m.costNoCache) * 1000).toFixed(3)} | ${Math.round(mean(m.promptTok)).toLocaleString()} tok | ${m.errors} |`
  ),
].join('\n');

// ---- McNemar: Jev vs each LLM, same granularity, same cases ----
const mcRows: string[] = [];
for (const g of ['fine', 'coarse'] as Granularity[]) {
  const j = ms.find((m) => m.classifier === 'jev' && m.g === g);
  if (!j) continue;
  for (const o of ms.filter((m) => m.classifier !== 'jev' && m.g === g)) {
    for (const [kind, A, B] of [
      ['答え', j.strict, o.strict],
      ['これでも可込み', j.lenient, o.lenient],
    ] as const) {
      const b = A.filter((x, i) => x && !B[i]).length;
      const c = A.filter((x, i) => !x && B[i]).length;
      mcRows.push(`| ${G[g]} | Jev vs ${o.label} | ${kind} | ${b} | ${c} | ${mcnemarExact(b, c).toFixed(3)} |`);
    }
  }
}

// ---- Jev calibration ----
const BINS: [string, number, number][] = [
  ['0.5未満', 0, 0.5],
  ['0.5〜0.7', 0.5, 0.7],
  ['0.7〜0.9', 0.7, 0.9],
  ['0.9以上', 0.9, 1.01],
];
const bins = (m: M): (Bin & { accL: number })[] =>
  BINS.map(([label, lo, hi]) => {
    const xs = m.conf.filter((x) => x.c >= lo && x.c < hi);
    return { label, n: xs.length, meanConf: mean(xs.map((x) => x.c)), acc: xs.length ? xs.filter((x) => x.ok).length / xs.length : 0, accL: xs.length ? xs.filter((x) => x.okL).length / xs.length : 0 };
  });
const calRows = ms
  .filter((m) => m.conf.length)
  .flatMap((m) => bins(m).map((b) => `| Jev ${G[m.g]} | ${b.label} | ${b.n} | ${b.n ? b.meanConf.toFixed(2) : '-'} | ${b.n ? pct(b.acc) : '-'} | ${b.n ? pct(b.accL) : '-'} |`));

// ---- confusion (wrong even with acceptable) ----
const confusionMd = ms
  .map((m) => {
    const list = [...m.confusion].sort((a, b) => b[1] - a[1]);
    const body = list.length ? list.map(([k, n]) => { const [a, ch] = k.split('\t'); return `${lab(a)} → ${lab(ch)} (${n})`; }).join('、') : 'なし';
    return `- **${m.label} ${G[m.g]}**: ${body}`;
  })
  .join('\n');

// ---- 6-class matrix for Jev and the best LLM ----
const matrix = (m: M) => {
  const ids = COARSE.map((c) => c.id);
  const cell = new Map<string, number>();
  rows.forEach((row) => {
    const c = byId.get(row.id) as EvalCase;
    const a = toCoarse(c.answer);
    const ch = chosenOf(row.results[m.key]);
    cell.set(`${a}\t${ch}`, (cell.get(`${a}\t${ch}`) ?? 0) + 1);
  });
  return [
    `| 正解 \\ 選択 | ${ids.map(lab).join(' | ')} |`,
    `|---|${ids.map(() => '---:').join('|')}|`,
    ...ids.map((a) => `| ${lab(a)} | ${ids.map((ch) => cell.get(`${a}\t${ch}`) ?? 0).join(' | ')} |`),
  ].join('\n');
};

// ---- charts ----
const p50 = (m: M) => percentile(m.lat, 0.5) ?? 0;
writeFileSync(
  'results/v2/chart-accuracy-latency.png',
  toPng(accuracyLatencyChart(ms.map((m) => { const k = sum(m.strict); const [lo, hi] = wilson(k, N); return { classifier: m.classifier, label: m.label, granularity: m.g, acc: k / N, lo, hi, latencyMs: p50(m) }; })))
);
const jevSeries = ms.filter((m) => m.conf.length && m.g === 'fine').map((m) => ({ name: `Jev ${G[m.g]}`, color: CLASSIFIER_COLOR.jev, bins: bins(m) }));
writeFileSync('results/v2/chart-calibration.png', toPng(calibrationChart(jevSeries)));
writeFileSync(
  'results/v2/chart-cost.png',
  toPng(
    costChart(
      ms
        .filter((m) => m.g === 'fine')
        .flatMap((m) => {
          const actual = { classifier: m.classifier, label: m.label, usd: mean(m.cost) * 1000 };
          const noCache = mean(m.costNoCache) * 1000;
          return m.classifier !== 'jev' && noCache > actual.usd * 1.05
            ? [actual, { classifier: m.classifier, label: `${m.label} 毎回キャッシュ切れ`, usd: noCache, faded: true }]
            : [actual];
        })
    )
  )
);

// ---- label agreement (from the review step) ----
const review = existsSync('results/v2/label-review.md') ? readFileSync('results/v2/label-review.md', 'utf8') : '';
const agreeLines = review.split('\n').filter((l) => l.startsWith('- ')).join('\n');
const findings = existsSync('results/v2/findings.md') ? readFileSync('results/v2/findings.md', 'utf8').trim() : '_(未記入)_';
const reasoningLuna = ms.find((m) => m.classifier === 'luna_low');

const md = `# v2 結果: Jev と LLM 分類器の比較

- 実行: ${run.startedAt} / ${N}件 / ${run.env.platform}-${run.env.arch}、Node ${run.env.node} / 実行費用 $${run.spentUsd.toFixed(3)}
- 正解データ: \`${run.data}\`(基準: \`data/LABELING.v2.md\`)
- 判定時間: 同じ端末・同じ回線から1件ずつ順番に実行。各件で全構成を交互に呼び、最初の${run.warmup}件は全構成で一度回して捨てた
- 費用: 実際のトークン数 × 公式の単価(\`results/v2/PRICING.md\`、2026-10-02 確認)
- 選択後のプロンプト: 選ばれた候補の部品を足したトークン数(o200k による近似)。全部載せは ${full.toLocaleString()} tok、基本プロンプトは ${always.toLocaleString()} tok。6分類は、その分類に含まれる部品をすべて載せる
- API エラーのときは基本プロンプトを使ったものとして採点した

${findings}

## 構成別の比較

${table}
${reasoningLuna ? `\ngpt-6-luna(推論 low)の推論トークンは1回あたり平均 ${Math.round(mean(reasoningLuna.reasoningTok))}。\n` : ''}
![正解率と判定時間](chart-accuracy-latency.png)

![1000回あたりの費用](chart-cost.png)

## Jev と LLM の差(McNemar の正確検定、同じ${N}件での勝ち負け)

b = Jev だけ正解、c = 相手だけ正解。p が小さいほど差が偶然ではない。

| 粒度 | 比較 | 採点 | b | c | p |
|---|---|---|---:|---:|---:|
${mcRows.join('\n')}

## Jev の確信度と実際の正解率

| 構成 | 確信度の区間 | 件数 | 平均確信度 | 正解率 | 「これでも可」込み |
|---|---|---:|---:|---:|---:|
${calRows.join('\n')}

![確信度の調整](chart-calibration.png)

## 取り違え(「これでも可」でも救えなかったもの、正解 → 選択)

${confusionMd}

### 6分類の対応表(行 = 正解、列 = 選択)

**Jev**

${matrix(ms.find((m) => m.classifier === 'jev' && m.g === 'coarse') as M)}

**gpt-6-sol(推論なし)**

${matrix(ms.find((m) => m.classifier === 'sol' && m.g === 'coarse') as M)}

## 正解ラベルの作り方

- 元のラベル(作成者1名、v1)と、Claude Opus 5.5 が基準書 v2 だけを見て独立に付けたラベルを突き合わせた
${agreeLines}
- 食い違いは主に v2 で決め直した境目(あいさつ・お礼を「範囲外」から「基本」へ)によるもの。確認のうえ、Claude のラベルをそのまま v2 の正解にした(\`results/v2/label-review.md\`)

## 条件の違い(Jev と LLM)

- 候補の説明文・直前の会話・発話・指示文は同じものを渡した
- Jev は \`state\`(会話)と choice の質問として、LLM は system に指示と候補一覧、user に会話の JSON として受け取る
- LLM は Chat Completions、構造化出力(候補 id の enum)、\`reasoning_effort: none\`(参考の1構成だけ low)。gpt-6-sol の後継の gpt-6.1-sol は \`none\` に対応していないため使っていない
- LLM の system(指示と候補一覧)は全件で同じなので、OpenAI 側の自動プロンプトキャッシュが効いた。入力のうちキャッシュから読まれた割合の平均: ${ms.filter((m) => m.classifier !== 'jev').map((m) => `${m.label} ${G[m.g]} ${pct(mean(m.cachedShare))}`).join('、')}。Jev にはキャッシュの割引がない

## キャッシュの有効期限を考えた費用

OpenAI のプロンプトキャッシュは、GPT-5.6 以降では最後に使われてから30分有効で、書き込みは入力単価の1.25倍、読み出しは0.1倍(https://developers.openai.com/api/docs/guides/prompt-caching 、2026-10-02 確認)。
費用はヒット率で決まるので、両端と、Jev と同じ費用になるヒット率を示す(12候補、1000回あたり)。

| 構成 | 毎回キャッシュが効く | 毎回キャッシュ切れ(書き込み) | Jev と並ぶヒット率 |
|---|---:|---:|---:|
${ms
  .filter((m) => m.classifier !== 'jev' && m.g === 'fine')
  .map((m) => {
    const jevCost = mean((ms.find((x) => x.classifier === 'jev' && x.g === 'fine') as M).cost) * 1000;
    const warm = mean(m.cost) * 1000;
    const cold = mean(m.costNoCache) * 1000;
    const be = cold - warm > 1e-9 ? (cold - jevCost) / (cold - warm) : Number.NaN;
    const beText = Number.isNaN(be) ? 'キャッシュされない' : be > 1 ? 'なし(常に Jev より高い)' : be < 0 ? '0%(常に Jev より安い)' : pct(be);
    return `| ${m.label} | $${warm.toFixed(3)} | $${cold.toFixed(3)} | ${beText} |`;
  })
  .join('\n')}

- 今回の実行では、ウォームアップで書き込みが済み、採点した100件はすべてキャッシュに当たった(呼び出し間隔は約15秒)
- 30分の有効期限は使われるたびに延びるので、判定の呼び出しが30分に1回以上ある限り、キャッシュは切れない。ヒット率が下がるのは、呼び出しがまばらな場合や、負荷分散で別のマシンに振られた場合、候補の説明を変えた直後
- gpt-5.4-nano は、同じプロンプトを続けて送ってもキャッシュに乗らなかった(理由は未確認)
`;
writeFileSync('results/v2/summary.md', md);
console.log(table);
console.log(mcRows.join('\n'));
console.log(calRows.join('\n'));
