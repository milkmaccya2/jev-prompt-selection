# Clef 補足: Worker から env.AI で呼んだときの判定時間

- 計画: [PLAN-worker.md](PLAN-worker.md)(測定前に保存)
- 生データ: `results/v4/appendix-clef/raw/worker-run-test-2026-10-11T12-20-42-n100.json`(測定 2026-10-11 21:20〜2026-10-11 21:22 JST)
- 比べた REST の測定: `results/v4/appendix-clef/raw/run-test-2026-10-11T12-09-44-n100.json`(2026-10-11 21:09 JST)。summary は [summary.md](summary.md)
- 一時的な Worker `clef-latency-probe`(`probe/clef-worker/`)から `env.AI.run` を1回ずつ呼び、測定後に削除しました。test 100件・12候補、ウォームアップ3発話、種 20261011 で順番を並べ替え、1件ずつ、再試行なし、失敗 0 件。
- Worker が動いたデータセンター: NRT ×200

## 判定時間(成功した呼び出し、各100件)

| 測り方 | 最速 | p25 | p50 | p75 | p90 | p95 | 最遅 | 1秒超 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Clef・Worker の中(env.AI.run) | 0.14s | 0.30s | **0.39s** | 0.58s | 0.85s | **0.99s** | 1.26s | 5 |
| Clef・端末→Worker→env.AI(往復込み) | 0.16s | 0.34s | **0.44s** | 0.63s | 0.90s | **1.04s** | 1.39s | 7 |
| Clef・端末→REST(先の測定) | 0.24s | 0.49s | **0.54s** | 0.71s | 0.92s | **1.25s** | 1.75s | 8 |
| Clef-flash・Worker の中(env.AI.run) | 0.34s | 0.45s | **0.53s** | 0.71s | 0.96s | **1.15s** | 5.13s | 10 |
| Clef-flash・端末→Worker→env.AI(往復込み) | 0.36s | 0.49s | **0.59s** | 0.78s | 1.02s | **1.17s** | 5.15s | 12 |
| Clef-flash・端末→REST(先の測定) | 0.45s | 0.59s | **0.70s** | 0.92s | 1.30s | **1.72s** | 4.07s | 18 |

- 「Worker の中」は `env.AI.run` を呼ぶ直前から結果が返るまで。端末から Worker までの往復は含みません。
- 端末→Worker の往復ぶん(往復込みの時間 − Worker の中の時間)の p50: Clef 0.03s、Clef-flash 0.03s。
- Worker の中の時間で、Clef-flash のほうが Clef より速かったのは100件中 26 件。
- 同じ日の約10分違いの別の実行です。REST と Worker の差には、時間帯による混み具合の違いも含まれえます。

## 正解率(参考。主な目的は判定時間)

| モデル | Worker 経由の完全一致 [95%CI] | REST の完全一致 | 同じ候補を選んだ件数 | 失敗 |
|---|---|---:|---:|---:|
| Clef | 93% [86–97%] | 93% | 100/100 | 0 |
| Clef-flash | 84% [76–90%] | 84% | 100/100 | 0 |

## 注意

- v4 の4構成の判定時間(2026-10-09)は端末から測った往復の時間なので、「Worker の中」の時間とはそのままでは比べられません。比べるなら往復込みの行です。
- Workers の時計は I/O の前後でしか進まないので、ミリ秒より細かい値は出ません。
- Cloudflare が公表している速さ(Clef-flash 約39ms、Clef 約209ms)とは測り方が違います。

## 再実行

```sh
cd probe/clef-worker && npx wrangler deploy && openssl rand -hex 24 | tr -d '\n' | tee /path/to/probe.key | npx wrangler secret put PROBE_KEY && cd ../..
PROBE_URL=https://clef-latency-probe.<subdomain>.workers.dev PROBE_KEY=$(cat /path/to/probe.key) npx tsx src/v4/evalClef.ts --via worker --set test --budget-usd 0.20
npx tsx src/v4/reportClefWorker.ts
cd probe/clef-worker && npx wrangler delete
```
