/**
 * v3 classifiers. Same call shapes as v2 (src/v2/classifiers.ts), with two changes:
 * - the instruction and candidate descriptions come from data/candidates.v3.json (frozen)
 * - no SDK retries: each call is one attempt, and a failure is recorded as a failure
 */
import { choice, TypeSafeClient } from '@typesafe-ai/sdk';
import { countTokens } from 'gpt-tokenizer';
import OpenAI from 'openai';
import type { Turn } from '../data.js';
import { buildState, MODEL as JEV_MODEL } from '../jev.js';
import type { ClassifierSpec, ClassifyResult } from '../v2/classifiers.js';
import { instruction } from './candidates.js';

export type { ClassifierSpec, ClassifyResult };

export interface Candidate {
  id: string;
  description: string;
}

/** $ per token. Sources and dates: results/v3/PRICING.md (re-checked 2026-10-04). */
export const CLASSIFIERS: ClassifierSpec[] = [
  { key: 'jev', label: 'Jev', provider: 'typesafe', model: JEV_MODEL, price: { input: 0.042 / 1e6, cachedInput: 0.042 / 1e6, output: 0 } },
  { key: 'nano', label: 'gpt-5.4-nano(推論なし)', provider: 'openai', model: 'gpt-5.4-nano', reasoningEffort: 'none', price: { input: 0.2 / 1e6, cachedInput: 0.02 / 1e6, output: 1.25 / 1e6 } },
  { key: 'luna', label: 'gpt-6-luna(推論なし)', provider: 'openai', model: 'gpt-6-luna', reasoningEffort: 'none', price: { input: 0.1 / 1e6, cachedInput: 0.01 / 1e6, cacheWrite: 0.125 / 1e6, output: 0.5 / 1e6 } },
  { key: 'sol', label: 'gpt-6-sol(推論なし)', provider: 'openai', model: 'gpt-6-sol', reasoningEffort: 'none', price: { input: 2 / 1e6, cachedInput: 0.2 / 1e6, cacheWrite: 2.5 / 1e6, output: 10 / 1e6 } },
  { key: 'luna_low', label: 'gpt-6-luna(推論 low・参考)', provider: 'openai', model: 'gpt-6-luna', reasoningEffort: 'low', price: { input: 0.1 / 1e6, cachedInput: 0.01 / 1e6, cacheWrite: 0.125 / 1e6, output: 0.5 / 1e6 } },
];

export const TIMEOUT_MS = 30_000;
export const newJevClient = () => new TypeSafeClient({ timeout: TIMEOUT_MS, retry: { maxRetries: 0 } });
export const newOpenAIClient = () => new OpenAI({ timeout: TIMEOUT_MS, maxRetries: 0 });

/** The LLM gets the same instruction, the same candidate descriptions, and the same state JSON as Jev. */
export const llmSystem = (cands: Candidate[]) =>
  `${instruction()}\n候補の id を1つだけ返してください。\n\n# 候補\n${cands.map((c) => `- ${c.id}: ${c.description}`).join('\n')}`;

/** o200k estimate of one call's input, used only for the dry run and the budget guard. */
export function estimateInputTokens(spec: ClassifierSpec, cands: Candidate[], context: Turn[], utterance: string): number {
  const state = buildState(context, utterance, 'ja');
  if (spec.provider === 'typesafe') {
    return countTokens(JSON.stringify({ state, questions: { main: choice(instruction(), Object.fromEntries(cands.map((c) => [c.id, c.description]))) } }));
  }
  return countTokens(llmSystem(cands)) + countTokens(JSON.stringify(state)) + 30;
}

const errText = (e: unknown) => {
  // Status and message only; the SDK errors do not carry request headers here.
  const status = (e as { status?: number })?.status;
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return `${status ? `[${status}] ` : ''}${msg}`.slice(0, 300);
};

const fail = (t0: number, e: unknown): ClassifyResult => ({
  ok: false,
  chosen: null,
  confidence: null,
  probs: null,
  model: null,
  latencyMs: performance.now() - t0,
  usage: { input: 0, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0 },
  costUsd: 0,
  error: errText(e),
});

export async function classifyJev(client: TypeSafeClient, spec: ClassifierSpec, cands: Candidate[], context: Turn[], utterance: string): Promise<ClassifyResult> {
  const criteria = Object.fromEntries(cands.map((c) => [c.id, c.description]));
  const t0 = performance.now();
  try {
    const res = await client.systemOne({
      model: spec.model,
      state: buildState(context, utterance, 'ja'),
      questions: { main: choice(instruction(), criteria) },
    });
    const latencyMs = performance.now() - t0;
    const a = res.answers.main as { choice: string; confidence: number; probabilities: Record<string, number> };
    const input = res.usage.input_tokens;
    return {
      ok: cands.some((c) => c.id === a.choice),
      chosen: a.choice,
      confidence: a.confidence,
      probs: { ...a.probabilities },
      model: res.model,
      latencyMs,
      usage: { input, cachedInput: 0, cacheWrite: 0, output: res.usage.output_tokens, reasoning: 0 },
      costUsd: input * spec.price.input,
    };
  } catch (e) {
    return fail(t0, e);
  }
}

export async function classifyOpenAI(client: OpenAI, spec: ClassifierSpec, cands: Candidate[], context: Turn[], utterance: string): Promise<ClassifyResult> {
  const schema = {
    type: 'object',
    properties: { prompt_id: { type: 'string', enum: cands.map((c) => c.id) } },
    required: ['prompt_id'],
    additionalProperties: false,
  };
  const t0 = performance.now();
  try {
    const res = await client.chat.completions.create({
      model: spec.model,
      reasoning_effort: spec.reasoningEffort,
      messages: [
        { role: 'system', content: llmSystem(cands) },
        { role: 'user', content: JSON.stringify(buildState(context, utterance, 'ja')) },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'prompt_choice', strict: true, schema } },
    });
    const latencyMs = performance.now() - t0;
    const u = res.usage;
    const cached = u?.prompt_tokens_details?.cached_tokens ?? 0;
    // GPT-5.6+ reports cache writes here (not yet in the SDK types)
    const written = (u?.prompt_tokens_details as { cache_write_tokens?: number } | undefined)?.cache_write_tokens ?? 0;
    const input = u?.prompt_tokens ?? 0;
    const output = u?.completion_tokens ?? 0;
    const costUsd =
      (input - cached - written) * spec.price.input + cached * spec.price.cachedInput + written * (spec.price.cacheWrite ?? spec.price.input) + output * spec.price.output;
    const usage = { input, cachedInput: cached, cacheWrite: written, output, reasoning: u?.completion_tokens_details?.reasoning_tokens ?? 0 };
    const msg = res.choices[0]?.message;
    let chosen: string | null = null;
    try {
      chosen = (JSON.parse(msg?.content ?? '{}') as { prompt_id?: string }).prompt_id ?? null;
    } catch {
      chosen = null;
    }
    const ok = !!msg && !msg.refusal && chosen !== null && cands.some((c) => c.id === chosen);
    return {
      ok,
      chosen: ok ? chosen : null,
      confidence: null,
      probs: null,
      model: res.model,
      latencyMs,
      usage,
      costUsd, // billed even when the answer is unusable
      ...(ok ? {} : { error: msg?.refusal ? `refusal: ${msg.refusal}` : `unusable output: ${(msg?.content ?? '').slice(0, 100)}` }),
    };
  } catch (e) {
    return fail(t0, e);
  }
}
