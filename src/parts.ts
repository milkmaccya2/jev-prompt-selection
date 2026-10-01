import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { countTokens } from 'gpt-tokenizer'; // o200k_base: proxy tokenizer, see README
import matter from 'gray-matter';

export type PartKind = 'always' | 'selectable';

export interface Part {
  id: string;
  kind: PartKind;
  summary: string;
  summary_en: string;
  use_when?: string;
  use_when_en?: string;
  not_when?: string;
  not_when_en?: string;
  lines: number;
  tokens: number;
  body: string;
}

export const PROMPTS_DIR = new URL('../prompts/', import.meta.url).pathname;

export function loadParts(): Part[] {
  return readdirSync(PROMPTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => {
      const { data, content } = matter(readFileSync(join(PROMPTS_DIR, f), 'utf8'));
      const body = content.trim();
      return {
        ...(data as Omit<Part, 'lines' | 'tokens' | 'body'>),
        lines: body.split('\n').length,
        tokens: countTokens(body),
        body,
      };
    });
}

export const selectable = (parts: Part[]) => parts.filter((p) => p.kind === 'selectable');
export const always = (parts: Part[]) => parts.filter((p) => p.kind === 'always');
