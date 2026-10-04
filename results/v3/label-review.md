> **レビュー前**(承認されたらこの行を消す)

# ラベルの確認(v3)

## ラベラーに渡したもの

- モデル: `claude-opus-5-5`(Anthropic API、推論 high、構造化出力)
- system: 基準書 v3(`data/LABELING.v3.md`)と候補の説明文(`data/candidates.v3.json` から組み立てた12候補の文)。全件で同じ文なので、プロンプトキャッシュに乗せた
- user: **context(直前の会話) と utterance(発話)だけ**。test の `design`(狙った分類・brief・まぎらわしい相手)と `tags`、dev の v1・v2 のラベルは渡していない
- 出力: 答え(`answer`)、別解(`acceptable`)、根拠(`basis`: どの候補の「扱う範囲」か「境目」か、基本ルール1〜5のどれか)、理由(`reason`)
- 費用: dev $0.55、test $0.47(ほかに5件の動作確認 $0.06)。生データ: `results/v3/raw/labels-claude.json`

## dev(100件)

### 人のラベル(v1)との突き合わせ

| 比べた相手 | 答えの一致率 | Cohen's kappa | 別解まで含めた一致率 |
|---|---:|---:|---:|
| v1(作成者が付けたラベル) | 92.0%(92/100) | 0.909 | 98.0%(98/100) |
| v2(Claude が基準書 v2 で付けたラベル) | 93.0%(93/100) | 0.920 | 100.0%(100/100) |

v1 と答えが違う件(8件):

| id | 発話 | v1 | v3(Claude) | 根拠 |
|---|---|---|---|---|
| e016 | この会社大丈夫?ブラックじゃない? | `company_info`(可: `reviews`) | `reviews`(可: `company_info`) | `reviews` の扱う範囲 |
| e047 | エラー出てログインできないんだけど | `account_terms`(可: `error_handling`) | `error_handling`(可: `account_terms`) | `account_terms` の境目 |
| e060 | こんにちは | `out_of_scope` | `base` | `base` の扱う範囲 |
| e061 | ありがとう!助かった | `out_of_scope` | `base` | `base` の扱う範囲 |
| e070 | はい | `base` | `search_conditions`(可: `base`) | 基本ルール3 |
| e075 | この求人、未経験でもいける? | `base` | `career_advice`(可: `base`) | 基本ルール4 |
| e076 | 面接何回あるの? | `base` | `interview_prep`(可: `base`, `company_info`) | 基本ルール4 |
| e078 | この会社の他の求人も見たい | `base` | `search_conditions`(可: `base`) | `search_conditions` の扱う範囲 |

### v2 から正解が変わった件(7件)

「根拠」は、ラベラーが答えを決めた一番の根拠として選んだものです(基準書のどの文によるか)。

