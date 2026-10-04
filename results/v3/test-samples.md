> **レビュー前**(承認されたらこの行を消す)

# test の発話サンプル(20件)

分類とタグの割合が test 全体と近くなるように選んだ20件です。正解はまだ付けていません。「狙った分類」は発話を作るときの指定で、正解とは限りません。

- 狙った分類: `search_conditions` 3、`query_normalization` 1、`company_info` 1、`reviews` 2、`salary_benefits` 2、`career_advice` 2、`application_docs` 1、`interview_prep` 1、`account_terms` 1、`error_handling` 2、`out_of_scope` 2、`base` 2
- タグ: 境目 5、文脈あり 3、口語 7、誤字 2、言い換え自体が目的 1、説明文に挙げた話題 2、挙げていない話題 2

| id | 直前の会話 | 発話 | 狙った分類 | まぎらわしい相手 | タグ |
|---|---|---|---|---|---|
| t002 | - | 時給1300円以上で、土日だけ入れるバイトない? | `search_conditions` | - | colloquial |
| t009 | - | ハマで調理の仕事、週3くらいで入れるとこ探してるんだよね | `search_conditions` | `query_normalization` | boundary, colloquial |
| t013 | U「京都で週3の図書館スタッフがいい」 A「京都府内・週3勤務・図書館スタッフの条件で探しますか?」 | うん、それでお願い | `search_conditions` | - | context |
| t017 | - | 求人の勤務地にある「五十集町」ってなんて読むの?読み方だけ知りたい | `query_normalization` | `search_conditions` | qn_purpose, boundary |
| t021 | - | Hテックって設立いつ?従業員は何人くらいいるの? | `company_info` | - | - |
| t029 | U「Hテックの求人が気になってるんだけど」 A「Hテックですね。口コミも投稿されていますので、気になる点があればお調べします。」 | そこの口コミって、良い評価と悪い評価どっちが多いの? | `reviews` | - | context |
| t032 | - | Qロジスティクスで働いた人って、残業の多さについてどう感じてた? | `reviews` | `company_info` | boundary |
| t036 | - | ボーナスからも税金とか保険料って引かれるの?満額もらえるわけじゃないよね | `salary_benefits` | - | colloquial |
| t043 | - | ざんぎょう代って、月給と労働時間からどうやって計算するの? | `salary_benefits` | - | typo |
| t047 | - | ずっと販売だったけど、デザインの分野に挑戦してみたい。まず何から考えるべき? | `career_advice` | - | - |
| t049 | - | 残業が月60時間超えでしんどい。でも給料はいいから辞めるか迷う | `career_advice` | `salary_benefits` | boundary |
| t053 | - | 複数社に応募するとき、志望動機ってどこを会社ごとに変えればいいの? | `application_docs` | - | - |
| t062 | - | 初めてZoomで面接受けるんだけど、事前に何チェックしとけばいい? | `interview_prep` | - | colloquial |
| t071 | - | ログインするたびに確認コード届くの面倒なんだけど、あれ止められない? | `account_terms` | - | colloquial |
| t079 | - | サインインは通るのに、マイページ開くたびに勝手にサインアウトされちゃう | `error_handling` | `account_terms` | boundary |
| t081 | - | スマホで見ると求人のひょうじがずれて文字が重なってる | `error_handling` | - | typo |
| t083 | - | JavaScriptでforEachとmapの違いってなに? | `out_of_scope` | - | topic_listed |
| t087 | - | 好きな人にLINE送ったのに既読スルーされてる。どうしたらいい? | `out_of_scope` | - | topic_unlisted |
| t093 | U「さっき気になるやつ保存したよね」 A「はい、「Hテックの事務職」と「Wフードの店舗スタッフ」の2件を保存しています。」 | Wフードのほうは保存やっぱ外しといて | `base` | - | topic_listed, context, colloquial |
| t097 | - | 今日さー、久しぶりに友だちとランチ行ってきたんだよね | `base` | - | topic_unlisted, colloquial |

全100件は `data/eval.v3.test.jsonl` にあります。
