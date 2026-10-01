import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEval } from './data.js';
import { MAIN, MODEL, questionsFor } from './jev.js';
import type { RawRun } from './metrics.js';
import { loadParts, selectable } from './parts.js';

// Everything the hosted viewer needs, baked at build time so the Worker has no Node dependencies.
const parts = loadParts();
const latest = readdirSync('results/raw')
  .filter((f) => f.startsWith('run-'))
  .sort()
  .at(-1);
const raw = latest ? (JSON.parse(readFileSync(`results/raw/${latest}`, 'utf8')) as RawRun) : null;
// keep only the main config to keep the payload small
const run = raw && {
  startedAt: raw.startedAt,
  spentUsd: raw.spentUsd,
  configs: [MAIN],
  cases: raw.cases.map((c) => ({ id: c.id, results: { [MAIN]: c.results[MAIN] } })),
};

writeFileSync(
  'worker/data.json',
  JSON.stringify({
    parts: parts.map(({ body: _b, ...p }) => p),
    cases: loadEval(),
    run,
    main: MAIN,
    model: MODEL,
    questions: questionsFor(MAIN, selectable(parts)),
  })
);
console.log(`worker/data.json written (run: ${latest ?? 'none'})`);
