# jev-prompt-selection

求人相談AIエージェントを想定した、**発話ごとのプロンプト部品選択**の検証。
1枚岩のシステムプロンプトを部品に分け、TypeSafe の System One モデル Jev に
「この発話にどの部品が必要か」を判定させたとき、入力トークンをどれだけ減らせて、
必要な部品をどれだけ落とさずに済むかを測る。

**すべて架空の合成データ。** サービス名「ハタラクラフト」、企業名(Kデジタル等)は実在しない。

## 構成
- `prompts/` プロンプト部品(frontmatter にメタデータ)。`npm run index` で `prompts/index.json` を生成
- `data/eval.jsonl` 評価セット / `data/LABELING.md` ラベル付けの基準
- `src/` 選択器・評価スクリプト・Web サーバー / `web/index.html` 画面
- `results/` 結果

## トークン数について
部品のトークン数は `gpt-tokenizer`(o200k_base)による**近似**。
本番モデルのトークナイザとは一致しないが、削減率(比率)の比較には影響が小さい。

## 使い方
```sh
npm install
cp .env.example .env            # TYPESAFE_API_KEY を設定(.env は gitignore 済み)
npm run index                   # 部品の行数・トークン数 → prompts/index.json
npm run check:data              # 評価セットの検証

npm run eval -- --limit 5 --dry-run           # 呼ばずに件数と費用の見込みだけ
npm run eval -- --limit 5 --budget-usd 0.05   # 5件で動作確認
npm run eval -- --budget-usd 0.20             # 100件(実績 約$0.03)
npm run report                                # results/summary.md, metrics.json, chart-*.png

npm run web                                   # http://localhost:4319 振り分けビューア
```

- 費用の上限: `--budget-usd`(評価)、`WEB_BUDGET_USD`(Web、既定 $0.05)。上限を超えそうな呼び出しの前で止まる。
- 比較する構成: A 全部載せ / B noul(日本語の質問文)/ B' noul(英語の質問文)/ C choice。B のしきい値(0.2/0.3/0.5/0.7)は1回の呼び出し結果に後から当てる。
- 逃げ道: noul が 0.35〜0.65 の部品が3個以上、choice の confidence < 0.3、API エラーのときは全部載せ(`src/select.ts`)。
- ツール(求人検索・応募など)は常に渡す前提で、選択の対象外。

## 結果
[results/summary.md](results/summary.md)
