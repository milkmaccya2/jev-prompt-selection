/**
 * Independent labels from Claude, given only the v2 labeling guide, the candidate descriptions,
 * and each case's conversation. The original labels are never sent.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { loadEval } from '../data.js';
import { buildState } from '../jev.js';
import { fineCandidates } from './candidates.js';

const MODEL = 'claude-opus-5-5';
// $ per token, https://platform.claude.com/docs/en/about-claude/pricing (checked 2026-10-02)
const PRICE = { input: 4 / 1e6, output: 20 / 1e6 };

const { values: args } = parseArgs({
  options: {
    limit: { type: 'string' },
    'budget-usd': { type: 'string', default: '5' },
    concurrency: { type: 'string', default: '4' },
    out: { type: 'string', default: 'results/v2/raw/labels-claude.json' },
  },
});

const candidates = fineCandidates();
const ids = candidates.map((c) => c.id) as [string, ...string[]];
const Label = z.object({
  answer: z.enum(ids),
  acceptable: z.array(z.enum(ids)),
  reason: z.string(),
});

const system = `あなたは評価データのラベル付けを担当します。下の基準書だけに従って、会話の最後のユーザー発話に「選ぶべきシステムプロンプト」を付けてください。

- answer: 選ぶべきプロンプトの id を1つ
- acceptable: それを選んでも間違いではない id(複数の分野にまたがる発話のときだけ。なければ空の配列)。answer と同じ id は入れない
- reason: 判断の理由を日本語で1文

# 候補の説明(分類器にも同じ文が渡ります)
${candidates.map((c) => `- ${c.id}: ${c.description}`).join('\n')}

# 基準書
${readFileSync('data/LABELING.v2.md', 'utf8')}`;

let cases = loadEval();
if (args.limit) cases = cases.slice(0, Number(args.limit));

// Keys that are not scoped to a workspace must name one (API error: "must include the anthropic-workspace-id header").
const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
const client = new Anthropic(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {});
const budget = Number(args['budget-usd']);
let spent = 0;
let stopped = false;
const out: Record<string, unknown>[] = [];

async function labelOne(c: (typeof cases)[number]) {
  const state = buildState(c.context, c.utterance, 'ja');
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: 'high', format: zodOutputFormat(Label) },
    system,
    messages: [{ role: 'user', content: JSON.stringify(state, null, 2) }],
  });
  spent += res.usage.input_tokens * PRICE.input + res.usage.output_tokens * PRICE.output;
  const parsed = res.stop_reason === 'refusal' ? null : res.parsed_output;
  return {
    id: c.id,
    answer: parsed?.answer ?? null,
    acceptable: (parsed?.acceptable ?? []).filter((a) => a !== parsed?.answer),
    reason: parsed?.reason ?? null,
    stop_reason: res.stop_reason,
    usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens },
  };
}

const queue = [...cases];
await Promise.all(
  Array.from({ length: Number(args.concurrency) }, async () => {
    for (let c = queue.shift(); c && !stopped; c = queue.shift()) {
      if (spent >= budget) {
        stopped = true;
        break;
      }
      try {
        out.push(await labelOne(c));
        process.stdout.write(`${c.id} `);
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) throw new Error('ANTHROPIC_API_KEY is missing or invalid');
        out.push({ id: c.id, answer: null, acceptable: [], reason: null, error: String(e).slice(0, 200) });
        process.stdout.write(`${c.id}(err) `);
      }
    }
  })
);
console.log();

const order = new Map(cases.map((c, i) => [c.id, i]));
out.sort((a, b) => (order.get(a.id as string) ?? 0) - (order.get(b.id as string) ?? 0));
mkdirSync('results/v2/raw', { recursive: true });
writeFileSync(
  args.out,
  `${JSON.stringify({ model: MODEL, effort: 'high', labeledAt: new Date().toISOString(), spentUsd: spent, stoppedByBudget: stopped, labels: out }, null, 2)}\n`
);
console.log(`labels=${out.length} spent≈$${spent.toFixed(3)} → ${args.out}${stopped ? ' (STOPPED by budget)' : ''}`);
