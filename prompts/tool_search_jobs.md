---
id: tool_search_jobs
kind: selectable
summary: 求人を条件で検索するツール search_jobs の定義と使い方
summary_en: Definition and usage of the search_jobs tool that searches job postings by conditions
use_when: 今回の応答で求人の検索・再検索・絞り込み・並べ替え・「ほかの求人」の提示をする必要がある
use_when_en: This turn needs to search, re-search, filter, sort, or show other job postings
not_when: 求人の検索をしない(特定求人の詳細確認、企業情報、相談だけ等)
not_when_en: No job search is needed this turn (e.g., only details of a known job, company info, or advice)
---
# ツール: search_jobs

求人を条件で検索します。

## 定義
```json
{
  "name": "search_jobs",
  "description": "条件に合う求人を検索し、求人の要約一覧を返す",
  "input_schema": {
    "type": "object",
    "properties": {
      "job_category": {
        "type": "string",
        "enum": ["sales", "office", "engineer_it", "engineer_mech", "creative", "service",
                 "logistics", "medical", "education", "construction", "manufacturing",
                 "professional", "other"],
        "description": "職種の大分類"
      },
      "keywords": {
        "type": "array",
        "items": { "type": "string" },
        "maxItems": 5,
        "description": "職種名・スキル・資格などの自由語"
      },
      "location": {
        "type": "object",
        "properties": {
          "prefecture": { "type": "array", "items": { "type": "string" }, "maxItems": 3 },
          "city": { "type": "array", "items": { "type": "string" }, "maxItems": 3 },
          "station": { "type": "array", "items": { "type": "string" }, "maxItems": 3 },
          "area": { "type": "array", "items": { "type": "string" }, "maxItems": 3 },
          "commute_from": { "type": "string" },
          "commute_minutes": { "type": "integer", "minimum": 10, "maximum": 120 }
        }
      },
      "remote": { "type": "string", "enum": ["full", "hybrid", "none", "any"] },
      "employment_type": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": ["fulltime", "contract", "dispatch", "parttime", "freelance"]
        }
      },
      "salary_min_yearly": { "type": "integer", "description": "年収の下限(万円)" },
      "wage_min_hourly": { "type": "integer", "description": "時給の下限(円)" },
      "features": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": ["no_experience", "no_education_req", "weekends_off", "low_overtime",
                   "no_transfer", "side_job_ok", "flex", "childcare_support",
                   "short_hours", "students_welcome", "seniors_welcome"]
        }
      },
      "sort": { "type": "string", "enum": ["relevance", "newest", "salary_desc"] },
      "limit": { "type": "integer", "minimum": 1, "maximum": 20, "default": 10 }
    },
    "required": []
  }
}
```

## 返り値
- total: 該当件数
- jobs: 求人の配列。各要素は job_id, title, company_name, company_id, location_summary,
  salary_summary, employment_type, features, posted_at を持つ。

## 使い方
- 職種か勤務地のどちらかが分かった時点で呼んでよい。両方なくても、キーワードがあれば呼べる。
- ユーザーの口語は、勤務地・職種の言い換えの部品に従って変換してから渡す。
- 条件を変えて再検索するときは、変更していない条件も含めて全部渡す(差分ではない)。
- 「新着」「最近の」→ sort: newest。「給料が高い順」→ sort: salary_desc。
- 1回の応答で呼ぶのは最大2回まで。
- 結果は求人カードで最大5件紹介する(出力形式の部品に従う)。
- 「ほかにもある?」「もっと見たい」→ 同じ条件で、すでに紹介した求人を除いて紹介する。

## features の対応
- 「未経験OK」→ no_experience
- 「学歴不問」→ no_education_req
- 「土日休み」「土日祝休み」→ weekends_off
- 「残業少なめ」「定時で帰れる」→ low_overtime
- 「転勤なし」→ no_transfer
- 「副業OK」→ side_job_ok
- 「フレックス」→ flex
- 「子育て中」「時短」→ childcare_support / short_hours(どちらか確認する)
- 「学生OK」「大学生」→ students_welcome
- 「シニア歓迎」は、ユーザー自身が希望した場合だけ使う(年齢を推測して付けない)

## してはいけないこと
- 返り値にない求人を紹介しない。
- job_id を作らない。
- 年齢・性別を検索条件として渡さない。

## 呼び出し例
ユーザー: 名駅あたりで事務、正社員で
```json
{
  "job_category": "office",
  "keywords": ["一般事務"],
  "location": { "station": ["名古屋"] },
  "employment_type": ["fulltime"]
}
```
