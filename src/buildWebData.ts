import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { choice } from '@typesafe-ai/sdk';
import { loadEval } from './data.js';
import { MODEL } from './jev.js';
import { loadParts } from './parts.js';
import { candidatesFor, coarseDefs, instruction } from './v3/candidates.js';

/**
 * Everything the viewer needs, baked once so the Cloudflare Worker has no Node dependencies.
 * The eval tab shows the v3 runs (test = main, dev = reference); the try tab calls Jev live
 * with the same frozen v3 instruction and descriptions that the eval used.
 */
type RawCall = Record<string, unknown> & { latencyMs: number };

function loadRun(set: 'test' | 'dev') {
  const latest = readdirSync('results/v3/raw')
    .filter((f) => f.startsWith(`run-${set}-`))
    .sort()
    .at(-1);
  if (!latest) return null;
  const raw = JSON.parse(readFileSync(`results/v3/raw/${latest}`, 'utf8'));
  // keep only what the viewer shows, to keep the payload small
  return {
    startedAt: raw.startedAt,
    spentUsd: raw.spentUsd,
    configs: raw.configs.map(({ price: _p, ...c }: Record<string, unknown>) => c),
    cases: raw.cases.map((c: { id: string; results: Record<string, RawCall> }) => ({
      id: c.id,
      results: Object.fromEntries(
        Object.entries(c.results).map(([k, r]) => [
          k,
          { ok: r.ok, chosen: r.chosen, confidence: r.confidence, probs: r.probs, model: r.model, latencyMs: Math.round(r.latencyMs), costUsd: r.costUsd },
        ])
      ),
    })),
  };
}

const loadCases = (set: 'test' | 'dev') =>
  loadEval(new URL(`../data/eval.v3.${set}.jsonl`, import.meta.url)).map((c) => ({
    id: c.id,
    context: c.context,
    utterance: c.utterance,
    answer: c.answer,
    acceptable: c.acceptable,
    tags: c.tags,
    reason: (c as { label?: { reason?: string } }).label?.reason ?? '',
  }));

export function buildWebData() {
  const questions = Object.fromEntries(
    (['fine', 'coarse'] as const).map((g) => [g, { main: choice(instruction(), Object.fromEntries(candidatesFor(g).map((c) => [c.id, c.description]))) }])
  );
  return {
    parts: loadParts().map(({ body: _b, ...p }) => p),
    coarse: coarseDefs().map(({ id, name, members }) => ({ id, name, members })),
    sets: {
      test: { cases: loadCases('test'), run: loadRun('test') },
      dev: { cases: loadCases('dev'), run: loadRun('dev') },
    },
    model: MODEL,
    questions,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync('worker/data.json', JSON.stringify(buildWebData()));
  console.log('worker/data.json written');
}
