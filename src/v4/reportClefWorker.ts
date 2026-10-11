/**
 * Clef appendix, Worker run (plan: results/v4/appendix-clef/PLAN-worker.md).
 * Latency inside the Worker (env.AI.run) and end-to-end from this machine, next to the REST run.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEval } from '../data.js';
import { percentile, wilson } from '../v3/stats.js';

const DIR = 'results/v4/appendix-clef';
interface Call { ok: boolean; chosen: string | null; latencyMs: number; workerLatencyMs?: number | null; colo?: string | null; model: string | null; usage: { input: number }; costUsd: number; pos: number }
interface Run { startedAt: string; finishedAt: string; set: string; data: string; smoke: boolean; via?: string; seed: number; spentUsd: number; stoppedByBudget: boolean; frozen: { before: { ok: boolean }; after: { ok: boolean } }; cases: { id: string; results: Record<string, Call> }[] }

const files = readdirSync(`${DIR}/raw`);
const pick = (prefix: string) => {
  const f = files.filter((x) => x.startsWith(prefix)).sort().at(-1);
  if (!f) throw new Error(`no ${prefix}*`);
  return { path: `${DIR}/raw/${f}`, run: JSON.parse(readFileSync(`${DIR}/raw/${f}`, 'utf8')) as Run };
};
const W = pick('worker-run-test-');
const R = pick('run-test-');
const cases = loadEval(new URL(`../../${W.run.data}`, import.meta.url));
for (const x of [W, R]) {
  if (x.run.smoke || x.run.set !== 'test' || x.run.stoppedByBudget || !x.run.frozen.before.ok || !x.run.frozen.after.ok) throw new Error(`incomplete run ${x.path}`);
  if (x.run.cases.length !== cases.length || x.run.cases.some((r, i) => r.id !== cases[i].id)) throw new Error(`run does not cover the test set ${x.path}`);
}

const KEYS = [['clef', 'Clef'], ['clefflash', 'Clef-flash']] as const;
const s = (ms: number | null) => (ms === null ? '-' : `${(ms / 1000).toFixed(2)}s`);
const stats = (xs: number[]) => ({ min: Math.min(...xs), p25: percentile(xs, 0.25), p50: percentile(xs, 0.5), p75: percentile(xs, 0.75), p90: percentile(xs, 0.9), p95: percentile(xs, 0.95), max: Math.max(...xs), over1s: xs.filter((x) => x > 1000).length, n: xs.length });
const row = (name: string, st: ReturnType<typeof stats>) => `| ${name} | ${s(st.min)} | ${s(st.p25)} | **${s(st.p50)}** | ${s(st.p75)} | ${s(st.p90)} | **${s(st.p95)}** | ${s(st.max)} | ${st.over1s} |`;
const jst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');

const out: Record<string, unknown> = {};
const lines: string[] = [];
const accLines: string[] = [];
for (const [k, label] of KEYS) {
  const ok = (run: Run) => run.cases.map((c) => c.results[k]).filter((x) => x.ok);
  const inside = stats(ok(W.run).map((x) => x.workerLatencyMs as number));
  const e2e = stats(ok(W.run).map((x) => x.latencyMs));
  const rest = stats(ok(R.run).map((x) => x.latencyMs));
  const overhead = stats(ok(W.run).map((x) => x.latencyMs - (x.workerLatencyMs as number)));
  lines.push(row(`${label}・Worker の中(env.AI.run)`, inside), row(`${label}・端末→Worker→env.AI(往復込み)`, e2e), row(`${label}・端末→REST(先の測定)`, rest));
  const correct = (run: Run) => run.cases.filter((c, i) => c.results[k].ok && c.results[k].chosen === cases[i].answer).length;
  const fail = (run: Run) => run.cases.filter((c) => !c.results[k].ok).length;
  const agree = W.run.cases.filter((c, i) => c.results[k].chosen === R.run.cases[i].results[k].chosen).length;
  const [lo, hi] = wilson(correct(W.run), cases.length);
  accLines.push(`| ${label} | ${correct(W.run)}% [${Math.round(lo * 100)}–${Math.round(hi * 100)}%] | ${correct(R.run)}% | ${agree}/100 | ${fail(W.run)} |`);
  out[k] = { workerInside: inside, endToEndViaWorker: e2e, endToEndRest: rest, terminalToWorkerOverhead: overhead, correctWorker: correct(W.run), correctRest: correct(R.run), sameChoiceAsRest: agree, failuresWorker: fail(W.run) };
}
const colos = new Map<string, number>();
for (const c of W.run.cases) for (const r of Object.values(c.results)) colos.set(r.colo ?? '?', (colos.get(r.colo ?? '?') ?? 0) + 1);
const flashFaster = W.run.cases.filter((c) => (c.results.clefflash.workerLatencyMs as number) < (c.results.clef.workerLatencyMs as number)).length;
const oh = (k: string) => (out[k] as { terminalToWorkerOverhead: ReturnType<typeof stats> }).terminalToWorkerOverhead;

const md = `# Clef 補足: Worker から env.AI で呼んだときの判定時間

- 計画: [PLAN-worker.md](PLAN-worker.md)(測定前に保存)
- 生データ: \`${W.path}\`(測定 ${jst(W.run.startedAt)}〜${jst(W.run.finishedAt)} JST)
- 比べた REST の測定: \`${R.path}\`(${jst(R.run.startedAt)} JST)。summary は [summary.md](summary.md)
- 一時的な Worker \`clef-latency-probe\`(\`probe/clef-worker/\`)から \`env.AI.run\` を1回ずつ呼び、測定後に削除しました。test 100件・12候補、ウォームアップ3発話、種 ${W.run.seed} で順番を並べ替え、1件ずつ、再試行なし、失敗 0 件。
- Worker が動いたデータセンター: ${[...colos].map(([c, n]) => `${c} ×${n}`).join('、')}

## 判定時間(成功した呼び出し、各100件)

| 測り方 | 最速 | p25 | p50 | p75 | p90 | p95 | 最遅 | 1秒超 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
${lines.join('\n')}

- 「Worker の中」は \`env.AI.run\` を呼ぶ直前から結果が返るまで。端末から Worker までの往復は含みません。
- 端末→Worker の往復ぶん(往復込みの時間 − Worker の中の時間)の p50: Clef ${s(oh('clef').p50)}、Clef-flash ${s(oh('clefflash').p50)}。
- Worker の中の時間で、Clef-flash のほうが Clef より速かったのは100件中 ${flashFaster} 件。
- 同じ日の約10分違いの別の実行です。REST と Worker の差には、時間帯による混み具合の違いも含まれえます。

## 正解率(参考。主な目的は判定時間)

| モデル | Worker 経由の完全一致 [95%CI] | REST の完全一致 | 同じ候補を選んだ件数 | 失敗 |
|---|---|---:|---:|---:|
${accLines.join('\n')}

## 注意

- v4 の4構成の判定時間(2026-10-09)は端末から測った往復の時間なので、「Worker の中」の時間とはそのままでは比べられません。比べるなら往復込みの行です。
- Workers の時計は I/O の前後でしか進まないので、ミリ秒より細かい値は出ません。
- Cloudflare が公表している速さ(Clef-flash 約39ms、Clef 約209ms)とは測り方が違います。

## 再実行

\`\`\`sh
cd probe/clef-worker && npx wrangler deploy && openssl rand -hex 24 | tr -d '\\n' | tee /path/to/probe.key | npx wrangler secret put PROBE_KEY && cd ../..
PROBE_URL=https://clef-latency-probe.<subdomain>.workers.dev PROBE_KEY=$(cat /path/to/probe.key) npx tsx src/v4/evalClef.ts --via worker --set test --budget-usd 0.20
npx tsx src/v4/reportClefWorker.ts
cd probe/clef-worker && npx wrangler delete
\`\`\`
`;
writeFileSync(`${DIR}/summary-worker.md`, md);
writeFileSync(`${DIR}/metrics-worker.json`, `${JSON.stringify({ raw: W.path, restRaw: R.path, startedAt: W.run.startedAt, spentUsd: W.run.spentUsd, colos: Object.fromEntries(colos), flashFasterInside: flashFaster, ...out }, null, 2)}\n`);
console.log(md);
