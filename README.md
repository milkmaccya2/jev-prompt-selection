# jev-prompt-selection

求人相談AIエージェントを想定した、**発話ごとのシステムプロンプト選択**の検証。
1枚岩のシステムプロンプトを、分野ごとの専用プロンプト11個 + 基本プロンプトに分け、
TypeSafe の System One モデル Jev(choice)に発話ごとに1つ選ばせたとき、
どれだけ正しく選べるか、確信度で「迷ったら全部載せ」にするとどうなるかを測る。

**すべて架空の合成データ。** サービス名「ハタラクラフト」、企業名(Kデジタル等)は実在しない。

## 構成
- `prompts/` プロンプト部品(frontmatter にメタデータ)。`npm run index` で `prompts/index.json` を生成
- `data/eval.jsonl` 評価セット / `data/LABELING.md` ラベル付けの基準
- `src/` 選択器・評価スクリプト・Web サーバー / `web/index.html` 画面
- `results/` 結果


## 使い方
```sh
npm install
cp .env.example .env            # TYPESAFE_API_KEY を設定(.env は gitignore 済み)
npm run index                   # 部品の行数・トークン数 → prompts/index.json
npm run check:data              # 評価セットの検証

npm run eval -- --limit 5 --dry-run           # 呼ばずに件数と費用の見込みだけ
npm run eval -- --limit 5 --budget-usd 0.05   # 5件で動作確認
npm run eval -- --budget-usd 0.20             # 100件(choice のみなら 約$0.01)
npm run report                                # results/summary.md, metrics.json, chart-*.png

npm run web                                   # http://localhost:4319 振り分けビューア
```

- 費用の上限: `--budget-usd`(評価)、`WEB_BUDGET_USD`(Web、既定 $0.05)。上限を超えそうな呼び出しの前で止まる。
- 候補: 専用プロンプト11個(常に載せる3部品 + 分野の部品1つ)+ 基本プロンプト(常に載せる3部品のみ)
- 本編: choice(日本語の説明)。補足として `--configs choice_ja,choice_en,noul_ja` で英語の説明版・noul の最大値版も回せる
- 逃げ道: choice の confidence が下限(0.5 / 0.7 / 0.9)未満、または API エラーなら全部載せ(`src/select.ts`)。下限は1回の呼び出し結果に後から当てる
- 前回の「部品を複数選ぶ」構成の生データは `results/raw/archive-multipart/` に残している
- ツール(求人検索・応募など)は常に渡す前提で、選択の対象外。

## 結果
[results/summary.md](results/summary.md)
