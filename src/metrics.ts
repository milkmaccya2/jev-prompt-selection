import type { EvalCase } from './data.js';
import { BASE, type CallResult, type ConfigId } from './jev.js';
import type { Part } from './parts.js';
import { CUTOFFS, decide, pickPrompt } from './select.js';

export interface RawRun {
  startedAt: string;
  configs: ConfigId[];
  spentUsd: number;
  cases: { id: string; results: Partial<Record<ConfigId, CallResult>> }[];
}

export interface Variant {
  key: string;
  label: string;
  config: ConfigId;
  cutoff: number;
}

export type Verdict = 'correct' | 'acceptable' | 'wrong' | 'fallback';

export interface CaseOutcome {
  id: string;
  answer: string;
  acceptable: string[];
  chosen: string | null;
  confidence: number | null;
  verdict: Verdict;
}

export interface VariantMetrics {
  variant: Variant;
  n: number;
  /** chosen === answer */
  accuracy: number;
  /** chosen is answer or an acceptable alternative */
  accuracyLenient: number;
  /** a prompt that is neither answer nor acceptable was used */
  wrongRate: number;
  fallbackRate: number;
  latencyP50: number | null;
  latencyP95: number | null;
  selectorTokensPerCall: number | null;
  costUsdPer1k: number | null;
  perAnswer: Record<string, { n: number; ok: number; wrong: number; fallback: number }>;
  confusion: { answer: string; chosen: string; count: number }[];
  outcomes: CaseOutcome[];
}

export const CONFIG_LABEL: Record<ConfigId, string> = {
  choice_ja: 'choice(日本語)',
  choice_en: 'choice(英語の説明)',
  noul_ja: 'noul ×11 の最大値',
};

export function variantsFor(configs: ConfigId[]): Variant[] {
  const v: Variant[] = [];
  // raw runs may hold configs that were dropped later (e.g. an earlier description variant)
  for (const c of configs.filter((x) => x in CONFIG_LABEL)) {
    for (const cut of CUTOFFS) {
      v.push({
        key: `${c}@${cut}`,
        label: cut ? `${CONFIG_LABEL[c]} 下限${cut}` : `${CONFIG_LABEL[c]} 下限なし`,
        config: c,
        cutoff: cut,
      });
    }
  }
  return v;
}

const pct = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
};

export function computeMetrics(run: RawRun, cases: EvalCase[], parts: Part[]): VariantMetrics[] {
  const answerIds = [...parts.filter((p) => p.kind === 'selectable').map((p) => p.id), BASE];
  const byId = new Map(cases.map((c) => [c.id, c]));
  const rows = run.cases.filter((r) => byId.has(r.id));

  return variantsFor(run.configs).map((variant) => {
    const outcomes: CaseOutcome[] = [];
    const latencies: number[] = [];
    let selTokens = 0;
    let calls = 0;
    for (const row of rows) {
      const c = byId.get(row.id) as EvalCase;
      const r = row.results[variant.config];
      if (!r) continue;
      latencies.push(r.latencyMs);
      selTokens += r.inputTokens;
      calls++;
      const d = decide(pickPrompt(r, variant.config), variant.cutoff);
      const chosen = d.chosen ?? null;
      const verdict: Verdict =
        d.kind === 'fallback'
          ? 'fallback'
          : d.chosen === c.answer
            ? 'correct'
            : c.acceptable.includes(d.chosen)
              ? 'acceptable'
              : 'wrong';
      outcomes.push({
        id: c.id,
        answer: c.answer,
        acceptable: c.acceptable,
        chosen,
        confidence: d.confidence ?? null,
        verdict,
      });
    }
    const n = outcomes.length || 1;
    const count = (f: (o: CaseOutcome) => boolean) => outcomes.filter(f).length;
    const perAnswer: VariantMetrics['perAnswer'] = Object.fromEntries(
      answerIds.map((id) => [id, { n: 0, ok: 0, wrong: 0, fallback: 0 }])
    );
    const conf = new Map<string, number>();
    for (const o of outcomes) {
      const pa = perAnswer[o.answer];
      pa.n++;
      if (o.verdict === 'correct' || o.verdict === 'acceptable') pa.ok++;
      if (o.verdict === 'fallback') pa.fallback++;
      if (o.verdict === 'wrong') {
        pa.wrong++;
        const k = `${o.answer}\t${o.chosen}`;
        conf.set(k, (conf.get(k) ?? 0) + 1);
      }
    }
    return {
      variant,
      n: outcomes.length,
      accuracy: count((o) => o.verdict === 'correct') / n,
      accuracyLenient: count((o) => o.verdict === 'correct' || o.verdict === 'acceptable') / n,
      wrongRate: count((o) => o.verdict === 'wrong') / n,
      fallbackRate: count((o) => o.verdict === 'fallback') / n,
      latencyP50: pct(latencies, 0.5),
      latencyP95: pct(latencies, 0.95),
      selectorTokensPerCall: calls ? selTokens / calls : null,
      costUsdPer1k: calls ? ((selTokens / calls) * 0.042) / 1000 : null,
      perAnswer,
      confusion: [...conf]
        .map(([k, count]) => {
          const [answer, chosen] = k.split('\t');
          return { answer, chosen, count };
        })
        .sort((a, b) => b.count - a.count),
      outcomes,
    };
  });
}
