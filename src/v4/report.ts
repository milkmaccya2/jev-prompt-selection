/**
 * v4 report (plan: results/v4/PLAN.md). Reads the latest complete run-test-*.json in results/v4/raw.
 * Scoring: a failed call is wrong. Main metric: 12 candidates, exact answer.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { type EvalCase, loadEval } from '../data.js';
import { accuracyLatencyChart, type Bin, CLASSIFIER_COLOR, costChart, toPng } from '../v2/charts.js';
import { confidenceCountChart } from './charts.js';
import { coarseDefs, type Granularity, toCoarse } from '../v3/candidates.js';
import type { ClassifyResult } from '../v3/classifiers.js';
import { mcnemarExact, percentile, wilson } from '../v3/stats.js';

const DIR = 'results/v4';
CLASSIFIER_COLOR.dec = '#8e5bd6';
const ORDER = ['jev', 'dec', 'luna', 'nano'] as const;
/** Display names that say how each model was called (the raw labels come from the v3 code). */
const DISPLAY: Record<string, string> = {
  jev: 'Jev(choice)',
  dec: 'gpt-6-luna(Decisions API・choice)',
  luna: 'gpt-6-luna(Chat・推論なし)',
  nano: 'gpt-5.4-nano(Chat・推論なし)',
};

type Call = ClassifyResult & { pos: number; at: string };
interface Cfg { key: string; classifier: string; label: string; model: string; reasoningEffort: string | null; granularity: Granularity; price: { input: number; cachedInput: number; cacheWrite?: number; output: number } }
interface Run {
  startedAt: string;
  finishedAt: string;
  set: string;
  data: string;
  smoke: boolean;
  env: { platform: string; arch: string; node: string; sdk: Record<string, string> };
  settings: Record<string, unknown>;
  seed: number;
  retries: number;
  timeoutMs: number;
  budgetUsd: number;
  spentUsd: number;
  stoppedByBudget: boolean;
  frozen: { before: { ok: boolean }; after: { ok: boolean } };
  configs: Cfg[];
  cases: { id: string; order: string[]; results: Record<string, Call> }[];
}

const rawFile = readdirSync(`${DIR}/raw`).filter((f) => f.startsWith('run-test-')).sort().at(-1);
if (!rawFile) throw new Error('no run-test-*.json');
const rawPath = `${DIR}/raw/${rawFile}`;
const run = JSON.parse(readFileSync(rawPath, 'utf8')) as Run;
const cases = loadEval(new URL(`../../${run.data}`, import.meta.url));
// PLAN: incomplete, budget-stopped or hash-changed runs are not reported as a finished evaluation
if (run.smoke || run.set !== 'test') throw new Error('not a test run');
if (run.stoppedByBudget) throw new Error('run stopped by budget');
if (!run.frozen.before.ok || !run.frozen.after.ok) throw new Error('frozen inputs changed');
if (run.cases.length !== cases.length || run.cases.some((r, i) => r.id !== cases[i].id)) throw new Error('run does not cover all test cases in order');
for (const r of run.cases) for (const c of run.configs) if (!r.results[c.key]) throw new Error(`missing ${c.key} for ${r.id}`);
const smokeFile = readdirSync(`${DIR}/raw`).filter((f) => f.startsWith('smoke-')).sort().at(-1);
const smoke = smokeFile ? (JSON.parse(readFileSync(`${DIR}/raw/${smokeFile}`, 'utf8')) as Run) : null;

