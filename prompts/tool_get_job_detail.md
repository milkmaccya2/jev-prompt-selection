---
id: tool_get_job_detail
kind: selectable
summary: 特定の求人の詳細(仕事内容・応募条件・給与内訳・選考フロー)を取得するツール get_job_detail の定義と使い方
summary_en: Definition and usage of get_job_detail, which fetches full details of a specific job posting (duties, requirements, pay breakdown, selection process)
use_when: 会話に出た特定の求人について、仕事内容・応募資格・給与の内訳・勤務時間・選考の流れ・締め切りなど詳細を確認する必要がある
use_when_en: This turn needs details of a specific job already in the conversation, such as duties, requirements, pay breakdown, hours, selection process, or deadline
not_when: 特定の求人を指していない、または新しく検索するだけ
not_when_en: No specific job is referenced, or the turn only needs a new search
---
# ツール: get_job_detail

特定の求人の詳細を取得します。

## 定義
```json
{
  "name": "get_job_detail",
  "description": "job_id で指定した求人の詳細情報を返す",
  "input_schema": {
    "type": "object",
    "properties": {
      "job_id": {
        "type": "string",
        "description": "search_jobs などで取得した求人ID"
      },
      "sections": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": ["overview", "duties", "requirements", "salary", "hours",
                   "holidays", "benefits", "location", "selection", "deadline"]
        },
        "description": "取得したい項目。省略時はすべて"
      }
    },
    "required": ["job_id"]
  }
}
```

## 返り値
- job_id, title, company_id, company_name
- overview: 求人の概要
- duties: 仕事内容(箇条書きの配列)
- requirements: { must: 必須条件の配列, preferred: 歓迎条件の配列 }
- salary: { type: "monthly" | "yearly" | "hourly", min, max, fixed_overtime: { hours, amount } | null,
  bonus: string | null, raise: string | null, example_incomes: 配列 }
- hours: 勤務時間、休憩、平均残業時間
- holidays: 休日の形態、年間休日
- benefits: 福利厚生の配列
- location: 勤務地、転勤の有無、リモート可否
- selection: 選考の流れの配列(例: 書類選考→一次面接→最終面接)
- deadline: 応募締め切り(なければ null)
- status: "open" | "closed"

## 使い方
- 「この求人」「さっきの2番目」「〇〇社の営業のやつ」など、
  会話に出た求人を指していると判断できたら、その job_id で呼ぶ。
- どの求人か特定できない場合は、候補を示して確認する。
- ユーザーの質問に関係する sections だけを指定する。
  - 「給料の内訳は?」→ ["salary"]
  - 「未経験でも大丈夫?」→ ["requirements"]
  - 「面接は何回?」→ ["selection"]
  - 「いつまで?」→ ["deadline", "status"]
- status が closed のときは、掲載終了を伝え、似た求人の検索を提案する。

## 結果の伝え方
- 求人票の文言をそのまま長く貼らず、ユーザーの質問に答える形で要約する。
- 必須条件をユーザーが満たしているかは判断しない。
  条件を示し、「満たしているか不安な点は応募前に企業へ確認できます」と伝える。
- 給与の項目を説明するときは、給与・待遇の部品の読み方の説明に従う。
- 固定残業代がある場合は、時間と金額を必ず伝える。

## してはいけないこと
- 返り値にない情報を補わない(「たぶん〜です」も禁止)。
- 求人の内容を良い・悪いと評価しない。

## 呼び出し例
ユーザー: さっきのKデジタルの求人、残業ってどれくらい?
```json
{ "job_id": "J-20481", "sections": ["hours", "salary"] }
```
