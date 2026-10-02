import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { choice } from '@typesafe-ai/sdk';
import { loadEval } from './data.js';
import { MODEL } from './jev.js';
import { loadParts } from './parts.js';
import { COARSE, candidatesFor } from './v2/candidates.js';

/**
 * Everything the viewer needs, baked once so the Cloudflare Worker has no Node dependencies.
 * The eval tab shows the latest v2 run (all classifiers × both granularities); the try tab calls Jev live.
 */
const JEV_INSTRUCTIONS =
  'アシスタントが `user_utterance` に答えるときに使うシステムプロンプトを1つ選んでください。`recent_turns` は直前の会話の文脈です。';

export function buildWebData() {
  const latest = readdirSync('results/v2/raw')
    .filter((f) => f.startsWith('run-'))
    .sort()
    .at(-1);
  const raw = latest ? JSON.parse(readFileSync(`results/v2/raw/${latest}`, 'utf8')) : null;
  // keep only what the viewer shows, to keep the payload small
  const run = raw && {
    startedAt: raw.startedAt,
    spentUsd: raw.spentUsd,
    configs: raw.configs,
    cases: raw.cases.map((c: { id: string; results: Record<string, Record<string, unknown>> }) => ({
      id: c.id,
      results: Object.fromEntries(
        Object.entries(c.results).map(([k, r]) => [
          k,
          { ok: r.ok, chosen: r.chosen, confidence: r.confidence, probs: r.probs, latencyMs: Math.round(r.latencyMs as number), costUsd: r.costUsd },
        ])
      ),
    })),
  };
  const questions = Object.fromEntries(
    (['fine', 'coarse'] as const).map((g) => [
      g,
      { main: choice(JEV_INSTRUCTIONS, Object.fromEntries(candidatesFor(g).map((c) => [c.id, c.description]))) },
    ])
  );
  return {
    parts: loadParts().map(({ body: _b, ...p }) => p),
    coarse: COARSE,
    cases: loadEval(new URL('../data/eval.v2.jsonl', import.meta.url)),
    run,
    model: MODEL,
    questions,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync('worker/data.json', JSON.stringify(buildWebData()));
  console.log('worker/data.json written');
}