const G = { fine: '12候補', coarse: '6分類' } as const;
const LABEL: Record<string, string> = {
  search_conditions: '検索条件', query_normalization: '地名・職種の言い換え', company_info: '企業情報', reviews: 'クチコミ',
  salary_benefits: '給与・待遇', career_advice: 'キャリア相談', application_docs: '応募書類', interview_prep: '面接対策',
  account_terms: 'ログイン・規約', error_handling: 'エラー時', out_of_scope: '範囲外', base: '基本',
  consult: '相談', docs: '書類作成', info: '情報提供', howto: 'ハウツー',
};
const SHORT: Record<string, string> = { jev: 'Jev', dec: 'Decisions(luna)', luna: 'luna Chat', nano: 'nano Chat' };
const lab = (id: string | null) => (id ? (LABEL[id] ?? id) : '(失敗)');
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const sec = (v: number | null) => (v === null ? '-' : `${(v / 1000).toFixed(2)}秒`);
const usd = (v: number) => `$${v.toFixed(3)}`;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const cnt = (xs: boolean[]) => xs.filter(Boolean).length;
const N = cases.length;

const gold = (c: EvalCase, g: Granularity) =>
  g === 'fine' ? { answer: c.answer, ok: new Set([c.answer, ...c.acceptable]) } : { answer: toCoarse(c.answer), ok: new Set([toCoarse(c.answer), ...c.acceptable.map(toCoarse)]) };

interface M {
  cfg: Cfg;
  strict: boolean[];
  lenient: boolean[];
  chosen: (string | null)[];
  conf: (number | null)[];
  probChosen: (number | null)[];
  failed: number;
  errors: string[];
  models: Map<string, number>;
  lat: number[];
  cost: number[];
  costNoCache: number[];
  tok: { input: number[]; output: number[]; cacheRead: number[]; cacheWrite: number[]; reasoning: number[] };
}
const ms: M[] = ORDER.flatMap((cl) =>
  (['fine', 'coarse'] as Granularity[]).map((g) => {
    const raw = run.configs.find((c) => c.classifier === cl && c.granularity === g) as Cfg;
    const cfg = { ...raw, label: DISPLAY[cl] };
    const m: M = { cfg, strict: [], lenient: [], chosen: [], conf: [], probChosen: [], failed: 0, errors: [], models: new Map(), lat: [], cost: [], costNoCache: [], tok: { input: [], output: [], cacheRead: [], cacheWrite: [], reasoning: [] } };
    run.cases.forEach((row, i) => {
      const r = row.results[cfg.key];
      const gd = gold(cases[i], g);
      const ch = r.ok ? r.chosen : null;
      m.strict.push(ch === gd.answer);
      m.lenient.push(ch !== null && gd.ok.has(ch));
      m.chosen.push(ch);
      m.conf.push(r.ok ? r.confidence : null);
      m.probChosen.push(r.ok && r.probs && ch ? (r.probs[ch] ?? null) : null);
      if (!r.ok) {
        m.failed++;
        m.errors.push(`${row.id}: ${r.error}`);
      } else m.lat.push(r.latencyMs);
      if (r.model) m.models.set(r.model, (m.models.get(r.model) ?? 0) + 1);
      m.cost.push(r.costUsd);
      const u = r.usage;
      m.tok.input.push(u.input);
      m.tok.output.push(u.output);
      m.tok.cacheRead.push(u.cachedInput);
      m.tok.cacheWrite.push(u.cacheWrite);
      m.tok.reasoning.push(u.reasoning);
      // estimate (not measured): Chat with no cache hit; cached/written tokens are billed at the write price (input price if none)
      const p = cfg.price;
      const cacheable = u.cachedInput + u.cacheWrite;
      m.costNoCache.push((u.input - cacheable) * p.input + cacheable * (p.cacheWrite ?? p.input) + u.output * p.output);
    });
    return m;
  })
);
const get = (cl: string, g: Granularity) => ms.find((m) => m.cfg.classifier === cl && m.cfg.granularity === g) as M;
const isChat = (m: M) => m.cfg.classifier === 'luna' || m.cfg.classifier === 'nano';
const ciText = (k: number) => {
  const [lo, hi] = wilson(k, N);
  return `${pct(k / N)} [${pct(lo)}–${pct(hi)}]`;
};

