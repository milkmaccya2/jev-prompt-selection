# jev-prompt-selection

求人相談AIエージェントの1枚岩のシステムプロンプトを分野ごとに分け、
**発話ごとに使うプロンプトを1つ、[TypeSafe](https://docs.typesafe.ai/) の System One モデル Jev に選ばせる**検証です。
Jev がどれだけ正しく選べるかを、合成した100件の発話で測りました。

- デモ: **https://jev-prompt-selection.milkmaccya2.workers.dev**
  - 「試す」: 発話を入れると、Jev が選んだプロンプトと12候補の確率が出ます
  - 「評価結果」: 100件の正解と Jev の選択を見比べられます
- 結果の詳細: [results/summary.md](results/summary.md)

> **すべて架空の合成データです。** サービス名「ハタラクラフト」、企業名(Kデジタル、Mフーズ など)は実在しません。

## 結果

| 正解率 | 「これでも可」込み | 誤ったプロンプト |
|---:|---:|---:|
| 82% | 88% | 12% |

- 判定は1回 p50 約175ms・p95 約225ms、費用は1000回で約 $0.07
- 間違いは「専用の指示がいらない発話」に集中しました。分野がはっきりした発話(79件)で外したのは2件だけです
  - 例: 「はい」「ほかにもある?」に検索のプロンプトを選び、「ありがとう」「こんにちは」に基本プロンプトを選んだ
- 確信度が低いときに基本プロンプトへ戻す方式も試しましたが、誤りがかえって増えました(確信度0.7未満を戻すと 12% → 25%)

![プロンプト別の選び間違い](results/chart-part-miss.png)

**この結果から言えないこと**

- 発話もラベルも、プロンプトを書いた本人が1人で作った合成データです。実際の発話では精度が下がるおそれがあります
- 件数が少なく、分野によっては1件で10ポイント以上動きます
- 間違ったプロンプトを選んだときに、回答がどれだけ悪くなるかは測っていません

## 仕組み

```
発話(+直前1〜2往復の会話)
   │
   ▼
Jev  POST /v1/systemone  ── choice 1問(12候補から1つ)
   │                        選択肢の説明 = 各プロンプトの「いつ使うか」
   ▼
選ばれたプロンプト + 確信度(0〜1)
   └─ Jev が使えないとき(API エラー)は基本プロンプト
```

### プロンプトの候補(12個)

システムプロンプト(約1,500行)を14の部品に分け、そこから候補を組み立てます。部品は `prompts/` にあります。

- **専用プロンプト 11個**: 常に載せる3部品(人格・安全・出力形式)+ 分野の部品1つ
  - 検索条件の聞き出し / 地名・職種の言い換え / 企業情報 / クチコミ / 給与・待遇 / キャリア相談 / 応募書類 / 面接対策 / ログイン・規約 / エラー時 / 範囲外の話題
- **基本プロンプト 1個**: 常に載せる3部品だけ。専用の指示がいらない発話(相づち、ツール操作だけで済む依頼など)用

各部品の frontmatter に書いた「1行の説明」と「必要なとき」が、そのまま Jev に渡す選択肢の説明になります。
ツール(求人検索・応募など)は常に渡す前提で、選択の対象外です。

### 評価セット(100件)

`data/eval.jsonl` の各件は、直前の会話・今回の発話・正解のプロンプト1つ(`answer`)・「これでも可」とする別解(`acceptable`)・タグを持ちます。

```json
{"id":"e040","context":[],"utterance":"面接で希望年収聞かれたらなんて答えればいい?",
 "answer":"interview_prep","acceptable":["salary_benefits"],"tags":["cross"]}
```

- 「これでも可」は、複数の分野にまたがる発話(27件)に、ラベルを付けるときに手で決めた別解です。閾値ではありません
- 口語・略称(34件)、直前の会話が必要(20件)、正解に迷いがある(18件)、範囲外の話題(9件)、誤字(5件)を含みます
- ラベルの基準: [data/LABELING.md](data/LABELING.md)

## 使い方

Node.js 22 以上と、TypeSafe の API キー(early access)が必要です。

```sh
npm install
cp .env.example .env            # TYPESAFE_API_KEY を設定(.env は gitignore 済み)
npm run check:data              # 評価セットの検証

npm run eval -- --limit 5 --dry-run           # 呼ばずに件数と費用の見込みだけ
npm run eval -- --limit 5 --budget-usd 0.05   # 5件で動作確認
npm run eval -- --budget-usd 0.20             # 100件(約 $0.01)
npm run report                                # results/summary.md, metrics.json, chart-part-miss.png

npm run web                                   # http://localhost:4319 でビューア
```

- `--budget-usd` で費用の上限を決められます。上限を超えそうな呼び出しの前で止まります
- `--configs choice_ja,choice_en,noul_ja` で、補足の聞き方(選択肢の説明を英語にした版、noul を11個聞いて最大値を取る版)も回せます。どちらも正解率は81〜83%で本編とほぼ同じでした
- プロンプトを直したら `npm run index` で `prompts/index.json`(行数・トークン数)を作り直します

## Cloudflare Workers へのデプロイ

```sh
npx wrangler login
# キーは Cloudflare 側にだけ置く(! で実行するときは対話入力できないのでパイプで渡す)
grep '^TYPESAFE_API_KEY=' .env | cut -d= -f2- | tr -d '\n' | npx wrangler secret put TYPESAFE_API_KEY
npm run cf:deploy               # worker/data.json を作ってからデプロイ
```

- `npm run cf:dev` でローカル確認できます(`.env` のキーを使います)
- 画面は `web/index.html`、API は `worker/index.ts`(`/api/data` と `/api/select`)です。評価結果は最新の `results/raw/run-*.json` から焼き込みます
- 公開版には費用の上限がありません。TypeSafe のアカウント側の課金上限に任せています。入力は1〜300文字に制限しています

## ディレクトリ

| パス | 内容 |
|---|---|
| `prompts/` | プロンプト部品(常に載せる3 + 分野11)と `index.json` |
| `data/` | 評価セット `eval.jsonl` とラベル基準 `LABELING.md` |
| `src/jev.ts` | Jev への質問の組み立てと呼び出し、費用の上限 |
| `src/select.ts` | Jev の返り値からプロンプトを1つ決める |
| `src/eval.ts` / `src/report.ts` | 評価の実行 / 集計・グラフ・summary.md の生成 |
| `src/server.ts` / `web/index.html` | ローカル用ビューア |
| `worker/` | Cloudflare Workers 版 |
| `results/` | 生データ(`raw/`)・集計・グラフ・summary.md |

最初は「部品を複数選んで組み合わせる」構成で試しました。その生データは `results/raw/archive-multipart/` に残しています。

## 参考

- [TypeSafe docs: API reference](https://docs.typesafe.ai/api)
- [TypeSafe docs: Choice](https://docs.typesafe.ai/primitives/choice)
- [TypeSafe docs: Models & pricing](https://docs.typesafe.ai/models)
