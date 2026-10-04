/**
 * Writes the approved v3 ground truth (step 4, 2026-10-04):
 *  - data/eval.v3.dev.jsonl  : dev utterances + v3 answer/acceptable (+ v1/v2 labels for reference)
 *  - data/eval.v3.test.jsonl : the frozen test utterances + v3 answer/acceptable
 * Refuses to write test if anything other than the label fields would change.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

interface Lab { id: string; answer: string; acceptable: string[]; basis: string; reason: string }
const labels = JSON.parse(readFileSync('results/v3/raw/labels-claude.json', 'utf8')) as { sets: Record<string, { labels: Lab[] }> };
const read = (p: string) => readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const byId = (set: string) => new Map(labels.sets[set].labels.map((l) => [l.id, l]));

const devLab = byId('dev');
const v1 = new Map(read('data/eval.jsonl').map((c) => [c.id, c]));
const dev = read('data/eval.v2.jsonl').map((c) => {
  const l = devLab.get(c.id) as Lab;
  if (!l?.answer) throw new Error(`dev ${c.id}: no label`);
  const p1 = v1.get(c.id);
  return { id: c.id, context: c.context, utterance: c.utterance, answer: l.answer, acceptable: l.acceptable, tags: c.tags, label: { basis: l.basis, reason: l.reason }, previous: { v1: { answer: p1.answer, acceptable: p1.acceptable }, v2: { answer: c.answer, acceptable: c.acceptable } } };
});
writeFileSync('data/eval.v3.dev.jsonl', `${dev.map((d) => JSON.stringify(d)).join('\n')}\n`);

const frozenKey = (c: { id: string; context: unknown; utterance: string; tags: unknown; design: unknown }) => JSON.stringify([c.id, c.context, c.utterance, c.tags, c.design]);
const testLab = byId('test');
const before = read('data/eval.v3.test.jsonl');
const after = before.map((c) => {
  const l = testLab.get(c.id) as Lab;
  if (!l?.answer) throw new Error(`test ${c.id}: no label`);
  return { id: c.id, context: c.context, utterance: c.utterance, answer: l.answer, acceptable: l.acceptable, tags: c.tags, design: c.design, label: { basis: l.basis, reason: l.reason } };
});
const h = (xs: { id: string; context: unknown; utterance: string; tags: unknown; design: unknown }[]) => createHash('sha256').update(xs.map(frozenKey).join('\n')).digest('hex');
if (h(before) !== h(after)) throw new Error('test: non-label fields would change; refusing to write');
writeFileSync('data/eval.v3.test.jsonl', `${after.map((d) => JSON.stringify(d)).join('\n')}\n`);
console.log(`dev ${dev.length}, test ${after.length}; test utterance/context/tags/design unchanged (sha256 ${h(after).slice(0, 12)}…)`);