// ---------- tests ----------
function holm(ps: number[]) {
  const idx = ps.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0]);
  const adj = new Array<number>(ps.length).fill(0);
  let r = 0;
  idx.forEach(([p, i], rank) => {
    r = Math.max(r, Math.min(1, (ps.length - rank) * p));
    adj[i] = r;
  });
  return adj;
}
const PAIRS: [string, string][] = [['jev', 'dec'], ['jev', 'luna'], ['jev', 'nano'], ['dec', 'luna'], ['dec', 'nano'], ['luna', 'nano']];
function family(g: Granularity) {
  const rows = PAIRS.map(([a, b]) => {
    const A = get(a, g).strict;
    const B = get(b, g).strict;
    const nb = A.filter((x, i) => x && !B[i]).length;
    const nc = A.filter((x, i) => !x && B[i]).length;
    return { a, b, accA: cnt(A), accB: cnt(B), b_: nb, c_: nc, p: mcnemarExact(nb, nc) };
  });
  const adj = holm(rows.map((r) => r.p));
  return rows.map((r, i) => ({ ...r, holm: adj[i], verdict: adj[i] < 0.05 ? '差がある' : '差があるとは言えない' }));
}
const famFine = family('fine');
const famCoarse = family('coarse');
const testTable = (fam: ReturnType<typeof family>) =>
  [
    '| 比較(A 対 B) | A の一致 | B の一致 | A だけ正解 | B だけ正解 | p(正確検定) | Holm 補正後の p | 判定 |',
    '|---|---:|---:|---:|---:|---:|---:|---|',
    ...fam.map((r) => `| ${SHORT[r.a]} 対 ${SHORT[r.b]} | ${r.accA} | ${r.accB} | ${r.b_} | ${r.c_} | ${r.p.toFixed(3)} | ${r.holm.toFixed(3)} | ${r.verdict} |`),
  ].join('\n');

// ---------- tables ----------
const modelText = (m: M) => [...m.models].map(([k, n]) => (m.models.size > 1 ? `\`${k}\`×${n}` : `\`${k}\``)).join(', ');
const accTable = (g: Granularity) =>
  [
    '| 構成 | 返ってきたモデル名 | 答えと一致 [95%CI] | 別解込み [95%CI] | 失敗 |',
    '|---|---|---:|---:|---:|',
    ...ORDER.map((cl) => get(cl, g)).map((m) => `| ${m.cfg.label} | ${modelText(m)} | ${ciText(cnt(m.strict))} | ${ciText(cnt(m.lenient))} | ${m.failed} |`),
  ].join('\n');
const p50 = (m: M) => percentile(m.lat, 0.5) as number;
const p95 = (m: M) => percentile(m.lat, 0.95) as number;
const speedTable = (g: Granularity) => {
  const j = get('jev', g);
  return [
    '| 構成 | p50 | p95 | p50 の比(この構成 ÷ Jev) | 計測した呼び出し |',
    '|---|---:|---:|---:|---:|',
    ...ORDER.map((cl) => get(cl, g)).map((m) => `| ${m.cfg.label} | ${sec(p50(m))} | ${sec(p95(m))} | ${(p50(m) / p50(j)).toFixed(1)} 倍 | ${m.lat.length} |`),
  ].join('\n');
};
const costTable = (g: Granularity) =>
  [
    '| 構成 | 費用 / 1000回(実績) | 入力 tok / 回 | 出力 tok / 回 | キャッシュ読み出し tok / 回 | キャッシュ書き込み tok / 回 |',
    '|---|---:|---:|---:|---:|---:|',
    ...ORDER.map((cl) => get(cl, g)).map(
      (m) =>
        `| ${m.cfg.label} | ${usd(mean(m.cost) * 1000)} | ${Math.round(mean(m.tok.input)).toLocaleString()} | ${mean(m.tok.output).toFixed(1)} | ${isChat(m) ? Math.round(mean(m.tok.cacheRead)).toLocaleString() : '-'} | ${isChat(m) ? Math.round(mean(m.tok.cacheWrite)).toLocaleString() : '-'} |`
    ),
  ].join('\n');
