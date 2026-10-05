/**
 * v3 report (plan: results/v3/PLAN.md, sections 4, 5 and 9).
 * Reads the latest run-test-*.json and run-dev-*.json and writes summary.md, metrics.json and the charts.
 * Scoring: a failed call counts as wrong (no fallback to base).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { type EvalCase, loadEval } from '../data.js';
import { accuracyLatencyChart, type Bin, CLASSIFIER_COLOR, calibrationChart, costChart, toPng } from '../v2/charts.js';
import { toCoarse as toCoarseV2 } from '../v2/candidates.js';
import { coarseDefs, type Granularity, toCoarse } from './candidates.js';
import type { ClassifyResult } from './classifiers.js';
import { mcnemarExact, percentile, wilson } from './stats.js';

const { values: args } = parseArgs({ options: { test: { type: 'string' }, dev: { type: 'string' } } });
const latest = (set: string) => {
  const f = readdirSync('results/v3/raw')
    .filter((x) => x.startsWith(`run-${set}-`))
    .sort()
    .at(-1);
  if (!f) throw new Error(`no run-${set}-*.json`);
  return `results/v3/raw/${f}`;
};

type Call = ClassifyResult & { pos: number; at: string };
interface Cfg { key: string; classifier: string; label: string; model: string; reasoningEffort: string | null; granularity: Granularity; price: { input: number; cachedInput: number; cacheWrite?: number; output: number } }
interface Run {
  startedAt: string;
  finishedAt: string;
  set: 'test' | 'dev';
  data: string;
  env: Record<string, string>;
  seed: number;
  warmup: { examples: number[]; utterances: string[] };
  retries: number;
  spentUsd: number;
  stoppedByBudget: boolean;
  frozen: { before: { ok: boolean }; after: { ok: boolean } };
  configs: Cfg[];
  cases: { id: string; order: string[]; results: Record<string, Call> }[];
}

const G = { fine: '12候補', coarse: '6分類' } as const;
const LABEL: Record<string, string> = {
  search_conditions: '検索条件', query_normalization: '地名・職種の言い換え', company_info: '企業情報', reviews: 'クチコミ',
  salary_benefits: '給与・待遇', career_advice: 'キャリア相談', application_docs: '応募書類', interview_prep: '面接対策',
  account_terms: 'ログイン・規約', error_handling: 'エラー時', out_of_scope: '範囲外', base: '基本',
  consult: '相談', docs: '書類作成', info: '情報提供', howto: 'ハウツー',
};
const lab = (id: string | null) => (id ? (LABEL[id] ?? id) : '(失敗)');
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sec = (v: number | null) => (v === null ? '-' : `${(v / 1000).toFixed(2)}秒`);
const usd = (v: number) => `$${v.toFixed(3)}`;

const gold = (c: EvalCase, g: Granularity, map: (id: string) => string = toCoarse) => {
  if (g === 'fine') return { answer: c.answer, ok: new Set([c.answer, ...c.acceptable]) };
  const a = map(c.answer);
  return { answer: a, ok: new Set([a, ...c.acceptable.map(map)]) };
};

interface M {
  cfg: Cfg;
  n: number;
  strict: boolean[];
  lenient: boolean[];
  failed: boolean[];
  models: Map<string, number>;
  lat: number[];
  cost: number[];
  costNoCache: number[];
  inputTok: number[];
  cachedShare: number[];
  reasoning: number[];
  conf: { c: number; p: number; ok: boolean; okL: boolean }[];
  confusion: Map<string, number>;
  byPos: number[][];
  chosen: (string | null)[];
}

function measure(run: Run, cases: EvalCase[]) {
  const byId = new Map(cases.map((c) => [c.id, c]));
  return run.configs.map((cfg) => {
    const m: M = { cfg, n: run.cases.length, strict: [], lenient: [], failed: [], models: new Map(), lat: [], cost: [], costNoCache: [], inputTok: [], cachedShare: [], reasoning: [], conf: [], confusion: new Map(), byPos: Array.from({ length: run.configs.length }, () => []), chosen: [] };
    for (const row of run.cases) {
      const c = byId.get(row.id) as EvalCase;
      const r = row.results[cfg.key];
      const gd = gold(c, cfg.granularity);
      const chosen = r.ok ? r.chosen : null; // failure = wrong
      const ok = chosen === gd.answer;
      const okL = chosen !== null && gd.ok.has(chosen);
      m.strict.push(ok);
      m.lenient.push(okL);
      m.failed.push(!r.ok);
      m.chosen.push(chosen);
      if (r.model) m.models.set(r.model, (m.models.get(r.model) ?? 0) + 1);
      m.cost.push(r.costUsd);
      const p = cfg.price;
      // "every call misses the cache": what was read from or written to the cache is written instead (1.25x on GPT-5.6+)
      const cacheable = r.usage.cachedInput + r.usage.cacheWrite;
      m.costNoCache.push((r.usage.input - cacheable) * p.input + cacheable * (p.cacheWrite ?? p.input) + r.usage.output * p.output);
      if (r.ok) {
        m.lat.push(r.latencyMs);
        m.byPos[r.pos].push(r.latencyMs);
        m.inputTok.push(r.usage.input);
        if (r.usage.input) m.cachedShare.push(r.usage.cachedInput / r.usage.input);
        m.reasoning.push(r.usage.reasoning);
        if (r.confidence !== null && r.probs && chosen) m.conf.push({ c: r.confidence, p: r.probs[chosen] ?? 0, ok, okL });
      }
      if (!okL) m.confusion.set(`${gd.answer}\t${chosen}`, (m.confusion.get(`${gd.answer}\t${chosen}`) ?? 0) + 1);
    }
    return m;
  });
}

const k = (xs: boolean[]) => xs.filter(Boolean).length;
const ci = (kk: number, n: number) => {
  const [lo, hi] = wilson(kk, n);
  return `${pct(kk / n)} [${pct(lo)}–${pct(hi)}]`;
};
const modelText = (m: M) => [...m.models].map(([name, n]) => (m.models.size > 1 ? `\`${name}\`×${n}` : `\`${name}\``)).join(', ') || '-';

function mainTable(ms: M[]) {
  return [
    '| 構成 | 粒度 | 返ってきたモデル名 | 答えと一致 [95%CI] | 別解込み [95%CI] | 判定時間 p50 / p95 | 費用 / 1000回(実績) | 同(毎回キャッシュ切れ) | 失敗 |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|',
    ...ms.map(
      (m) =>
        `| ${m.cfg.label} | ${G[m.cfg.granularity]} | ${modelText(m)} | ${ci(k(m.strict), m.n)} | ${ci(k(m.lenient), m.n)} | ${sec(percentile(m.lat, 0.5))} / ${sec(percentile(m.lat, 0.95))} | ${usd(mean(m.cost) * 1000)} | ${usd(mean(m.costNoCache) * 1000)} | ${k(m.failed)} |`
    ),
  ].join('\n');
}

/** Holm step-down adjustment. */
function holm(ps: number[]) {
  const idx = ps.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0]);
  const adj = new Array(ps.length).fill(0);
  let run = 0;
  idx.forEach(([p, i], r) => {
    run = Math.max(run, Math.min(1, (ps.length - r) * p));
    adj[i] = run;
  });
  return adj as number[];
}

