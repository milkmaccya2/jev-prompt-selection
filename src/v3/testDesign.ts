/** Writes results/v3/test-design.md and results/v3/test-samples.md from the spec and the generated test set. */
import { readFileSync, writeFileSync } from 'node:fs';
import { GEN_DEFINITIONS, GEN_MODEL } from './genTest.js';
import { JUDGE, SAME_REQUEST_CRITERIA } from './sameRequest.js';
import { slots } from './testSpec.js';

interface T { id: string; context: { role: string; text: string }[]; utterance: string; tags: string[]; design: { target: string; boundaryWith: string | null; brief: string } }
const test = readFileSync('data/eval.v3.test.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l) as T);
const gen = JSON.parse(readFileSync('results/v3/raw/test-generation.json', 'utf8')) as { rounds: { at: string; regenerated: string[] | string; spentUsd?: number; source?: string }[] };
const sem = (f: string) => JSON.parse(readFileSync(f, 'utf8')) as { checkedAt: string; spentUsd: number; results: { id: string; utterance: string; matches: { example: string; reason: string }[] }[] };
const semEx = sem('results/v3/raw/semantic-leak-test.json');
const semDev = sem('results/v3/raw/semantic-test-vs-dev.json');

const REVIEW = '> **レビュー前**(承認されたらこの行を消す)\n\n';
const classes = [...new Set(slots.map((s) => s.target))];
const has = (t: T, tag: string) => t.tags.includes(tag);
const count = (f: (t: T) => boolean) => test.filter(f).length;
const TAGS: [string, string][] = [
  ['colloquial', '口語・くだけた言い方'],
  ['context', '直前の会話がないと意味が決まらない'],
  ['boundary', '境目(隣の分類とまぎらわしい)'],
  ['typo', '誤字・変換ミス・ひらがな書き'],
  ['qn_purpose', '言い換え自体が目的'],
  ['topic_listed', '説明文に例として挙げた話題(範囲外・基本)'],
  ['topic_unlisted', '説明文に挙げていない話題(範囲外・基本)'],
];
const ctxText = (t: T) => (t.context.length ? t.context.map((c) => `${c.role === 'user' ? 'U' : 'A'}「${c.text}」`).join(' ') : '');
const cell = (s: string) => s.replace(/\|/g, '\\|');

const classTable = [
  '| 分類(狙い) | 件数 | 境目 | 文脈あり | 口語 | 誤字 |',
  '|---|---:|---:|---:|---:|---:|',
  ...classes.map((c) => {
    const g = test.filter((t) => t.design.target === c);
    return `| \`${c}\` | ${g.length} | ${g.filter((t) => has(t, 'boundary')).length} | ${g.filter((t) => has(t, 'context')).length} | ${g.filter((t) => has(t, 'colloquial')).length} | ${g.filter((t) => has(t, 'typo')).length} |`;
  }),
  `| **計** | **${test.length}** | **${count((t) => has(t, 'boundary'))}** | **${count((t) => has(t, 'context'))}** | **${count((t) => has(t, 'colloquial'))}** | **${count((t) => has(t, 'typo'))}** |`,
].join('\n');

const pairs = new Map<string, number>();
for (const t of test.filter((x) => x.design.boundaryWith)) {
  const k = `\`${t.design.target}\` ← \`${t.design.boundaryWith}\``;
  pairs.set(k, (pairs.get(k) ?? 0) + 1);
}
const topicRows = ['out_of_scope', 'base'].map((c) => {
  const g = test.filter((t) => t.design.target === c);
  const listed = g.filter((t) => has(t, 'topic_listed'));
  const unlisted = g.filter((t) => has(t, 'topic_unlisted'));
  const topic = (t: T) => t.design.brief.replace(/^.*?話題: /, '');
  return `| \`${c}\` | ${g.length} | ${listed.length}(${listed.map(topic).join('、')}) | ${unlisted.length}(${unlisted.map(topic).join('、')}) |`;
});

// samples: proportional to class and tag shares (picked by hand from the generated set, see test-samples.md)
const SAMPLE_IDS = ['t002', 't009', 't013', 't017', 't021', 't029', 't032', 't036', 't043', 't047', 't049', 't053', 't062', 't071', 't079', 't081', 't083', 't087', 't093', 't097'];
const samples = SAMPLE_IDS.map((id) => test.find((t) => t.id === id) as T);
const sCount = (f: (t: T) => boolean) => samples.filter(f).length;

const totalGen = 0.182 + gen.rounds.reduce((s, r) => s + (r.spentUsd ?? 0), 0);
const design = `${REVIEW}# test の設計

test は、v3 の主な結論を言うための評価セットです(100件、\`data/eval.v3.test.jsonl\`)。先に「分類ごとの件数」と「タグの配分」を決め(\`data/test-spec.v3.json\`、\`src/v3/testSpec.ts\`)、それを指定して発話だけを LLM に作らせました。**正解はまだ付けていません**(step 4 でラベラーが付けます)。表の「分類」は、発話を作るときに狙った分類で、正解とは限りません。

## 発話を作ったモデル

- **${GEN_MODEL}**(Anthropic API、推論 medium)
- 比べる側の LLM(gpt-5.4-nano / gpt-6-luna / gpt-6-sol)は、その言い回しに寄って有利になるおそれがあるため使わない。ラベラー(claude-opus-5-5)とも別のモデルにした
- 渡したもの: 生成用に別に書いた短い分類の定義(下の表)、枠ごとの指示(brief・tags・境目の相手)、「作らない発話」(dev 100件と基準書の例29件)。**分類器に渡す説明文(\`data/candidates.v3.json\`)と基準書は渡していない**
- 企業名は架空の名前(Hテック、Wフード、Yリンク、Bメディア、Qロジスティクス、Lクリニック)だけを使わせた
- 生成の費用: 合計 約$${totalGen.toFixed(2)}(最初の100件と、作り直し${gen.rounds.length}回)

| 分類 | 生成用の定義 |
|---|---|
${Object.entries(GEN_DEFINITIONS).map(([k, v]) => `| \`${k}\` | ${v} |`).join('\n')}