const estTable = (g: Granularity) =>
  [
    '| 構成 | 実績 / 1000回 | 試算: キャッシュが効かない場合 / 1000回 |',
    '|---|---:|---:|',
    ...['luna', 'nano'].map((cl) => get(cl, g)).map((m) => `| ${m.cfg.label} | ${usd(mean(m.cost) * 1000)} | ${usd(mean(m.costNoCache) * 1000)} |`),
  ].join('\n');

const BINS: [string, number, number][] = [['0.5未満', 0, 0.5], ['0.5〜0.7', 0.5, 0.7], ['0.7〜0.9', 0.7, 0.9], ['0.9以上', 0.9, 1.01]];
const binsOf = (m: M, by: 'conf' | 'prob'): (Bin & { k: number })[] =>
  BINS.map(([label, lo, hi]) => {
    const vals = by === 'conf' ? m.conf : m.probChosen;
    const idx = vals.map((v, i) => [v, i] as const).filter(([v]) => v !== null && v >= lo && v < hi);
    const k = idx.filter(([, i]) => m.strict[i]).length;
    return { label, n: idx.length, k, meanConf: mean(idx.map(([v]) => v as number)), acc: idx.length ? k / idx.length : 0 };
  });
const calTable = (g: Granularity, by: 'conf' | 'prob') =>
  [
    `| 構成 | 区間(${by === 'conf' ? 'confidence' : '選んだ候補の probability'}) | 件数 | 平均 | 答えと一致 |`,
    '|---|---|---:|---:|---:|',
    ...['jev', 'dec'].map((cl) => get(cl, g)).flatMap((m) => binsOf(m, by).map((b) => `| ${m.cfg.label} | ${b.label} | ${b.n} | ${b.n ? b.meanConf.toFixed(2) : '-'} | ${b.n ? `${pct(b.acc)}(${b.k}/${b.n})` : '-'} |`)),
  ].join('\n');

// misclassified examples (12 candidates): every case where at least one config missed the answer
const missRows = cases
  .map((c, i) => ({ c, i }))
  .filter(({ i }) => ORDER.some((cl) => !get(cl, 'fine').strict[i]))
  .map(({ c, i }) => {
    const cell = (cl: string) => {
      const m = get(cl, 'fine');
      const ch = m.chosen[i];
      const mark = m.strict[i] ? '✓' : m.lenient[i] ? '△' : '✗';
      const cf = m.conf[i];
      return `${mark} ${lab(ch)}${cf !== null ? `(${cf.toFixed(2)})` : ''}`;
    };
    const ctx = c.context.length ? `(直前: ${c.context.map((t) => `${t.role === 'user' ? 'U' : 'A'}「${t.text}」`).join(' ')})` : '';
    return `| ${c.id} | ${c.utterance}${ctx} | ${lab(c.answer)}${c.acceptable.length ? `(別解: ${c.acceptable.map(lab).join('、')})` : ''} | ${ORDER.map(cell).join(' | ')} |`;
  });

