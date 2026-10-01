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
  /** Selection hints; empty for always-on parts. */
  use_when: string;
  use_when_en: string;
  not_when: string;
  not_when_en: string;
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
      if (data.kind === 'selectable') {
        for (const k of ['use_when', 'use_when_en', 'not_when', 'not_when_en']) {
          if (!data[k]) throw new Error(`${f}: missing ${k}`);
        }
      }
      const hints = { use_when: '', use_when_en: '', not_when: '', not_when_en: '' };
      return {
        ...hints,
        ...(data as Partial<Part> & Pick<Part, 'id' | 'kind' | 'summary' | 'summary_en'>),
        lines: body.split('\n').length,
        tokens: countTokens(body),
        body,
      };
    });
}

export const selectable = (parts: Part[]) => parts.filter((p) => p.kind === 'selectable');
export const always = (parts: Part[]) => parts.filter((p) => p.kind === 'always');