function mcnemar(ms: M[]) {
  const PRIMARY = ['nano', 'luna', 'sol'];
  const pairs: { g: Granularity; o: M; b: number; c: number; p: number; primary: boolean; kind: '答え' | '別解込み' }[] = [];
  for (const g of ['fine', 'coarse'] as Granularity[]) {
    const j = ms.find((m) => m.cfg.classifier === 'jev' && m.cfg.granularity === g);
    if (!j) continue;
    for (const o of ms.filter((m) => m.cfg.classifier !== 'jev' && m.cfg.granularity === g)) {
      for (const kind of ['答え', '別解込み'] as const) {
        const A = kind === '答え' ? j.strict : j.lenient;
        const B = kind === '答え' ? o.strict : o.lenient;
        const b = A.filter((x, i) => x && !B[i]).length;
        const c = A.filter((x, i) => !x && B[i]).length;
        pairs.push({ g, o, b, c, p: mcnemarExact(b, c), primary: kind === '答え' && PRIMARY.includes(o.cfg.classifier), kind });
      }
    }
  }
  const prim = pairs.filter((x) => x.primary);
  const adj = holm(prim.map((x) => x.p));
  const adjOf = new Map(prim.map((x, i) => [x, adj[i]]));
  const row = (x: (typeof pairs)[number]) => {
    const a = adjOf.get(x);
    return `| ${G[x.g]} | Jev 対 ${x.o.cfg.label} | ${x.kind} | ${x.b} | ${x.c} | ${x.p.toFixed(3)} | ${a === undefined ? '-' : a.toFixed(3)} | ${a === undefined ? '(参考)' : a < 0.05 ? '差がある' : '差があるとは言えない'} |`;
  };
  const head = '| 粒度 | 比較 | 採点 | b(Jevだけ正解) | c(相手だけ正解) | p | Holm 補正後の p | 判定 |\n|---|---|---|---:|---:|---:|---:|---|';
  return {
    primary: `${head}\n${prim.map(row).join('\n')}`,
    reference: `${head}\n${pairs.filter((x) => !x.primary).map(row).join('\n')}`,
    data: pairs.map((x) => ({ granularity: x.g, vs: x.o.cfg.key, scoring: x.kind === '答え' ? 'answer' : 'lenient', b: x.b, c: x.c, p: x.p, holm: adjOf.get(x) ?? null, primary: x.primary })),
  };
}

