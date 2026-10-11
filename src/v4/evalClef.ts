/**
 * v4 appendix: Cloudflare Clef and Clef-flash (plan: results/v4/appendix-clef/PLAN.md).
 * Same procedure as src/v4/eval.ts, on the 12 candidates only:
 * - one call at a time, both models on every case, order shuffled per case with a seeded RNG
 * - no retries, 30 s timeout; a failed call is stored and scored as wrong
 * - warmup on labeling examples #0, #1, #19 (not scored); frozen inputs checked before and after
 * - the request body is the one sent to Jev (System One format); only `model` and the URL differ
 * - the whole response body is stored per call
 * Auth: CLOUDFLARE_API_TOKEN, or the token of the logged-in wrangler (never printed or stored).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { parseArgs } from 'node:util';
import { choice } from '@typesafe-ai/sdk';
import { countTokens } from 'gpt-tokenizer';
import { type EvalCase, loadEval } from '../data.js';
import { buildState } from '../jev.js';
import { fineCandidates, instruction } from '../v3/candidates.js';
import type { ClassifyResult } from '../v3/classifiers.js';
import { TIMEOUT_MS } from '../v3/classifiers.js';
import { checkFrozen } from '../v3/frozen.js';

const { values: args } = parseArgs({
  options: {
    set: { type: 'string' },
    limit: { type: 'string' },
    seed: { type: 'string', default: '20261011' },
    'budget-usd': { type: 'string' },
    smoke: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    // rest: Workers AI REST from this machine; worker: through the probe Worker (probe/clef-worker), env.AI.run
    via: { type: 'string', default: 'rest' },
  },
});
if (args.set !== 'dev' && args.set !== 'test') throw new Error('--set dev|test is required');
if (args.set === 'dev' && !args.smoke && !args['dry-run']) throw new Error('dev is run only as --smoke');
if (!args['dry-run'] && !args['budget-usd']) throw new Error('--budget-usd is required');
if (args.via !== 'rest' && args.via !== 'worker') throw new Error('--via rest|worker');
const viaWorker = args.via === 'worker';

/** $ per input token; output is not billed. Sources and date: results/v4/appendix-clef/PRICING.md. */
export const CLEF = [
  { key: 'clef', label: 'Clef', path: '@cf/cloudflare/clef', model: 'clef', price: 0.24 / 1e6 },
  { key: 'clefflash', label: 'Clef-flash', path: '@cf/cloudflare/clef-flash', model: 'clef-flash', price: 0.038 / 1e6 },
] as const;
type Spec = (typeof CLEF)[number];

const OUT = 'results/v4/appendix-clef';
const dataPath = `data/eval.v3.${args.set}.jsonl`;
let cases = loadEval(new URL(`../../${dataPath}`, import.meta.url));
if (args.limit) cases = cases.slice(0, Number(args.limit));
const cands = fineCandidates();
const ids = new Set(cands.map((c) => c.id));

const WARMUP_EXAMPLES = [0, 1, 19];
const examples = (JSON.parse(readFileSync('data/labeling-examples.v3.json', 'utf8')) as { examples: { context?: EvalCase['context']; utterance: string }[] }).examples;
const warmupCases: EvalCase[] = WARMUP_EXAMPLES.map((i) => ({ id: `warmup-ex${i}`, context: examples[i].context ?? [], utterance: examples[i].utterance, answer: '', acceptable: [], tags: [] }));
const evalUtterances = new Set(['dev', 'test'].flatMap((s) => loadEval(new URL(`../../data/eval.v3.${s}.jsonl`, import.meta.url)).map((c) => c.utterance)));
for (const w of warmupCases) if (evalUtterances.has(w.utterance)) throw new Error(`warmup utterance is in the eval sets: ${w.utterance}`);

