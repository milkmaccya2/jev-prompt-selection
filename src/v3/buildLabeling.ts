/**
 * Builds data/LABELING.v3.md. The scope and boundary sentences are inserted verbatim from
 * data/candidates.v3.json, so the labeling guide and the classifiers' descriptions cannot drift apart.
 * Examples come from data/labeling-examples.v3.json (new utterances that are in neither dev nor test).
 */
import { readFileSync, writeFileSync } from 'node:fs';

interface Ex { utterance: string; context?: { role: string; text: string }[]; answer: string; acceptable: string[]; why: string }
const cands = JSON.parse(readFileSync('data/candidates.v3.json', 'utf8')) as {
  fine: { id: string; scope: string; boundary: string }[];
  coarse: { id: string; name: string; members: string[]; boundary: string }[];
};
const ex = (JSON.parse(readFileSync('data/labeling-examples.v3.json', 'utf8')) as { examples: Ex[] }).examples;
const base = cands.fine.find((c) => c.id === 'base');
if (!base?.boundary) throw new Error('base boundary missing');

const cell = (s: string) => s.replace(/\|/g, '\\|');
const exRows = cands.fine
  .flatMap((c) => ex.filter((e) => e.answer === c.id))
  .map((e) => {
    const ctx = e.context?.length ? `(直前: ${e.context.map((t) => `${t.role === 'user' ? 'ユーザー' : 'アシスタント'}「${t.text}」`).join(' ')}) ` : '';
    return `| ${cell(ctx)}「${cell(e.utterance)}」 | \`${e.answer}\` | ${e.acceptable.map((a) => `\`${a}\``).join(', ') || '-'} | ${cell(e.why)} |`;
  });

// remove the next line's marker once step 2 is approved
const REVIEW = '> **レビュー前**(承認されたらこの行を消す)\n\n';
const md = `${REVIEW}# ラベル付けの基準 v3

求人相談AI(架空サービス「ハタラクラフト」)は、ユーザーの発話ごとに**回答に使うプロンプトを1つ選んで**回答します。
この基準は、各発話に「選ぶべきプロンプト」を付けるためのものです。

- 候補の「扱う範囲」と「境目」の文は、分類器に渡す説明文(\`data/candidates.v3.json\`)と**同じ文**です。この基準書はそのファイルから組み立てています(\`src/v3/buildLabeling.ts\`)
- 例の発話は、評価データ(dev・test)に出てこない新しいものだけを使っています(照合結果: \`results/v3/leak-check.md\`)

## 候補(12個)

すべての候補には、人格・安全・出力形式の基本ルールが常に入っています。違いは、そこに足す「分野の指示」です。ツール(求人検索・求人の詳細・応募・お気に入り・応募状況の確認など)は、どの候補を選んでも常に使えます。

| id | 扱う範囲 | 境目 |
|---|---|---|
${cands.fine.map((c) => `| \`${c.id}\` | ${cell(c.scope)} | ${cell(c.boundary) || '-'} |`).join('\n')}

## 付けるもの

- \`answer\`: 選ぶべきプロンプト1つ
- \`acceptable\`: それを選んでも間違いではないプロンプト(0個以上)。複数の分野にまたがる発話や、二通りに読める発話にだけ付ける。\`answer\` と同じものは入れない

## 基本ルール

1. **\`answer\` は、ユーザーの主な目的に対応するプロンプトにする。** 上の表の「境目」に当てはまる場合は、境目に書いたほうを選ぶ。
2. **複数の分野にまたがる発話は、主な1つを \`answer\` にし、回答に役立つほかの候補を \`acceptable\` にする。**
3. **直前の会話があれば、それを踏まえて今回の発話の目的を決める。** 短い返事や相づちは、直前のアシスタントの問いかけへの返事として読む。
4. **\`base\` を選ぶのは、専用の指示がなくても普通に返せる発話だけ。** ${base.boundary}。ツールの操作だけで済む依頼でも、分野の相談が含まれていれば \`base\` にはしない。
5. **迷った場合は、回答の質に一番効く指示を持つプロンプトを \`answer\` にし、迷ったもう一方を \`acceptable\` にする。**

## 例

どれも評価データにはない発話です。

| 発話 | answer | acceptable | 理由 |
|---|---|---|---|
${exRows.join('\n')}

## 6分類

12候補を、次の6つにまとめた版も測ります。正解・別解も同じ対応で写します。「境目」の文は、6分類で分類器に渡す説明文と同じです。

| id | 名前 | 含める12候補 | 境目 |
|---|---|---|---|
${cands.coarse.map((c) => `| \`${c.id}\` | ${c.name} | ${c.members.map((m) => `\`${m}\``).join(', ')} | ${cell(c.boundary) || '-'} |`).join('\n')}

この6分類は検証のために作ったまとめ方で、実際のサービスで使う分類とは別物です。

## v2 からの変更点

- 範囲と境目を、分類器に渡す説明文と同じ文にした(v2 では基準書と説明文が別々に書かれ、\`query_normalization\` などでずれていた)
- \`query_normalization\` は「地名・職種の略称や口語を正式な名称に直すこと自体が目的」の発話だけにした
- \`base\` の境目に「${base.boundary}」を足した。v2 で \`base\` だった、求人の詳細についての質問のうち、分野の相談を含むもの(例: 待遇や選考についての質問)は、その分野のプロンプトになりうる
- 例をすべて、評価データに出てこない新しい発話に差し替えた

## 既知の限界

- 例の発話も評価データも合成で、作成者が候補の説明文を知ったうえで書いている
- 正解は、この基準書と候補の説明文だけを渡した Claude Opus 5.5 が付け、人が確認する(dev は v1 の人のラベルと突き合わせる)
`;
writeFileSync('data/LABELING.v3.md', md);
console.log('data/LABELING.v3.md written');
