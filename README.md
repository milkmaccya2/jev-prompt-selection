# jev-prompt-selection

求人相談AIエージェントの1枚岩のシステムプロンプトを分野ごとに分け、
**発話ごとに使うプロンプトを1つ、[TypeSafe](https://docs.typesafe.ai/) の System One モデル Jev に選ばせる**検証です。
v2 では、LLM 分類器(gpt-5.4-nano / gpt-6-luna / gpt-6-sol)と、正解率・判定時間・費用・確信度の当たり具合を比べました。

- デモ: **https://jev-prompt-selection.milkmaccya2.workers.dev**
  - 「試す(Jev)」: 発話を入れると、Jev が選んだプロンプトと候補ごとの確率が出ます(12候補 / 6分類)
  - 「比較(100件)」: 9構成の正解率・判定時間・費用と、100件それぞれの正解と選択を見比べられます
- 結果の詳細: [results/v2/summary.md](results/v2/summary.md)(v1 は [results/summary.md](results/summary.md))

> **すべて架空の合成データです。** サービス名「ハタラクラフト」、企業名(Kデジタル、Mフーズ など)は実在しません。

## 結果(v2、合成100件)

| 構成 | 粒度 | 正解率 [95%CI] | 「これでも可」込み | 判定時間 p50 / p95 | 費用 / 1000回 |
|---|---|---:|---:|---:|---:|
| Jev | 12候補 | 91% [84–95] | 99% | 0.23秒 / 0.34秒 | $0.074 |
| Jev | 6分類 | 92% [85–96] | 97% | 0.18秒 / 0.31秒 | $0.073 |
| gpt-5.4-nano(推論なし) | 12候補 | 80% [71–87] | 91% | 0.65秒 / 0.87秒 | $0.26 |
| gpt-6-luna(推論なし) | 12候補 | 85% [77–91] | 98% | 0.80秒 / 1.03秒 | $0.022〜0.158 |
| gpt-6-luna(推論なし) | 6分類 | 95% [89–98] | 98% | 0.84秒 / 1.19秒 | $0.021〜0.15 |
| gpt-6-sol(推論なし) | 12候補 | 85% [77–91] | 100% | 1.05秒 / 1.46秒 | $0.45〜3.16 |
| gpt-6-sol(推論なし) | 6分類 | 96% [90–98] | 98% | 1.05秒 / 1.41秒 | $0.43〜3.1 |

OpenAI の費用は「プロンプトキャッシュが毎回効く 〜 毎回切れる」の幅です(今回の実行は前者)。全9構成は summary を見てください。

- **判定時間は Jev が3〜5倍速い。**
- **12候補の正解率は Jev が最も高いが、統計的に差があると言えるのは gpt-5.4-nano との差だけ**(McNemar p=0.007)。LLM の外れの多くは「検索条件」と「地名・職種の言い換え」の境目で、別解込みではほぼ並ぶ。6分類では LLM が追いつく
- **推論を足しても正解率はほぼ変わらない**(gpt-6-luna 85% → 推論 low 86%、p95 は 1.03秒 → 1.87秒)
- **費用は Jev が一番安いとは言えない。** gpt-6-luna はキャッシュのヒット率が62%以上なら Jev より安い
- **Jev の確信度は控えめ。** 確信度0.9以上の67件は正解率96%

![正解率と判定時間](results/v2/chart-accuracy-latency.png)

**この結果から言えないこと**: 正解は Claude Opus 5.5 が基準書から付けたラベル(作成者のラベルとの一致 97%、kappa 0.966)で、データは合成100件です。判定時間は1台の端末・1回の実行で測りました。応答の品質は測っていません。

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

# v2: 比較(OPENAI_API_KEY / ANTHROPIC_API_KEY も使う)
npm run v2:label -- --budget-usd 4            # 基準書 v2 だけを見せて Claude が独立にラベル付け
npm run v2:agree                              # 元ラベルとの一致率・kappa・食い違い一覧
npm run v2:eval -- --limit 5 --budget-usd 0.2 # 5件で動作確認
npm run v2:eval -- --budget-usd 2             # 100件 × 9構成(1件ずつ順番、構成を交互に)
npm run v2:report                             # results/v2/summary.md とグラフ
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
| `data/` | 評価セット(v1 `eval.jsonl` / v2 `eval.v2.jsonl`)とラベル基準(`LABELING.md` / `LABELING.v2.md`) |
| `src/jev.ts` | Jev への質問の組み立てと呼び出し、費用の上限 |
| `src/select.ts` | Jev の返り値からプロンプトを1つ決める |
| `src/eval.ts` / `src/report.ts` | 評価の実行 / 集計・グラフ・summary.md の生成 |
| `src/server.ts` / `web/index.html` | ローカル用ビューア |
| `worker/` | Cloudflare Workers 版 |
| `src/v2/` | v2 の候補定義・分類器(Jev / OpenAI)・ラベラー・統計・レポート |
| `results/` | v1 の生データ・集計・グラフ / `results/v2/` に v2 一式(料金の確認記録 `PRICING.md` を含む) |

最初は「部品を複数選んで組み合わせる」構成で試しました。その生データは `results/raw/archive-multipart/` に残しています。

## 参考

- [TypeSafe docs: API reference](https://docs.typesafe.ai/api)
- [TypeSafe docs: Choice](https://docs.typesafe.ai/primitives/choice)
- [TypeSafe docs: Models & pricing](https://docs.typesafe.ai/models)
