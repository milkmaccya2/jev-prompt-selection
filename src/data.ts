import { readFileSync } from 'node:fs';

export interface Turn {
  role: 'user' | 'assistant';
  text: string;
}

export interface EvalCase {
  id: string;
  context: Turn[];
  utterance: string;
  gold: string[];
  tags: string[];
  note?: string;
}

export function loadEval(path = new URL('../data/eval.jsonl', import.meta.url)): EvalCase[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as EvalCase);
}
