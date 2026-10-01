---
id: query_normalization
kind: selectable
summary: 勤務地・職種の口語や略称・表記ゆれを、検索用の正式な名称に言い換える
summary_en: Normalize colloquial names, abbreviations, and spelling variants of locations and job types into canonical search terms
use_when: ユーザーの発話に、地名・駅名・職種の略称・口語・表記ゆれ・カタカナ語・誤字が含まれ、検索条件に変換する必要がある
use_when_en: The utterance contains location/station names, job-title abbreviations, slang, spelling variants, loanwords, or typos that must be converted into search conditions
not_when: 地名や職種に触れていない、または触れていても検索に使わない
not_when_en: No location or job type is mentioned, or it is mentioned but not used for searching
---
# 勤務地・職種の言い換え

ユーザーの言葉を、search_jobs ツールが受け付ける正式な値に変換します。
変換した結果は、必ずユーザーに確認できる形で示します。

## 勤務地の変換ルール
- 都道府県・市区町村・駅名・エリア名のどれでも受け付ける。
- ツールに渡すときは、次のどれかの形にする。
  - prefecture: 都道府県名(例: 東京都)
  - city: 市区町村名(例: 横浜市西区)
  - station: 駅名(「駅」は付けない。例: 渋谷)
  - area: 下の「エリア名の対応表」にあるキー
- 複数指定は最大3つまで。

### よくある言い方と変換先
- 「都内」→ prefecture: 東京都
- 「23区」「区内」→ area: tokyo_23ku
- 「多摩のほう」→ area: tokyo_tama
- 「横浜あたり」→ city: 横浜市(区の指定がなければ市全体)
- 「大阪市内」「キタ」「ミナミ」→ city: 大阪市 / area: osaka_kita / area: osaka_minami
- 「名駅」→ station: 名古屋
- 「天神」→ station: 天神 / area: fukuoka_tenjin
- 「博多のへん」→ station: 博多
- 「さいたま新都心」→ station: さいたま新都心
- 「関西」→ area: kansai(大阪・京都・兵庫・奈良・滋賀・和歌山)
- 「首都圏」→ area: shutoken(東京・神奈川・埼玉・千葉)
- 「東海」→ area: tokai(愛知・岐阜・三重・静岡)
- 「地元」「実家の近く」→ 具体的な地名を聞く
- 「どこでも」「全国」→ 勤務地の指定なし
- 「リモート」「在宅」「フルリモ」→ remote: full
- 「週何日か在宅」「ハイブリッド」→ remote: hybrid

### エリア名の対応表
| キー | 範囲 |
| tokyo_23ku | 東京23区 |
| tokyo_tama | 東京都の市部 |
| osaka_kita | 梅田・北新地・中之島周辺 |
| osaka_minami | 難波・心斎橋・天王寺周辺 |
| fukuoka_tenjin | 天神・大名・薬院周辺 |
| kansai | 関西6府県 |
| shutoken | 1都3県 |
| tokai | 東海4県 |

### 通勤時間での指定
- 「〇〇から30分以内」→ commute_from: 〇〇, commute_minutes: 30
- 「乗り換えなしで」→ 対応していないことを伝え、路線名で探すことを提案する

## 職種の変換ルール
- ツールに渡すときは job_category(大分類)と keywords(自由語)に分ける。
- 大分類は次のどれか。
  - sales(営業), office(事務・管理), engineer_it(ITエンジニア), engineer_mech(機械・電気),
    creative(デザイン・クリエイティブ), service(販売・接客・飲食), logistics(物流・ドライバー),
    medical(医療・介護), education(教育・保育), construction(建築・施工), manufacturing(製造・工場),
    professional(士業・コンサル), other(その他)

### よくある言い方と変換先
- 「SE」「システムエンジニア」→ engineer_it, keywords: システムエンジニア
- 「PG」「プログラマー」→ engineer_it, keywords: プログラマー
- 「インフラ」「サーバー系」→ engineer_it, keywords: インフラエンジニア
- 「フロント」「フロントエンド」→ engineer_it, keywords: フロントエンド
- 「PM」→ engineer_it, keywords: プロジェクトマネージャー(IT以外の文脈なら確認する)
- 「CS」→ 「カスタマーサポート」か「カスタマーサクセス」か確認する
- 「経理」「会計」「財務」→ office, keywords: 経理
- 「人事」「採用担当」→ office, keywords: 人事
- 「一般事務」「OL」→ office, keywords: 一般事務(「OL」は言い換えて扱う)
- 「営業事務」→ office, keywords: 営業事務(sales ではない)
- 「ルート営業」「ルートセールス」→ sales, keywords: ルート営業
- 「飛び込み」→ sales, keywords: 新規開拓営業
- 「MR」→ sales, keywords: MR(医薬情報担当者)
- 「介護」「ヘルパー」「介護士」→ medical, keywords: 介護職
- 「看護師」「ナース」→ medical, keywords: 看護師
- 「保育士」「保育園の先生」→ education, keywords: 保育士
- 「塾講」「塾の先生」→ education, keywords: 塾講師
- 「ドライバー」「配送」「運ちゃん」→ logistics, keywords: ドライバー
- 「倉庫」「ピッキング」→ logistics, keywords: 倉庫作業
- 「工場」「ライン作業」→ manufacturing, keywords: 製造スタッフ
- 「施工管理」「現場監督」→ construction, keywords: 施工管理
- 「デザイナー」「Webデザ」→ creative, keywords: Webデザイナー
- 「動画編集」→ creative, keywords: 動画編集
- 「コンサル」→ professional, keywords: コンサルタント
- 「飲食」「ホール」「キッチン」→ service, keywords: 飲食店スタッフ
- 「アパレル」「ショップ店員」→ service, keywords: アパレル販売

## 表記ゆれ・誤字
- ひらがな・カタカナ・漢字・英字のゆれは同じものとして扱う(例: えいぎょう→営業)。
- 明らかな誤字(例: 「経里」「看語師」)は正しい表記に直し、直したことを示す。
- 判断できない略語は、推測で決めずに候補を2つ示して聞く。

## 確認の仕方
- 変換した結果は、検索の前に短く示す。
  - 例: 「『名駅』は名古屋駅周辺として探します」
- 変換に自信がないときは、選択肢ボタンで確認する。

## 注意
- 地名が複数の都道府県にある場合(例: 「府中」)は、どちらか確認する。
- 職種名が業界によって意味が変わる場合(例: 「PM」「CS」)は、確認する。
- 差別的・蔑称的な職業名が使われた場合は、正式名称に置き換えて扱い、指摘はしない。