const BINS: [string, number, number][] = [
  ['0.5未満', 0, 0.5],
  ['0.5〜0.7', 0.5, 0.7],
  ['0.7〜0.9', 0.7, 0.9],
  ['0.9以上', 0.9, 1.01],
];
const bins = (m: M, by: 'c' | 'p'): (Bin & { accL: number })[] =>
  BINS.map(([label, lo, hi]) => {
    const xs = m.conf.filter((x) => x[by] >= lo && x[by] < hi);
    return { label, n: xs.length, meanConf: mean(xs.map((x) => x[by])), acc: xs.length ? k(xs.map((x) => x.ok)) / xs.length : 0, accL: xs.length ? k(xs.map((x) => x.okL)) / xs.length : 0 };
  });
const calTable = (ms: M[], by: 'c' | 'p') =>
  [
    `| 構成 | 区間 | 件数 | 平均${by === 'c' ? '確信度' : '確率'} | 答えと一致 | 別解込み |`,
    '|---|---|---:|---:|---:|---:|',
    ...ms
      .filter((m) => m.conf.length)
      .flatMap((m) => bins(m, by).map((b) => `| Jev ${G[m.cfg.granularity]} | ${b.label} | ${b.n} | ${b.n ? b.meanConf.toFixed(2) : '-'} | ${b.n ? pct(b.acc) : '-'} | ${b.n ? pct(b.accL) : '-'} |`)),
  ].join('\n');

const confusionMd = (ms: M[]) =>
  ms
    .map((m) => {
      const list = [...m.confusion].sort((a, b) => b[1] - a[1]);
      const body = list.length ? list.map(([key, n]) => { const [a, ch] = key.split('\t'); return `${lab(a)} → ${lab(ch === 'null' ? null : ch)} (${n})`; }).join('、') : 'なし';
      return `- **${m.cfg.label} ${G[m.cfg.granularity]}**: ${body}`;
    })
    .join('\n');

function matrix(m: M, cases: EvalCase[]) {
  const ids = coarseDefs().map((c) => c.id);
  const cell = new Map<string, number>();
  cases.forEach((c, i) => cell.set(`${toCoarse(c.answer)}\t${m.chosen[i]}`, (cell.get(`${toCoarse(c.answer)}\t${m.chosen[i]}`) ?? 0) + 1));
  const fails = m.chosen.filter((x) => x === null).length;
  return [
    `| 正解 \\ 選択 | ${ids.map(lab).join(' | ')} |${fails ? ' 失敗 |' : ''}`,
    `|---|${ids.map(() => '---:').join('|')}|${fails ? '---:|' : ''}`,
    ...ids.map((a) => `| ${lab(a)} | ${ids.map((ch) => cell.get(`${a}\t${ch}`) ?? 0).join(' | ')} |${fails ? ` ${cell.get(`${a}\tnull`) ?? 0} |` : ''}`),
  ].join('\n');
}

const posTable = (ms: M[]) => {
  const P = ms[0].byPos.length;
  return [
    `| 構成 | ${Array.from({ length: P }, (_, i) => `${i + 1}番目`).join(' | ')} |`,
    `|---|${Array.from({ length: P }, () => '---:').join('|')}|`,
    ...ms.map((m) => `| ${m.cfg.label} ${G[m.cfg.granularity]} | ${m.byPos.map((xs) => (xs.length ? `${sec(percentile(xs, 0.5))}(${xs.length})` : '-')).join(' | ')} |`),
  ].join('\n');
};