## 分類ごとの件数とタグ

${classTable}

- 各分類6件以上(最少は \`query_normalization\` の${test.filter((t) => t.design.target === 'query_normalization').length}件)
- **境目の発話: ${count((t) => has(t, 'boundary'))}件**(20件以上の条件を満たす)
- **言い換え自体が目的の発話: ${count((t) => has(t, 'qn_purpose'))}件**(6件以上の条件を満たす)

### タグの配分(1件に複数付く)

| タグ | 意味 | 件数 |
|---|---|---:|
${TAGS.map(([k, v]) => `| \`${k}\` | ${v} | ${count((t) => has(t, k))} |`).join('\n')}

### 境目の組み合わせ(狙った分類 ← まぎらわしい相手)

| 組み合わせ | 件数 |
|---|---:|
${[...pairs].map(([k, v]) => `| ${k} | ${v} |`).join('\n')}

### 範囲外と基本: 説明文に挙げた話題 / 挙げていない話題

| 分類 | 件数 | 説明文に挙げた話題 | 説明文に挙げていない話題 |
|---|---:|---|---|
${topicRows.join('\n')}

どちらも、説明文に挙げていない話題が半分以上です。

## 作り直しの経緯

1. 最初の100件を作ったところ、dev とほぼ同じ依頼が多く混ざっていた(例: 「アカウントを削除したい」と dev の「退会したい」)。枠の指示を dev と同じ話題で書いていたため。dev を見て基準を直したことへの合わせ込みを避けるという test の目的に反するので、22枠の指示を同じ分類・同じ境目のまま別の中身に書き換えて作り直した
2. 意味の照合(下)で基準書の例や dev と同じ依頼と判定された枠を、さらに指示を書き換えて作り直した(12枠、3枠、1枠)
3. 途中で Anthropic API の残高が尽きた際、12枠を Claude Code のサブエージェント(Sonnet)で作ったが、生成の条件をそろえるため使わず、残高を足したあとに API で作り直した
- 作り直しのたびに、置き換えた前の発話も \`results/v3/raw/test-generation.json\` の \`rounds\` に残している(最初の100件の生成は \`rounds\` を記録する前のため、費用 約$0.18 だけを記す)

## 照合

### 基準書の例との意味の照合(必須)

step 2 と同じ判定基準・同じ判定モデル(${JUDGE.model}、推論 ${JUDGE.effort})で、test の各発話について、基準書の例のうち同じ依頼を言い換えただけのものがあるかを判定させた。

- 結果(${semEx.checkedAt.slice(0, 10)}): **${semEx.results.filter((r) => r.matches.length).length}件**

### 文字の照合

詳細は \`results/v3/leak-check.md\`。

- 発話がまるごと基準書に含まれる件: 0件
- 連続6文字以上が基準書と重なる件: 11件。どれも「たいんだけど」「メールアドレス」「求人の勤務地」「登録している」のような日常的な言い回しで、基準書の例の発話との重なりではない。test を直して0件にすると test から普通の言い回しを避けることになるため、直していない(**判断をお願いしたい点**)

### 参考: dev との意味の照合

申し送りの必須ではないが、test が dev と同じ依頼を多く含むと独立した評価セットにならないため、同じ基準・同じ判定モデルで test と dev も照合した。

- 結果(${semDev.checkedAt.slice(0, 10)}): ${semDev.results.filter((r) => r.matches.length).length}件

| test | 発話 | dev | 判定の理由 |
|---|---|---|---|
${semDev.results.flatMap((r) => r.matches.map((m) => `| ${r.id} | ${cell(r.utterance)} | ${cell(m.example)} | ${cell(m.reason)} |`)).join('\n')}

- あいさつ(t091 と dev「こんにちは」)は、どう書いても同じ依頼と判定されるため残した
- 判定モデルは同じ入力でも実行ごとに結果が少し揺れる。直前の実行では t032・t098 は一致と判定されていなかった
- 判定の基準: ${SAME_REQUEST_CRITERIA.split('\n')[0]}(全文は \`results/v3/leak-check.md\`)

## サンプル20件

\`results/v3/test-samples.md\`
`;
writeFileSync('results/v3/test-design.md', design);