// ---------- charts ----------
writeFileSync(
  `${DIR}/chart-accuracy-latency.png`,
  toPng(
    accuracyLatencyChart(
      ms.map((m) => {
        const [lo, hi] = wilson(cnt(m.strict), N);
        return { classifier: m.cfg.classifier, label: m.cfg.label, granularity: m.cfg.granularity, acc: cnt(m.strict) / N, lo, hi, latencyMs: p50(m) };
      }),
      { legendValues: true }
    ).replace('正解率(95%信頼区間)と判定時間', 'test 100件: 答えと一致した割合(95%CI)と判定時間 p50')
  )
);
writeFileSync(
  `${DIR}/chart-cost.png`,
  toPng(
    costChart(
      ORDER.map((cl) => get(cl, 'fine')).flatMap((m) => {
        const actual = { classifier: m.cfg.classifier, label: `${m.cfg.label}(実績)`, usd: mean(m.cost) * 1000 };
        const est = mean(m.costNoCache) * 1000;
        return isChat(m) && est > actual.usd * 1.05 ? [actual, { classifier: m.cfg.classifier, label: `${m.cfg.label}(試算: キャッシュなし)`, usd: est, faded: true }] : [actual];
      })
    )
      .replace('2026-10-02 確認', '2026-10-09 確認')
      .replace('1000回あたりの判定の費用(12候補)', 'test 100件: 1000回あたりの判定の費用(12候補)')
      .replace('薄い棒は OpenAI のプロンプトキャッシュなしで換算した値', '薄い棒は実測ではなく、キャッシュが効かない場合の試算')
  )
);
writeFileSync(
  `${DIR}/chart-calibration.png`,
  toPng(
    confidenceCountChart(
      ['jev', 'dec'].map((cl) => ({ name: get(cl, 'fine').cfg.label, color: CLASSIFIER_COLOR[cl], bins: binsOf(get(cl, 'fine'), 'conf').map(({ label, n, k }) => ({ label, n, correct: k })) })),
      'confidence の区間ごとの件数と、答えと一致した件数',
      'test 100件・12候補。棒の長さ = その区間に入った件数、赤 = 答えと一致しなかった件数'
    )
  )
);

// ---------- metrics.json ----------
const metrics = {
  raw: rawPath,
  plan: `${DIR}/PLAN.md`,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  env: run.env,
  seed: run.seed,
  retries: run.retries,
  timeoutMs: run.timeoutMs,
  spentUsd: { smoke: smoke?.spentUsd ?? null, run: run.spentUsd, total: (smoke?.spentUsd ?? 0) + run.spentUsd },
  configs: ms.map((m) => ({
    key: m.cfg.key,
    label: m.cfg.label,
    granularity: m.cfg.granularity,
    models: Object.fromEntries(m.models),
    n: N,
    correct: cnt(m.strict),
    correctCI: wilson(cnt(m.strict), N),
    correctLenient: cnt(m.lenient),
    correctLenientCI: wilson(cnt(m.lenient), N),
    failures: m.failed,
    latencyMs: { p50: p50(m), p95: p95(m), n: m.lat.length },
    usdPer1000: mean(m.cost) * 1000,
    usdPer1000NoCacheEstimate: isChat(m) ? mean(m.costNoCache) * 1000 : null,
    tokensPerCall: { input: mean(m.tok.input), output: mean(m.tok.output), cacheRead: mean(m.tok.cacheRead), cacheWrite: mean(m.tok.cacheWrite), reasoning: mean(m.tok.reasoning) },
    confidenceBins: m.conf.some((x) => x !== null) ? binsOf(m, 'conf').map(({ label, n, k }) => ({ label, n, correct: k })) : null,
    chosenProbabilityBins: m.probChosen.some((x) => x !== null) ? binsOf(m, 'prob').map(({ label, n, k }) => ({ label, n, correct: k })) : null,
  })),
  mcnemar: { fine: famFine, coarse: famCoarse },
};
writeFileSync(`${DIR}/metrics.json`, `${JSON.stringify(metrics, null, 2)}\n`);

// ---------- slide table ----------
const slideTable = [
  '| 構成(test 100件・12候補) | 答えと一致 [95%CI] | 別解込み | p50 / p95 | 費用 / 1000回(実績) |',
  '|---|---:|---:|---:|---:|',
  ...ORDER.map((cl) => get(cl, 'fine')).map((m) => `| ${m.cfg.label} | ${ciText(cnt(m.strict))} | ${pct(cnt(m.lenient) / N)} | ${sec(p50(m))} / ${sec(p95(m))} | ${usd(mean(m.cost) * 1000)} |`),
].join('\n');
writeFileSync(`${DIR}/slide-table.md`, `<!-- generated by src/v4/report.ts from ${rawPath} -->\n${slideTable}\n`);

