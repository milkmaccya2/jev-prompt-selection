import { type CallResult, NONE } from './jev.js';

export const THRESHOLDS = [0.2, 0.3, 0.5, 0.7];

/** "Not sure" escape hatch: fall back to loading every part. */
export const FALLBACK = {
  /** noul values inside this band count as "uncertain". */
  uncertainBand: [0.35, 0.65] as const,
  /** Fall back when at least this many parts are uncertain. */
  uncertainMin: 3,
  /** choice: fall back when confidence is below this. */
  choiceMinConfidence: 0.3,
};

export type FallbackReason = 'error' | 'uncertain' | 'low_confidence';

export interface Selection {
  /** Parts chosen by the selector itself (before fallback). */
  chosen: string[];
  /** Why we fell back to all parts, or null. */
  fallback: FallbackReason | null;
}

export function selectNoul(r: CallResult, threshold: number): Selection {
  if (!r.ok) return { chosen: [], fallback: 'error' };
  const chosen = Object.entries(r.probs)
    .filter(([, p]) => p >= threshold)
    .map(([id]) => id);
  const [lo, hi] = FALLBACK.uncertainBand;
  const uncertain = Object.values(r.probs).filter((p) => p >= lo && p <= hi).length;
  return { chosen, fallback: uncertain >= FALLBACK.uncertainMin ? 'uncertain' : null };
}

export function selectChoice(r: CallResult): Selection {
  if (!r.ok || !r.choice) return { chosen: [], fallback: 'error' };
  const chosen = r.choice === NONE ? [] : [r.choice];
  const low = (r.confidence ?? 0) < FALLBACK.choiceMinConfidence;
  return { chosen, fallback: low ? 'low_confidence' : null };
}

/** Parts actually loaded. Errors always fall back; other reasons only when the hatch is on. */
export function loaded(s: Selection, allIds: string[], useFallback: boolean): string[] {
  if (s.fallback === 'error' || (useFallback && s.fallback)) return allIds;
  return s.chosen;
}
