/**
 * One interface for every classifier: give it the candidates and a case, get back one candidate id.
 * Jev and the OpenAI models see the same candidate descriptions and the same conversation state.
 */
import { choice, type TypeSafeClient } from '@typesafe-ai/sdk';
import OpenAI from 'openai';
import type { Turn } from '../data.js';
import { buildState, MODEL as JEV_MODEL } from '../jev.js';

export interface Candidate {
  id: string;
  description: string;
}

export interface ClassifyResult {
  ok: boolean;
  chosen: string | null;
  /** Jev only: confidence and the full distribution. */
  confidence: number | null;
  probs: Record<string, number> | null;
  model: string | null;
  latencyMs: number;
  usage: { input: number; cachedInput: number; output: number; reasoning: number };
  costUsd: number;
  error?: string;
}

export interface ClassifierSpec {
  key: string;
  label: string;
  provider: 'typesafe' | 'openai';
  model: string;
  reasoningEffort?: 'none' | 'low';
  /** $ per token. Sources and dates: results/v2/PRICING.md */
  price: { input: number; cachedInput: number; output: number };
}

export const CLASSIFIERS: ClassifierSpec[] = [
  { key: 'jev', label: 'Jev', provider: 'typesafe', model: JEV_MODEL, price: { input: 0.042 / 1e6, cachedInput: 0.042 / 1e6, output: 0 } },
  { key: 'luna', label: 'gpt-6-luna(推論なし)', provider: 'openai', model: 'gpt-6-luna', reasoningEffort: 'none', price: { input: 0.1 / 1e6, cachedInput: 0.01 / 1e6, output: 0.5 / 1e6 } },
  { key: 'sol', label: 'gpt-6-sol(推論なし)', provider: 'openai', model: 'gpt-6-sol', reasoningEffort: 'none', price: { input: 2 / 1e6, cachedInput: 0.2 / 1e6, output: 10 / 1e6 } },
  { key: 'nano', label: 'gpt-5.4-nano(推論なし)', provider: 'openai', model: 'gpt-5.4-nano', reasoningEffort: 'none', price: { input: 0.2 / 1e6, cachedInput: 0.02 / 1e6, output: 1.25 / 1e6 } },
  { key: 'luna_low', label: 'gpt-6-luna(推論 low・参考)', provider: 'openai', model: 'gpt-6-luna', reasoningEffort: 'low', price: { input: 0.1 / 1e6, cachedInput: 0.01 / 1e6, output: 0.5 / 1e6 } },
];

const JEV_INSTRUCTIONS =
  'アシスタントが `user_utterance` に答えるときに使うシステムプロンプトを1つ選んでください。`recent_turns` は直前の会話の文脈です。';

/** The LLM gets the same instruction, the same candidate descriptions, and the same state JSON. */
const llmSystem = (cands: Candidate[]) =>
  `${JEV_INSTRUCTIONS}\n候補の id を1つだけ返してください。\n\n# 候補\n${cands.map((c) => `- ${c.id}: ${c.description}`).join('\n')}`;

const fail = (t0: number, e: unknown): ClassifyResult => ({
  ok: false,
  chosen: null,
  confidence: null,
  probs: null,
  model: null,
  latencyMs: performance.now() - t0,
  usage: { input: 0, cachedInput: 0, output: 0, reasoning: 0 },
  costUsd: 0,
  error: (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 300),
});

export async function classifyJev(
  client: TypeSafeClient,
  spec: ClassifierSpec,
  cands: Candidate[],
  context: Turn[],
  utterance: string
): Promise<ClassifyResult> {
  const criteria = Object.fromEntries(cands.map((c) => [c.id, c.description]));
  const t0 = performance.now();
  try {
    const res = await client.systemOne({
      model: spec.model,
      state: buildState(context, utterance, 'ja'),
      questions: { main: choice(JEV_INSTRUCTIONS, criteria) },
    });
    const latencyMs = performance.now() - t0;
    const a = res.answers.main as { choice: string; confidence: number; probabilities: Record<string, number> };
    const input = res.usage.input_tokens;
    return {
      ok: true,
      chosen: a.choice,
      confidence: a.confidence,
      probs: { ...a.probabilities },
      model: res.model,
      latencyMs,
      usage: { input, cachedInput: 0, output: res.usage.output_tokens, reasoning: 0 },
      costUsd: input * spec.price.input,
    };
  } catch (e) {
    return fail(t0, e);
  }
}

export async function classifyOpenAI(
  client: OpenAI,
  spec: ClassifierSpec,
  cands: Candidate[],
  context: Turn[],
  utterance: string
): Promise<ClassifyResult> {
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
    const msg = res.choices[0]?.message;
    if (!msg || msg.refusal) return { ...fail(t0, `refusal: ${msg?.refusal ?? 'no message'}`), latencyMs };
    const chosen = (JSON.parse(msg.content ?? '{}') as { prompt_id?: string }).prompt_id ?? null;
    const u = res.usage;
    const cached = u?.prompt_tokens_details?.cached_tokens ?? 0;
    const input = u?.prompt_tokens ?? 0;
    const output = u?.completion_tokens ?? 0;
    return {
      ok: chosen !== null,
      chosen,
      confidence: null,
      probs: null,
      model: res.model,
      latencyMs,
      usage: { input, cachedInput: cached, output, reasoning: u?.completion_tokens_details?.reasoning_tokens ?? 0 },
      costUsd: (input - cached) * spec.price.input + cached * spec.price.cachedInput + output * spec.price.output,
    };
  } catch (e) {
    return fail(t0, e);
  }
}