const tokTable = (ms: M[]) =>
  [
    '| 構成 | 粒度 | 入力トークン / 回(平均) | うちキャッシュから読まれた割合 |',
    '|---|---|---:|---:|',
    ...ms.map((m) => `| ${m.cfg.label} | ${G[m.cfg.granularity]} | ${Math.round(mean(m.inputTok)).toLocaleString()} | ${m.cfg.classifier === 'jev' ? '-(キャッシュの割引なし)' : pct(mean(m.cachedShare))} |`),
  ].join('\n');

const breakEven = (ms: M[]) =>
  [
    '| 構成 | 粒度 | 実績 | 毎回キャッシュ切れ | Jev と並ぶヒット率 |',
    '|---|---|---:|---:|---:|',
    ...ms
      .filter((m) => m.cfg.classifier !== 'jev')
      .map((m) => {
        const j = ms.find((x) => x.cfg.classifier === 'jev' && x.cfg.granularity === m.cfg.granularity) as M;
        const jevCost = mean(j.cost) * 1000;
        const warm = mean(m.cost) * 1000;
        const cold = mean(m.costNoCache) * 1000;
        // same as v2: the observed run is treated as "every call hits", cost is linear in the hit rate
        const be = cold - warm > 1e-9 ? (cold - jevCost) / (cold - warm) : Number.NaN;
        const beText = Number.isNaN(be) ? 'キャッシュされない' : be > 1 ? 'なし(常に Jev より高い)' : be < 0 ? '0%(常に Jev より安い)' : pct(be);
        return `| ${m.cfg.label} | ${G[m.cfg.granularity]} | ${usd(warm)} | ${usd(cold)} | ${beText} |`;
      }),
  ].join('\n');

// ---------- load ----------
const testRun = JSON.parse(readFileSync(args.test ?? latest('test'), 'utf8')) as Run;
const devRun = JSON.parse(readFileSync(args.dev ?? latest('dev'), 'utf8')) as Run;
const testCases = loadEval(new URL(`../../${testRun.data}`, import.meta.url));
const devCases = loadEval(new URL(`../../${devRun.data}`, import.meta.url));
for (const [run, cases] of [[testRun, testCases], [devRun, devCases]] as const) {
  if (run.cases.length !== cases.length || run.cases.some((r, i) => r.id !== cases[i].id)) throw new Error(`${run.set}: run does not cover the whole set in order`);
  if (run.stoppedByBudget || !run.frozen.before.ok || !run.frozen.after.ok) throw new Error(`${run.set}: run stopped or frozen inputs changed`);
}
const T = measure(testRun, testCases);
const D = measure(devRun, devCases);
const tooManyFails = [...T, ...D].filter((m) => k(m.failed) >= 10);
if (tooManyFails.length) console.warn(`WARNING: >=10 failures in ${tooManyFails.map((m) => m.cfg.key).join(', ')} (PLAN 5: stop and report)`);
const mcT = mcnemar(T);
const mcD = mcnemar(D);

// ---------- v2 → v3 on dev ----------
const V2_RAW = 'results/v2/raw/run-2026-10-02T12-50-44-n100.json';
const v2Run = JSON.parse(readFileSync(V2_RAW, 'utf8')) as { cases: { id: string; results: Record<string, ClassifyResult> }[] };
const v2Cases = new Map(loadEval(new URL('../../data/eval.v2.jsonl', import.meta.url)).map((c) => [c.id, c]));
const v2Rows = D.map((m) => {
  const key = m.cfg.key;
  let v2ok = 0;
  let v3onV2 = 0;
  for (const row of v2Run.cases) {
    const r = row.results[key];
    const c2 = v2Cases.get(row.id) as EvalCase;
    const g2 = gold(c2, m.cfg.granularity, toCoarseV2);
    if ((r?.ok && r.chosen ? r.chosen : 'base') === g2.answer) v2ok++; // v2 scoring (failure -> base)
    const i3 = devCases.findIndex((c) => c.id === row.id);
    if (i3 >= 0 && m.chosen[i3] === g2.answer) v3onV2++;
  }
  const v3ok = k(m.strict);
  return { key, label: m.cfg.label, g: m.cfg.granularity, v2: v2ok, v3onV2, v3: v3ok };
});

