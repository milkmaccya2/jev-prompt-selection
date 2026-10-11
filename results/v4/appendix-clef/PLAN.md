# v4 補足: Cloudflare Clef / Clef-flash の追加測定(計画)

作成: 2026-10-11(測定の前に保存)。結果を見たあとで指標・採点のしかた・入力を変えません。変えた場合は、変えた点と理由を summary に書き、計画どおりの数字も残します。

## 位置づけ

- v4 本編(`results/v4/`、2026-10-09 測定)の **補足** です。v4 の4構成(Jev・Decisions API・gpt-6-luna Chat・gpt-5.4-nano Chat)は測り直しません。v4 本編のファイルは変更しません。
- **測定日時が v4 本編と異なります。** 4構成と並べた表は参考で、同じ実行の中での比較ではありません。検定(McNemar)は、同じ実行の中の Clef 対 Clef-flash だけ参考に出し、v4 の4構成との検定はしません。
- test 100件は、v3 で凍結し、すでに結果を見たことのあるデータの再利用です。新しい評価データは追加しません。

## 対象

| key | モデル | 呼び方 |
|---|---|---|
| `clef` | `@cf/cloudflare/clef`(本文の `model: "clef"`) | Workers AI REST `POST https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/@cf/cloudflare/clef` |
| `clefflash` | `@cf/cloudflare/clef-flash`(本文の `model: "clef-flash"`) | 同じ REST、`@cf/cloudflare/clef-flash` |

- 粒度は **12候補だけ**(v4 の主な結果)。6分類は測りません。
- API が返したモデル名を呼び出しごとに記録します。Omni は対象外です。

## 入力(固定)

- 評価データ `data/eval.v3.test.jsonl`、指示文・候補の説明文 `data/candidates.v3.json`、正解の基準 `data/LABELING.v3.md`。最初の呼び出しの前と最後の呼び出しの後に `results/v3/FROZEN.md` のハッシュを確かめます(v4 と同じ `checkFrozen()`)。
- Clef は Jev の System One 形式と互換とされているので、**Jev に送った本文と同じ形** にします: `{ model, state, questions: { main: { type: "choice", instructions, criteria } } }`。`state`・`instructions`・`criteria` は Jev と同じ関数(`buildState`・`instruction()`・`fineCandidates()`)で作ります。違うのは `model` の値と送り先だけです。
- 結果を見ながら入力や説明文を調整しません。

## 測り方(v4 の実装に合わせる)

- 1台の端末から1件ずつ順番に呼びます。並列にしません。
- 各件で2つの呼び出しの順番を、種 `20261011` の乱数(mulberry32、v4 と同じ並べ替え)で並べ替え、生データに残します。
- 再試行は0回(`fetch` を1回だけ)。1回の呼び出しは30秒でタイムアウト。
- 判定時間は v4 と同じく、端末側で呼び出しの直前から応答の JSON を読み終えるまで(`performance.now()`)。
- 失敗(HTTP エラー、タイムアウト、候補 id として読めない応答)は記録し、不正解として採点します。
- ウォームアップ: v4 と同じ基準書の例 0・1・19番の3発話を両モデルで1回ずつ呼び、採点しません。
- 動作確認: dev の最初の5件(v4 と同じ理由。集計に使わない)。問題がなければそのまま本評価に進みます。
- 生レスポンス(API が返した JSON 全体)を、呼び出しごとに生データに保存します。
- 認証: wrangler にログイン済みの OAuth トークン(`ai (write)` 権限)を実行時に読み、ファイル・ログには出しません。

## 費用

| 手順 | 見込み(最大) | 上限 |
|---|---:|---:|
| 動作確認(dev 5件 + ウォームアップ) | 約 $0.005 | $0.05 |
| 本評価(test 100件 + ウォームアップ) | 約 $0.07 | $0.20 |

- 単価(2026-10-11 確認、`PRICING.md`): Clef $0.240 / 1M 入力、Clef-flash $0.038 / 1M 入力、出力は課金なし。
- 1000件あたりの費用は「入力トークン × 公式単価」で計算します。Workers AI の無料枠(1日1万 Neurons)で実際の請求が0になる場合も、表の費用は単価で計算した値です。

## 集計

- 12候補の完全一致率(95% Wilson 区間)、別解を含む一致率(許容正答率)、失敗件数。
- 判定時間 p50 / p95(成功した呼び出しだけ)。倍率を書くときは「p50 どうしの比」と明記。
- トークン(入力・出力)、1000件あたりの費用、算出根拠と確認日。
- 確信度(返ってくれば): `confidence` の区間(0.5未満 / 0.5〜0.7 / 0.7〜0.9 / 0.9以上)ごとの件数と一致率。選んだ候補の確率は別の値として扱う。
- 誤答の例: test の実際の結果から(id・発話・正解・別解・Clef / Clef-flash の選択・確信度、同じ id の v4 Jev / Decisions の選択)。
- v4 の4構成(2026-10-09)と並べた表。測定日時が異なることを表に書きます。
- 予算で止まった実行、途中で終わった実行、ハッシュが変わった実行は集計しません。

## 出すもの(`results/v4/appendix-clef/`)

PLAN.md(この計画)、PRICING.md、raw/smoke-dev-*.json、raw/run-test-*.json、metrics.json、summary.md。

## 範囲外

v4 の4構成の再測定、6分類、新しい評価データ、プロンプトの調整、スライドと Web アプリの変更。
