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

## 追加の対応表
### 勤務地(地名の口語・愛称)
- 「ハマ」→ city: 横浜市
- 「みなとみらい」→ station: みなとみらい
- 「新宿らへん」「新宿周辺」→ station: 新宿
- 「丸の内」「大手町」→ station: 東京 / station: 大手町
- 「京都市内」→ city: 京都市
- 「三宮」→ station: 三宮
- 「札幌駅前」→ station: 札幌
- 「仙台の中心部」→ station: 仙台
- 「広島市内」→ city: 広島市
- 「埼玉の南のほう」→ 市区町村を候補で示して確認する(川口市、さいたま市、戸田市 など)
- 「千葉の東京寄り」→ 市区町村を候補で示して確認する(市川市、船橋市、浦安市 など)

### 同じ名前の地名
- 「府中」(東京都・広島県)
- 「伊達」(北海道・福島県)
- 「朝日町」(複数の県)
- 「中央区」(東京都・大阪市・札幌市など)
- これらは必ず都道府県を確認する。

### 職種(業界用語・カタカナ語)
- 「バックオフィス」→ office(経理・人事・総務のどれか確認する)
- 「インサイドセールス」→ sales, keywords: インサイドセールス
- 「カスタマーサクセス」→ sales, keywords: カスタマーサクセス
- 「データアナリスト」→ engineer_it, keywords: データアナリスト
- 「QA」「テスター」→ engineer_it, keywords: テストエンジニア
- 「ディレクター」→ 業界(Web・映像・広告)を確認する
- 「マーケ」→ creative, keywords: マーケティング(営業寄りなら確認する)
- 「受付」→ office, keywords: 受付
- 「コールセンター」「テレオペ」→ office, keywords: コールセンター
- 「軽作業」→ logistics, keywords: 軽作業
- 「調理師」「料理人」→ service, keywords: 調理スタッフ
- 「美容師」→ service, keywords: 美容師
- 「薬剤師」→ medical, keywords: 薬剤師
- 「警備」→ other, keywords: 警備員
- 「清掃」→ other, keywords: 清掃スタッフ

### 英字・略語の大文字小文字
- 「se」「Se」「ＳＥ」(全角)は、すべて「SE」として扱う。
- 全角英数字は半角に直してから変換する。

### 送り仮名・長音のゆれ
- 「プログラマ」「プログラマー」は同じ。
- 「ドライバ」「ドライバー」は同じ。
- 「エンジニヤ」などの誤記も「エンジニア」として扱う。
