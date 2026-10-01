import { BASE, type CallResult, type ConfigId } from './jev.js';

/** noul_ja picks the top part when its probability is at least this, else the base prompt. */
export const NOUL_MIN = 0.5;

export interface Pick {
  chosen: string;
  confidence: number | null;
  /** True when Jev could not be used (API error/timeout); the base prompt is used instead. */
  failed: boolean;
}

/** One prompt per call. choice: the answer itself; noul: the most probable part (or base). */
export function pickPrompt(r: CallResult | undefined, config: ConfigId): Pick {
  if (!r?.ok) return { chosen: BASE, confidence: null, failed: true };
  if (config !== 'noul_ja') return { chosen: r.choice as string, confidence: r.confidence ?? 0, failed: false };
  const [id, p] = Object.entries(r.probs).sort((a, b) => b[1] - a[1])[0];
  return p >= NOUL_MIN
    ? { chosen: id, confidence: p, failed: false }
    : { chosen: BASE, confidence: 1 - p, failed: false };
}
