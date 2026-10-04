/**
 * v3 labels from claude-opus-5-5 (Anthropic API). The labeler gets ONLY:
 *   system: the v3 labeling guide + the candidate descriptions (cached, identical for every case)
 *   user:   the case's recent turns (context) and the utterance
 * It never sees the design target, tags, or any earlier label.
 * Output: results/v3/raw/labels-claude.json ({ sets: { dev, test } }), merged per --set.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { loadEval } from '../data.js';
import { buildState } from '../jev.js';
import { fineCandidates } from './candidates.js';

export const LABEL_MODEL = 'claude-opus-5-5';
export const LABEL_EFFORT = 'high';
export const LABELER_INPUTS = ['context(直前の会話)', 'utterance(発話)'];
// $ per token, https://platform.claude.com/docs/en/about-claude/pricing (checked 2026-10-02): input 4, 5m cache write 5, cache read 0.20, output 20
const PRICE = { input: 4 / 1e6, write: 5 / 1e6, read: 0.2 / 1e6, output: 20 / 1e6 };
const PATHS: Record<string, string> = { dev: 'data/eval.v2.jsonl', test: 'data/eval.v3.test.jsonl' };

const { values: args } = parseArgs({
  options: {
    set: { type: 'string', default: 'dev' },
    limit: { type: 'string' },
    'budget-usd': { type: 'string', default: '5' },
    concurrency: { type: 'string', default: '4' },
    out: { type: 'string', default: 'results/v3/raw/labels-claude.json' },
  },
});

const cands = fineCandidates();
const ids = cands.map((c) => c.id) as [string, ...string[]];
/** Which part of the guide decided the answer: a candidate's scope, a candidate's boundary, or general rule 1-5. */
const BASES = [...ids.map((i) => `scope:${i}`), ...ids.map((i) => `boundary:${i}`), 'rule1', 'rule2', 'rule3', 'rule4', 'rule5'] as unknown as [string, ...string[]];
const Label = z.object({
  answer: z.enum(ids),
  acceptable: z.array(z.enum(ids)),
  basis: z.enum(BASES),
  reason: z.string(),
});

export const SYSTEM = `あなたは評価データのラベル付けを担当します。下の基準書だけに従って、会話の最後のユーザー発話(user_utterance)に「選ぶべきプロンプト」を付けてください。recent_turns は直前の会話です。

- answer: 選ぶべきプロンプトの id を1つ
- acceptable: それを選んでも間違いではない id(複数の分野にまたがる発話や、二通りに読める発話のときだけ。なければ空の配列)。answer と同じ id は入れない
- basis: answer を決めた一番の根拠を1つ。「scope:<id>」= その候補の「扱う範囲」に当てはまる、「boundary:<id>」= その候補の「境目」の文で決まった、「rule1」〜「rule5」= 基準書の基本ルール1〜5で決まった
- reason: 判断の理由を日本語で1文

# 候補の説明(分類器にも同じ文が渡ります)
${cands.map((c) => `- ${c.id}: ${c.description}`).join('\n')}

# 基準書
${readFileSync('data/LABELING.v3.md', 'utf8')}`;

if (import.meta.url === `file://${process.argv[1]}`) {
  let cases = loadEval(new URL(`../../${PATHS[args.set]}`, import.meta.url));
  if (args.limit) cases = cases.slice(0, Number(args.limit));
  const client = new Anthropic(process.env.ANTHROPIC_WORKSPACE_ID ? { defaultHeaders: { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID } } : {});
  const budget = Number(args['budget-usd']);
  let spent = 0;
  let stopped = false;
  const out: Record<string, unknown>[] = [];

  const labelOne = async (c: (typeof cases)[number]) => {
    // only context + utterance reach the labeler
    const state = buildState(c.context, c.utterance, 'ja');
    const res = await client.messages.parse({
      model: LABEL_MODEL,
      max_tokens: 16000,
      output_config: { effort: LABEL_EFFORT, format: zodOutputFormat(Label) },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: JSON.stringify(state, null, 2) }],
    });
    const u = res.usage;
    const write = u.cache_creation_input_tokens ?? 0;
    const read = u.cache_read_input_tokens ?? 0;
    spent += u.input_tokens * PRICE.input + write * PRICE.write + read * PRICE.read + u.output_tokens * PRICE.output;
    const p = res.stop_reason === 'refusal' ? null : res.parsed_output;
    return {
      id: c.id,
      answer: p?.answer ?? null,
      acceptable: (p?.acceptable ?? []).filter((a) => a !== p?.answer),
      basis: p?.basis ?? null,
      reason: p?.reason ?? null,
      stop_reason: res.stop_reason,
      usage: { input_tokens: u.input_tokens, cache_write: write, cache_read: read, output_tokens: u.output_tokens },
    };
  };

  // first call alone so the cache is written once, then the rest in parallel
  const queue = [...cases];
  const first = queue.shift();
  if (first) out.push(await labelOne(first));
  await Promise.all(
    Array.from({ length: Number(args.concurrency) }, async () => {
      for (let c = queue.shift(); c && !stopped; c = queue.shift()) {
        if (spent >= budget) {
          stopped = true;
          break;
        }
        try {
          out.push(await labelOne(c));
          process.stdout.write('.');
        } catch (e) {
          if (e instanceof Anthropic.AuthenticationError) throw new Error('ANTHROPIC_API_KEY is missing or invalid');
          out.push({ id: c.id, answer: null, acceptable: [], basis: null, reason: null, error: (e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : String(e)).slice(0, 200) });
          process.stdout.write('x');
        }
      }
    })
  );
  console.log();
  const order = new Map(cases.map((c, i) => [c.id, i]));
  out.sort((a, b) => (order.get(a.id as string) ?? 0) - (order.get(b.id as string) ?? 0));

  mkdirSync('results/v3/raw', { recursive: true });
  const file = existsSync(args.out) ? (JSON.parse(readFileSync(args.out, 'utf8')) as { sets: Record<string, unknown> }) : { sets: {} };
  file.sets[args.set] = { labeledAt: new Date().toISOString(), n: out.length, spentUsd: spent, stoppedByBudget: stopped, labels: out };
  writeFileSync(args.out, `${JSON.stringify({ model: LABEL_MODEL, effort: LABEL_EFFORT, inputs: LABELER_INPUTS, guide: 'data/LABELING.v3.md', descriptions: 'data/candidates.v3.json', sets: file.sets }, null, 2)}\n`);
  const reads = out.reduce((s, o) => s + (((o.usage as { cache_read?: number }) ?? {}).cache_read ?? 0), 0);
  console.log(`${args.set}: ${out.length} labels, missing ${out.filter((o) => !o.answer).length}, cache read ${reads} tok, spent≈$${spent.toFixed(3)} → ${args.out}${stopped ? ' (STOPPED by budget)' : ''}`);
}