const sampleMd = `${REVIEW}# test の発話サンプル(20件)

分類とタグの割合が test 全体と近くなるように選んだ20件です。正解はまだ付けていません。「狙った分類」は発話を作るときの指定で、正解とは限りません。

- 狙った分類: ${classes.map((c) => `\`${c}\` ${sCount((t) => t.design.target === c)}`).join('、')}
- タグ: 境目 ${sCount((t) => has(t, 'boundary'))}、文脈あり ${sCount((t) => has(t, 'context'))}、口語 ${sCount((t) => has(t, 'colloquial'))}、誤字 ${sCount((t) => has(t, 'typo'))}、言い換え自体が目的 ${sCount((t) => has(t, 'qn_purpose'))}、説明文に挙げた話題 ${sCount((t) => has(t, 'topic_listed'))}、挙げていない話題 ${sCount((t) => has(t, 'topic_unlisted'))}

| id | 直前の会話 | 発話 | 狙った分類 | まぎらわしい相手 | タグ |
|---|---|---|---|---|---|
${samples.map((t) => `| ${t.id} | ${cell(ctxText(t)) || '-'} | ${cell(t.utterance)} | \`${t.design.target}\` | ${t.design.boundaryWith ? `\`${t.design.boundaryWith}\`` : '-'} | ${t.tags.join(', ') || '-'} |`).join('\n')}

全100件は \`data/eval.v3.test.jsonl\` にあります。
`;
writeFileSync('results/v3/test-samples.md', sampleMd);
console.log('written: results/v3/test-design.md, results/v3/test-samples.md');
