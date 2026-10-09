# 料金の確認結果(v4)

確認日: **2026-10-09**。すべて公式ページを見て確認した値です。1M = 100万トークン、Standard(通常)料金です。v3(2026-10-04)・appendix(2026-10-08)から変わった値はありません。

| 構成 | モデル | 入力 / 1M | キャッシュ読み出し / 1M | キャッシュ書き込み / 1M | 出力 / 1M | 出典 |
|---|---|---:|---:|---:|---:|---|
| Jev | `jev-latest` = `jev-1.13.0` | $0.042 | - | - | 無料 | https://docs.typesafe.ai/models |
| Decisions API | `gpt-6-luna` | $0.10 | 課金なし | 課金なし | 課金なし | https://developers.openai.com/api/docs/guides/decisions |
| Chat | `gpt-6-luna` | $0.10 | $0.01 | $0.125 | $0.50 | https://developers.openai.com/api/docs/pricing |
| Chat | `gpt-5.4-nano` | $0.20 | $0.02 | 記載なし | $1.25 | https://developers.openai.com/api/docs/pricing |

## 公式ページの記載(要約)

- **Jev**: 入力トークンだけに課金。出力は無料。
- **Decisions API**: パブリックベータ(「coming weeks」に GA の予定と記載)。対応モデルは `gpt-6-luna` だけ。gpt-6-luna では入力 $0.10 / 1M で、キャッシュの読み出し・書き込みと出力には課金しない。地域を指定した処理の割増と、長い入力の倍率は `/v1/decisions` にも適用される。今回はどちらにも当たらない(地域の指定なし、入力は1回あたり約1,500トークン)。料金のページ(pricing)には Decisions API の行はなく、ガイドのページに書かれている。
- **プロンプトキャッシュ**(https://developers.openai.com/api/docs/guides/prompt-caching): GPT-5.6 以降は1,024トークン以上の入力がキャッシュの対象になり、最後に書き込まれるか使われてから30分有効。書き込みは入力単価の1.25倍、読み出しは0.1倍。GPT-5.4 以前(gpt-5.4-nano を含む)は、キャッシュの対象になる最小の長さが「リクエストの設定で変わる」とされ、書き込みの追加料金はない。

コードの単価は `src/v3/classifiers.ts` の `CLASSIFIERS`(Jev・luna・nano)と `src/v3/decisions.ts` の `DECISIONS` にあり、この表と同じ値です。
