import type { EvalCase } from './data.js';
import type { CallResult, ConfigId } from './jev.js';
import type { Part } from './parts.js';
import { loaded, type Selection, selectChoice, selectNoul, THRESHOLDS } from './select.js';

export interface RawRun {
  startedAt: string;
  configs: ConfigId[];
  spentUsd: number;
  cases: { id: string; results: Partial<Record<ConfigId, CallResult>> }[];
}

export interface Variant {
  key: string;
  label: string;
  config: ConfigId | 'all';
  threshold?: number;
  fallback: boolean;
}

export interface CaseOutcome {
  id: string;
  gold: string[];
  loaded: string[];
  chosen: string[];
  fallback: string | null;
  missed: string[];
  extra: string[];
  tokens: number;
}

export interface VariantMetrics {
  variant: Variant;
  n: number;
  meanPromptTokens: number;
  reduction: number;
  recall: number;
  caseMissRate: number;
  precision: number | null;
  fallbackRate: number;
  latencyP50: number | null;
  latencyP95: number | null;
  selectorTokensPerCall: number | null;
  costUsdPer1k: number | null;
  perPartMiss: Record<string, { gold: number; missed: number }>;
  outcomes: CaseOutcome[];
}

const CONFIG_LABEL: Record<ConfigId, string> = {
  noul_ja: 'B noul(日本語)',
  noul_en: "B' noul(英語)",
  choice_ja: 'C choice',
};

export function variantsFor(configs: ConfigId[]): Variant[] {
  const v: Variant[] = [{ key: 'A', label: 'A 全部載せ', config: 'all', fallback: false }];
  for (const c of configs) {
    for (const fb of [true, false]) {
      const sfx = fb ? '' : ' 逃げ道なし';
      if (c === 'choice_ja') {
        v.push({ key: `${c}${fb ? '' : '_nofb'}`, label: `${CONFIG_LABEL[c]}${sfx}`, config: c, fallback: fb });
      } else {
        for (const t of THRESHOLDS) {
          v.push({
            key: `${c}@${t}${fb ? '' : '_nofb'}`,
            label: `${CONFIG_LABEL[c]} t=${t}${sfx}`,
            config: c,
            threshold: t,
            fallback: fb,
          });
        }
      }
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
  const sel = parts.filter((p) => p.kind === 'selectable');
  const allIds = sel.map((p) => p.id);
  const tok = new Map(parts.map((p) => [p.id, p.tokens]));
  const alwaysTokens = parts.filter((p) => p.kind === 'always').reduce((s, p) => s + p.tokens, 0);
  const fullTokens = alwaysTokens + sel.reduce((s, p) => s + p.tokens, 0);
  const byId = new Map(cases.map((c) => [c.id, c]));
  const rows = run.cases.filter((r) => byId.has(r.id));

  return variantsFor(run.configs).map((variant) => {
    const outcomes: CaseOutcome[] = [];
    const latencies: number[] = [];
    let selTokens = 0;
    let calls = 0;
    for (const row of rows) {
      const c = byId.get(row.id) as EvalCase;
      let s: Selection;
      if (variant.config === 'all') {
        s = { chosen: allIds, fallback: null };
      } else {
        const r = row.results[variant.config];
        if (!r) continue;
        latencies.push(r.latencyMs);
        selTokens += r.inputTokens;
        calls++;
        s = variant.config === 'choice_ja' ? selectChoice(r) : selectNoul(r, variant.threshold as number);
      }
      const L = variant.config === 'all' ? allIds : loaded(s, allIds, variant.fallback);
      const fb = variant.config === 'all' ? null : L === allIds && s.fallback ? s.fallback : null;
      outcomes.push({
        id: c.id,
        gold: c.gold,
        loaded: L,
        chosen: s.chosen,
        fallback: fb,
        missed: c.gold.filter((g) => !L.includes(g)),
        extra: L.filter((x) => !c.gold.includes(x)),
        tokens: alwaysTokens + L.reduce((t, id) => t + (tok.get(id) ?? 0), 0),
      });
    }
    const goldTotal = outcomes.reduce((s, o) => s + o.gold.length, 0);
    const hit = outcomes.reduce((s, o) => s + o.gold.length - o.missed.length, 0);
    const loadedTotal = outcomes.reduce((s, o) => s + o.loaded.length, 0);
    const withGold = outcomes.filter((o) => o.gold.length);
    const perPartMiss: VariantMetrics['perPartMiss'] = Object.fromEntries(
      allIds.map((id) => [id, { gold: 0, missed: 0 }])
    );
    for (const o of outcomes) {
      for (const g of o.gold) perPartMiss[g].gold++;
      for (const m of o.missed) perPartMiss[m].missed++;
    }
    const meanPromptTokens = outcomes.reduce((s, o) => s + o.tokens, 0) / (outcomes.length || 1);
    return {
      variant,
      n: outcomes.length,
      meanPromptTokens,
      reduction: 1 - meanPromptTokens / fullTokens,
      recall: goldTotal ? hit / goldTotal : 1,
      caseMissRate: withGold.length ? withGold.filter((o) => o.missed.length).length / withGold.length : 0,
      precision: loadedTotal ? hit / loadedTotal : null,
      fallbackRate: outcomes.filter((o) => o.fallback).length / (outcomes.length || 1),
      latencyP50: pct(latencies, 0.5),
      latencyP95: pct(latencies, 0.95),
      selectorTokensPerCall: calls ? selTokens / calls : null,
      costUsdPer1k: calls ? ((selTokens / calls) * 0.042) / 1000 : null,
      perPartMiss,
      outcomes,
    };
  });
}
