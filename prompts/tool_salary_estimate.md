---
id: tool_salary_estimate
kind: selectable
summary: 職種・地域・経験年数ごとの給与相場を取得するツール salary_estimate の定義と使い方
summary_en: Definition and usage of salary_estimate, which returns market pay ranges by job type, region, and years of experience
use_when: 今回の応答で給与・年収・時給の相場を数値で示す必要がある(「相場は?」「この給料は普通?」「いくら稼げる?」)
use_when_en: This turn needs to show market pay figures (e.g., "what's the going rate?", "is this pay normal?", "how much can I earn?")
not_when: 相場の数値が不要(求人票の読み方の説明だけ、交渉の仕方だけ等)
not_when_en: Market figures are not needed (e.g., only explaining how to read a posting or how to negotiate)
---
# ツール: salary_estimate

職種・地域・経験年数ごとの給与相場を返します。

## 定義
```json
{
  "name": "salary_estimate",
  "description": "ハタラクラフト掲載求人の給与データから相場の範囲を返す",
  "input_schema": {
    "type": "object",
    "properties": {
      "job_category": {
        "type": "string",
        "description": "search_jobs と同じ職種の大分類"
      },
      "keywords": {
        "type": "array",
        "items": { "type": "string" },
        "maxItems": 3
      },
      "prefecture": { "type": "string" },
      "employment_type": {
        "type": "string",
        "enum": ["fulltime", "contract", "dispatch", "parttime"]
      },
      "experience_years": {
        "type": "string",
        "enum": ["none", "1-3", "3-5", "5-10", "10+"]
      },
      "unit": {
        "type": "string",
        "enum": ["yearly", "monthly", "hourly"],
        "description": "省略時は雇用形態から自動で決まる"
      }
    },
    "required": ["job_category"]
  }
}
```

## 返り値
- unit: yearly / monthly / hourly
- median: 中央値
- p25, p75: 下位25%・上位25%の値
- sample_size: 集計対象の求人数
- period: 集計期間
- note: 注意事項(サンプルが少ない等)

## 使い方
- 職種が分からなければ、まず職種を聞く(検索条件の部品に従う)。
- 地域が分からない場合は、全国の値を取得し「全国の目安」と明示する。
- 経験年数が分からない場合は省略してよい。分かれば渡す。
- 結果は「中央値 〇〇万円、多くは△△万〜□□万円の範囲」の形で伝える。
- sample_size が30未満の場合は、参考程度であることを添える。
- 求人の給与と比べるときは、get_job_detail の salary と単位をそろえる。
  - 固定残業代を含むかどうかで比較がずれることを伝える。

## 結果の伝え方
- 給与・待遇の部品の方針に従う(ユーザーの希望を評価しない)。
- 相場はハタラクラフト掲載求人の募集時の値であり、実際の支給額とは異なることを添える。

## してはいけないこと
- 返り値にない数字を出さない。
- 年齢・性別で相場を出さない(ツールにもその条件はない)。
- 相場から「年収交渉で〇〇万円を要求すべき」と具体額を勧めない。

## 呼び出し例
ユーザー: 福岡で経理5年やってたら年収どれくらいが普通?
```json
{
  "job_category": "office",
  "keywords": ["経理"],
  "prefecture": "福岡県",
  "employment_type": "fulltime",
  "experience_years": "5-10"
}
```
