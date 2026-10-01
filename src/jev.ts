import { choice, noul, type Questions, TypeSafeClient } from '@typesafe-ai/sdk';
import { countTokens } from 'gpt-tokenizer';
import type { Turn } from './data.js';
import type { Part } from './parts.js';

/** Jev 1.13 price per input token (docs.typesafe.ai/models: $0.042 / Mtok). Output is free. */
export const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;
export const MODEL = 'jev-latest';

export type Lang = 'ja' | 'en';
export type ConfigId = 'choice_ja' | 'choice_en' | 'noul_ja';
/** The main configuration. */
export const MAIN: ConfigId = 'choice_ja';
/** Supplementary checks (run with --configs): English descriptions, and noul argmax. */
export const CONFIGS: ConfigId[] = ['choice_ja', 'choice_en', 'noul_ja'];
/** The base prompt: only the always-on parts, no topic part. */
export const BASE = 'base';

export interface CallResult {
  ok: boolean;
  model?: string;
  /** noul: part id -> probability. choice: option -> probability. */
  probs: Record<string, number>;
  choice?: string;
  confidence?: number;
  latencyMs: number;
  inputTokens: number;
  error?: string;
}

export function makeClient(): TypeSafeClient {
  if (!process.env.TYPESAFE_API_KEY) {
    throw new Error('TYPESAFE_API_KEY is not set (put it in .env)');
  }
  // apiKey is read from TYPESAFE_API_KEY by the SDK; logLevel stays at the default (warn)
  // because debug would log request bodies.
  return new TypeSafeClient({ timeout: 30_000 });
}

export function buildState(context: Turn[], utterance: string, lang: Lang) {
  const speaker = (r: Turn['role']) =>
    lang === 'ja' ? (r === 'user' ? 'ユーザー' : 'アシスタント') : r;
  return {
    recent_turns: context.map((t) => ({ speaker: speaker(t.role), text: t.text })),
    user_utterance: utterance,
  };
}

export function noulQuestions(parts: Part[], lang: Lang): Questions {
  const q: Questions = {};
  for (const p of parts) {
    q[p.id] =
      lang === 'ja'
        ? noul(
            {
              section: { name: p.summary, needed_when: p.use_when },
              question:
                'アシスタントが `user_utterance` に適切に答えるために、システムプロンプトの `section` の指示が必要ですか?' +
                ' `recent_turns` は直前の会話の文脈です。',
            },
            { true: `必要: ${p.use_when}`, false: `不要: ${p.not_when}` }
          )
        : noul(
            {
              section: { name: p.summary_en, needed_when: p.use_when_en },
              question:
                'To answer `user_utterance` well, does the assistant need the instructions in the system-prompt `section`?' +
                ' `recent_turns` is the preceding conversation for context. The conversation is in Japanese.',
            },
            { true: `Needed: ${p.use_when_en}`, false: `Not needed: ${p.not_when_en}` }
          );
  }
  return q;
}

const BASE_DESC = {
  ja: 'どの専用の指示も不要(人格・安全・出力形式の基本ルールだけで答えられる)',
  en: 'No topic-specific instructions needed (the base rules for persona, safety, and output format are enough)',
};

export function choiceQuestions(parts: Part[], variant: Lang): Questions {
  const criteria: Record<string, string> = {};
  for (const p of parts) {
    criteria[p.id] = variant === 'en' ? `${p.summary_en}. ${p.use_when_en}` : `${p.summary}。${p.use_when}`;
  }
  criteria[BASE] = variant === 'en' ? BASE_DESC.en : BASE_DESC.ja;
  const instructions =
    variant === 'en'
      ? 'Pick the ONE system prompt the assistant should use to answer `user_utterance`. `recent_turns` is the preceding conversation. The conversation is in Japanese.'
      : 'アシスタントが `user_utterance` に答えるときに使うシステムプロンプトを1つ選んでください。`recent_turns` は直前の会話の文脈です。';
  return { main: choice(instructions, criteria) };
}

export function questionsFor(config: ConfigId, parts: Part[]): Questions {
  if (config === 'noul_ja') return noulQuestions(parts, 'ja');
  if (config === 'choice_en') return choiceQuestions(parts, 'en');
  return choiceQuestions(parts, 'ja');
}

export const langOf = (config: ConfigId): Lang => (config === 'choice_en' ? 'en' : 'ja');

/** Rough pre-call estimate (o200k tokens of the JSON payload) used only for the budget guard. */
export function estimateTokens(state: unknown, questions: Questions): number {
  return countTokens(JSON.stringify({ state, questions }));
}

export class Budget {
  spentUsd = 0;
  constructor(readonly limitUsd: number) {}
  /** Throws before a call that could push spending over the limit (with a 2x safety margin). */
  reserve(estTokens: number) {
    const est = estTokens * USD_PER_INPUT_TOKEN * 2;
    if (this.spentUsd + est > this.limitUsd) {
      throw new BudgetExceeded(
        `budget $${this.limitUsd} would be exceeded (spent $${this.spentUsd.toFixed(5)}, next ~$${est.toFixed(5)})`
      );
    }
  }
  record(inputTokens: number) {
    this.spentUsd += inputTokens * USD_PER_INPUT_TOKEN;
  }
}
export class BudgetExceeded extends Error {}

export async function runConfig(
  client: TypeSafeClient,
  budget: Budget,
  config: ConfigId,
  parts: Part[],
  context: Turn[],
  utterance: string
): Promise<CallResult> {
  const state = buildState(context, utterance, langOf(config));
  const questions = questionsFor(config, parts);
  budget.reserve(estimateTokens(state, questions));
  const t0 = performance.now();
  try {
    const res = await client.systemOne({ state, questions, model: MODEL });
    const latencyMs = performance.now() - t0;
    budget.record(res.usage.input_tokens);
    const base = { ok: true, model: res.model, latencyMs, inputTokens: res.usage.input_tokens };
    if (config !== 'noul_ja') {
      const a = res.answers.main as { choice: string; confidence: number; probabilities: Record<string, number> };
      return { ...base, probs: { ...a.probabilities }, choice: a.choice, confidence: a.confidence };
    }
    const probs: Record<string, number> = {};
    for (const p of parts) probs[p.id] = (res.answers[p.id] as { noul: number }).noul;
    return { ...base, probs };
  } catch (e) {
    if (e instanceof BudgetExceeded) throw e;
    // Never include request headers in logs; the SDK error message carries status + body only.
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return { ok: false, probs: {}, latencyMs: performance.now() - t0, inputTokens: 0, error: msg.slice(0, 300) };
  }
}
