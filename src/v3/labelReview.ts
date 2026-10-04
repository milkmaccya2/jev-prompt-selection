/** Writes results/v3/label-review.md from the v3 labels (dev + test). */
import { readFileSync, writeFileSync } from 'node:fs';
import { cohenKappa } from './stats.js';
import { LABEL_EFFORT, LABEL_MODEL, LABELER_INPUTS } from './label.js';

interface Lab { id: string; answer: string | null; acceptable: string[]; basis: string | null; reason: string | null }
interface Case { id: string; context: { role: string; text: string }[]; utterance: string; answer?: string; acceptable?: string[]; tags: string[]; design?: { target: string; boundaryWith: string | null; brief: string } }
const raw = JSON.parse(readFileSync('results/v3/raw/labels-claude.json', 'utf8')) as { sets: Record<string, { labeledAt: string; spentUsd: number; labels: Lab[] }> };
const read = (p: string) => readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Case);
const v1 = new Map(read('data/eval.jsonl').map((c) => [c.id, c]));
const v2 = new Map(read('data/eval.v2.jsonl').map((c) => [c.id, c]));
const test = new Map(read('data/eval.v3.test.jsonl').map((c) => [c.id, c]));
const dev = raw.sets.dev.labels;
const tst = raw.sets.test.labels;

const REVIEW = '> **レビュー前**(承認されたらこの行を消す)\n\n';
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const code = (id: string) => `\`${id}\``;
const ansText = (a: string | null | undefined, acc: string[] = []) => `${a ? code(a) : '-'}${acc.length ? `(可: ${acc.map(code).join(', ')})` : ''}`;
const ctx = (c: Case) => (c.context.length ? c.context.map((t) => `${t.role === 'user' ? 'U' : 'A'}「${t.text}」`).join(' ') : '-');
const basisText = (b: string | null) => {
  if (!b) return '-';
  if (b.startsWith('scope:')) return `${code(b.slice(6))} の扱う範囲`;
  if (b.startsWith('boundary:')) return `${code(b.slice(9))} の境目`;
  return `基本ルール${b.slice(4)}`;
};

// ---- dev: agreement with the human (v1) labels and with v2 ----
const agree = (ref: Map<string, Case>) => {
  const pairs = dev.filter((l) => l.answer && ref.get(l.id));
  const a = pairs.map((l) => ref.get(l.id)?.answer as string);
  const b = pairs.map((l) => l.answer as string);
  const exact = pairs.filter((l, i) => a[i] === l.answer).length;
  const compat = pairs.filter((l) => { const r = ref.get(l.id) as Case; return r.answer === l.answer || l.acceptable.includes(r.answer as string) || (r.acceptable ?? []).includes(l.answer as string); }).length;
  return { n: pairs.length, exact, compat, kappa: cohenKappa(a, b) };
};
const g1 = agree(v1);
const g2 = agree(v2);
const pct = (k: number, n: number) => `${((k / n) * 100).toFixed(1)}%(${k}/${n})`;

const changed = dev.filter((l) => v2.get(l.id)?.answer !== l.answer);
const changedRows = changed.map((l) => {
  const c = v2.get(l.id) as Case;
  return `| ${l.id} | ${cell(ctx(c))} | ${cell(c.utterance)} | ${ansText(c.answer, c.acceptable)} | ${ansText(l.answer, l.acceptable)} | ${basisText(l.basis)} | ${cell(l.reason ?? '')} |`;
});
const accChanged = dev.filter((l) => { const c = v2.get(l.id) as Case; return c.answer === l.answer && [...(c.acceptable ?? [])].sort().join() !== [...l.acceptable].sort().join(); }).length;
const v1Diff = dev.filter((l) => v1.get(l.id)?.answer !== l.answer);
const v1Rows = v1Diff.map((l) => { const c = v1.get(l.id) as Case; return `| ${l.id} | ${cell(c.utterance)} | ${ansText(c.answer, c.acceptable)} | ${ansText(l.answer, l.acceptable)} | ${basisText(l.basis)} |`; });

// ---- test: all cases, and the ones that differ from the design target ----
const mismatch = tst.filter((l) => test.get(l.id)?.design?.target !== l.answer);
const testRows = tst.map((l) => {
  const c = test.get(l.id) as Case;
  const t = c.design?.target as string;
  const mark = l.answer === t ? '' : l.acceptable.includes(t) ? '△' : '●';
  return `| ${l.id} | ${cell(ctx(c))} | ${cell(c.utterance)} | ${ansText(l.answer, l.acceptable)} | ${code(t)} | ${mark} |`;
});
const dist = new Map<string, number>();
for (const l of tst) dist.set(l.answer as string, (dist.get(l.answer as string) ?? 0) + 1);