// ---------- luna_low reasoning ----------
const reasoningLine = (ms: M[], set: string) => {
  const m = ms.find((x) => x.cfg.classifier === 'luna_low');
  if (!m) return '';
  return `${set}: 推論トークンが0だった呼び出し ${m.reasoning.filter((x) => x === 0).length} / ${m.reasoning.length}回、平均 ${mean(m.reasoning).toFixed(1)} トークン`;
};

// ---------- charts (test) ----------
const point = (m: M) => {
  const kk = k(m.strict);
  const [lo, hi] = wilson(kk, m.n);
  return { classifier: m.cfg.classifier, label: m.cfg.label, granularity: m.cfg.granularity, acc: kk / m.n, lo, hi, latencyMs: percentile(m.lat, 0.5) ?? 0 };
};
writeFileSync('results/v3/chart-accuracy-latency.png', toPng(accuracyLatencyChart(T.map(point), { legendValues: true }).replace('正解率(95%信頼区間)と判定時間', 'test: 答えと一致した割合(95%信頼区間)と判定時間')));
writeFileSync(
  'results/v3/chart-calibration.png',
  toPng(calibrationChart(T.filter((m) => m.conf.length && m.cfg.granularity === 'fine').map((m) => ({ name: 'Jev 12候補', color: CLASSIFIER_COLOR.jev, bins: bins(m, 'c') }))).replace('Jev の確信度は、実際の正解率と合っているか', 'test: Jev の確信度は、実際の正解率と合っているか'))
);
writeFileSync(
  'results/v3/chart-cost.png',
  toPng(
    costChart(
      T.filter((m) => m.cfg.granularity === 'fine').flatMap((m) => {
        const actual = { classifier: m.cfg.classifier, label: m.cfg.label, usd: mean(m.cost) * 1000 };
        const cold = mean(m.costNoCache) * 1000;
        return m.cfg.classifier !== 'jev' && cold > actual.usd * 1.05 ? [actual, { classifier: m.cfg.classifier, label: `${m.cfg.label} 毎回キャッシュ切れ`, usd: cold, faded: true }] : [actual];
      })
    ).replace('2026-10-02 確認', '2026-10-04 確認').replace('1000回あたりの判定の費用(12候補)', 'test: 1000回あたりの判定の費用(12候補)')
  )
);

// ---------- metrics.json ----------
const metricsOf = (ms: M[]) =>
  ms.map((m) => ({
    key: m.cfg.key,
    label: m.cfg.label,
    granularity: m.cfg.granularity,
    models: Object.fromEntries(m.models),
    n: m.n,
    correct: k(m.strict),
    correctLenient: k(m.lenient),
    failures: k(m.failed),
    accuracy: k(m.strict) / m.n,
    accuracyCI: wilson(k(m.strict), m.n),
    accuracyLenient: k(m.lenient) / m.n,
    accuracyExcludingFailures: k(m.strict) / Math.max(1, m.n - k(m.failed)),
    latencyMs: { p50: percentile(m.lat, 0.5), p95: percentile(m.lat, 0.95) },
    usdPer1000: mean(m.cost) * 1000,
    usdPer1000NoCache: mean(m.costNoCache) * 1000,
    inputTokensPerCall: mean(m.inputTok),
    cachedShare: m.cfg.classifier === 'jev' ? null : mean(m.cachedShare),
    reasoningTokens: m.cfg.classifier === 'luna_low' ? { zero: m.reasoning.filter((x) => x === 0).length, calls: m.reasoning.length, mean: mean(m.reasoning) } : undefined,
    calibration: m.conf.length ? { confidence: bins(m, 'c'), chosenProbability: bins(m, 'p') } : undefined,
  }));
writeFileSync(
  'results/v3/metrics.json',
  `${JSON.stringify(
    {
      test: { raw: args.test ?? latest('test'), startedAt: testRun.startedAt, spentUsd: testRun.spentUsd, configs: metricsOf(T), mcnemar: mcT.data },
      dev: { raw: args.dev ?? latest('dev'), startedAt: devRun.startedAt, spentUsd: devRun.spentUsd, configs: metricsOf(D), mcnemar: mcD.data, v2: v2Rows },
    },
    null,
    2
  )}\n`
);

