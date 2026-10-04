/**
 * Checks that the frozen inputs still match the hashes in results/v3/FROZEN.md.
 * The eval runs this before the first call and after the last one, and stores both results in the raw file.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { descriptionsHash } from './candidates.js';

/** Current (latest approved) hash per input. The pre-label test hash is superseded by the labeled one. */
export const FROZEN: { name: string; path: string | null; sha256: string }[] = [
  { name: '分類器に渡す文', path: null, sha256: '3e178125c4a72fa31d18c34ca15cca4169968acb13b155c7540b9794051c65df' },
  { name: '説明文の元ファイル', path: 'data/candidates.v3.json', sha256: '8f96ec13e047dc3e6dfda75610b293bffb73cc5e578de3b26afe77a2bf660412' },
  { name: '基準書 v3', path: 'data/LABELING.v3.md', sha256: '1bfc13c298c3bae872ccceea46f5f5d89279825924a6eea78f6278379b628ce2' },
  { name: '基準書の例', path: 'data/labeling-examples.v3.json', sha256: '6ddc2b9177314b56f272022d51666b69de6667784c2a16887d64465e63bd4fbd' },
  { name: 'test の設計', path: 'data/test-spec.v3.json', sha256: 'b6abdf54ba68d7554e725c26ca238032544269b2717baa3f21ea0b352e1dbe0a' },
  { name: 'dev の正解(v3)', path: 'data/eval.v3.dev.jsonl', sha256: 'e432acbe6a7a56f5f6f34e39ba69d4cb020a4cf6d3af1e151fd271fabfa0f7a6' },
  { name: '測定計画', path: 'results/v3/PLAN.md', sha256: '7a72e97c668698f35710079aac0b63b2f602c892cc6dc7ae6768237b5f1183f5' },
  { name: 'test の正解つき', path: 'data/eval.v3.test.jsonl', sha256: '437f6508af3eed4ee1aa3f84a1daa0ab69bc13a3c7b0e93f514613512bade9c8' },
];

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

export function checkFrozen(): { ok: boolean; items: { name: string; ok: boolean; actual: string }[] } {
  const items = FROZEN.map((f) => {
    const actual = f.path ? sha(f.path) : descriptionsHash();
    return { name: f.name, ok: actual === f.sha256, actual };
  });
  return { ok: items.every((i) => i.ok), items };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = checkFrozen();
  for (const i of r.items) console.log(`${i.ok ? 'OK ' : 'NG '} ${i.name} ${i.actual}`);
  process.exit(r.ok ? 0 : 1);
}
