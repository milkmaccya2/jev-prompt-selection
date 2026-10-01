import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { type EvalCase, loadEval } from './data.js';
import {
  Budget,
  BudgetExceeded,
  type CallResult,
  CONFIGS,
  type ConfigId,
  buildState,
  estimateTokens,
  langOf,
  MODEL,
  makeClient,
  questionsFor,
  runConfig,
  USD_PER_INPUT_TOKEN,
} from './jev.js';
import { loadParts, selectable } from './parts.js';

const { values: args } = parseArgs({
  options: {
    limit: { type: 'string' },
    ids: { type: 'string' },
    'budget-usd': { type: 'string', default: '0.10' },
    configs: { type: 'string', default: CONFIGS.join(',') },
    concurrency: { type: 'string', default: '4' },
    'dry-run': { type: 'boolean', default: false },
    out: { type: 'string' },
  },
});

const parts = selectable(loadParts());
const configs = args.configs.split(',') as ConfigId[];
for (const c of configs) if (!CONFIGS.includes(c)) throw new Error(`unknown config ${c}`);

let cases = loadEval();
if (args.ids) {
  const want = new Set(args.ids.split(','));
  cases = cases.filter((c) => want.has(c.id));
} else if (args.limit) {
  // evenly spaced sample so a small run still covers different kinds of cases
  const n = Number(args.limit);
  const step = cases.length / n;
  cases = Array.from({ length: n }, (_, i) => cases[Math.floor(i * step)]);
}

const estTotal = cases.reduce(
  (s, c) =>
    s +
    configs.reduce(
      (t, cfg) =>
        t + estimateTokens(buildState(c.context, c.utterance, langOf(cfg)), questionsFor(cfg, parts)),
      0
    ),
  0
);
console.log(
  `cases=${cases.length} configs=${configs.join(',')} calls=${cases.length * configs.length} ` +
    `est. input tokens≈${estTotal} (≈$${(estTotal * USD_PER_INPUT_TOKEN).toFixed(4)}) budget=$${args['budget-usd']}`
);
if (args['dry-run']) process.exit(0);

const client = makeClient();
const budget = new Budget(Number(args['budget-usd']));
const results: { id: string; results: Partial<Record<ConfigId, CallResult>> }[] = [];
let stopped: string | null = null;

const queue = [...cases];
async function worker() {
  for (let c = queue.shift(); c && !stopped; c = queue.shift()) {
    const row = { id: c.id, results: {} as Partial<Record<ConfigId, CallResult>> };
    for (const cfg of configs) {
      try {
        row.results[cfg] = await runConfig(client, budget, cfg, parts, c.context, c.utterance);
      } catch (e) {
        if (e instanceof BudgetExceeded) {
          stopped = e.message;
          return;
        }
        throw e;
      }
    }
    results.push(row);
    const errs = Object.values(row.results).filter((r) => !r.ok).length;
    process.stdout.write(`${c.id}${errs ? `(err ${errs})` : ''} `);
  }
}
const startedAt = new Date().toISOString();
await Promise.all(Array.from({ length: Number(args.concurrency) }, worker));
console.log();

const order = new Map(cases.map((c: EvalCase, i) => [c.id, i]));
results.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
const out =
  args.out ?? `results/raw/run-${startedAt.replace(/[:.]/g, '-').slice(0, 19)}-n${results.length}.json`;
mkdirSync('results/raw', { recursive: true });
writeFileSync(
  out,
  `${JSON.stringify(
    {
      startedAt,
      requestedModel: MODEL,
      configs,
      budgetUsd: Number(args['budget-usd']),
      spentUsd: budget.spentUsd,
      stoppedByBudget: stopped,
      parts: parts.map((p) => ({ id: p.id, tokens: p.tokens })),
      cases: results,
    },
    null,
    2
  )}\n`
);
console.log(`spent≈$${budget.spentUsd.toFixed(5)} → ${out}${stopped ? `\nSTOPPED: ${stopped}` : ''}`);
