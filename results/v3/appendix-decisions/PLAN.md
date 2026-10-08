# appendix: OpenAI Decisions API の追加測定 — 計画

v3 の本編(`results/v3/PLAN.md`、凍結済み)の結果と結論は変えません。v3 の測定のあと(2026-10-08)に公開を知った OpenAI の Decisions API を、v3 と同じ条件で測り、情報として追加します。

## 何を測るか

| 構成 | 呼び方 | 12候補 | 6分類 | 役割 |
|---|---|:-:|:-:|---|
| gpt-6-luna(Decisions API) | `POST /v1/decisions`、choice 1問 | ○ | ○ | 追加する構成 |
| Jev | v3 と同じ | ○ | ○ | 比べる相手(同じ実行の中で呼び直す) |
| gpt-6-luna(推論なし、Chat) | v3 と同じ | ○ | ○ | 参考(同じモデルを別の API で呼んだもの) |

- Decisions API は2026-10-08時点でパブリックベータで、使えるモデルは `gpt-6-luna` だけです(https://developers.openai.com/api/docs/guides/decisions 、2026-10-08 確認)。
- 指示文・候補の説明文・dev・test は、v3 で凍結したものをそのまま使います。実行の前と後に v3 と同じハッシュの確認をします。
- Decisions API には、Jev と同じ `recent_turns` と `user_utterance` の JSON を文字列で渡します(指示文がこの2つの名前を使っているため)。候補は `choices` に、id を `value`、説明文を `description` として渡します。
- 判定時間を同じ条件で比べるため、Jev と gpt-6-luna(Chat)も同じ実行の中で呼び直します。正解率は、呼び直した結果と v3 本編の結果で何件違ったかも書きます。

## 指標と比較

- 主な指標: test での「答えと一致した割合」(別解は含めない)。失敗は不正解
- 主な比較: Decisions API と Jev の McNemar 正確検定(12候補・6分類の2組、Holm 補正)。どちらも同じ実行の中の結果を使う
- 参考の比較: Decisions API と gpt-6-luna(Chat)
- 副指標: 別解込みの正解率、判定時間 p50 / p95、1000回あたりの費用、確信度の区間ごとの正解率(Decisions API と Jev の `confidence`)
- dev は参考

## 測り方

v3 本編と同じです。1台の端末から1回ずつ順番に呼ぶ。各件で6構成の順番を種 `20261004` でランダムに並べ替える。リトライ0回、1回30秒でタイムアウト。ウォームアップは基準書の例の0・1・19番。返ってきたモデル名を記録する。

v3 本編との違い:

- OpenAI の Node SDK を 7.27.0 から 7.30.0 に上げた(Decisions API に対応したのが新しい版のため)。v3 本編は 7.27.0 で測った
- 測った日が違う(本編 2026-10-04、appendix 2026-10-08)。判定時間は、本編の数字とではなく、この実行の中の Jev・gpt-6-luna(Chat)と比べる

## 手順と費用

1. 5件で動作確認: `npx tsx --env-file=.env src/v3/evalAppendix.ts --set dev --limit 5 --smoke --budget-usd 0.05`
2. 本番: test → dev の順に1回ずつ。上限はそれぞれ $0.30(最大の見込みは各 約 $0.09)
3. 集計して `results/v3/appendix-decisions/summary.md` に書く

## 単価(2026-10-08 確認)

| モデル | 入力 / 1M | 出力 | キャッシュ | 確認したページ |
|---|---:|---|---|---|
| gpt-6-luna(Decisions API) | $0.10 | 課金なし | 読み出し・書き込みとも課金なし | https://developers.openai.com/api/docs/guides/decisions |

## 言えないこと(先に決めておくもの)

- Decisions API はベータ版で、今後、精度・速さ・料金が変わりうる
- v3 本編の「言えないこと」(test は易しく、発話が長い、など)はすべてこちらにも当てはまる