// out_of_scope / base topics, recounted on the labels (topic tags come from the design)
const topicCount = (cls: string) => {
  const g = tst.filter((l) => l.answer === cls).map((l) => test.get(l.id) as Case);
  const listed = g.filter((c) => c.tags.includes('topic_listed'));
  const unlisted = g.filter((c) => c.tags.includes('topic_unlisted'));
  const other = g.filter((c) => !c.tags.includes('topic_listed') && !c.tags.includes('topic_unlisted'));
  return { n: g.length, listed: listed.length, unlisted: unlisted.length, other: other.map((c) => c.id) };
};
const oos = topicCount('out_of_scope');
const base = topicCount('base');
const watch = ['t096', 't097'].map((id) => { const l = tst.find((x) => x.id === id) as Lab; const c = test.get(id) as Case; return `| ${id} | ${cell(c.utterance)} | ${code(c.design?.target as string)} | ${ansText(l.answer, l.acceptable)} | ${basisText(l.basis)} | ${cell(l.reason ?? '')} |`; });

const md = `${REVIEW}# ラベルの確認(v3)

## ラベラーに渡したもの

- モデル: \`${LABEL_MODEL}\`(Anthropic API、推論 ${LABEL_EFFORT}、構造化出力)
- system: 基準書 v3(\`data/LABELING.v3.md\`)と候補の説明文(\`data/candidates.v3.json\` から組み立てた12候補の文)。全件で同じ文なので、プロンプトキャッシュに乗せた
- user: **${LABELER_INPUTS.join(' と ')}だけ**。test の \`design\`(狙った分類・brief・まぎらわしい相手)と \`tags\`、dev の v1・v2 のラベルは渡していない
- 出力: 答え(\`answer\`)、別解(\`acceptable\`)、根拠(\`basis\`: どの候補の「扱う範囲」か「境目」か、基本ルール1〜5のどれか)、理由(\`reason\`)
- 費用: dev $${raw.sets.dev.spentUsd.toFixed(2)}、test $${raw.sets.test.spentUsd.toFixed(2)}(ほかに5件の動作確認 $0.06)。生データ: \`results/v3/raw/labels-claude.json\`

## dev(100件)

### 人のラベル(v1)との突き合わせ

| 比べた相手 | 答えの一致率 | Cohen's kappa | 別解まで含めた一致率 |
|---|---:|---:|---:|
| v1(作成者が付けたラベル) | ${pct(g1.exact, g1.n)} | ${g1.kappa.toFixed(3)} | ${pct(g1.compat, g1.n)} |
| v2(Claude が基準書 v2 で付けたラベル) | ${pct(g2.exact, g2.n)} | ${g2.kappa.toFixed(3)} | ${pct(g2.compat, g2.n)} |

v1 と答えが違う件(${v1Diff.length}件):

| id | 発話 | v1 | v3(Claude) | 根拠 |
|---|---|---|---|---|
${v1Rows.join('\n')}

### v2 から正解が変わった件(${changed.length}件)

「根拠」は、ラベラーが答えを決めた一番の根拠として選んだものです(基準書のどの文によるか)。

| id | 直前の会話 | 発話 | v2 の正解 | v3 の正解 | 根拠 | ラベラーの理由 |
|---|---|---|---|---|---|---|
${changedRows.join('\n')}

- 答えは同じで、別解だけが変わった件: ${accChanged}件(一覧は省略。生データで確認できる)

## test(100件)

### 狙った分類と正解がずれた件(${mismatch.length}件)

${mismatch.length ? `| id | 発話 | 狙った分類 | 正解 | 根拠 |\n|---|---|---|---|---|\n${mismatch.map((l) => { const c = test.get(l.id) as Case; return `| ${l.id} | ${cell(c.utterance)} | ${code(c.design?.target as string)} | ${ansText(l.answer, l.acceptable)} | ${basisText(l.basis)} |`; }).join('\n')}` : '**0件。** 100件すべてで、ラベラーの答えが発話を作るときに狙った分類と一致した。'}

${mismatch.length ? '' : `ずれが0件だったこと自体に注意が要る。test の発話は dev より長く(平均 約29文字と約16文字)、作り手が狙った分類に合わせて書き分けているため、分類しやすい発話に寄っている可能性がある。この点は summary の「言えないこと」に書く。

レビューで「ずれうる」と挙がった発話のラベル:

| id | 発話 | 狙った分類 | 正解 | 根拠 | ラベラーの理由 |
|---|---|---|---|---|---|
${watch.join('\n')}
`}
### 正解の分布

| 正解 | 件数 |
|---|---:|
${[...dist].sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${code(k)} | ${v} |`).join('\n')}

### 範囲外と基本の話題(正解が付いたあとに数え直したもの)

| 正解 | 件数 | 説明文に挙げた話題 | 説明文に挙げていない話題 | 話題の指定なし(境目などで移ってきた件) |
|---|---:|---:|---:|---|
| \`out_of_scope\` | ${oos.n} | ${oos.listed} | ${oos.unlisted} | ${oos.other.join(', ') || '-'} |
| \`base\` | ${base.n} | ${base.listed} | ${base.unlisted} | ${base.other.join(', ') || '-'} |

### 全件の一覧

「ずれ」は、正解が狙った分類と違う件に ● を、正解は違うが狙った分類が別解に入っている件に △ を付けています。

| id | 直前の会話 | 発話 | Claude の答え・別解 | 狙った分類 | ずれ |
|---|---|---|---|---|---|
${testRows.join('\n')}
`;
writeFileSync('results/v3/label-review.md', md);
console.log(`dev changed vs v2: ${changed.length}, vs v1 diff: ${v1Diff.length}, test mismatch: ${mismatch.length}`);
