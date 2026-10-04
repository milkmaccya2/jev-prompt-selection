/**
 * Semantic leak check: for each eval utterance, a model other than the labeler (OpenAI gpt-6-sol)
 * judges whether any LABELING.v3 example is "the same request, just reworded".
 * Output: results/v3/raw/semantic-leak-<set>.json (rendered by src/v3/leakCheck.ts).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import OpenAI from 'openai';
import { loadEval } from '../data.js';
import { JUDGE, SAME_REQUEST_CRITERIA } from './sameRequest.js';

export const JUDGE_MODEL = JUDGE.model;
export const JUDGE_EFFORT = JUDGE.effort;
// $ per token, results/v2/PRICING.md (checked 2026-10-02)
const PRICE = { input: 2 / 1e6, cached: 0.2 / 1e6, write: 2.5 / 1e6, output: 10 / 1e6 };

const { values: args } = parseArgs({
  options: {
    set: { type: 'string', default: 'dev' },
    // what to compare against: the LABELING.v3 examples (required check) or the dev set (reference check for test)
    against: { type: 'string', default: 'examples' },
    'budget-usd': { type: 'string', default: '2' },
    concurrency: { type: 'string', default: '4' },
  },
});
const PATHS: Record<string, string> = { dev: 'data/eval.v2.jsonl', test: 'data/eval.v3.test.jsonl' };

interface Ex { utterance: string; context?: { role: string; text: string }[] }
const examplesRaw = readFileSync('data/labeling-examples.v3.json', 'utf8');
const examples = (JSON.parse(examplesRaw) as { examples: Ex[] }).examples;
const examplesHash = createHash('sha256').update(examplesRaw).digest('hex');
const speak = (r: string) => (r === 'user' ? 'ユーザー' : 'アシスタント');
const devCases = args.against === 'dev' ? loadEval(new URL('../../data/eval.v2.jsonl', import.meta.url)) : [];
const pool: Ex[] = args.against === 'dev' ? devCases.map((c) => ({ utterance: c.utterance, context: c.context })) : examples;
const poolIds = args.against === 'dev' ? devCases.map((c) => c.id) : examples.map((_, i) => `ex${i}`);
const exList = pool.map((e, i) => ({ index: i, recent_turns: (e.context ?? []).map((t) => ({ speaker: speak(t.role), text: t.text })), utterance: e.utterance }));

const poolName = args.against === 'dev' ? '別の評価データ(dev)の発話' : '基準書に載っている例の発話';
const system = `あなたは、評価データの発話が、ほかの文書の発話と重なっていないかを調べる担当です。評価データの発話1件と、${poolName}の一覧(examples)が渡されます。
一覧のうち、評価データの発話と「同じ依頼を言い換えただけ」のものをすべて挙げてください。なければ空の配列を返してください。分類が同じだけのもの、話題が似ているだけのものは挙げないでください。

# 「同じ依頼」の基準
${SAME_REQUEST_CRITERIA}`;

const schema = {
  type: 'object',
  properties: {
    matches: {
      type: 'array',
      items: {
        type: 'object',
        properties: { example_index: { type: 'integer', enum: exList.map((e) => e.index) }, reason: { type: 'string' } },
        required: ['example_index', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['matches'],
  additionalProperties: false,
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const cases = loadEval(new URL(`../../${PATHS[args.set]}`, import.meta.url));
  const client = new OpenAI();
  const budget = Number(args['budget-usd']);
  let spent = 0;
  const out: { id: string; utterance: string; matches: { example_index: number; example: string; reason: string }[]; error?: string }[] = [];
  const queue = [...cases];
  await Promise.all(
    Array.from({ length: Number(args.concurrency) }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        if (spent >= budget) break;
        try {
          const res = await client.chat.completions.create({
            model: JUDGE_MODEL,
            reasoning_effort: JUDGE_EFFORT,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: JSON.stringify({ eval: { recent_turns: c.context.map((t) => ({ speaker: speak(t.role), text: t.text })), user_utterance: c.utterance }, examples: exList }) },
            ],
            response_format: { type: 'json_schema', json_schema: { name: 'same_request', strict: true, schema } },
          });
          const u = res.usage;
          const cached = u?.prompt_tokens_details?.cached_tokens ?? 0;
          const written = (u?.prompt_tokens_details as { cache_write_tokens?: number } | undefined)?.cache_write_tokens ?? 0;
          spent += ((u?.prompt_tokens ?? 0) - cached - written) * PRICE.input + cached * PRICE.cached + written * PRICE.write + (u?.completion_tokens ?? 0) * PRICE.output;
          const parsed = JSON.parse(res.choices[0]?.message.content ?? '{"matches":[]}') as { matches: { example_index: number; reason: string }[] };
          out.push({ id: c.id, utterance: c.utterance, matches: parsed.matches.map((m) => ({ ...m, example: pool[m.example_index].utterance, exampleId: poolIds[m.example_index] })) });
        } catch (e) {
          out.push({ id: c.id, utterance: c.utterance, matches: [], error: String(e).slice(0, 200) });
        }
        process.stdout.write('.');
      }
    })
  );
  console.log();
  out.sort((a, b) => a.id.localeCompare(b.id));
  mkdirSync('results/v3/raw', { recursive: true });
  const file = args.against === 'dev' ? `results/v3/raw/semantic-${args.set}-vs-dev.json` : `results/v3/raw/semantic-leak-${args.set}.json`;
  writeFileSync(file, `${JSON.stringify({ set: args.set, against: args.against, judge: JUDGE_MODEL, effort: JUDGE_EFFORT, checkedAt: new Date().toISOString(), examplesSha256: examplesHash, spentUsd: spent, n: out.length, results: out }, null, 2)}\n`);
  const hits = out.filter((o) => o.matches.length);
  console.log(`${file}: ${out.length} judged, ${hits.length} with matches, errors ${out.filter((o) => o.error).length}, spent≈$${spent.toFixed(3)}`);
  for (const h of hits) for (const m of h.matches) console.log(`${h.id} 「${h.utterance}」 ⇔ 例「${m.example}」: ${m.reason}`);
}
