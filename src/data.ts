import { readFileSync } from 'node:fs';

export interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

export interface EvalCase {
  id: string;
  context: Turn[];
  utterance: string;
  /** The one prompt that should be chosen: a selectable part id, or BASE. */
  answer: string;
  /** Other prompts that are also acceptable (utterances spanning several topics). */
  acceptable: string[];
  tags: string[];
  note?: string;
}

export function loadEval(path = new URL('../data/eval.jsonl', import.meta.url)): EvalCase[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as EvalCase);
}