// ---------- summary.md ----------
const coarseMap = coarseDefs().map((c) => `${c.name}(\`${c.id}\`) = ${c.members.map((x) => lab(x)).join('・')}`).join(' / ');
const md = `# v4 結果: Jev・Decisions API・通常の LLM 分類器の比較(同じ実行)

**問い: 判断を返す API は、プロンプトの振り分けに使えるか。** 測定計画: [PLAN.md](PLAN.md)(実行前に保存。sha256 は [PLAN.sha256](PLAN.sha256))。計画から変えた点: なし。

## 条件

- 実行: ${run.startedAt} 〜 ${run.finishedAt}(UTC)、test 100件 × 4構成 × 2粒度 = 800回(ほかにウォームアップ 3発話 × 8 = 24回)
- 端末: ${run.env.platform}-${run.env.arch}、Node ${run.env.node}。SDK: \`openai\` ${run.env.sdk.openai}、\`@typesafe-ai/sdk\` ${run.env.sdk.typesafe}
- 1件ずつ順番に呼び、並列にはしない。各件で8つの呼び出しの順番を種 ${run.seed} の乱数で並べ替えた。自動リトライ ${run.retries}回、1回 ${run.timeoutMs / 1000}秒でタイムアウト。失敗は不正解として採点
- ウォームアップは評価対象外の既存の例(基準書の例の0・1・19番)。採点しない
- 指示文・候補の説明文・会話・正解は v3 で凍結したもの。ハッシュは実行の前と後で一致した
- **test 100件は v3 で結果を見たことのあるデータの再利用。** 新しい独立した未知のデータでの評価ではない。dev は使っていない
- 6分類(補足): ${coarseMap}。この検証で作ったまとめ方で、本番の分類とは別物

## 発表用の比較表(12候補)

${slideTable}

![答えと一致した割合と判定時間](chart-accuracy-latency.png)

## 正確さ

### 12候補(主な結果)

${accTable('fine')}

### 6分類(補足)

${accTable('coarse')}

## 検定(McNemar の正確検定、答えと一致)

### 主な比較群: 12候補の総当たり6組(Holm 補正)

${testTable(famFine)}

### 補足の比較群: 6分類の総当たり6組(Holm 補正、主な比較群とは別)

${testTable(famCoarse)}

「差があるとは言えない」は、同等の精度を示すものではない。片方だけが正解した件数が少なく、100件では差を判断できない。

## 速さ(同じ実行の中、成功した呼び出しのみ)

### 12候補

${speedTable('fine')}

### 6分類

${speedTable('coarse')}

1台の端末から1回の実行で測った値。一般的な速さや SLA ではない。

## 費用

単価と出典: [PRICING.md](PRICING.md)(2026-10-09 確認)。実績は、API が返した usage × 公式の単価。

### 実績(12候補)

${costTable('fine')}

### 実績(6分類)

${costTable('coarse')}

- Jev は入力だけに課金(出力は無料)。Decisions API は入力だけに課金(出力・キャッシュは課金なし)。どちらもキャッシュの割引はない
- gpt-6-luna(Chat)は、指示文と候補一覧の部分がキャッシュから読まれ(読み出しは入力単価の0.1倍)、発話の部分が毎回「キャッシュ書き込み」(1.25倍)として返ってきた。gpt-5.4-nano はキャッシュに乗らなかった

### 試算: 通常 API でキャッシュが効かない場合(実測ではない)

計算条件: 返ってきた usage のうち、キャッシュの読み出し・書き込みとされたトークンも、すべて書き込み単価(gpt-6-luna は $0.125 / 1M、書き込み単価のない gpt-5.4-nano は入力単価 $0.20 / 1M)で払ったとする。出力は実績のまま。

**12候補**

${estTable('fine')}

**6分類**

${estTable('coarse')}

![1000回あたりの費用](chart-cost.png)

## 確信度(Jev と Decisions API)

### confidence の区間ごとの一致率(12候補)

${calTable('fine', 'conf')}

### confidence の区間ごとの一致率(6分類、補足)

${calTable('coarse', 'conf')}

### 参考: 選んだ候補の probability で区切った場合(12候補)

\`confidence\` とは別の値。混ぜて読まないこと。

${calTable('fine', 'prob')}

![confidence の区間ごとの件数と一致した件数](chart-calibration.png)

確信度0.9以上の件の一致率は、この test 100件の、それぞれの粒度での結果に限った観測。確信度が低いときに別の分類器へ回すと改善するかは、検証していない。

## 誤分類の例(12候補、test の実測)

どれか1つでも答えと一致しなかった件をすべて挙げる。✓ = 答えと一致、△ = 別解と一致、✗ = どちらとも不一致。括弧内は confidence(Jev と Decisions API のみ)。

| id | 発話 | 正解 | Jev | Decisions(luna) | luna Chat | nano Chat |
|---|---|---|---|---|---|---|
${missRows.join('\n')}

## 失敗した呼び出し

${ms.some((m) => m.failed) ? ms.filter((m) => m.failed).map((m) => `- ${m.cfg.label} ${G[m.cfg.granularity]}: ${m.failed}件(${m.errors.slice(0, 3).join(' / ')})`).join('\n') : '- 800回すべて成功した(失敗0件)'}

## 言えないこと

- **test 100件は v3 で結果を見たデータの再利用**で、新しい独立したデータでの評価ではない
- test は LLM(claude-sonnet-5-5)が作った発話で、v1〜v3 の dev より長く(平均29.3文字 対 15.8文字)、狙った分類と正解が100件すべて一致した。分類しやすい発話に寄っている可能性がある
- データは合成。正解は Claude Opus 5.5 が基準書 v3 から付けたラベルを人が確認したもの
- 「差があるとは言えない」は「同等の精度」ではない
- 判定時間は1台の端末・1回の実行の観測。時間帯・回線・API 側の混み具合で変わる(同じ gpt-6-luna Chat でも、v3 の 10-04 と appendix の 10-08 で p50 が違った)
- Decisions API はパブリックベータで、精度・速さ・料金は今後変わりうる。使えるモデルは gpt-6-luna だけ
- 選んだあとの回答の品質、確信度が低いときの切り替え、プロンプトの最適化は測っていない
- 会社としての利用の可否、本番での採用、実際のユーザーへの回答の品質は、この検証では確認していない

## 再実行のコマンドと実際の費用

\`\`\`sh
npx tsx src/v4/eval.ts --set test --dry-run                                               # 見積もり(API を呼ばない)
npx tsx --env-file=.env src/v4/eval.ts --set dev --limit 5 --smoke --budget-usd 0.05      # 動作確認
npx tsx --env-file=.env src/v4/eval.ts --set test --budget-usd 0.40                       # 本評価
npx tsx src/v4/report.ts                                                                  # 集計・summary・グラフ
node src/v4/verify.mjs                                                                    # 生データから独立に再計算して照合
\`\`\`

| 実行 | 生データ | 呼び出し | 費用(usage × 単価) |
|---|---|---:|---:|
| 動作確認 | \`raw/${smokeFile ?? '-'}\` | ${smoke ? (smoke.cases.length + 3) * 8 : '-'} | ${smoke ? usd(smoke.spentUsd) : '-'} |
| 本評価 | \`raw/${rawFile}\` | ${(run.cases.length + 3) * 8} | ${usd(run.spentUsd)} |
| 合計 | | | ${usd((smoke?.spentUsd ?? 0) + run.spentUsd)} |
`;
writeFileSync(`${DIR}/summary.md`, md);
console.log(slideTable);
console.log(testTable(famFine));
console.log(testTable(famCoarse));
