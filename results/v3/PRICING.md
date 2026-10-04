# 料金の確認結果(v3)

確認日: **2026-10-04**。すべて公式ページを見て確認した値です。1M = 100万トークン、Standard(通常)料金です。v2 の確認(2026-10-02、`results/v2/PRICING.md`)から変わった値はありません。

| 用途 | モデル | 入力 / 1M | キャッシュ読み出し / 1M | キャッシュ書き込み / 1M | 出力 / 1M | 確認したページ |
|---|---|---:|---:|---:|---:|---|
| 比べる分類器 | Jev `jev-latest` = `jev-1.13.0` | $0.042 | - | - | 無料 | https://docs.typesafe.ai/models |
| 比べる分類器 | OpenAI `gpt-5.4-nano` | $0.20 | $0.02 | 記載なし | $1.25 | https://developers.openai.com/api/docs/pricing |
| 比べる分類器 | OpenAI `gpt-6-luna` | $0.10 | $0.01 | $0.125 | $0.50 | https://developers.openai.com/api/docs/pricing |
| 比べる分類器 | OpenAI `gpt-6-sol` | $2.00 | $0.20 | $2.50 | $10.00 | https://developers.openai.com/api/docs/pricing |
| test の発話の作成(step 3) | Anthropic `claude-sonnet-5-5` | $2.00 | $0.20 | $2.50(5分) | $10.00 | https://platform.claude.com/docs/en/about-claude/pricing |
| ラベル付け(step 4) | Anthropic `claude-opus-5-5` | $4.00 | $0.20 | $5.00(5分) | $20.00 | https://platform.claude.com/docs/en/about-claude/pricing |

- Jev は入力トークンだけに課金され、出力は無料です(公式ページの記載)。
- OpenAI のキャッシュの有効期限(GPT-5.6 以降は最後に使われてから30分)と、gpt-5.4-nano のプロンプトがキャッシュに乗らない件は、v2 で確認したとおりです(`results/v2/PRICING.md`、`results/v2/summary.md`)。今回は再確認していません。
- 意味の照合に使った `gpt-6-sol`(推論 medium)も上の表の単価です。
- コードの単価は `src/v3/classifiers.ts` の `CLASSIFIERS` にあり、この表と同じ値です。
