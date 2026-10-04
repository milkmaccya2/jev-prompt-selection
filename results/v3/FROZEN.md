# 凍結した入力

v3 の測定で、承認後に変えないものと、そのハッシュです。測定の前と後でこの値を再計算し、変わっていないことを確かめます(`src/v3/candidates.ts` の `descriptionsHash()` と `shasum -a 256`)。

| 対象 | 内容 | 承認日 | sha256 |
|---|---|---|---|
| 分類器に渡す文 | 指示文 + 12候補の説明文 + 6分類の説明文(実際に組み立てた文字列) | 2026-10-04(step 1) | `3e178125c4a72fa31d18c34ca15cca4169968acb13b155c7540b9794051c65df` |
| 説明文の元ファイル | `data/candidates.v3.json` | 2026-10-04(step 1) | `8f96ec13e047dc3e6dfda75610b293bffb73cc5e578de3b26afe77a2bf660412` |
| 基準書 v3 | `data/LABELING.v3.md`(`src/v3/buildLabeling.ts` で生成) | 2026-10-04(step 2) | `1bfc13c298c3bae872ccceea46f5f5d89279825924a6eea78f6278379b628ce2` |
| 基準書の例 | `data/labeling-examples.v3.json`(29件) | 2026-10-04(step 2) | `6ddc2b9177314b56f272022d51666b69de6667784c2a16887d64465e63bd4fbd` |

この先の step で承認されたもの(基準書 v3、test、測定計画)も、承認のたびにこの表へ追記します。
