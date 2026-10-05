/**
 * Generates the v3 test utterances with Claude Sonnet 5.5 — a model that is neither one of the
 * compared LLMs (gpt-5.4-nano / gpt-6-luna / gpt-6-sol) nor the labeler (claude-opus-5-5).
 * The generator gets its own short class definitions (not the classifiers' descriptions),
 * the slot design, and a do-not-repeat list (dev + LABELING examples). No labels are produced here.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { loadEval } from '../data.js';
import { slots, type Slot } from './testSpec.js';

export const GEN_MODEL = 'claude-sonnet-5-5';
const PRICE = { input: 2 / 1e6, output: 10 / 1e6 }; // https://platform.claude.com/docs/en/about-claude/pricing (checked 2026-10-02)

/** Generator-only definitions, written separately from data/candidates.v3.json on purpose. */
export const GEN_DEFINITIONS: Record<string, string> = {
  search_conditions: '仕事を探したい。条件を伝えたり変えたりする',
  query_normalization: '地名や職種の呼び方そのものについて知りたい(略称が何を指すか、正しい呼び方)。仕事探しそのものではない',
  company_info: '特定の会社の公式な情報(事業・規模・制度・公開されている数字)を知りたい',
  reviews: '特定の会社について、働いた人の感想や評判を知りたい、または自分で投稿したい',
  salary_benefits: 'お金や休み、手当などの待遇について知りたい・相談したい',
  career_advice: '転職するかどうかや、自分の向き不向き、これからの方向性に迷っている',
  application_docs: '履歴書などの応募のための文章を書きたい・直したい',
  interview_prep: '面接に向けて準備したい・練習したい',
  account_terms: 'サービスのアカウントや設定、規約、料金について知りたい',
  error_handling: 'サービスの画面やボタンがおかしい、エラーが出ると伝える',
  out_of_scope: '仕事探しやキャリアとは関係のない話や、引き受けられない依頼',
  base: '特別な知識がなくても普通に返せる一言(あいさつ、お礼、短い返事、ツールの操作だけで済む依頼など)',
};

const TAG_RULES: Record<string, string> = {
  colloquial: 'くだけた話し言葉にする(友だちに話すような言い方、語尾の省略など)',
  context: '直前の会話を1〜2往復(context)付け、今回の発話はその会話がないと意味が決まらないようにする',
  boundary: '「boundaryWith」の分類とまぎらわしいが、target の分類が正解になる発話にする',
  typo: '誤字・変換ミス・ひらがな書きを1か所入れる',
  qn_purpose: '仕事探しではなく、呼び方そのものを知ることが目的の発話にする',
  topic_listed: 'brief に書いた話題を使う',
  topic_unlisted: 'brief に書いた話題を使う(ほかの話題に変えない)',
};

const { values: args } = parseArgs({ options: { 'budget-usd': { type: 'string', default: '2' }, only: { type: 'string' }, slots: { type: 'string' },
  // --dump <file>: write the exact prompt instead of calling the API (to run it in a Claude Code subagent)
  dump: { type: 'string' },
  // --import <file>: merge items produced elsewhere (e.g. by a Claude Code subagent) instead of calling the API
  import: { type: 'string' }, source: { type: 'string' } } });