/** Same body as classifyJev sends (src/v3/classifiers.ts), with Clef's model name. */
const body = (spec: Spec, c: EvalCase) => ({
  model: spec.model,
  state: buildState(c.context, c.utterance, 'ja'),
  questions: { main: choice(instruction(), Object.fromEntries(cands.map((x) => [x.id, x.description]))) },
});
/** Budget guard only: o200k count x 2 (Clef uses another tokenizer; Jev's count was ~1.4x o200k in v3). */
const worstCost = (spec: Spec, c: EvalCase) => countTokens(JSON.stringify(body(spec, c))) * 2 * spec.price;
const worstCaseCost = (c: EvalCase) => CLEF.reduce((s, spec) => s + worstCost(spec, c), 0);

if (args['dry-run']) {
  const c0 = cases[0];
  for (const s of CLEF) console.log(`${s.key.padEnd(10)} ~${countTokens(JSON.stringify(body(s, c0)))} o200k tok/call, worst $${worstCost(s, c0).toFixed(5)}/call`);
  const total = [...warmupCases, ...cases].reduce((s, c) => s + worstCaseCost(c), 0);
  console.log(`set=${args.set} cases=${cases.length} warmup=${warmupCases.length} calls=${(cases.length + warmupCases.length) * CLEF.length} worst-case total ≈ $${total.toFixed(3)}`);
  process.exit(0);
}

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const probeUrl = process.env.PROBE_URL;
const probeKey = process.env.PROBE_KEY;
if (viaWorker && (!probeUrl || !probeKey)) throw new Error('PROBE_URL and PROBE_KEY are required for --via worker');
if (!viaWorker && !account) throw new Error('CLOUDFLARE_ACCOUNT_ID is required');
const token = viaWorker ? 'unused' : process.env.CLOUDFLARE_API_TOKEN || execFileSync('npx', ['wrangler', 'auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').at(-1)?.trim();
if (!token) throw new Error('no Cloudflare token');

const before = checkFrozen();
if (!before.ok) {
  console.error('frozen inputs changed:', before.items.filter((i) => !i.ok).map((i) => i.name).join(', '));
  process.exit(1);
}

type Call = ClassifyResult & { pos: number; at: string; status: number | null; raw: unknown; workerLatencyMs?: number | null; colo?: string | null };

/** One attempt. Latency: from just before the request until the response JSON is read (as in v4). */
async function classifyClef(spec: Spec, c: EvalCase): Promise<Omit<Call, 'pos' | 'at'>> {
  const empty = { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0 };
  const t0 = performance.now();
  try {
    const url = viaWorker ? (probeUrl as string) : `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${spec.path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: viaWorker ? { 'x-probe-key': probeKey as string, 'content-type': 'application/json' } : { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body(spec, c)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    const latencyMs = performance.now() - t0;
    let raw: unknown = text.slice(0, 2000);
    try {
      raw = JSON.parse(text);
    } catch {}
    const r = ((raw as { result?: unknown })?.result ?? raw) as {
      model?: string;
      answers?: { main?: { choice?: string; confidence?: number; probabilities?: Record<string, number> | { value: string; probability: number }[] } };
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const input = r?.usage?.input_tokens ?? 0;
    const usage = { ...empty, input, output: r?.usage?.output_tokens ?? 0 };
    const a = r?.answers?.main;
    const probs = Array.isArray(a?.probabilities) ? Object.fromEntries(a.probabilities.map((p) => [p.value, p.probability])) : (a?.probabilities ?? null);
    const w = viaWorker ? (raw as { ok?: boolean; workerLatencyMs?: number; colo?: string; error?: string }) : null;
    const ok = res.ok && (!w || w.ok === true) && typeof a?.choice === 'string' && ids.has(a.choice);
    return {
      ok,
      chosen: ok ? (a?.choice as string) : null,
      confidence: typeof a?.confidence === 'number' ? a.confidence : null,
      probs,
      model: r?.model ?? null,
      latencyMs,
      usage,
      costUsd: input * spec.price,
      status: res.status,
      raw,
      ...(w ? { workerLatencyMs: w.workerLatencyMs ?? null, colo: w.colo ?? null } : {}),
      ...(ok ? {} : { error: `HTTP ${res.status}: ${w?.error ?? text.slice(0, 200)}` }),
    };
  } catch (e) {
    return { ok: false, chosen: null, confidence: null, probs: null, model: null, latencyMs: performance.now() - t0, usage: empty, costUsd: 0, status: null, raw: null, error: String(e).slice(0, 300) };
  }
}

function rng(s: number) {
  let a = s >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seed = Number(args.seed);
const rand = rng(seed);
const shuffled = <T>(xs: readonly T[]) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const budget = Number(args['budget-usd']);
let spent = 0;
async function runCase(c: EvalCase) {
  const order = shuffled(CLEF);
  const results: Record<string, Call> = {};
  for (const [pos, spec] of order.entries()) {
    const at = new Date().toISOString();
    const r = await classifyClef(spec, c);
    results[spec.key] = { ...r, pos, at };
    spent += r.costUsd;
  }
  return { order: order.map((o) => o.key), results };
}

console.log(`set=${args.set} models=${CLEF.map((s) => s.key).join(', ')} cases=${cases.length} warmup=${warmupCases.length} seed=${seed} budget=$${budget}`);
const startedAt = new Date().toISOString();
let stopped = false;
const fits = (c: EvalCase) => spent + worstCaseCost(c) <= budget;
const warmup: { id: string; order: string[]; results: Record<string, Call> }[] = [];
for (const c of warmupCases) {
  if (!fits(c)) {
    stopped = true;
    break;
  }
  warmup.push({ id: c.id, ...(await runCase(c)) });
}
console.log(`warmup done (spent≈$${spent.toFixed(5)})`);
const rows: { id: string; order: string[]; results: Record<string, Call> }[] = [];
for (const c of stopped ? [] : cases) {
  if (!fits(c)) {
    stopped = true;
    break;
  }
  const r = await runCase(c);
  rows.push({ id: c.id, ...r });
  const errs = Object.values(r.results).filter((x) => !x.ok).length;
  process.stdout.write(`${c.id}${errs ? `(err ${errs})` : ''} `);
}
console.log();
const after = checkFrozen();

const kind = args.smoke ? 'smoke' : 'run';
const stamp = startedAt.replace(/[:.]/g, '-').slice(0, 19);
const out = `${OUT}/raw/${viaWorker ? 'worker-' : ''}${kind}-${args.set}-${stamp}-n${rows.length}.json`;
mkdirSync(`${OUT}/raw`, { recursive: true });
writeFileSync(
  out,
  `${JSON.stringify(
    {
      startedAt,
      finishedAt: new Date().toISOString(),
      set: args.set,
      data: dataPath,
      smoke: args.smoke,
      via: args.via,
      granularity: 'fine',
      env: { platform: platform(), arch: arch(), node: process.version, sdk: { fetch: 'node built-in fetch (no SDK)' } },
      settings: {
        clef: 'Workers AI REST /ai/run/<model>, body = the System One body sent to Jev ({ model, state, questions: { main: choice(instruction, criteria) } }) with model "clef" / "clef-flash"',
        timeoutMsPerCall: TIMEOUT_MS,
        retries: 0,
        parallel: false,
        latency: 'performance.now() from just before fetch until the response body is read',
        ...(viaWorker ? { worker: 'probe Worker clef-latency-probe (probe/clef-worker): one env.AI.run per request; workerLatencyMs = Date.now() around env.AI.run inside the Worker' } : {}),
      },
      seed,
      warmup: { examples: WARMUP_EXAMPLES, utterances: warmupCases.map((w) => w.utterance) },
      budgetUsd: budget,
      spentUsd: spent,
      stoppedByBudget: stopped,
      frozen: { before, after },
      configs: CLEF.map((s) => ({ key: s.key, label: s.label, path: s.path, model: s.model, priceInput: s.price })),
      warmupCases: warmup,
      cases: rows,
    },
    null,
    2
  )}\n`
);
console.log(`spent≈$${spent.toFixed(5)} → ${out}${stopped ? ' (STOPPED by budget)' : ''}${after.ok ? '' : ' (FROZEN INPUTS CHANGED DURING RUN)'}`);
const errs = rows.flatMap((r) => Object.entries(r.results).filter(([, v]) => !v.ok).map(([k, v]) => `${r.id} ${k}: ${v.error}`));
console.log(`failed calls: ${errs.length}`);
if (errs.length) console.log(errs.slice(0, 10).join('\n'));
