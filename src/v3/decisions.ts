/**
 * Appendix: OpenAI Decisions API (POST /v1/decisions, public beta) as one more classifier.
 * Same instruction, same candidate descriptions and same state JSON as Jev in v3.
 * The state JSON is passed as the text input, because the instruction refers to its keys.
 */
import type OpenAI from 'openai';
import type { Turn } from '../data.js';
import { buildState } from '../jev.js';
import { instruction } from './candidates.js';
import type { Candidate, ClassifierSpec, ClassifyResult } from './classifiers.js';

/** $0.10 / 1M input tokens; output and cache are not billed (guide checked 2026-10-08). */
export const DECISIONS: ClassifierSpec = {
  key: 'dec',
  label: 'gpt-6-luna(Decisions API)',
  provider: 'openai',
  model: 'gpt-6-luna',
  price: { input: 0.1 / 1e6, cachedInput: 0.1 / 1e6, output: 0 },
};

export async function classifyDecisions(client: OpenAI, spec: ClassifierSpec, cands: Candidate[], context: Turn[], utterance: string): Promise<ClassifyResult> {
  const t0 = performance.now();
  try {
    const res = await client.decisions.create({
      model: spec.model,
      input: JSON.stringify(buildState(context, utterance, 'ja')),
      questions: [{ type: 'choice', name: 'main', instructions: instruction(), choices: cands.map((c) => ({ value: c.id, description: c.description })) }],
    });
    const latencyMs = performance.now() - t0;
    const a = res.answers[0];
    const input = res.usage?.input_tokens ?? 0;
    const usage = { input, cachedInput: 0, cacheWrite: 0, output: res.usage?.output_tokens ?? 0, reasoning: 0 };
    const costUsd = input * spec.price.input;
    if (!a || a.type !== 'choice') {
      return { ok: false, chosen: null, confidence: null, probs: null, model: res.model, latencyMs, usage, costUsd, error: `no choice answer: ${JSON.stringify(a).slice(0, 150)}` };
    }
    const chosen = String(a.choice);
    const ok = cands.some((c) => c.id === chosen);
    return {
      ok,
      chosen: ok ? chosen : null,
      confidence: a.confidence,
      probs: Object.fromEntries(a.probabilities.map((p) => [String(p.value), p.probability])),
      model: res.model,
      latencyMs,
      usage,
      costUsd,
      ...(ok ? {} : { error: `unknown choice: ${chosen}` }),
    };
  } catch (e) {
    const status = (e as { status?: number })?.status;
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return {
      ok: false,
      chosen: null,
      confidence: null,
      probs: null,
      model: null,
      latencyMs: performance.now() - t0,
      usage: { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0 },
      costUsd: 0,
      error: `${status ? `[${status}] ` : ''}${msg}`.slice(0, 300),
    };
  }
}