| id | 直前の会話 | 発話 | v2 の正解 | v3 の正解 | 根拠 | ラベラーの理由 |
|---|---|---|---|---|---|---|
| e016 | U「Kデジタルの求人ある?」 A「Kデジタルの求人が1件あります。法人営業の正社員募集です。 [[job:J-20481]] [[company:C-0193]]」 | この会社大丈夫?ブラックじゃない? | `company_info`(可: `reviews`) | `reviews`(可: `company_info`) | `reviews` の扱う範囲 | 直前に紹介されたKデジタルについて「ブラックじゃないか」と職場の実態や評判を知りたい発話なのでreviewsを選び、公開されている残業時間や離職率で答える読み方もできるためcompany_infoも可とする。 |
| e047 | - | エラー出てログインできないんだけど | `account_terms`(可: `error_handling`) | `error_handling`(可: `account_terms`) | `account_terms` の境目 | ログインの問題ではあるものの、エラーが出ているという不具合の報告が主なので、account_terms の境目に従って error_handling とし、サインインの問題としても読めるため account_terms も可とする。 |
| e070 | U「大阪市内で営業、正社員がいい」 A「営業職・大阪市内・正社員で探しますね。よろしいですか?」 | はい | `base`(可: `search_conditions`) | `search_conditions`(可: `base`) | 基本ルール3 | 短い返事「はい」は、直前にアシスタントが確認した希望条件(営業職・大阪市内・正社員)への同意なので、目的は仕事探しの続行と読めます。ただし、検索を実行するだけの返事とも読めるため base も可とします。 |
| e075 | U「Kデジタルの求人ある?」 A「Kデジタルの求人が1件あります。法人営業の正社員募集です。 [[job:J-20481]] [[company:C-0193]]」 | この求人、未経験でもいける? | `base`(可: `career_advice`) | `career_advice`(可: `base`) | 基本ルール4 | 求人の詳細を見れば答えられる質問ですが、「経験のない分野への挑戦」というキャリア相談の要素を含むため base ではなく career_advice とし、詳細表示で済む読み方も考えて base を別解にしました。 |
| e076 | U「Kデジタルの求人ある?」 A「Kデジタルの求人が1件あります。法人営業の正社員募集です。 [[job:J-20481]] [[company:C-0193]]」 | 面接何回あるの? | `base` | `interview_prep`(可: `base`, `company_info`) | 基本ルール4 | 直前に紹介されたKデジタルの求人について、選考での面接回数を尋ねています。求人の詳細を見れば答えられますが、面接(選考)の分野に関わるため base にせず interview_prep を選びます。 |
| e078 | U「Kデジタルの求人ある?」 A「Kデジタルの求人が1件あります。法人営業の正社員募集です。 [[job:J-20481]] [[company:C-0193]]」 | この会社の他の求人も見たい | `base`(可: `search_conditions`) | `search_conditions`(可: `base`) | `search_conditions` の扱う範囲 | 直前に紹介したKデジタルの、ほかの求人を新たに探したいという仕事探しの依頼です。ツールで検索するだけでも済むため、base も可とします。 |
| e087 | - | 応募したいけどWeb履歴書が埋まってないって出る | `error_handling`(可: `application_docs`) | `application_docs`(可: `error_handling`) | `application_docs` の扱う範囲 | 応募の前に「Web履歴書が埋まっていない」と表示されており、不具合ではなくサイト上の履歴書の入力内容を整えることが主な課題なので application_docs とし、エラー表示の報告とも読めるため error_handling も可とする。 |

- 答えは同じで、別解だけが変わった件: 30件(一覧は省略。生データで確認できる)

## test(100件)

### 狙った分類と正解がずれた件(0件)

**0件。** 100件すべてで、ラベラーの答えが発話を作るときに狙った分類と一致した。

ずれが0件だったこと自体に注意が要る。test の発話は dev より長く(平均 約29文字と約16文字)、作り手が狙った分類に合わせて書き分けているため、分類しやすい発話に寄っている可能性がある。この点は summary の「言えないこと」に書く。

レビューで「ずれうる」と挙がった発話のラベル:

| id | 発話 | 狙った分類 | 正解 | 根拠 | ラベラーの理由 |
|---|---|---|---|---|---|
| t096 | そういえばあなたってAIなの?名前とかあるの? | `base` | `base`(可: `out_of_scope`) | `base` の扱う範囲 | アシスタント自身がAIかどうかや名前を尋ねる軽い質問で、断る必要はなく、人格の基本ルールだけで普通に答えられるため base とし、求人と無関係な雑談とも読めるので out_of_scope も可とした。 |
| t097 | 今日さー、久しぶりに友だちとランチ行ってきたんだよね | `base` | `base`(可: `out_of_scope`) | `base` の扱う範囲 | 求人の相談を含まない軽い雑談で、断る必要のある質問や依頼でもないため、あいさつと同じように基本プロンプトで自然に返せますが、本来の相談に戻す対応とも読めるので out_of_scope も可とします。 |

### 正解の分布

| 正解 | 件数 |
|---|---:|
| `search_conditions` | 14 |
| `base` | 10 |
| `salary_benefits` | 9 |
| `out_of_scope` | 9 |
| `career_advice` | 8 |
| `application_docs` | 8 |
| `interview_prep` | 8 |
| `company_info` | 7 |
| `reviews` | 7 |
| `account_terms` | 7 |
| `error_handling` | 7 |
| `query_normalization` | 6 |

### 範囲外と基本の話題(正解が付いたあとに数え直したもの)

| 正解 | 件数 | 説明文に挙げた話題 | 説明文に挙げていない話題 | 話題の指定なし(境目などで移ってきた件) |
|---|---:|---:|---:|---|
| `out_of_scope` | 9 | 4 | 5 | - |
| `base` | 10 | 5 | 5 | - |

### 全件の一覧

「ずれ」は、正解が狙った分類と違う件に ● を、正解は違うが狙った分類が別解に入っている件に △ を付けています。

