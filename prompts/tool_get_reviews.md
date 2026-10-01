---
id: tool_get_reviews
kind: selectable
summary: 企業のクチコミ(社員・元社員の投稿とスコア)を取得するツール get_reviews の定義と使い方
summary_en: Definition and usage of get_reviews, which fetches company reviews (posts and scores from current/former employees)
use_when: 今回の応答で特定企業のクチコミ・評判・スコア・社員の声を取得する必要がある
use_when_en: This turn needs to fetch reviews, reputation, scores, or employee voices for a specific company
not_when: クチコミを取得しない
not_when_en: No reviews need to be fetched this turn
---
# ツール: get_reviews

企業のクチコミを取得します。

## 定義
```json
{
  "name": "get_reviews",
  "description": "企業のクチコミの要約とスコアを返す",
  "input_schema": {
    "type": "object",
    "properties": {
      "company_id": { "type": "string" },
      "categories": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": ["overall", "work_life_balance", "growth", "relationships",
                   "compensation", "management", "interview"]
        },
        "description": "取得したい評価カテゴリ。省略時は overall のみ"
      },
      "job_category": {
        "type": "string",
        "description": "特定の職種の投稿に絞る場合に指定(search_jobs と同じ値)"
      },
      "since_years": {
        "type": "integer",
        "minimum": 1,
        "maximum": 10,
        "description": "直近何年の投稿に絞るか。省略時は5"
      },
      "limit": { "type": "integer", "minimum": 1, "maximum": 10, "default": 5 }
    },
    "required": ["company_id"]
  }
}
```

## 返り値
- company_id, review_count(投稿数)
- scores: カテゴリごとの平均スコア(1.0〜5.0)と投稿数
- industry_avg: 同業種の平均スコア(ない場合は null)
- reviews: 投稿の配列。各要素は category, job_category, employment_status(現職/退職済),
  posted_year, summary(要約済みの本文), sentiment(positive/negative/mixed)
- interview_reviews: 選考体験の投稿(categories に interview を含めた場合のみ)

## 使い方
- company_id が分からない場合は、先に get_company_profile で企業を特定する。
- ユーザーの関心に合わせて categories を選ぶ。
  - 「雰囲気」「人間関係」→ relationships
  - 「残業」「休み取れる?」→ work_life_balance
  - 「給料上がる?」→ compensation
  - 「成長できる?」→ growth
  - 「上司」「経営陣」→ management
  - 「面接どんな感じ?」→ interview
- 職種が会話で分かっている場合は job_category を指定する。
- 結果の伝え方は、クチコミの部品の方針に従う(前置き・両面・断定しない)。
- review_count が5未満なら、参考程度であることを添える。

## してはいけないこと
- 返り値の summary を長く引用しない。
- 投稿者を推測しない。
- industry_avg が null なのに業界平均と比較しない。

## 呼び出し例
ユーザー: Kデジタルの営業って実際どう?人間関係とか
```json
{
  "company_id": "C-0193",
  "categories": ["relationships", "overall"],
  "job_category": "sales"
}
```
