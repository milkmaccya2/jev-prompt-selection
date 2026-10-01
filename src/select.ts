import { BASE, type CallResult, type ConfigId } from './jev.js';

/** Confidence cut-offs to compare: below the cut-off we do not trust the pick and load everything. */
export const CUTOFFS = [0, 0.5, 0.7, 0.9];
/** noul_ja picks the top part when its probability is at least this, else the base prompt. */
export const NOUL_MIN = 0.5;

export interface Pick {
  chosen: string;
  confidence: number;
}

/** One prompt per call. choice: the answer itself; noul: the most probable part (or base). */
export function pickPrompt(r: CallResult | undefined, config: ConfigId): Pick | null {
  if (!r?.ok) return null;
  if (config !== 'noul_ja') return { chosen: r.choice as string, confidence: r.confidence ?? 0 };
  const [id, p] = Object.entries(r.probs).sort((a, b) => b[1] - a[1])[0];
  return p >= NOUL_MIN ? { chosen: id, confidence: p } : { chosen: BASE, confidence: 1 - p };
}

export type Decision =
  | { kind: 'prompt'; chosen: string; confidence: number }
  | { kind: 'fallback'; reason: 'error' | 'low_confidence'; chosen?: string; confidence?: number };

/** Escape hatch: on an error or a low-confidence pick, load every part instead. */
export function decide(pick: Pick | null, cutoff: number): Decision {
  if (!pick) return { kind: 'fallback', reason: 'error' };
  if (pick.confidence < cutoff) return { kind: 'fallback', reason: 'low_confidence', ...pick };
  return { kind: 'prompt', ...pick };
}
