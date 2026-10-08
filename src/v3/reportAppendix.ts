/**
 * Appendix report (plan: results/v3/appendix-decisions/PLAN.md).
 * Same scoring as src/v3/report.ts: a failed call is wrong; the answer only for the main metric.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { type EvalCase, loadEval } from '../data.js';
import { accuracyLatencyChart, CLASSIFIER_COLOR, toPng } from '../v2/charts.js';
import { type Granularity, toCoarse } from './candidates.js';
import type { ClassifyResult } from './classifiers.js';
import { mcnemarExact, percentile, wilson } from './stats.js';

const DIR = 'results/v3/appendix-decisions';
CLASSIFIER_COLOR.dec = '#8e5bd6';

interface Cfg { key: string; classifier: string; label: string; model: string; granularity: Granularity }
interface Run {
  startedAt: string;
  set: 'test' | 'dev';
  data: string;
  env: Record<string, string>;
  seed: number;
  spentUsd: number;
  stoppedByBudget: boolean;
  frozen: { before: { ok: boolean }; after: { ok: boolean } };
  configs: Cfg[];
  cases: { id: string; results: Record<string, ClassifyResult> }[];
}
const latest = (dir: string, prefix: string) => `${dir}/${readdirSync(dir).filter((f) => f.startsWith(prefix)).sort().at(-1)}`;
const G = { fine: '12候補', coarse: '6分類' } as const;
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const sec = (v: number | null) => (v === null ? '-' : `${(v / 1000).toFixed(2)}秒`);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const k = (xs: boolean[]) => xs.filter(Boolean).length;

const gold = (c: EvalCase, g: Granularity) =>
  g === 'fine' ? { answer: c.answer, ok: new Set([c.answer, ...c.acceptable]) } : { answer: toCoarse(c.answer), ok: new Set([toCoarse(c.answer), ...c.acceptable.map(toCoarse)]) };

function measure(run: Run, cases: EvalCase[]) {
  const byId = new Map(cases.map((c) => [c.id, c]));
  return run.configs.map((cfg) => {
    const strict: boolean[] = [];
    const lenient: boolean[] = [];
    const chosen: (string | null)[] = [];
    const lat: number[] = [];
    const cost: number[] = [];
    const inTok: number[] = [];
    const conf: { c: number; ok: boolean }[] = [];
    const models = new Map<string, number>();
    let failed = 0;
    for (const row of run.cases) {
      const c = byId.get(row.id) as EvalCase;
      const r = row.results[cfg.key];
      const gd = gold(c, cfg.granularity);
      const ch = r.ok ? r.chosen : null;
      strict.push(ch === gd.answer);
      lenient.push(ch !== null && gd.ok.has(ch));
      chosen.push(ch);
      cost.push(r.costUsd);
      if (r.model) models.set(r.model, (models.get(r.model) ?? 0) + 1);
      if (!r.ok) failed++;
      else {
        lat.push(r.latencyMs);
        inTok.push(r.usage.input);
        if (r.confidence !== null) conf.push({ c: r.confidence, ok: ch === gd.answer });
      }
    }
    return { cfg, n: run.cases.length, strict, lenient, chosen, lat, cost, inTok, conf, models, failed };
  });
}
type M = ReturnType<typeof measure>[number];

const table = (ms: M[]) =>
  [
    '| 構成 | 粒度 | 返ってきたモデル名 | 答えと一致 [95%CI] | 別解込み | 判定時間 p50 / p95 | 費用 / 1000回 | 入力トークン / 回 | 失敗 |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|',
    ...ms.map((m) => {
      const [lo, hi] = wilson(k(m.strict), m.n);
      return `| ${m.cfg.label} | ${G[m.cfg.granularity]} | ${[...m.models.keys()].map((x) => `\`${x}\``).join(', ')} | ${pct(k(m.strict) / m.n)} [${pct(lo)}–${pct(hi)}] | ${pct(k(m.lenient) / m.n)} | ${sec(percentile(m.lat, 0.5))} / ${sec(percentile(m.lat, 0.95))} | $${(mean(m.cost) * 1000).toFixed(3)} | ${Math.round(mean(m.inTok)).toLocaleString()} | ${m.failed} |`;
    }),
  ].join('\n');

function compare(ms: M[]) {
  const rows: { g: Granularity; vs: string; b: number; c: number; p: number; primary: boolean }[] = [];
  for (const g of ['fine', 'coarse'] as Granularity[]) {
    const d = ms.find((m) => m.cfg.classifier === 'dec' && m.cfg.granularity === g) as M;
    for (const o of ms.filter((m) => m.cfg.classifier !== 'dec' && m.cfg.granularity === g)) {
      const b = d.strict.filter((x, i) => x && !o.strict[i]).length;
      const c = d.strict.filter((x, i) => !x && o.strict[i]).length;
      rows.push({ g, vs: o.cfg.label, b, c, p: mcnemarExact(b, c), primary: o.cfg.classifier === 'jev' });
    }
  }
  const prim = rows.filter((r) => r.primary).sort((a, b) => a.p - b.p);
  const holm = new Map<(typeof rows)[number], number>();
  let run = 0;
  prim.forEach((r, i) => {
    run = Math.max(run, Math.min(1, (prim.length - i) * r.p));
    holm.set(r, run);
  });
  return [
    '| 粒度 | 比較 | b(Decisions だけ正解) | c(相手だけ正解) | p | Holm 補正後の p | 判定 |',
    '|---|---|---:|---:|---:|---:|---|',
    ...rows.map((r) => {
      const h = holm.get(r);
      return `| ${G[r.g]} | Decisions 対 ${r.vs} | ${r.b} | ${r.c} | ${r.p.toFixed(3)} | ${h === undefined ? '-' : h.toFixed(3)} | ${h === undefined ? '(参考)' : h < 0.05 ? '差がある' : '差があるとは言えない'} |`;
    }),
  ].join('\n');
}

const BINS: [string, number, number][] = [['0.5未満', 0, 0.5], ['0.5〜0.7', 0.5, 0.7], ['0.7〜0.9', 0.7, 0.9], ['0.9以上', 0.9, 1.01]];
const calib = (ms: M[]) =>
  [
    '| 構成 | 区間 | 件数 | 平均確信度 | 答えと一致 |',
    '|---|---|---:|---:|---:|',
    ...ms
      .filter((m) => m.conf.length)
      .flatMap((m) =>
        BINS.map(([l, lo, hi]) => {
          const xs = m.conf.filter((x) => x.c >= lo && x.c < hi);
          return `| ${m.cfg.label} ${G[m.cfg.granularity]} | ${l} | ${xs.length} | ${xs.length ? mean(xs.map((x) => x.c)).toFixed(2) : '-'} | ${xs.length ? pct(k(xs.map((x) => x.ok)) / xs.length) : '-'} |`;
        })
      ),
  ].join('\n');

/** Jev and gpt-6-luna (Chat) were re-run here: how many cases chose differently from the v3 main run. */
function rerun(ms: M[], main: Run, cases: EvalCase[]) {
  return ms
    .filter((m) => m.cfg.classifier !== 'dec')
    .map((m) => {
      const prev = cases.map((c) => {
        const r = main.cases.find((x) => x.id === c.id)?.results[m.cfg.key];
        return r?.ok ? r.chosen : null;
      });
      const diff = m.chosen.filter((x, i) => x !== prev[i]).length;
      const prevOk = prev.filter((x, i) => x === gold(cases[i], m.cfg.granularity).answer).length;
      return `| ${m.cfg.label} | ${G[m.cfg.granularity]} | ${prevOk}% | ${k(m.strict)}% | ${diff} |`;
    })
    .join('\n');
}

