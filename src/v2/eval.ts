/**
 * Runs every (classifier × granularity) config on the eval set, one call at a time.
 * Configs are interleaved per case so all of them see the same network conditions,
 * and the first `--warmup` cases are run through every config and discarded.
 */
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { mkdirSync, writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { parseArgs } from 'node:util';
import OpenAI from 'openai';
import { type EvalCase, loadEval } from '../data.js';
import { candidatesFor, type Granularity } from './candidates.js';
import { CLASSIFIERS, type ClassifyResult, classifyJev, classifyOpenAI } from './classifiers.js';

const { values: args } = parseArgs({
  options: {
    data: { type: 'string', default: 'data/eval.v2.jsonl' },
    limit: { type: 'string' },
    classifiers: { type: 'string', default: 'jev,luna,sol,luna_low' },
    granularity: { type: 'string', default: 'fine,coarse' },
    warmup: { type: 'string', default: '3' },
    'budget-usd': { type: 'string', default: '3' },
    out: { type: 'string' },
  },
});

const grans = args.granularity.split(',') as Granularity[];
const specs = args.classifiers.split(',').map((k) => {
  const s = CLASSIFIERS.find((c) => c.key === k);
  if (!s) throw new Error(`unknown classifier ${k}`);
  return s;
});
// the reasoning reference is measured on the 12 candidates only
const configs = specs.flatMap((spec) =>
  grans.filter((g) => !(spec.key === 'luna_low' && g === 'coarse')).map((g) => ({ key: `${spec.key}@${g}`, spec, g }))
);

let cases = loadEval(new URL(`../../${args.data}`, import.meta.url));
if (args.limit) cases = cases.slice(0, Number(args.limit));
const warmupN = Number(args.warmup);

const jev = specs.some((s) => s.provider === 'typesafe') ? new TypeSafeClient({ timeout: 30_000 }) : null;
const oai = specs.some((s) => s.provider === 'openai') ? new OpenAI() : null;
const budget = Number(args['budget-usd']);
let spent = 0;

async function runCase(c: EvalCase) {
  const results: Record<string, ClassifyResult> = {};
  for (const cfg of configs) {
    const cands = candidatesFor(cfg.g);
    results[cfg.key] =
      cfg.spec.provider === 'typesafe'
        ? await classifyJev(jev as TypeSafeClient, cfg.spec, cands, c.context, c.utterance)
        : await classifyOpenAI(oai as OpenAI, cfg.spec, cands, c.context, c.utterance);
    spent += results[cfg.key].costUsd;
  }
  return results;
}

console.log(`configs=${configs.map((c) => c.key).join(', ')} cases=${cases.length} warmup=${warmupN} budget=$${budget}`);
for (const c of cases.slice(0, warmupN)) await runCase(c); // discarded
console.log(`warmup done (spent≈$${spent.toFixed(4)})`);

const startedAt = new Date().toISOString();
const rows: { id: string; results: Record<string, ClassifyResult> }[] = [];
let stopped = false;
for (const c of cases) {
  if (spent >= budget) {
    stopped = true;
    break;
  }
  const results = await runCase(c);
  rows.push({ id: c.id, results });
  const errs = Object.values(results).filter((r) => !r.ok).length;
  process.stdout.write(`${c.id}${errs ? `(err ${errs})` : ''} `);
}
console.log();

const out = args.out ?? `results/v2/raw/run-${startedAt.replace(/[:.]/g, '-').slice(0, 19)}-n${rows.length}.json`;
mkdirSync('results/v2/raw', { recursive: true });
writeFileSync(
  out,
  `${JSON.stringify(
    {
      startedAt,
      data: args.data,
      env: { platform: platform(), arch: arch(), node: process.version },
      warmup: warmupN,
      configs: configs.map((c) => ({ key: c.key, classifier: c.spec.key, label: c.spec.label, model: c.spec.model, reasoningEffort: c.spec.reasoningEffort ?? null, granularity: c.g })),
      spentUsd: spent,
      stoppedByBudget: stopped,
      cases: rows,
    },
    null,
    2
  )}\n`
);
console.log(`spent≈$${spent.toFixed(4)} → ${out}${stopped ? ' (STOPPED by budget)' : ''}`);
const errSamples = rows.flatMap((r) => Object.entries(r.results).filter(([, v]) => !v.ok).map(([k, v]) => `${r.id} ${k}: ${v.error}`));
if (errSamples.length) console.log('errors:', errSamples.slice(0, 5).join('\n'));