if (import.meta.url === `file://${process.argv[1]}`) {
  const dev = loadEval(new URL('../../data/eval.v2.jsonl', import.meta.url));
  const examples = (JSON.parse(readFileSync('data/labeling-examples.v3.json', 'utf8')) as { examples: { utterance: string }[] }).examples;
  const avoid = [...dev.map((c) => c.utterance), ...examples.map((e) => e.utterance)];
  const system = `あなたは、架空の求人情報サービス「ハタラクラフト」のチャットで、求職者がアシスタントに送る発話を作る担当です。評価データに使います。

# 守ること
- 実在の会社名・人名・個人情報は使わない。会社名が必要なら、次の架空の名前だけを使う: Hテック、Wフード、Yリンク、Bメディア、Qロジスティクス、Lクリニック
- 自然な日本語の、実際にチャットで送られそうな長さ(だいたい60字以内)にする
- 下の「作らない発話」と同じ依頼(言い回しを変えただけのもの)は作らない。分類が同じでも、依頼の中身(条件・知りたいこと・頼むこと)は変える
- 正解のラベルや分類名を発話に書かない
- context を付けるときは、role が user と assistant の発話を古い順に並べ、最後は assistant にする

# 分類の意味(target と boundaryWith に出てくるもの)
${Object.entries(GEN_DEFINITIONS).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

# tags の意味
${Object.entries(TAG_RULES).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

# 作らない発話(これらと同じ依頼にしない)
${avoid.map((u) => `- ${u}`).join('\n')}`;

  const groupsFor = () => {
    const g = new Map<string, Slot[]>();
    const w = args.slots ? new Set(args.slots.split(',')) : null;
    for (const sl of slots) if (!w || w.has(sl.slot)) g.set(sl.target, [...(g.get(sl.target) ?? []), sl]);
    return g;
  };
  const taskFor = (target: string, group: Slot[]) =>
    `次の枠それぞれに、発話を1つずつ作ってください。枠は${group.length}個です。\n\n${JSON.stringify(group.map(({ slot, brief, tags, boundaryWith }) => ({ slot, target, brief, tags, boundaryWith: boundaryWith ?? null })), null, 2)}`;
  if (args.dump) {
    const tasks = [...groupsFor()].map(([t, g]) => taskFor(t, g)).join('\n\n');
    writeFileSync(args.dump, `# system\n\n${system}\n\n# user\n\n${tasks}\n\n# 出力の形式\n\n{"items": [{"slot": "t001", "context": [{"role": "user" | "assistant", "text": "..."}], "utterance": "..."}]} の JSON だけを返す\n`);
    console.log(`prompt written to ${args.dump}`);
    process.exit(0);
  }
  if (args.import) {
    const imported = (JSON.parse(readFileSync(args.import, 'utf8')) as { items: { slot: string; context: { role: 'user' | 'assistant'; text: string }[]; utterance: string }[] }).items;
    const w = new Set(args.slots?.split(',') ?? []);
    const prevAll = JSON.parse(readFileSync('results/v3/raw/test-generation.json', 'utf8')) as { items: typeof imported; rounds?: unknown[] };
    const missing = [...w].filter((x) => !imported.some((i) => i.slot === x));
    if (missing.length) throw new Error(`import: missing ${missing.join(',')}`);
    const bad = imported.filter((i) => !w.has(i.slot) || (i.context.length && i.context.at(-1)?.role !== 'assistant') || !i.utterance.trim());
    if (bad.length) throw new Error(`import: invalid items ${bad.map((b) => b.slot).join(',')}`);
    const merged = [...prevAll.items.filter((i) => !w.has(i.slot)), ...imported].sort((a, b) => a.slot.localeCompare(b.slot));
    const rounds = [...(prevAll.rounds ?? []), { at: new Date().toISOString(), regenerated: [...w], source: args.source ?? 'imported', replaced: prevAll.items.filter((i) => w.has(i.slot)) }];
    writeFileSync('results/v3/raw/test-generation.json', `${JSON.stringify({ model: GEN_MODEL, effort: 'medium', generatedAt: new Date().toISOString(), rounds, items: merged }, null, 2)}\n`);
    const bySlot = new Map(slots.map((sl) => [sl.slot, sl]));
    writeFileSync('data/eval.v3.test.jsonl', `${merged.map((o) => { const sl = bySlot.get(o.slot) as Slot; return JSON.stringify({ id: o.slot, context: o.context, utterance: o.utterance, tags: sl.tags, design: { target: sl.target, boundaryWith: sl.boundaryWith ?? null, brief: sl.brief } }); }).join('\n')}\n`);
    console.log(`imported ${imported.length} items → data/eval.v3.test.jsonl`);
    process.exit(0);
  }
  const client = new Anthropic(process.env.ANTHROPIC_WORKSPACE_ID ? { defaultHeaders: { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID } } : {});
  const groups = new Map<string, Slot[]>();
  // --slots t005,t011: regenerate only these slots and keep the rest from the previous run
  const want = args.slots ? new Set(args.slots.split(',')) : null;
  const prev = want ? (JSON.parse(readFileSync('results/v3/raw/test-generation.json', 'utf8')) as { items: { slot: string; context: { role: 'user' | 'assistant'; text: string }[]; utterance: string }[]; rounds?: unknown[] }) : null;
  for (const s of slots) if (!want || want.has(s.slot)) groups.set(s.target, [...(groups.get(s.target) ?? []), s]);
  const budget = Number(args['budget-usd']);
  let spent = 0;
  const out: { slot: string; context: { role: 'user' | 'assistant'; text: string }[]; utterance: string }[] = [];
  for (const [target, group] of groups) {
    if (args.only && !args.only.split(',').includes(target)) continue;
    if (spent >= budget) throw new Error(`budget $${budget} reached`);
    const Item = z.object({
      slot: z.enum(group.map((g) => g.slot) as [string, ...string[]]),
      context: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string() })),
      utterance: z.string(),
    });
    const res = await client.messages.parse({
      model: GEN_MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium', format: zodOutputFormat(z.object({ items: z.array(Item) })) },
      system,
      messages: [{ role: 'user', content: `次の枠それぞれに、発話を1つずつ作ってください。枠は${group.length}個です。\n\n${JSON.stringify(group.map(({ slot, brief, tags, boundaryWith }) => ({ slot, target, brief, tags, boundaryWith: boundaryWith ?? null })), null, 2)}` }],
    });
    spent += res.usage.input_tokens * PRICE.input + res.usage.output_tokens * PRICE.output;
    const items = res.parsed_output?.items ?? [];
    const missing = group.filter((g) => !items.some((i) => i.slot === g.slot));
    if (missing.length) throw new Error(`${target}: missing ${missing.map((m) => m.slot).join(',')} (stop_reason ${res.stop_reason})`);
    for (const g of group) out.push(items.find((i) => i.slot === g.slot) as (typeof out)[number]);
    console.log(`${target}: ${group.length} (spent≈$${spent.toFixed(3)})`);
  }
  if (prev) for (const it of prev.items) if (!out.some((o) => o.slot === it.slot)) out.push(it);
  out.sort((a, b) => a.slot.localeCompare(b.slot));
  mkdirSync('results/v3/raw', { recursive: true });
  // keep every round (what was regenerated and what it replaced), so the history stays inspectable
  const rounds = [...(prev?.rounds ?? []), { at: new Date().toISOString(), regenerated: want ? [...want] : 'all', spentUsd: spent, replaced: prev ? prev.items.filter((i) => want?.has(i.slot)) : [] }];
  writeFileSync('results/v3/raw/test-generation.json', `${JSON.stringify({ model: GEN_MODEL, effort: 'medium', generatedAt: new Date().toISOString(), rounds, items: out }, null, 2)}\n`);
  // the test set itself: utterances + design info only (labels are added in step 4)
  const bySlot = new Map(slots.map((s) => [s.slot, s]));
  writeFileSync(
    'data/eval.v3.test.jsonl',
    `${out.map((o) => { const s = bySlot.get(o.slot) as Slot; return JSON.stringify({ id: o.slot, context: o.context, utterance: o.utterance, tags: s.tags, design: { target: s.target, boundaryWith: s.boundaryWith ?? null, brief: s.brief } }); }).join('\n')}\n`
  );
  console.log(`items=${out.length} spent≈$${spent.toFixed(3)} → data/eval.v3.test.jsonl`);
}
