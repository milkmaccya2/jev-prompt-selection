import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { choice } from '@typesafe-ai/sdk';
import { loadEval } from './data.js';
import { MODEL } from './jev.js';
import { loadParts } from './parts.js';
import { candidatesFor, coarseDefs, instruction } from './v3/candidates.js';

/**
 * Everything the viewer needs, baked once so the Cloudflare Worker has no Node dependencies.
 * The eval tab shows the v4 run (Jev, Decisions API, gpt-6-luna Chat, gpt-5.4-nano Chat on the frozen test set);
 * the try tab calls Jev live with the same frozen v3 instruction and descriptions that the eval used.
 */
type RawCall = Record<string, unknown> & { latencyMs: number };

/** Display names that say how each model was called (same as results/v4/summary.md). */
const DISPLAY: Record<string, string> = {
  jev: 'Jev(choice)',
  dec: 'gpt-6-luna(Decisions API・choice)',
  luna: 'gpt-6-luna(Chat・推論なし)',
  nano: 'gpt-5.4-nano(Chat・推論なし)',
};
const ORDER = ['jev', 'dec', 'luna', 'nano'];

function loadRun() {
  const latest = readdirSync('results/v4/raw')
    .filter((f) => f.startsWith('run-test-'))
    .sort()
    .at(-1);
  if (!latest) return null;
  const raw = JSON.parse(readFileSync(`results/v4/raw/${latest}`, 'utf8'));
  if (raw.stoppedByBudget || !raw.frozen.before.ok || !raw.frozen.after.ok) throw new Error('v4 run is incomplete');
  // keep only what the viewer shows, to keep the payload small
  return {
    startedAt: raw.startedAt,
    spentUsd: raw.spentUsd,
    configs: raw.configs
      .map(({ price: _p, ...c }: Record<string, unknown>) => ({ ...c, label: DISPLAY[c.classifier as string] ?? c.label }))
      .sort((a: { classifier: string; granularity: string }, b: { classifier: string; granularity: string }) => ORDER.indexOf(a.classifier) - ORDER.indexOf(b.classifier) || (a.granularity === 'fine' ? -1 : 1)),
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
      test: { cases: loadCases('test'), run: loadRun() },
    },
    model: MODEL,
    questions,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync('worker/data.json', JSON.stringify(buildWebData()));
  console.log('worker/data.json written');
}