// ---------- summary.md ----------
const findings = existsSync('results/v3/findings.md') ? readFileSync('results/v3/findings.md', 'utf8').trim() : '_(未記入)_';
const v2Table = [
  '| 構成 | 粒度 | v2(v2 の正解で採点) | v3 の選択を v2 の正解で採点 | v3(v3 の正解で採点) |',
  '|---|---|---:|---:|---:|',
  ...v2Rows.map((r) => `| ${r.label} | ${G[r.g]} | ${r.v2}% | ${r.v3onV2}% | ${r.v3}% |`),
].join('\n');

const md = `# v3 結果: Jev と LLM 分類器の比較

- 計画: [PLAN.md](PLAN.md)(2026-10-04 承認、ハッシュは [FROZEN.md](FROZEN.md))。計画から変えた点: なし
- test: ${testRun.startedAt} 開始、100件 × 9構成、実行費用 ${usd(testRun.spentUsd)}(\`${(args.test ?? latest('test')).replace('results/v3/', '')}\`)
- dev: ${devRun.startedAt} 開始、100件 × 9構成、実行費用 ${usd(devRun.spentUsd)}(\`${(args.dev ?? latest('dev')).replace('results/v3/', '')}\`)
- 端末: ${testRun.env.platform}-${testRun.env.arch}、Node ${testRun.env.node}。1回ずつ順番に呼び、各件で9構成の順番をランダムに並べ替えた(種 ${testRun.seed})。自動リトライ0回。ウォームアップは dev・test にない3発話
- 凍結した入力のハッシュは、test・dev とも実行の前と後で一致した
- test の1回目の実行は、実行環境(Claude Code のコマンドの時間制限10分)で途中で止められ、結果を書き出す前に終わった。結果は保存されず、誰も見ていない。PLAN 8章のとおり test を最初から全部やり直した。1回目の費用は記録が残っていないが、2回目の実績から $${testRun.spentUsd.toFixed(2)} 以下と見込む
- 失敗した呼び出しは不正解として採点した

${findings}

## test の比較(主)

${mainTable(T)}

- **gpt-6-luna と gpt-6-sol は、日付つきのモデル名(スナップショット名)を返さなかった。** 上の表のモデル名は API の応答の \`model\` そのまま
- 失敗を除いた正解率は \`metrics.json\` の \`accuracyExcludingFailures\`(失敗が0件の構成では同じ値)
- gpt-6-luna 推論 low の推論トークン(12候補): ${reasoningLine(T, 'test')}。${reasoningLine(D, 'dev')}

![答えと一致した割合と判定時間(test)](chart-accuracy-latency.png)

### Jev と各 LLM の差(McNemar の正確検定、test)

主な比較の6組。Holm 補正後の p が 0.05 未満の組だけを「差がある」とする。「差があるとは言えない」は「差がない」ではない。

${mcT.primary}

参考(別解込みの採点と、推論 low との比較。Holm の補正に含めない):

${mcT.reference}

### 費用(test)

![1000回あたりの費用(test、12候補)](chart-cost.png)

${breakEven(T)}

**Jev は、1回あたりの入力トークンが LLM より多い。** Jev は単価が低い($0.042 / 1M)ので費用は安いが、トークン数では多い。

${tokTable(T)}

- OpenAI の「毎回キャッシュ切れ」は、キャッシュから読まれた分も書き込みの単価(GPT-6 は入力の1.25倍、gpt-5.4-nano は書き込み単価の記載がないので入力単価)で払ったとした値
- gpt-6 の2モデルは、指示文と候補一覧の部分が毎回キャッシュから読まれ、発話の部分は毎回「キャッシュ書き込み」として返ってきた。費用は返ってきた内訳どおりに計算した。gpt-5.4-nano はキャッシュに乗らなかった
- 単価: [PRICING.md](PRICING.md)(2026-10-04 確認)

## dev の比較(参考)

dev は、step 1 で説明文を直すときに v2 の dev での外れを見ているので、test より高く出やすい。

${mainTable(D)}

${mcD.primary}

## v2 から v3 で変わった点と、数字の動き(dev)

| | v2 | v3 |
|---|---|---|
| 説明文・指示文 | プロンプト部品の frontmatter から作った | 基準書と同じ範囲・境目で書き直し、凍結(\`data/candidates.v3.json\`) |
| 正解 | 基準書 v2 によるラベル | 基準書 v3 によるラベル(7件変わった) |
| 呼ぶ順番 | 各件で Jev 12候補が最初 | 各件でランダム |
| 自動リトライ | SDK の既定(最大2回) | 0回 |
| ウォームアップ | 評価セットの最初の3件 | dev・test にない3発話 |
| 失敗の採点 | 基本プロンプトとして採点 | 不正解 |

答えと一致した割合(dev、100件なので件数 = %):

${v2Table}

- 1列目と2列目の差は、同じ v2 の正解で採点したときの v2 → v3 の動き。説明文・指示文・順番・リトライ・ウォームアップの変更が混ざっていて、どれが効いたかは分けられない
- 2列目と3列目の差は、正解を v3 に変えたことによる動き(選択は同じ)

## Jev の確信度と正解率

主: Jev が返す \`confidence\`。

**test**

${calTable(T, 'c')}

**dev**

${calTable(D, 'c')}

参考: 選んだ候補の確率(\`probabilities\` のうち選んだ候補の値)で同じ集計をしたもの。

**test**

${calTable(T, 'p')}

**dev**

${calTable(D, 'p')}

![確信度と正解率(test、12候補)](chart-calibration.png)

## 取り違え(test、別解でも救えなかったもの、正解 → 選択)

${confusionMd(T)}

### 6分類の対応表(test、行 = 正解、列 = 選択)

${T.filter((m) => m.cfg.granularity === 'coarse').map((m) => `**${m.cfg.label}**\n\n${matrix(m, testCases)}`).join('\n\n')}

## 呼び出しの順番と判定時間(test、中央値、括弧内は件数)

順番を入れ替えたことで、特定の順番の判定時間が偏っていないかを見るための表。

${posTable(T)}

## 言えないこと

- **test の発話は dev より長い**(平均 29.3文字 対 15.8文字)。LLM が作った発話は情報が多く、分類しやすい可能性がある
- **test は、狙った分類と正解が、境目の25件も含めて100件すべて一致した。** 分類しやすい発話に寄っている可能性がある
- データは合成。正解は Claude Opus 5.5 が基準書 v3 から付けたラベルを人が確認したもの。正解を付けた人・モデルが違えば、数字は変わりうる
- 判定時間は1台の端末から1回の実行で測ったもの。時間帯や回線、API 側の混み具合で変わる
- 応答の品質(選んだプロンプトで答えたときの回答の良さ)は測っていない
- 6分類はこの検証で作ったまとめ方で、本番の分類とは別物。6分類の数字から本番の分類での正解率は言えない
- McNemar 検定で「差があるとは言えない」組は、差がないことを示すものではない。100件では数ポイントの差は検出できない
- dev は説明文を直すときに見ているので、dev の数字は独立した評価ではない

## ラベルの食い違い

- dev: v2 から正解が変わった7件と、その理由(どのルールによるか)は [label-review.md](label-review.md) の dev の節
- test: 全100件の一覧(直前の会話・発話・Claude の答えと別解・狙った分類)は [label-review.md](label-review.md) の test の節。人の確認で変更はなし。判断が分かれうる5件(t031・t034・t049・t096・t097)も同じファイルにある

## この計画(PLAN.md)の要点

- 主な指標: test での答えと一致した割合(別解は含めない)
- 主な比較: Jev と gpt-5.4-nano・gpt-6-luna・gpt-6-sol の McNemar 正確検定(12候補・6分類それぞれ、計6組、Holm 補正)
- 副指標: 別解込みの正解率、判定時間 p50 / p95、1000回あたりの費用、Jev の確信度の区間ごとの正解率
- 6分類の中身: 相談 = キャリア相談・検索条件・地名・職種の言い換え / 書類作成 = 応募書類 / 情報提供 = 企業情報・クチコミ・給与・待遇 / ハウツー = 面接対策・ログイン・規約・エラー時 / 範囲外 / 基本。本番の分類とは別物
- 計画から変えた点: なし
`;
writeFileSync('results/v3/summary.md', md);
console.log(mainTable(T));
console.log(mcT.primary);
console.log(mainTable(D));
console.log(v2Table);
