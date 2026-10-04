/**
 * results/v3/leak-check.md: mechanical checks that
 *  (1) no dev/test utterance (or a 6+ char piece of it) appears in LABELING.v3.md or in the classifiers' descriptions
 *  (2) every scope/boundary sentence of data/candidates.v3.json appears verbatim in LABELING.v3.md
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEval } from '../data.js';
import { candidatesFor, instruction } from './candidates.js';
import { findLeaks, normalize } from './leak.js';

const MIN = 6;
const labeling = readFileSync('data/LABELING.v3.md', 'utf8');
const sets: { name: string; path: string }[] = [
  { name: 'dev', path: 'data/eval.v2.jsonl' },
  { name: 'test', path: 'data/eval.v3.test.jsonl' },
];
const descTexts = [{ name: '指示文', text: instruction() }, ...(['fine', 'coarse'] as const).flatMap((g) => candidatesFor(g).map((c) => ({ name: `説明文 ${g === 'fine' ? '12候補' : '6分類'} ${c.id}`, text: c.description })))];

const lines: string[] = [];
let total = 0;
for (const s of sets) {
  if (!existsSync(s.path)) {
    lines.push(`### ${s.name}(\`${s.path}\`)\n\nまだ無いため未実施。作成後にこのスクリプトを再実行する。\n`);
    continue;
  }
  const utts = loadEval(new URL(`../../${s.path}`, import.meta.url));
  const hits = findLeaks(utts, [{ name: 'LABELING.v3.md', text: labeling }, ...descTexts], MIN);
  const exact = utts.filter((u) => normalize(labeling).includes(normalize(u.utterance)));
  total += hits.length;
  lines.push(
    `### ${s.name}(\`${s.path}\`、${utts.length}件)\n\n- 発話がまるごと基準書に含まれる件: **${exact.length}件**\n- 連続${MIN}文字以上が基準書・説明文・指示文に含まれる件: **${hits.length}件**\n` +
      (hits.length ? `\n| id | 発話 | 場所 | 一致した部分 |\n|---|---|---|---|\n${hits.map((h) => `| ${h.id} | ${h.utterance} | ${h.where} | 「${h.piece}」 |`).join('\n')}\n` : '')
  );
}

const cands = JSON.parse(readFileSync('data/candidates.v3.json', 'utf8')) as { fine: { id: string; scope: string; boundary: string }[]; coarse: { id: string; boundary: string }[] };
const verbatim = [
  ...cands.fine.flatMap((c) => [{ what: `${c.id} の扱う範囲`, text: c.scope }, ...(c.boundary ? [{ what: `${c.id} の境目`, text: c.boundary }] : [])]),
  ...cands.coarse.filter((c) => c.boundary).map((c) => ({ what: `6分類 ${c.id} の境目`, text: c.boundary })),
].map((v) => ({ ...v, ok: labeling.includes(v.text) }));
const ng = verbatim.filter((v) => !v.ok);

const md = `> **レビュー前**(承認されたらこの行を消す)

# 評価データが基準書に残っていないことの照合

実行日: ${new Date().toISOString().slice(0, 10)}(\`npx tsx src/v3/leakCheck.ts\`)

評価データの発話を、空白と記号(「」、。!? など)を除いて正規化し、次の2つを調べた(\`src/v3/leak.ts\`)。

- 発話がまるごと基準書(\`data/LABELING.v3.md\`)に含まれていないか
- 発話の連続${MIN}文字以上が、基準書・分類器に渡す説明文・指示文に含まれていないか(例の発話の言い換えや、説明文への入り込みも拾うため)

## 結果

${lines.join('\n')}
## 基準書と説明文が同じ文か

\`data/candidates.v3.json\` の「扱う範囲」と「境目」の文 ${verbatim.length}個が、基準書にそのまま含まれているかを調べた。

- 含まれている: **${verbatim.length - ng.length} / ${verbatim.length}**
${ng.length ? ng.map((v) => `- 含まれていない: ${v.what}`).join('\n') : ''}
`;
writeFileSync('results/v3/leak-check.md', md);
console.log(`leak hits=${total}, verbatim ${verbatim.length - ng.length}/${verbatim.length}`);
if (total || ng.length) process.exitCode = 1;
