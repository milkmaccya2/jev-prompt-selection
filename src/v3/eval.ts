/**
 * v3 eval runner (plan: results/v3/PLAN.md).
 * - one call at a time from one machine; every config is called on every case
 * - the order of the configs is shuffled per case with a seeded RNG (v2 always called Jev first)
 * - no retries; a failed call is stored as a failure and scored as wrong
 * - the first --warmup cases go through every config once and are not scored
 * - the frozen inputs are checked before the first call and after the last one
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { parseArgs } from 'node:util';
import type { TypeSafeClient } from '@typesafe-ai/sdk';
import type OpenAI from 'openai';
import { type EvalCase, loadEval } from '../data.js';
import { candidatesFor, type Granularity } from './candidates.js';
import { CLASSIFIERS, type ClassifierSpec, type ClassifyResult, classifyJev, classifyOpenAI, estimateInputTokens, newJevClient, newOpenAIClient, TIMEOUT_MS } from './classifiers.js';
import { checkFrozen } from './frozen.js';

const { values: args } = parseArgs({
  options: {
    set: { type: 'string' },
    limit: { type: 'string' },
    classifiers: { type: 'string', default: 'jev,nano,luna,sol,luna_low' },
    warmup: { type: 'string', default: '3' },
    seed: { type: 'string', default: '20261004' },
    'budget-usd': { type: 'string' },
    smoke: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
});
if (args.set !== 'dev' && args.set !== 'test') throw new Error('--set dev|test is required');
if (!args['dry-run'] && !args['budget-usd']) throw new Error('--budget-usd is required');

const specs = args.classifiers.split(',').map((k) => {
  const s = CLASSIFIERS.find((c) => c.key === k);
  if (!s) throw new Error(`unknown classifier ${k}`);
  return s;
});
// the reasoning reference is measured on the 12 candidates only
const configs = specs.flatMap((spec) =>
  (['fine', 'coarse'] as Granularity[]).filter((g) => !(spec.key === 'luna_low' && g === 'coarse')).map((g) => ({ key: `${spec.key}@${g}`, spec, g }))
);

const dataPath = `data/eval.v3.${args.set}.jsonl`;
let cases = loadEval(new URL(`../../${dataPath}`, import.meta.url));
if (args.limit) cases = cases.slice(0, Number(args.limit));
const warmupN = Math.min(Number(args.warmup), cases.length);
const seed = Number(args.seed);

/** mulberry32: small seeded RNG so the call order can be reproduced from the seed. */
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
const rand = rng(seed);
const shuffled = <T>(xs: T[]) => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Worst-case cost of one call: every input token billed at the cache-write (or input) price, output padded for reasoning. */
const worstCost = (spec: ClassifierSpec, g: Granularity, c: EvalCase) => {
  const inTok = estimateInputTokens(spec, candidatesFor(g), c.context, c.utterance) * 1.2;
  const outTok = spec.reasoningEffort === 'low' ? 600 : 30;
  return inTok * Math.max(spec.price.input, spec.price.cacheWrite ?? 0) + outTok * spec.price.output;
};
const worstCaseCost = (c: EvalCase) => configs.reduce((s, cfg) => s + worstCost(cfg.spec, cfg.g, c), 0);

if (args['dry-run']) {
  const c0 = cases[0];
  for (const cfg of configs) console.log(`${cfg.key.padEnd(16)} ~${estimateInputTokens(cfg.spec, candidatesFor(cfg.g), c0.context, c0.utterance)} input tok/call, worst $${worstCost(cfg.spec, cfg.g, c0).toFixed(5)}/call`);
  const total = [...cases.slice(0, warmupN), ...cases].reduce((s, c) => s + worstCaseCost(c), 0);
  console.log(`set=${args.set} cases=${cases.length} warmup=${warmupN} calls=${(cases.length + warmupN) * configs.length} worst-case total ≈ $${total.toFixed(3)}`);
  process.exit(0);
}

const before = checkFrozen();
if (!before.ok) {
  console.error('frozen inputs changed:', before.items.filter((i) => !i.ok).map((i) => i.name).join(', '));
  process.exit(1);
}

const jev = specs.some((s) => s.provider === 'typesafe') ? newJevClient() : null;
const oai = specs.some((s) => s.provider === 'openai') ? newOpenAIClient() : null;
const budget = Number(args['budget-usd']);
let spent = 0;

interface Call extends ClassifyResult {
  /** 0-based position of this call within the case. */
  pos: number;
  at: string;
}
async function runCase(c: EvalCase) {
  const order = shuffled(configs);
  const results: Record<string, Call> = {};
  for (const [pos, cfg] of order.entries()) {
    const cands = candidatesFor(cfg.g);
    const at = new Date().toISOString();
    const r =
      cfg.spec.provider === 'typesafe'
        ? await classifyJev(jev as TypeSafeClient, cfg.spec, cands, c.context, c.utterance)
        : await classifyOpenAI(oai as OpenAI, cfg.spec, cands, c.context, c.utterance);
    results[cfg.key] = { ...r, pos, at };
    spent += r.costUsd;
  }
  return { order: order.map((o) => o.key), results };
}

console.log(`set=${args.set} configs=${configs.map((c) => c.key).join(', ')} cases=${cases.length} warmup=${warmupN} seed=${seed} budget=$${budget}`);
const startedAt = new Date().toISOString();
let stopped = false;
const fits = (c: EvalCase) => spent + worstCaseCost(c) <= budget;

const warmup: { id: string; order: string[]; results: Record<string, Call> }[] = [];
for (const c of cases.slice(0, warmupN)) {
  if (!fits(c)) {
    stopped = true;
    break;
  }
  warmup.push({ id: c.id, ...(await runCase(c)) });
}
console.log(`warmup done (spent≈$${spent.toFixed(4)})`);

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
const out = `results/v3/raw/${kind}-${args.set}-${stamp}-n${rows.length}.json`;
mkdirSync('results/v3/raw', { recursive: true });
writeFileSync(
  out,
  `${JSON.stringify(
    {
      startedAt,
      finishedAt: new Date().toISOString(),
      set: args.set,
      data: dataPath,
      smoke: args.smoke,
      env: { platform: platform(), arch: arch(), node: process.version },
      seed,
      warmup: warmupN,
      retries: 0,
      timeoutMs: TIMEOUT_MS,
      budgetUsd: budget,
      spentUsd: spent,
      stoppedByBudget: stopped,
      frozen: { before, after },
      configs: configs.map((c) => ({ key: c.key, classifier: c.spec.key, label: c.spec.label, model: c.spec.model, reasoningEffort: c.spec.reasoningEffort ?? null, granularity: c.g, price: c.spec.price })),
      warmupCases: warmup,
      cases: rows,
    },
    null,
    2
  )}\n`
);
console.log(`spent≈$${spent.toFixed(4)} → ${out}${stopped ? ' (STOPPED by budget)' : ''}${after.ok ? '' : ' (FROZEN INPUTS CHANGED DURING RUN)'}`);
const errs = rows.flatMap((r) => Object.entries(r.results).filter(([, v]) => !v.ok).map(([k, v]) => `${r.id} ${k}: ${v.error}`));
console.log(`failed calls: ${errs.length}`);
if (errs.length) console.log(errs.slice(0, 10).join('\n'));
