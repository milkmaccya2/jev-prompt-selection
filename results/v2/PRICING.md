# 料金の確認結果

確認日: **2026-10-02**。すべて公式ページを見て確認した値。1M = 100万トークン。

| 用途 | モデル | 入力 / 1M | キャッシュ入力 / 1M | 出力 / 1M | 確認したページ |
|---|---|---:|---:|---:|---|
| 振り分け(本命) | Jev `jev-latest` = `jev-1.13.0` | $0.042 | - | 無料 | https://docs.typesafe.ai/models |
| 比較: LLM 分類器(軽量) | OpenAI `gpt-6-luna` | $0.10 | $0.01 | $0.50 | https://developers.openai.com/api/docs/pricing , https://developers.openai.com/api/docs/models/gpt-6-luna |
| 比較: LLM 分類器(上位) | OpenAI `gpt-6-sol` | $2.00 | $0.20 | $10.00 | https://developers.openai.com/api/docs/models/gpt-6-sol |
| (検討したが不採用) | OpenAI `gpt-6.1-sol` | $2.00 | $0.10 | $10.00 | https://developers.openai.com/api/docs/models/gpt-6.1-sol |
| 独立ラベラー | Anthropic `claude-opus-5-5` | $4.00 | $0.20 | $20.00 | https://platform.claude.com/docs/en/about-claude/pricing |

## 補足(公式ページの記載)

- **Jev**: 入力トークンのみ課金、出力は無料。
- **gpt-6-luna**: 「focused, high-volume tasks 向けの最も効率的なモデル」と説明されている。reasoning effort は none / low / medium(既定)/ high / xhigh / max。**既定が medium なので `none` を明示して呼ぶ**。Structured Outputs に対応。キャッシュ書き込みは $0.125 / 1M。
- **gpt-6-sol**: 「複雑なコーディングとエージェント向け」と説明されている。reasoning effort は luna と同じ(既定 medium、`none` 可)。Structured Outputs に対応。**対応エンドポイントは Chat Completions と Batch のみ**(Responses 非対応)なので、luna・sol とも Chat Completions で呼ぶ。キャッシュ書き込みは $2.50 / 1M。
- **gpt-6.1-sol**: 新しい Sol だが **`none` に対応していない**ため、「推論なし」で比べる条件を満たせず不採用。
- 当初の依頼は gpt-5.4-nano と上位モデルだったが、相談のうえ GPT-6 の luna(軽量)と sol(上位)に変更した。
- **Claude Opus 5.5**: thinking は無効にできない(effort で深さを調整する)。費用はラベル付け100件分のみ。
- いずれも Standard(通常)料金。Batch 料金は使わない(判定時間を測るため)。
