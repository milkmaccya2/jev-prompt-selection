# jev-prompt-selection

求人相談AIエージェントを想定した、**発話ごとのプロンプト部品選択**の検証。
1枚岩のシステムプロンプトを部品に分け、TypeSafe の System One モデル Jev に
「この発話にどの部品が必要か」を判定させたとき、入力トークンをどれだけ減らせて、
必要な部品をどれだけ落とさずに済むかを測る。

**すべて架空の合成データ。** サービス名「ハタラクラフト」、企業名(Kデジタル等)は実在しない。

## 構成
- `prompts/` プロンプト部品(frontmatter にメタデータ)。`npm run index` で `prompts/index.json` を生成
- `data/eval.jsonl` 評価セット / `data/LABELING.md` ラベル付けの基準
- `src/` 選択器・評価スクリプト
- `results/` 結果

## トークン数について
部品のトークン数は `gpt-tokenizer`(o200k_base)による**近似**。
本番モデルのトークナイザとは一致しないが、削減率(比率)の比較には影響が小さい。

## セットアップ
```sh
npm install
cp .env.example .env   # TYPESAFE_API_KEY を設定
npm run index
npm run check:data
```