| id | 直前の会話 | 発話 | Claude の答え・別解 | 狙った分類 | ずれ |
|---|---|---|---|---|---|
| t001 | - | 札幌で経理の正社員の求人を探してます。未経験可だとうれしいです | `search_conditions` | `search_conditions` |  |
| t002 | - | 時給1300円以上で、土日だけ入れるバイトない? | `search_conditions` | `search_conditions` |  |
| t003 | U「川崎で調理補助のパートを探したい」 A「川崎市内で調理補助のパートを探しましたが、該当は2件でした。」 | 少なすぎるので、神奈川全体に広げて探し直して | `search_conditions` | `search_conditions` |  |
| t004 | U「仙台でカスタマーサポートの仕事を探してる」 A「仙台のカスタマーサポート求人が48件見つかりました。正社員・契約社員・派遣・パートが含まれます。」 | じゃあ契約社員だけにして | `search_conditions` | `search_conditions` |  |
| t005 | - | 先週こっち越してきたばっかで全然わかんないんだけど、家から近いとこで働きたい | `search_conditions` | `search_conditions` |  |
| t006 | - | 第二種電気工事士を持ってるので、その資格を活かせる仕事を探したいです | `search_conditions`(可: `career_advice`) | `search_conditions` |  |
| t007 | - | ぐんまで、けんちく設計の求人をさがしてます | `search_conditions` | `search_conditions` |  |
| t008 | - | こうべで事務のしごと探してるんだけど | `search_conditions` | `search_conditions` |  |
| t009 | - | ハマで調理の仕事、週3くらいで入れるとこ探してるんだよね | `search_conditions` | `search_conditions` |  |
| t010 | - | MRの求人を関東で探したいです。正社員でお願いします | `search_conditions` | `search_conditions` |  |
| t011 | - | 検索したら1件しか出なかった。壊れてるわけじゃなさそうだけど、もっと見たいな | `search_conditions` | `search_conditions` |  |
| t012 | - | 今日めっちゃ頭痛いわ〜。それはそうと、岡山で在宅OKの事務ない? | `search_conditions` | `search_conditions` |  |
| t013 | U「京都で週3の図書館スタッフがいい」 A「京都府内・週3勤務・図書館スタッフの条件で探しますか?」 | うん、それでお願い | `search_conditions`(可: `base`) | `search_conditions` |  |
| t014 | - | 家から片道40分以内で通える事務の仕事ないかな〜 | `search_conditions` | `search_conditions` |  |
| t015 | - | 求人に出てる「県央エリア」って、どの市まで入るの? | `query_normalization` | `query_normalization` |  |
| t016 | - | 「営事」ってなんの職種のこと?営業事務の略? | `query_normalization` | `query_normalization` |  |
| t017 | - | 求人の勤務地にある「五十集町」ってなんて読むの?読み方だけ知りたい | `query_normalization` | `query_normalization` |  |
| t018 | - | うちの地元で「北摂」って言うけど、その呼び方で検索して通じる? | `query_normalization` | `query_normalization` |  |
| t019 | U「Yリンクの募集要項に「SV候補」って書いてあった」 A「「SV候補」は、募集要項の中で使われている略称ですね。」 | その「SV」って正式には何て言うの? | `query_normalization` | `query_normalization` |  |
| t020 | - | 「ふろんとえんどえんじにあ」って、正しい表記はどれ?カタカナでどう書くの? | `query_normalization` | `query_normalization` |  |
| t021 | - | Hテックって設立いつ?従業員は何人くらいいるの? | `company_info` | `company_info` |  |
| t022 | - | Wフードの離職率ってどんくらいか公表されてる? | `company_info`(可: `reviews`) | `company_info` |  |
| t023 | U「Yリンクの営業職に興味あるんだけど」 A「Yリンクの営業職ですね。気になる点があれば教えてください。」 | 本社ってどこにあるの?支社もある? | `company_info` | `company_info` |  |
| t024 | - | Bメディアからスカウト来たんだけど、会社の規模ってどのくらい? | `company_info` | `company_info` |  |
| t025 | - | Qロジスティクスって在宅勤務の制度あるの?対象は誰か知りたい | `company_info`(可: `salary_benefits`) | `company_info` |  |
| t026 | - | Lクリニックの職員数と拠点数教えて。あと評判もちょっと気になる | `company_info`(可: `reviews`) | `company_info` |  |
| t027 | - | Hテクの資本金っていくらか分かる? | `company_info` | `company_info` |  |
| t028 | - | Wフードで子育てしながら働いてる人の口コミってある? | `reviews` | `reviews` |  |
| t029 | U「Hテックの求人が気になってるんだけど」 A「Hテックですね。口コミも投稿されていますので、気になる点があればお調べします。」 | そこの口コミって、良い評価と悪い評価どっちが多いの? | `reviews` | `reviews` |  |
| t030 | - | Bメディアの上司や社内の人間関係について、クチコミで何か書かれてる? | `reviews` | `reviews` |  |
| t031 | - | 前に自分が書いた口コミ、やっぱ消したいんだけどどうやるの? | `reviews`(可: `account_terms`) | `reviews` |  |
| t032 | - | Qロジスティクスで働いた人って、残業の多さについてどう感じてた? | `reviews`(可: `company_info`) | `reviews` |  |
| t033 | - | Bメディアの面接受ける前に、社員さんの雰囲気を口コミで見ておきたい | `reviews` | `reviews` |  |
| t034 | - | クチコミの総合点って、何を基準に付いてる点数なの? | `reviews`(可: `account_terms`) | `reviews` |  |
| t035 | - | 求人票の「基本給+諸手当」って、諸手当には何が含まれるの? | `salary_benefits` | `salary_benefits` |  |
| t036 | - | ボーナスからも税金とか保険料って引かれるの?満額もらえるわけじゃないよね | `salary_benefits` | `salary_benefits` |  |
| t037 | - | 年間休日120日と、125日ってどのくらい違うの? | `salary_benefits` | `salary_benefits` |  |
| t038 | U「札幌で事務の求人を見せて」 A「Hテックの事務職など3件が見つかりました。1件目は月給22万円からです。」 | 1件目って住宅手当や家族手当はついてる? | `salary_benefits`(可: `base`, `company_info`) | `salary_benefits` |  |
| t039 | - | 同じ事務でも正社員と派遣だと、時給に直したらどれくらい差が出るもん? | `salary_benefits` | `salary_benefits` |  |
| t040 | - | 試用期間中は給料下がるって書いてあったんだけど、それって普通なの? | `salary_benefits` | `salary_benefits` |  |
| t041 | - | 福利厚生でよく見る「カフェテリアプラン」ってどういう制度? | `salary_benefits` | `salary_benefits` |  |
| t042 | - | 年収は低めで残業なしの会社と、年収高めで残業多めの会社、待遇面で比べるとどっちが得? | `salary_benefits`(可: `career_advice`) | `salary_benefits` |  |
| t043 | - | ざんぎょう代って、月給と労働時間からどうやって計算するの? | `salary_benefits` | `salary_benefits` |  |
| t044 | - | 課長にならないかって話が来てるんだけど、ずっと現場の専門職でいたい気もして迷ってる | `career_advice` | `career_advice` |  |
| t045 | - | 人と話す仕事と数字を扱う仕事、どっちの道に進むべきか決められません | `career_advice` | `career_advice` |  |
| t046 | - | 契約社員から正社員になりたいんだけど、まず何から準備したらいいんだろ | `career_advice`(可: `search_conditions`) | `career_advice` |  |
| t047 | - | ずっと販売だったけど、デザインの分野に挑戦してみたい。まず何から考えるべき? | `career_advice` | `career_advice` |  |
| t048 | U「自分のアピールポイントがよくわからなくて」 A「これまでのお仕事で、周りから頼られたことや褒められたことはありますか?」 | 後輩の指導を任されることが多かったかな。これって強みになる?整理を手伝ってほしい | `career_advice`(可: `application_docs`) | `career_advice` |  |
| t049 | - | 残業が月60時間超えでしんどい。でも給料はいいから辞めるか迷う | `career_advice`(可: `salary_benefits`, `base`) | `career_advice` |  |
| t050 | - | 求人見る前にさ、自分が何したいのか整理したいんだよね。話聞いてくれる? | `career_advice`(可: `search_conditions`) | `career_advice` |  |
| t051 | - | 来年地方に移住しようと思ってるんですが、今の職種のまま働きつずけられるか不安です | `career_advice`(可: `search_conditions`) | `career_advice` |  |
| t052 | - | 履歴書の学歴って、どこから書き始めるのが正しいの? | `application_docs` | `application_docs` |  |
| t053 | - | 複数社に応募するとき、志望動機ってどこを会社ごとに変えればいいの? | `application_docs` | `application_docs` |  |
| t054 | - | 派遣で3社まわったんだけど、職務経歴書って全部ばらばらに書くの?まとめていい? | `application_docs` | `application_docs` |  |
| t055 | U「自己PRを書いたので見てください。「私は粘り強さが強みで、どんな仕事も最後までやり遂げます」」 A「粘り強さが伝わる一文ですね。ただ、具体的なエピソードが入るとより説得力が増します。」 | じゃあ在庫管理で欠品を半分に減らした話を入れて、書き直してもらえる? | `application_docs` | `application_docs` |  |
| t056 | - | 退職理由、人間関係が原因だったんだけど書類にはどう書けばいい? | `application_docs` | `application_docs` |  |
| t057 | - | 面接でも聞かれると思うけど、まず書類の自己PR欄ってどういう構成で書くのがいい? | `application_docs`(可: `interview_prep`) | `application_docs` |  |
| t058 | U「Hテックの求人に応募するところなんだけど」 A「応募フォームの入力画面まで進まれましたか?わからない点があればお聞きください。」 | 最後の自由記入欄、何を書けばいいかわからなくて。アピールしたいことって何書くべき? | `application_docs` | `application_docs` |  |
| t059 | - | しかく欄に普通自動車免許と日商簿記2級を書きたいんだけど、書き方これで合ってる? | `application_docs` | `application_docs` |  |
| t060 | - | 面接の最後に「何か一言どうぞ」って言われたら、なに話せばいい? | `interview_prep` | `interview_prep` |  |
| t061 | - | 面接のあとにお礼メールって送ったほうがいいですか?送るならどんな内容にすればいいでしょう | `interview_prep`(可: `application_docs`) | `interview_prep` |  |
| t062 | - | 初めてZoomで面接受けるんだけど、事前に何チェックしとけばいい? | `interview_prep` | `interview_prep` |  |
| t063 | U「面接で長所を聞かれたときの答えを考えてみた」 A「ぜひ聞かせてください。どんな長所を伝えようと考えていますか?」 | 「粘り強いところです」って言うつもり。このあと深掘りされたらどう返せばいい? | `interview_prep` | `interview_prep` |  |
| t064 | - | 面接で希望の待遇を聞かれたとき、休みや手当の希望はどう伝えるのが印象いい? | `interview_prep`(可: `salary_benefits`) | `interview_prep` |  |
| t065 | - | 履歴書に書いた退職理由を、面接で聞かれたときどう話せばいいか教えて | `interview_prep`(可: `application_docs`) | `interview_prep` |  |
| t066 | U「Hテックの求人を見せて」 A「Hテックの事務職の求人です。選考は書類のあと面接が2回あります。」 | その2回の面接、それぞれどんな準備しとけばいい? | `interview_prep` | `interview_prep` |  |
| t067 | - | 面接の服そう、スーツじゃなきゃだめ?私服でもいいって言われたんだけど | `interview_prep` | `interview_prep` |  |
| t068 | - | 登録している電話番号を新しい番号に変更したいです | `account_terms` | `account_terms` |  |
| t069 | - | アプリのプッシュ通知、夜は鳴らないようにしたいんだけど | `account_terms` | `account_terms` |  |
| t070 | - | 退会したあとに、同じメールアドレスでもう一度登録することってできる? | `account_terms` | `account_terms` |  |
| t071 | - | ログインするたびに確認コード届くの面倒なんだけど、あれ止められない? | `account_terms` | `account_terms` |  |
| t072 | U「Yリンクの求人に応募したんだけど、やっぱり辞退しようか迷ってる」 A「応募の取り下げはマイページからできます。ほかに気になる点はありますか?」 | 取り下げたら、送った履歴書とかは向こうで消してもらえるの? | `account_terms` | `account_terms` |  |
| t073 | - | ログインに使ったメールアドレスがどれだったか思い出せない。確認する方法ある? | `account_terms` | `account_terms` |  |
| t074 | - | りようきやくの中で、データの扱いについて書いてある部分を確認したい | `account_terms` | `account_terms` |  |
| t075 | - | 求人の写真が全然出てこないんだけど、灰色の四角のまま | `error_handling` | `error_handling` |  |
| t076 | - | 保存した求人の一覧を開いたら、E-4021って表示されて見られません | `error_handling` | `error_handling` |  |
| t077 | U「Yリンクの求人、条件に合うものをもう一度検索して」 A「申し訳ありません、検索ツールの実行中に問題が発生し、結果を取得できませんでした。」 | さっきのって何が起きたの?どうして出なかったの? | `error_handling` | `error_handling` |  |
| t078 | - | アプリ開いたらすぐ落ちるんだけどー、なんで? | `error_handling` | `error_handling` |  |
| t079 | - | サインインは通るのに、マイページ開くたびに勝手にサインアウトされちゃう | `error_handling`(可: `account_terms`) | `error_handling` |  |
| t080 | - | 検索ボタンを押してもぐるぐる回るだけで、条件入力の画面が開かない | `error_handling` | `error_handling` |  |
| t081 | - | スマホで見ると求人のひょうじがずれて文字が重なってる | `error_handling` | `error_handling` |  |
| t082 | - | カレーのルーって何入れたらコク出る?隠し味知りたい | `out_of_scope` | `out_of_scope` |  |
| t083 | - | JavaScriptでforEachとmapの違いってなに? | `out_of_scope` | `out_of_scope` |  |
| t084 | - | 明日の東京って傘いるかな?夕方から雨って聞いたんだけど | `out_of_scope` | `out_of_scope` |  |
| t085 | - | 履歴書に大卒って書きたい。実際は中退だけど、バレない書き方にして | `out_of_scope`(可: `application_docs`) | `out_of_scope` |  |
| t086 | - | ボーナス出たから投資信託始めようかなって。何買えばいい? | `out_of_scope` | `out_of_scope` |  |
| t087 | - | 好きな人にLINE送ったのに既読スルーされてる。どうしたらいい? | `out_of_scope` | `out_of_scope` |  |
| t088 | - | この英文を日本語に訳してほしい。"Thank you for your prompt reply." | `out_of_scope` | `out_of_scope` |  |
| t089 | - | 来月連休とれたし京都行きたい!2泊3日のプラン考えて〜 | `out_of_scope` | `out_of_scope` |  |
| t090 | U「ちょっと仕事と関係ない話なんだけどいい?」 A「はい、どうぞ。どんなことでしょうか?」 | ドラム式と縦型の洗濯機、一人暮らしならどっちがいい? | `out_of_scope` | `out_of_scope` |  |
| t091 | - | 仕事終わりに寄ってみました、こんばんは〜 | `base` | `base` |  |
| t092 | U「事務の仕事を探してるんだけど、条件がまだ固まってなくて」 A「それなら、希望の勤務地や働き方を一緒に整理してみましょうか?」 | いや、整理するのは今はいいや。また今度にする | `base` | `base` |  |
| t093 | U「さっき気になるやつ保存したよね」 A「はい、「Hテックの事務職」と「Wフードの店舗スタッフ」の2件を保存しています。」 | Wフードのほうは保存やっぱ外しといて | `base` | `base` |  |
| t094 | - | 最近ずっと頭が痛くて、体がだるいです | `base` | `base` |  |
| t095 | U「Yリンクの求人を3件出して」 A「Yリンクの求人を3件表示します。1. 営業事務 2. カスタマーサポート 3. 法人営業」 U「給与のところを見たい」 A「画面の表示項目を切り替えられます。」 | 3件とも給与の欄を表示に切り替えて | `base`(可: `salary_benefits`) | `base` |  |
| t096 | - | そういえばあなたってAIなの?名前とかあるの? | `base`(可: `out_of_scope`) | `base` |  |
| t097 | - | 今日さー、久しぶりに友だちとランチ行ってきたんだよね | `base`(可: `out_of_scope`) | `base` |  |
| t098 | U「Bメディアの求人で気になるのがあるんだけど」 A「どの求人か教えてください。職種や勤務地がわかると確認しやすいです。」 | ごめん、ちょっと待ってて。いま調べてくる | `base` | `base` |  |
| t099 | U「来週の水曜に時間あるから、その日に求人を見返すね」 A「わかりました。水曜日にまた確認しましょう。」 | あ、ごめん、水曜じゃなくて木曜だった | `base` | `base` |  |
| t100 | - | きょうはここまでにします。またこんど続きおねがいします | `base` | `base` |  |
