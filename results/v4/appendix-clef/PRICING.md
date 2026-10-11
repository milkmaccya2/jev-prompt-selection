# 料金の確認結果(Clef 補足)

確認日: **2026-10-11**。公式ページを見て確認した値です。1M = 100万トークン。

| モデル | 入力 / 1M | 出力 / 1M | Neurons / 1M 入力 | 出典 |
|---|---:|---:|---:|---|
| `@cf/cloudflare/clef` | $0.240 | 課金なし | 21,818 | https://developers.cloudflare.com/workers-ai/platform/pricing/ 、https://developers.cloudflare.com/workers-ai/models/clef/ |
| `@cf/cloudflare/clef-flash` | $0.038 | 課金なし | 3,455 | https://developers.cloudflare.com/workers-ai/platform/pricing/ 、https://developers.cloudflare.com/workers-ai/models/clef-flash/ |

- Workers AI は Neurons で課金され、$0.011 / 1,000 Neurons。1日1万 Neurons までは無料枠。上の $ / 1M は公式の表にある換算値です。
- この補足の費用は「API が返した入力トークン数 × 上の $ / 1M」で計算します。無料枠で実際の請求が0になる場合も、比較のために単価で計算した値を出します。
- v4 の4構成の単価は `results/v4/PRICING.md`(2026-10-09 確認)のままです。
