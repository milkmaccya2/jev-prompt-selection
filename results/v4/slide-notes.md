# スライド更新用メモ(v4)

数字はすべて `results/v4/summary.md`・`metrics.json`(生データ `raw/run-test-2026-10-09T12-29-00-n100.json` から集計し、`verify.txt` で照合済み)と同じです。

## 1. 冒頭の説明

**問い: 判断を返す API は、プロンプトの振り分けに使えるか。**

- 求人相談 AI(架空)で、発話ごとに使うシステムプロンプトを12候補から1つ選ぶ。この振り分けには、通常の LLM に構造化出力で候補 id を返させる方法がよく使われる
- それとは別に、「質問と候補を渡すと、選択と確率・確信度を返す」API がある。TypeSafe の **Jev** を調べ始めたのが出発点で、その後 OpenAI からも **Decisions API**(パブリックベータ)が出た
- 今回は、この2つと通常の LLM(Chat Completions)2つを、**同じ実行の中で同じ条件**で比べた

### 使い方の流れ(choice を中心に)

```
発話 + 直前の会話
   │
   ▼
質問(指示文)と候補(id + 説明文)を渡す
   │
   ▼
選んだ候補 + 候補ごとの確率 + 確信度(confidence)
   │
   ▼
アプリ側: 選ばれた id に対応するシステムプロンプトを載せて回答を作る
```

- 両 API とも、質問の種類は3つ: **条件判定**(Jev: noul / Decisions: predicate)、**候補選択**(choice)、**尺度による採点**(score)。今回使ったのは choice だけ
- 説明するのは、共通する入出力と使い方まで。**両製品の内部の仕組みが同じだとは言わない**
- 通常の LLM も構造化出力(候補 id の enum、strict)で、決まった形の答えを返す。**「LLM は決まった型を返せない」という対比はしない**。今回の設定での違いは、通常の LLM が候補 id だけを返し、確率と確信度を返さなかったこと

## 2. 比べたもの

| 構成 | 呼び方 |
|---|---|
| Jev(choice) | TypeSafe、`jev-latest`(返ってきたのは `jev-1.13.0`) |
| gpt-6-luna(Decisions API・choice) | OpenAI `/v1/decisions` |
| gpt-6-luna(Chat・推論なし) | OpenAI Chat Completions、構造化出力 |
| gpt-5.4-nano(Chat・推論なし) | OpenAI Chat Completions、構造化出力 |

- 指示文・候補の説明文・会話・正解は固定(v3 で凍結したもの)。API ごとに渡す形だけを変えた
- test 100件、12候補(主)と6分類(補足)。1件ずつ順番に、各件で呼ぶ順番をランダムにし、リトライなしで測った

## 3. 比較表(test 100件・12候補)

| 構成 | 答えと一致 [95%CI] | 別解込み | 判定時間 p50 / p95 | 費用 / 1000回(実績) |
|---|---:|---:|---:|---:|
| Jev(choice) | 96% [90%–98%] | 98% | 0.18秒 / 0.23秒 | $0.086 |
| gpt-6-luna(Decisions API・choice) | 97% [92%–99%] | 100% | 0.21秒 / 0.31秒 | $0.145 |
| gpt-6-luna(Chat・推論なし) | 98% [93%–99%] | 99% | 1.00秒 / 1.49秒 | $0.028 |
| gpt-5.4-nano(Chat・推論なし) | 94% [88%–97%] | 96% | 0.73秒 / 0.95秒 | $0.307 |

図: `chart-accuracy-latency.png`(正解率と p50)、`chart-cost.png`(費用。薄い棒は試算)。確信度の図 `chart-calibration.png` は、Jev と Decisions API それぞれについて、confidence の区間ごとに何件あり、そのうち何件が答えと一致したかを横棒で示す(赤 = 一致しなかった件数)。

## 4. 結果として言えること

1. **正確さ: 4構成の間に、差があるとは言えない。** 12候補の総当たり6組を McNemar 正確検定で比べ、Holm 補正後の p はすべて 1.000。片方だけが正解した件は、どの組も9件以下だった。6分類(補足)でも同じ。
   - 「同等の精度」とは言わない。100件では差を判断できない、という結果
2. **速さ(同じ実行・1台の端末・1回の観測)**: p50 は Jev 0.18秒、Decisions API 0.21秒、gpt-5.4-nano(Chat)0.73秒、gpt-6-luna(Chat)1.00秒。
   - p50 の比(÷ Jev): Decisions 1.2倍、nano Chat 4.1倍、luna Chat 5.6倍
   - 同じ gpt-6-luna でも、Decisions API の p50 は Chat の約5分の1(0.21秒 対 1.00秒)
