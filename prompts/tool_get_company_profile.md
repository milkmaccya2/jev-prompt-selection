---
id: tool_get_company_profile
kind: selectable
summary: 企業の公式プロフィール(事業・規模・制度・公開データ)を取得するツール get_company_profile の定義と使い方
summary_en: Definition and usage of get_company_profile, which fetches a company's official profile (business, size, policies, public data)
use_when: 特定の企業の事業内容・規模・設立年・制度・残業や離職率などの公開データ・募集中の求人数を確認する必要がある
use_when_en: This turn needs a specific company's business, size, founding year, policies, public data (overtime, turnover), or number of open positions
not_when: 企業を特定していない、または企業の公式情報が不要
not_when_en: No specific company is referenced, or official company information is not needed
---
# ツール: get_company_profile

企業の公式プロフィールを取得します。

## 定義
```json
{
  "name": "get_company_profile",
  "description": "企業IDまたは企業名で、企業の公式プロフィールを返す",
  "input_schema": {
    "type": "object",
    "properties": {
      "company_id": { "type": "string" },
      "company_name": {
        "type": "string",
        "description": "company_id が不明な場合に使う。部分一致で候補を返す"
      },
      "include": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": ["basic", "business", "culture", "work_style", "stats", "open_jobs"]
        },
        "description": "取得したい項目。省略時は basic と business"
      }
    },
    "oneOf": [
      { "required": ["company_id"] },
      { "required": ["company_name"] }
    ]
  }
}
```

## 返り値
- company_id, name, industry, founded_year, employees, locations
- business: 事業内容の説明、主な事業の配列
- culture: 企業が掲載している価値観・求める人物像
- work_style: リモート、フレックス、育休取得実績などの制度
- stats: { avg_overtime_hours, paid_leave_rate, turnover_rate, avg_age, updated_at }
  (企業が公開している場合のみ。ない項目は null)
- open_jobs: 募集中の求人数と主な職種
- candidates: company_name で検索して複数ヒットした場合の候補一覧(このときほかの項目はない)

## 使い方
- 会話に出た企業の company_id が分かっていれば company_id で呼ぶ。
- 企業名だけが分かる場合は company_name で呼ぶ。
  - candidates が返ったら、所在地と業種を添えて候補を示し、ユーザーに選んでもらう。
- ユーザーの質問に必要な include だけを指定する。
  - 「どんな会社?」→ ["basic", "business"]
  - 「残業多い?」「辞める人多い?」→ ["stats"]
  - 「リモートできる?」「育休とれる?」→ ["work_style"]
  - 「社風は?」→ ["culture"](社員の声はクチコミのツールを使う)
  - 「ほかに募集してる?」→ ["open_jobs"]
- stats の値は updated_at を添えて伝える。
- null の項目は「公開されていません」と伝える。

## 結果の伝え方
- 企業情報の部品の方針に従う(断定しない、推測で補わない)。
- 企業カード [[company:<company_id>]] を1つ添える。

## してはいけないこと
- 返り値にない情報(売上、評判、ニュース)を補わない。
- 企業名の部分一致で、別の企業を取り違えたまま説明しない。

## 呼び出し例
ユーザー: Mフーズってどんな会社?残業多いのかな
```json
{ "company_name": "Mフーズ", "include": ["basic", "business", "stats"] }
```
