/** Writes results/v3/description-diff.md: what each classifier saw in v2 vs what it will see in v3. */
import { readFileSync, writeFileSync } from 'node:fs';
import { candidatesFor as v2Candidates } from '../v2/candidates.js';
import { loadEval } from '../data.js';
import { candidatesFor, descriptionsHash, instruction } from './candidates.js';
import { findLeaks } from './leak.js';

const V2_INSTRUCTION =
  'アシスタントが `user_utterance` に答えるときに使うシステムプロンプトを1つ選んでください。`recent_turns` は直前の会話の文脈です。';

const section = (g: 'fine' | 'coarse') => {
  const before = new Map(v2Candidates(g).map((c) => [c.id, c.description]));
  return candidatesFor(g)
    .map((c) => `### \`${c.id}\`\n\n- v2: ${before.get(c.id) ?? '(なし)'}\n- **v3: ${c.description}**\n`)
    .join('\n');
};

const dev = loadEval(new URL('../../data/eval.v2.jsonl', import.meta.url));
const textsOf = (ins: string, get: (g: 'fine' | 'coarse') => { id: string; description: string }[]) => [
  { name: '指示文', text: ins },
  ...(['fine', 'coarse'] as const).flatMap((g) => get(g).map((c) => ({ name: `${g === 'fine' ? '12候補' : '6分類'} ${c.id}`, text: c.description }))),
];
const leakTable = (hits: ReturnType<typeof findLeaks>) =>
  hits.length
    ? ['| dev の id | 発話 | 一致した場所 | 一致した部分 |', '|---|---|---|---|', ...hits.map((h) => `| ${h.id} | ${h.utterance} | ${h.where} | 「${h.piece}」 |`)].join('\n')
    : '一致なし(0件)';

const md = `# 説明文の修正差分(v2 → v3)

分類器(Jev・LLM すべて)に渡す文の、v2 と v3 の比較です。v3 の説明文は \`data/candidates.v3.json\` だけを元にしており、プロンプトの部品(\`prompts/\`)の frontmatter からは切り離しました(v2 は今のまま再現できます)。

## 指示文

- v2: ${V2_INSTRUCTION}
- **v3: ${instruction()}**

## 12候補

${section('fine')}
## 6分類

6分類の説明文は、v3 の12候補の「扱う範囲」(scope)をつないで作り直しました。12候補の「境目」(boundary)は12候補の id を参照しているので入れず、6分類どうしの境目だけを書いています。

${section('coarse')}
## 評価データの発話との照合(dev 100件)

dev の発話を空白・記号を除いて正規化し、その連続6文字以上が説明文・指示文に含まれていないかを機械的に調べました(\`src/v3/leak.ts\`)。test はまだ無いので、test を作ったあとにもう一度調べます。

### v2 の説明文

${leakTable(findLeaks(dev, textsOf(V2_INSTRUCTION, v2Candidates)))}

### v3 の説明文

${leakTable(findLeaks(dev, textsOf(instruction(), candidatesFor)))}

## ハッシュ

\`sha256: ${descriptionsHash()}\`(指示文・12候補・6分類の説明文。2026-10-04 に承認・凍結。\`results/v3/FROZEN.md\` 参照)
`;
writeFileSync('results/v3/description-diff.md', md);
console.log('results/v3/description-diff.md written');