3. **費用(1000回あたり、実績)**: luna Chat $0.028 < Jev $0.086 < Decisions $0.145 < nano Chat $0.307。
   - luna Chat が安いのはプロンプトキャッシュが効いたため。**キャッシュが効かない場合の試算**では $0.187(実測ではない)
   - Decisions API は入力だけに課金($0.10 / 1M)。Jev も入力だけ($0.042 / 1M)。Jev は1回の入力トークンが多い(2,049 対 Decisions 1,450)が、単価が低い
   - nano Chat はキャッシュに乗らなかった
4. **確信度**: confidence が0.9以上だった件は、12候補では Jev 83件・Decisions 77件で、どちらも全件が答えと一致した。**この test 100件・12候補での観測**。6分類では、0.9以上でも Jev・Decisions とも1件ずつ不一致があった(76/77、80/81)
5. **間違え方**: 不一致は範囲外と基本の境目に多い(例: t088 の英訳の依頼を、Jev と nano Chat が「基本」に。t092 の「整理するのは今はいいや」を Jev が「検索条件」に、confidence 0.44)。一覧は summary の「誤分類の例」

## 5. 言えないこと

- **test 100件は、v3 で一度結果を見たデータの再利用**。新しい、独立した、未知のデータでの評価ではない
- test は LLM が作った発話で長め(平均29.3文字)。狙った分類と正解が100件すべて一致していて、分類しやすい発話に寄っている可能性がある。4構成とも94〜98%で、差が出にくい
- 正確さに差があるとは言えないことは、同等であることを意味しない
- 判定時間は1台・1回の観測。一般的な速さや SLA ではない(同じ luna Chat でも、10-04・10-08・10-09 で p50 が違った)
- Decisions API はパブリックベータ。精度・速さ・料金は変わりうる
- 「確信度が低いときに LLM に回せば改善する」は検証していない
- 選んだあとの回答の品質、プロンプトの最適化は測っていない
- 会社としての利用の可否、本番での採用、実際のユーザーへの回答の品質の改善は確認していない

## 6. 既存の発表から変えるべき結論・数値

| 既存の発表(出典) | v4 での扱い |
|---|---|
| 「12候補の正解率は Jev が最も高い(91%)」(v2) | 使わない。v4 では Jev 96%・Decisions 97%・luna Chat 98%・nano Chat 94% で、差があるとは言えない |
| 「判定時間は Jev が3〜5倍速い」(v2・v3) | 「通常の LLM(Chat)と比べて p50 で4.1〜5.6倍短い。Decisions API とは1.2倍」に変える。比べる相手と、p50 の比であることを書く |
| Jev の費用「$0.074 / 1000回」(v2) | $0.086(v3・v4 の説明文で入力トークンが増えたため) |
| 「確信度0.9以上の67件は正解率96%」(v2) | 12候補で83件・全件一致(test 100件に限る)。6分類では0.9以上でも1件不一致 |
| Decisions API は appendix(10-08、Jev・luna Chat だけと比較) | 最初から4構成の1つとして比べる。数字は v4 のものに置き換える(Decisions p50 0.20秒 → 0.21秒、luna Chat p50 1.22秒 → 1.00秒 など) |
| gpt-6-sol・gpt-6-luna 推論 low の数字(v3) | v4 では測っていない。使うなら「v3、別の日の実行」と明記し、v4 の表とは混ぜない |
| v3 の dev の数字 | v4 では使っていない。v4 の表と並べない |

## 7. 根拠のファイルと公式資料

- 計画: `results/v4/PLAN.md`(実行前に保存。sha256 は `PLAN.sha256`、実行後に一致を確認)
- 結果: `results/v4/summary.md`、`metrics.json`、`slide-table.md`、`chart-*.png`
- 生データ: `results/v4/raw/run-test-2026-10-09T12-29-00-n100.json`(動作確認は `raw/smoke-dev-2026-10-09T12-27-43-n5.json`、集計には使っていない)
- 照合: `results/v4/verify.txt`(生データから別のコードで計算し直し、103項目が一致)
- 単価: `results/v4/PRICING.md`(2026-10-09 確認)
  - Jev: https://docs.typesafe.ai/models
  - Decisions API: https://developers.openai.com/api/docs/guides/decisions
  - Chat の単価: https://developers.openai.com/api/docs/pricing
  - キャッシュ: https://developers.openai.com/api/docs/guides/prompt-caching
- データと正解の凍結: `results/v3/FROZEN.md`、test の作り方 `results/v3/test-design.md`、正解の確認 `results/v3/label-review.md`

## 8. 再実行のコマンドと実際の費用

```sh
npx tsx src/v4/eval.ts --set test --dry-run                                               # 見積もり
npx tsx --env-file=.env src/v4/eval.ts --set dev --limit 5 --smoke --budget-usd 0.05      # 動作確認
npx tsx --env-file=.env src/v4/eval.ts --set test --budget-usd 0.40                       # 本評価
npx tsx src/v4/report.ts                                                                  # 集計
node src/v4/verify.mjs                                                                    # 照合
```

実際の費用(usage × 公式の単価): 動作確認 $0.008、本評価 $0.104、合計 $0.113(上限 $1)。