const out: Record<string, unknown> = {};
let md = '';
for (const set of ['test', 'dev'] as const) {
  const path = latest(`${DIR}/raw`, `run-${set}-`);
  const run = JSON.parse(readFileSync(path, 'utf8')) as Run;
  const cases = loadEval(new URL(`../../${run.data}`, import.meta.url));
  if (run.cases.length !== cases.length || run.stoppedByBudget || !run.frozen.before.ok || !run.frozen.after.ok) throw new Error(`${set}: incomplete run or frozen inputs changed`);
  const main = JSON.parse(readFileSync(latest('results/v3/raw', `run-${set}-`), 'utf8')) as Run;
  const ms = measure(run, cases);
  out[set] = { raw: path, startedAt: run.startedAt, spentUsd: run.spentUsd, configs: ms.map((m) => ({ key: m.cfg.key, correct: k(m.strict), correctLenient: k(m.lenient), failures: m.failed, p50: percentile(m.lat, 0.5), p95: percentile(m.lat, 0.95), usdPer1000: mean(m.cost) * 1000, inputTokensPerCall: mean(m.inTok), models: Object.fromEntries(m.models) })) };
  if (set === 'test') {
    writeFileSync(
      `${DIR}/chart-accuracy-latency.png`,
      toPng(
        accuracyLatencyChart(
          ms.map((m) => {
            const [lo, hi] = wilson(k(m.strict), m.n);
            return { classifier: m.cfg.classifier, label: m.cfg.label, granularity: m.cfg.granularity, acc: k(m.strict) / m.n, lo, hi, latencyMs: percentile(m.lat, 0.5) ?? 0 };
          }),
          { legendValues: true }
        ).replace('正解率(95%信頼区間)と判定時間', 'appendix test: 答えと一致した割合と判定時間(2026-10-08)')
      )
    );
  }
  md += `## ${set === 'test' ? 'test(主)' : 'dev(参考)'}

- 実行: ${run.startedAt} 開始、100件 × 6構成、費用 $${run.spentUsd.toFixed(3)}(\`${path.replace(`${DIR}/`, '')}\`)。凍結した入力のハッシュは実行の前後で一致

${table(ms)}

### Decisions API との差(McNemar の正確検定、答えと一致)

主な比較は Jev との2組(Holm 補正)。gpt-6-luna(Chat)との比較は参考。

${compare(ms)}

### 確信度の区間ごとの正解率(${set})

${calib(ms)}

### 呼び直した Jev・gpt-6-luna(Chat)と、v3 本編(2026-10-04)の違い(${set})

| 構成 | 粒度 | 本編の答えと一致 | この実行の答えと一致 | 選んだ候補が本編と違った件数 |
|---|---|---:|---:|---:|
${rerun(ms, main, cases)}

`;
}
writeFileSync(`${DIR}/metrics.json`, `${JSON.stringify(out, null, 2)}\n`);
const findings = readFileSync(`${DIR}/findings.md`, 'utf8').trim();
writeFileSync(
  `${DIR}/summary.md`,
  `# appendix: OpenAI Decisions API の追加測定

- 計画: [PLAN.md](PLAN.md)。v3 本編([../summary.md](../summary.md))の結果と結論は変えない
- 条件: v3 で凍結した指示文・説明文・test・dev。手順も本編と同じ(1回ずつ順番、各件で順番をランダム、リトライ0回、ウォームアップは専用の3発話)。OpenAI の Node SDK は 7.30.0(本編は 7.27.0)
- 判定時間は、この実行の中の構成どうしで比べる(本編とは測った日が違う)
- 単価: Decisions API は入力 $0.10 / 1M のみ(出力・キャッシュは課金なし。https://developers.openai.com/api/docs/guides/decisions 、2026-10-08 確認)。ほかは [../PRICING.md](../PRICING.md)

${findings}

![答えと一致した割合と判定時間(appendix、test)](chart-accuracy-latency.png)

${md}## 言えないこと

- Decisions API は2026-10-08時点でパブリックベータ。精度・速さ・料金は今後変わりうる。使えるモデルは gpt-6-luna だけ
- 判定時間は1台の端末から1回の実行で測ったもの。gpt-6-luna(Chat)の判定時間は本編(2026-10-04)と大きく違い、日や時間帯で変わる
- v3 本編の「言えないこと」はすべてこちらにも当てはまる。とくに test は易しく(発話が長く、狙った分類と正解が100件すべて一致)、正解率の差を判断するには件数が足りない
- Decisions API には会話の JSON を文字列で渡した。メッセージ形式で渡すなど、別の渡し方では結果が変わりうる
`
);
console.log(md);
